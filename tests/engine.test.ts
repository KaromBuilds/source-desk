import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine.ts";
import { demoState } from "../lib/demo.ts";
import { trainModel, scoreSeries } from "../lib/ml.ts";
import { demoSeries } from "../lib/feed.ts";
import type { DeskState } from "../lib/types.ts";

const scored = scoreSeries(trainModel(), demoSeries());
const ok = (r: E.Result): DeskState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

function onboarded(): DeskState {
  let s = demoState();
  s = ok(E.saveAgreement(s, { acceptedCorrections: true, acceptedEscalation: true, offlineRoute: "Community contacts call each household", supervisorId: "p3" }));
  s = ok(E.saveSource(s, { ...s.sources[0], backupId: "p2" }));
  return s;
}

test("locked desk refuses spending, confirmations and cuts", () => {
  const s = demoState();
  assert.equal(E.authorizeSpending(s).ok, false);
  assert.equal(E.addScheduledCut(s, "S1", 30 * 60, "p1", "src1", "", "").ok, false);
});

test("full day: candidate, confirm, publish, escalate, update", () => {
  let s = onboarded();
  s = ok(E.authorizeSpending(s));
  s = E.advanceClock(s, 12 * 60, scored); // S3 glitch at 11:15 should not create anything
  assert.equal(s.incidents.length, 0);
  s = E.advanceClock(s, 14 * 60, scored);
  const cand = s.incidents.find((i) => i.sector === "S2");
  assert.ok(cand && cand.status === "candidate");
  assert.equal(E.confirmIncident(s, cand.id, "p4", "src1").ok, false, "community contact can't confirm");
  s = ok(E.confirmIncident(s, cand.id, "p1", "src1"));
  s = ok(E.publishNotice(s, cand.id));
  s = E.advanceClock(s, 18 * 60 + 30, scored); // due 18:00 missed
  assert.equal(s.incidents.find((i) => i.id === cand.id)?.escalationLevel, 1);
  s = E.advanceClock(s, 20 * 60 + 30, scored);
  assert.equal(s.incidents.find((i) => i.id === cand.id)?.escalationLevel, 2);
  s = ok(E.postUpdate(s, cand.id, "Pressure back in Sector 2, confirmed by ops desk", true));
  assert.equal(s.incidents.find((i) => i.id === cand.id)?.status, "closed");
});

test("scheduled cut, correction and household rejection", () => {
  let s = onboarded();
  assert.equal(E.addScheduledCut(s, "S1", 30 * 60, "p1", "src1", "fuga", "").ok, false, "cause without source rejected");
  s = ok(E.addScheduledCut(s, "S1", 30 * 60, "p1", "src1", "", ""));
  s = ok(E.addCorrection(s, "S1", "offline route", "Notice says Sector 1 but our street is in Sector 3", s.incidents[0].id));
  s = E.advanceClock(s, s.now + 3 * 60, scored);
  assert.ok(s.log.some((e) => e.type === "escalation" && e.text.startsWith("Correction")));
  s = ok(E.resolveCorrection(s, s.corrections[0].id, true, "Street moved to Sector 3 list"));
  assert.match(s.log.at(-1)!.text, /LATE/);
  const before = s.log.length;
  s = ok(E.householdRequest(s, "S2", "My tinaco valve leaks"));
  assert.equal(s.log.length, before + 1);
  assert.equal(s.corrections.length, 1);
  assert.equal(s.incidents.length, 1);
});
