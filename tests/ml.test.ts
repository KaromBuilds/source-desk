import { test } from "node:test";
import assert from "node:assert/strict";
import { trainModel, scoreSeries, THRESHOLD } from "../lib/ml.ts";
import { demoSeries } from "../lib/feed.ts";

const model = trainModel();
const scored = scoreSeries(model, demoSeries());
const maxIn = (s: "S1" | "S2" | "S3" | "S4", a: number, b: number) =>
  Math.max(...scored[s].filter((r) => r.minute >= a && r.minute < b).map((r) => r.score));

test("model reaches useful held-out quality on SIMULATED history", () => {
  console.log("held-out", model.heldOut, "trained on", model.trainedOn);
  assert.ok(model.heldOut.accuracy > 0.85, `accuracy ${model.heldOut.accuracy}`);
  assert.ok(model.heldOut.precision > 0.8, `precision ${model.heldOut.precision}`);
});

test("T4: Sector 2 sustained drop becomes a candidate", () => {
  assert.ok(maxIn("S2", 13 * 60, 15 * 60) >= THRESHOLD, `S2 max ${maxIn("S2", 13 * 60, 15 * 60)}`);
});

test("T5: Sector 3 one-reading glitch stays below threshold", () => {
  assert.ok(maxIn("S3", 11 * 60, 12 * 60) < THRESHOLD, `S3 max ${maxIn("S3", 11 * 60, 12 * 60)}`);
});

test("quiet periods stay quiet", () => {
  assert.ok(maxIn("S1", 0, 10 * 60) < THRESHOLD);
  assert.ok(maxIn("S4", 0, 14 * 60) < THRESHOLD);
});

import { evaluateEvents } from "../lib/ml.ts";
test("event-level check on a fresh SIMULATED history", () => {
  const ev = evaluateEvents(model);
  console.log("events", ev);
  assert.ok(ev.realDetected / ev.realTotal >= 0.9);
  assert.ok(ev.glitchFlagged / ev.glitchTotal <= 0.1);
});
