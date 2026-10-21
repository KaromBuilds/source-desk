import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSms, launchGate, meets12h, requiredEscalation, runEscalation, validateText, isAuthorizedConfirmer, scorecard } from "../lib/rules.ts";
import { demoState } from "../lib/demo.ts";
import type { DeskState, Incident } from "../lib/types.ts";

function unlocked(): DeskState {
  const s = demoState();
  s.agreement = { ...s.agreement, acceptedCorrections: true, acceptedEscalation: true, offlineRoute: "Doña Lupita calls 5 households each", supervisorId: "p3" };
  s.sources = s.sources.map((x) => (x.backupId ? x : { ...x, backupId: "p2" }));
  return s;
}

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: "i1", sector: "S2", kind: "scheduled", status: "confirmed", origin: "bulletin", modelScore: null,
    detectedAt: 0, utilityInputAt: 0, startsAt: 30 * 60, confirmedBy: "p1", confirmSourceId: "src1",
    cause: null, causeSource: null, restoration: null, restorationSource: null,
    publishedAt: 10 * 60, nextUpdateDue: 14 * 60, lastUpdateAt: null, dispatchAt: null, receiptCheckAt: null, escalationLevel: 0,
    ...over,
  };
}

test("T1: fresh demo is locked and names the missing duties", () => {
  const g = launchGate(demoState());
  assert.equal(g.locked, true);
  assert.ok(g.missing.some((m) => m.includes("corrections")));
  assert.ok(g.missing.some((m) => m.includes("escalation")));
  assert.ok(g.missing.some((m) => m.includes("backup")));
});

test("T2: two of three duties is still locked", () => {
  const s = unlocked();
  s.agreement.acceptedEscalation = false;
  const g = launchGate(s);
  assert.equal(g.locked, true);
  assert.deepEqual(g.missing, ["Utility contact has not accepted escalation"]);
});

test("T3: all duties + backups unlocks", () => {
  assert.deepEqual(launchGate(unlocked()), { locked: false, missing: [] });
});

test("same person as owner and backup does not count", () => {
  const s = unlocked();
  s.sources[0].backupId = s.sources[0].ownerId;
  assert.equal(launchGate(s).locked, true);
});

test("T6: only an authorized person can confirm", () => {
  const s = unlocked();
  const bulletin = s.sources.find((x) => x.id === "src1");
  const feed = s.sources.find((x) => x.id === "src2");
  assert.equal(isAuthorizedConfirmer(s, "p1", bulletin), true);
  assert.equal(isAuthorizedConfirmer(s, "p4", bulletin), false);
  assert.equal(isAuthorizedConfirmer(s, "p2", feed), false, "the sensor feed can never confirm an official event");
});

test("T7: SMS never invents cause or restoration", () => {
  const sms = buildSms(unlocked(), incident());
  assert.match(sms.text, /Causa: no confirmada/);
  assert.doesNotMatch(sms.text, /Regreso/);
  const withCause = buildSms(unlocked(), incident({ cause: "mantenimiento de bomba", causeSource: "Mesa de Operación" }));
  assert.match(withCause.text, /Causa: mantenimiento de bomba/);
  const unsourced = buildSms(unlocked(), incident({ cause: "fuga", causeSource: null }));
  assert.match(unsourced.text, /no confirmada/, "a cause without a source is not shown");
});

test("T8: 12-hour target", () => {
  assert.equal(meets12h(incident({ publishedAt: 30 * 60 - 8 * 60 })), false);
  assert.equal(meets12h(incident({ publishedAt: 30 * 60 - 12 * 60 })), true);
  assert.equal(meets12h(incident({ kind: "unexpected" })), null);
});

test("T9: escalation steps to backup then supervisor, and an update stops it", () => {
  const i = incident();
  assert.equal(requiredEscalation(i, 14 * 60), 0);
  assert.equal(requiredEscalation(i, 14 * 60 + 5), 1);
  assert.equal(requiredEscalation(i, 16 * 60 + 5), 2);
  // update posted at 13:00 moved the due to 17:00
  assert.equal(requiredEscalation({ ...i, lastUpdateAt: 13 * 60, nextUpdateDue: 17 * 60 }, 16 * 60), 0);
  // ...but if that second due is missed too, it escalates again
  assert.equal(requiredEscalation({ ...i, lastUpdateAt: 13 * 60, nextUpdateDue: 17 * 60 }, 17 * 60 + 30), 1);
});

test("runEscalation logs once per level", () => {
  const s = { ...unlocked(), incidents: [incident()] };
  const a = runEscalation(s, 17 * 60);
  const b = runEscalation(a, 17 * 60 + 30);
  const esc = b.log.filter((e) => e.type === "escalation");
  assert.equal(esc.length, 2);
  assert.equal(b.incidents[0].escalationLevel, 2);
});

test("T12: validation", () => {
  assert.equal(validateText("", 80).ok, false);
  assert.equal(validateText("x".repeat(500), 80).ok, false);
  const v = validateText("  hola\u0000  mundo ", 80);
  assert.deepEqual(v, { ok: true, value: "hola mundo" });
});

test("scorecard reports denominators and says inconclusive with no events", () => {
  const sc = scorecard(unlocked());
  assert.equal(sc.scheduled.den, 0);
});

import { smsSegments, smsName } from "../lib/rules.ts";
test("bug fix: model-raised SMS never states a start time as fact", () => {
  const sms = buildSms(unlocked(), incident({ kind: "unexpected", origin: "model", detectedAt: 13 * 60 + 30, startsAt: 13 * 60 + 30, utilityInputAt: 14 * 60 }));
  assert.doesNotMatch(sms.text, /desde/);
  assert.match(sms.text, /confirmada lun 14:00/);
});
test("bug fix: no English source note inside the Spanish SMS", () => {
  assert.equal(smsName("Mesa de Operación (utility bulletin)"), "Mesa de Operación");
  assert.doesNotMatch(buildSms(unlocked(), incident()).text, /utility bulletin/);
});
test("bug fix: SMS segments follow the real encoding", () => {
  assert.deepEqual(smsSegments("a".repeat(160)), { encoding: "GSM-7", units: 160, segments: 1 });
  assert.equal(smsSegments("á" + "a".repeat(100)).encoding, "UCS-2");
  assert.equal(smsSegments("á" + "a".repeat(100)).segments, 2);
  const sms = buildSms(unlocked(), incident());
  assert.equal(sms.encoding, "GSM-7", "accents outside GSM-7 are swapped so the notice stays cheap");
  assert.equal(sms.segments, 1);
});
