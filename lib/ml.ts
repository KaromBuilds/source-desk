// Anomaly classifier: logistic regression trained on SIMULATED labeled history.
// It separates sustained supply drops from one-reading sensor glitches.
// Output is a CANDIDATE score only. It never states a cause, restoration time or water quality.
import type { SectorId } from "./types.ts";
import { generateSeries, mulberry32, randomEvents, SECTOR_IDS, STEP_MIN, type InjectedEvent, type Series } from "./feed.ts";

export const THRESHOLD = 0.7;
const DROP_MIN = 0.35; // bar

export interface Features {
  drop: number; // bar below lagged baseline
  z: number; // drop / noise
  persistence: number; // consecutive low readings
  neighbor: number; // share of other sectors also low
}

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function std(xs: number[]): number {
  const mu = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / xs.length);
}

/** Drop vs. a lagged baseline (readings k-20..k-5), so a sustained drop isn't absorbed for ~1 h. */
function dropAt(arr: number[], k: number): { drop: number; noise: number } {
  const lo = Math.max(0, k - 20);
  const hi = Math.max(lo + 1, k - 4);
  const win = arr.slice(lo, hi);
  if (win.length < 4) return { drop: 0, noise: 0.05 };
  return { drop: median(win) - arr[k], noise: Math.max(0.03, std(win)) };
}

export function featureMatrix(series: Series): Record<SectorId, Features[]> {
  const n = series.S1.length;
  const drops = {} as Record<SectorId, number[]>;
  const noises = {} as Record<SectorId, number[]>;
  for (const s of SECTOR_IDS) {
    drops[s] = [];
    noises[s] = [];
    for (let k = 0; k < n; k++) {
      const d = dropAt(series[s], k);
      drops[s].push(d.drop);
      noises[s].push(d.noise);
    }
  }
  const out = {} as Record<SectorId, Features[]>;
  for (const s of SECTOR_IDS) {
    const f: Features[] = [];
    let persist = 0;
    for (let k = 0; k < n; k++) {
      const drop = drops[s][k];
      persist = drop > DROP_MIN ? persist + 1 : 0;
      const others = SECTOR_IDS.filter((o) => o !== s);
      const neighbor = others.filter((o) => drops[o][k] > DROP_MIN).length / others.length;
      f.push({ drop, z: Math.max(-10, Math.min(10, drop / noises[s][k])), persistence: Math.min(persist, 6), neighbor });
    }
    out[s] = f;
  }
  return out;
}

function vec(f: Features): number[] {
  return [f.drop, f.z / 5, f.persistence / 3, f.neighbor];
}

export interface Model {
  w: number[];
  b: number;
  heldOut: { accuracy: number; precision: number; recall: number; n: number };
  trainedOn: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function predict(m: Model, f: Features): number {
  const x = vec(f);
  return sigmoid(x.reduce((s, xi, i) => s + xi * m.w[i], m.b));
}

/** A reading counts as "real" from the 2nd reading of a sustained drop on. */
function labelFor(events: InjectedEvent[], s: SectorId, minute: number): number {
  return events.some((e) => e.sector === s && e.kind === "real" && minute >= e.start + STEP_MIN && minute < e.end) ? 1 : 0;
}

export function trainModel(seed = 7, days = 30): Model {
  const rand = mulberry32(seed);
  const hours = days * 24;
  const events = randomEvents(rand, hours);
  const series = generateSeries(seed * 31 + 1, hours, events);
  const feats = featureMatrix(series);
  const X: number[][] = [];
  const y: number[] = [];
  for (const s of SECTOR_IDS) {
    feats[s].forEach((f, k) => {
      // train only on readings that look unusual or sit in an event; normal readings are easy and dominate otherwise
      const inEvent = events.some((e) => e.sector === s && k * STEP_MIN >= e.start && k * STEP_MIN < e.end);
      if (!inEvent && f.drop < 0.15 && rand() > 0.15) return;
      X.push(vec(f));
      y.push(labelFor(events, s, k * STEP_MIN));
    });
  }
  // shuffle + split
  const idx = X.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const cut = Math.floor(idx.length * 0.7);
  const tr = idx.slice(0, cut);
  const te = idx.slice(cut);
  const w = [0, 0, 0, 0];
  let b = 0;
  const lr = 0.5;
  for (let it = 0; it < 800; it++) {
    const gw = [0, 0, 0, 0];
    let gb = 0;
    for (const i of tr) {
      const p = sigmoid(X[i].reduce((s, xi, j) => s + xi * w[j], b));
      const e = p - y[i];
      for (let j = 0; j < 4; j++) gw[j] += e * X[i][j];
      gb += e;
    }
    for (let j = 0; j < 4; j++) w[j] -= (lr * gw[j]) / tr.length;
    b -= (lr * gb) / tr.length;
  }
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const i of te) {
    const p = sigmoid(X[i].reduce((s, xi, j) => s + xi * w[j], b)) >= THRESHOLD ? 1 : 0;
    if (p && y[i]) tp++;
    else if (p && !y[i]) fp++;
    else if (!p && !y[i]) tn++;
    else fn++;
  }
  return {
    w,
    b,
    heldOut: { accuracy: (tp + tn) / te.length, precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0, n: te.length },
    trainedOn: tr.length,
  };
}

/**
 * Event-level check on a fresh SIMULATED history (different seed than training):
 * how many real drops got at least one flag, and how many glitches got flagged by mistake.
 */
export function evaluateEvents(m: Model, seed = 99, days = 20) {
  const rand = mulberry32(seed);
  const hours = days * 24;
  const events = randomEvents(rand, hours);
  const series = generateSeries(seed * 31 + 1, hours, events);
  const scored = scoreSeries(m, series);
  const flagged = (e: InjectedEvent) =>
    scored[e.sector].some((r) => r.minute >= e.start && r.minute < e.end + STEP_MIN && r.score >= THRESHOLD);
  const real = events.filter((e) => e.kind === "real");
  const glitch = events.filter((e) => e.kind === "glitch");
  const delays = real
    .map((e) => scored[e.sector].find((r) => r.minute >= e.start && r.minute < e.end + STEP_MIN && r.score >= THRESHOLD))
    .filter((r): r is Scored => !!r)
    .map((r, i) => r.minute - real.filter(flagged)[i].start);
  return {
    realDetected: real.filter(flagged).length,
    realTotal: real.length,
    glitchFlagged: glitch.filter(flagged).length,
    glitchTotal: glitch.length,
    medianDelayMin: delays.length ? median(delays) : null,
  };
}

export interface Scored {
  minute: number;
  pressure: number;
  score: number;
  features: Features;
}

export function scoreSeries(m: Model, series: Series): Record<SectorId, Scored[]> {
  const feats = featureMatrix(series);
  const out = {} as Record<SectorId, Scored[]>;
  for (const s of SECTOR_IDS) {
    out[s] = feats[s].map((f, k) => ({ minute: k * STEP_MIN, pressure: series[s][k], score: predict(m, f), features: f }));
  }
  return out;
}
