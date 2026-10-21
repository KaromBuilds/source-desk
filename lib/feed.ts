// SIMULATED sector pressure feed. No real sensor or utility data is used anywhere.
import type { SectorId } from "./types.ts";

export const STEP_MIN = 15;
export const SECTOR_IDS: SectorId[] = ["S1", "S2", "S3", "S4"];

export interface InjectedEvent {
  sector: SectorId;
  start: number; // minutes
  end: number; // minutes (exclusive)
  kind: "real" | "glitch";
  depth: number; // bar
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Daily demand pattern: pressure sags at the morning and evening peaks. */
export function diurnal(minute: number): number {
  const h = (minute % 1440) / 60;
  const morning = Math.exp(-((h - 7.5) ** 2) / 2.5);
  const evening = Math.exp(-((h - 20) ** 2) / 3);
  return -0.35 * morning - 0.25 * evening;
}

const BASE: Record<SectorId, number> = { S1: 2.3, S2: 2.1, S3: 2.2, S4: 2.0 };

// The demo's scripted events (fictional).
export const DEMO_EVENTS: InjectedEvent[] = [
  { sector: "S3", start: 11 * 60 + 15, end: 11 * 60 + 30, kind: "glitch", depth: 1.3 },
  { sector: "S2", start: 13 * 60, end: 17 * 60 + 30, kind: "real", depth: 1.05 },
  { sector: "S1", start: 24 * 60 + 10 * 60, end: 24 * 60 + 10 * 60 + 15, kind: "glitch", depth: 1.2 },
  { sector: "S4", start: 24 * 60 + 15 * 60, end: 24 * 60 + 18 * 60, kind: "real", depth: 0.9 },
];

export type Series = Record<SectorId, number[]>;

export function generateSeries(seed: number, hours: number, events: InjectedEvent[]): Series {
  const rand = mulberry32(seed);
  const n = Math.floor((hours * 60) / STEP_MIN);
  const out = {} as Series;
  for (const s of SECTOR_IDS) {
    const arr: number[] = [];
    for (let k = 0; k < n; k++) {
      const m = k * STEP_MIN;
      let p = BASE[s] + diurnal(m) + 0.05 * gauss(rand);
      for (const e of events) if (e.sector === s && m >= e.start && m < e.end) p -= e.depth;
      arr.push(Math.max(0, Math.round(p * 1000) / 1000));
    }
    out[s] = arr;
  }
  return out;
}

export const DEMO_HOURS = 48;
let demoCache: Series | null = null;
export function demoSeries(): Series {
  if (!demoCache) demoCache = generateSeries(20261021, DEMO_HOURS, DEMO_EVENTS);
  return demoCache;
}

/** Random events for training history (different seed from the demo). */
export function randomEvents(rand: () => number, hours: number): InjectedEvent[] {
  const ev: InjectedEvent[] = [];
  const total = hours * 60;
  for (const s of SECTOR_IDS) {
    let t = 120 + Math.floor(rand() * 600);
    while (t < total - 300) {
      const real = rand() < 0.5;
      const dur = real ? (6 + Math.floor(rand() * 18)) * STEP_MIN : (1 + Math.floor(rand() * 2)) * STEP_MIN;
      const depth = real ? 0.5 + rand() * 0.9 : 0.6 + rand() * 1.0;
      ev.push({ sector: s, start: t - (t % STEP_MIN), end: t - (t % STEP_MIN) + dur, kind: real ? "real" : "glitch", depth });
      t += 600 + Math.floor(rand() * 1800);
    }
  }
  // occasional network-wide real drop (pump station), hits all sectors
  return ev;
}
