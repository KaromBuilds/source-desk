// Pure state transitions for the desk. The UI only calls these.
import type { Correction, DeskState, Incident, LogEvent, Minutes, SectorId, Source } from "./types.ts";
import { CORRECTION_DUE_MIN, HOUSEHOLD_REJECTION, UPDATE_EVERY_MIN, isAuthorizedConfirmer, launchGate, newId, personName, runEscalation, validateText } from "./rules.ts";
import { THRESHOLD, type Scored } from "./ml.ts";
import { fmt } from "./time.ts";

export type Result = { ok: true; state: DeskState } | { ok: false; error: string };

const addLog = (s: DeskState, e: LogEvent): DeskState => ({ ...s, log: [...s.log, e].sort((a, b) => a.at - b.at) });

/** Advance the simulated clock: turn high-score readings into CANDIDATE incidents, then run escalation. */
export function advanceClock(state: DeskState, to: Minutes, scored: Record<SectorId, Scored[]>): DeskState {
  let s: DeskState = { ...state, now: Math.max(state.now, to) };
  for (const sector of Object.keys(scored) as SectorId[]) {
    for (const r of scored[sector]) {
      if (r.minute <= state.now || r.minute > s.now) continue;
      if (r.score < THRESHOLD) continue;
      // one candidate per event: skip while another one for this sector is open or was raised in the last 3 h
      const recent = s.incidents.some(
        (i) => i.sector === sector && i.origin === "model" && (i.status === "candidate" || i.status === "confirmed" || r.minute - i.detectedAt < 180),
      );
      if (recent) continue;
      const inc: Incident = {
        id: newId("INC-", s.incidents), sector, kind: "unexpected", status: "candidate", origin: "model",
        modelScore: Math.round(r.score * 100) / 100, detectedAt: r.minute, utilityInputAt: null, startsAt: r.minute,
        confirmedBy: null, confirmSourceId: null, cause: null, causeSource: null, restoration: null, restorationSource: null,
        publishedAt: null, nextUpdateDue: null, lastUpdateAt: null, dispatchAt: null, receiptCheckAt: null, escalationLevel: 0,
      };
      s = { ...s, incidents: [...s.incidents, inc] };
      s = addLog(s, { at: r.minute, type: "candidate", incidentId: inc.id, text: `Model flagged ${sector} (score ${inc.modelScore}). Candidate only, awaiting authorized confirmation.` });
    }
  }
  return runEscalation(s, s.now);
}

export function saveAgreement(state: DeskState, patch: Partial<DeskState["agreement"]>): Result {
  const next = { ...state.agreement, ...patch };
  if (patch.offlineRoute !== undefined) {
    const v = validateText(patch.offlineRoute, 200, false);
    if (!v.ok) return { ok: false, error: v.error };
    next.offlineRoute = v.value;
  }
  let s = { ...state, agreement: next };
  const before = launchGate(state).locked;
  const after = launchGate(s).locked;
  if (before !== after) s = addLog(s, { at: s.now, type: "gate", text: after ? "Pilot LOCKED again." : "All duties accepted. Pilot UNLOCKED." });
  if (after && s.spendingAuthorized) s = { ...s, spendingAuthorized: false };
  return { ok: true, state: s };
}

export function saveSource(state: DeskState, src: Source): Result {
  const label = validateText(src.label, 80);
  if (!label.ok) return { ok: false, error: `Label: ${label.error}` };
  const method = validateText(src.method, 160);
  if (!method.ok) return { ok: false, error: `Verification method: ${method.error}` };
  if (!state.people.some((p) => p.id === src.ownerId)) return { ok: false, error: "Pick an owner." };
  if (src.backupId && src.backupId === src.ownerId) return { ok: false, error: "The backup must be a different person than the owner." };
  if (src.kind === "pressure-feed" && src.canConfirm) return { ok: false, error: "A sensor feed can't confirm official events. Only an authorized person can (Condition 2)." };
  const clean = { ...src, label: label.value, method: method.value };
  const exists = state.sources.some((x) => x.id === src.id);
  const sources = exists ? state.sources.map((x) => (x.id === src.id ? clean : x)) : [...state.sources, { ...clean, id: newId("src", state.sources) }];
  let s = { ...state, sources };
  s = addLog(s, { at: s.now, type: "source", text: `${exists ? "Updated" : "Registered"} source "${clean.label}": owner ${personName(s, clean.ownerId)}, backup ${personName(s, clean.backupId)}.` });
  const wasLocked = launchGate(state).locked;
  const nowLocked = launchGate(s).locked;
  if (wasLocked !== nowLocked) s = addLog(s, { at: s.now, type: "gate", text: nowLocked ? "Pilot LOCKED again." : "All duties accepted. Pilot UNLOCKED." });
  return { ok: true, state: s };
}

export function verifySource(state: DeskState, id: string): DeskState {
  const s = { ...state, sources: state.sources.map((x) => (x.id === id ? { ...x, verifiedAt: state.now } : x)) };
  const src = s.sources.find((x) => x.id === id);
  return addLog(s, { at: s.now, type: "source", text: `Source "${src?.label}" verified by its owner.` });
}

export function authorizeSpending(state: DeskState): Result {
  if (launchGate(state).locked) return { ok: false, error: "Locked: no field spending before the utility contact accepts verification, corrections and escalation (Condition 3)." };
  return { ok: true, state: addLog({ ...state, spendingAuthorized: true }, { at: state.now, type: "spending", text: "Field spending authorized (pilot cap MX$15,000)." }) };
}

function needUnlocked(state: DeskState): string | null {
  return launchGate(state).locked ? "The pilot is locked. Finish onboarding first." : null;
}

export const CONFIRM_METHODS = ["Phone call with the person", "Message from the utility's official number", "Written bulletin from the utility"] as const;

export function confirmIncident(state: DeskState, id: string, personId: string, sourceId: string, method: string): Result {
  const lock = needUnlocked(state);
  if (lock) return { ok: false, error: lock };
  if (!(CONFIRM_METHODS as readonly string[]).includes(method))
    return { ok: false, error: "First get the confirmation yourself (call or message the utility), then say how you got it. This app does not contact anyone." };
  const src = state.sources.find((x) => x.id === sourceId);
  if (!isAuthorizedConfirmer(state, personId, src)) return { ok: false, error: `${personName(state, personId)} is not authorized to confirm official events from this source.` };
  const inc = state.incidents.find((i) => i.id === id);
  if (!inc || inc.status !== "candidate") return { ok: false, error: "Only a candidate can be confirmed." };
  const s = {
    ...state,
    incidents: state.incidents.map((i) => (i.id === id ? { ...i, status: "confirmed" as const, confirmedBy: personId, confirmSourceId: sourceId, utilityInputAt: state.now } : i)),
  };
  return { ok: true, state: addLog(s, { at: state.now, type: "confirm", incidentId: id, text: `${id} confirmed by ${personName(state, personId)} via "${src?.label}" (${method.toLowerCase()}). Utility input delay: ${state.now - inc.detectedAt} min.` }) };
}

export function dismissIncident(state: DeskState, id: string, reason: string): Result {
  const r = validateText(reason, 160);
  if (!r.ok) return { ok: false, error: `Reason: ${r.error}` };
  const s = { ...state, incidents: state.incidents.map((i) => (i.id === id ? { ...i, status: "dismissed" as const } : i)) };
  return { ok: true, state: addLog(s, { at: state.now, type: "dismiss", incidentId: id, text: `${id} dismissed as a false alarm: ${r.value}` }) };
}

export function addScheduledCut(state: DeskState, sector: SectorId, startsAt: Minutes, personId: string, sourceId: string, cause: string, causeSource: string): Result {
  const lock = needUnlocked(state);
  if (lock) return { ok: false, error: lock };
  if (startsAt <= state.now) return { ok: false, error: "The cut must start after the current time." };
  const src = state.sources.find((x) => x.id === sourceId);
  if (!isAuthorizedConfirmer(state, personId, src)) return { ok: false, error: `${personName(state, personId)} is not authorized to confirm official events from this source.` };
  const c = validateText(cause, 80, false);
  const cs = validateText(causeSource, 80, false);
  if (!c.ok) return { ok: false, error: `Cause: ${c.error}` };
  if (!cs.ok) return { ok: false, error: `Cause source: ${cs.error}` };
  if (c.value && !cs.value) return { ok: false, error: "A cause needs a source. Leave it empty and the SMS will say \"no confirmada\"." };
  const inc: Incident = {
    id: newId("INC-", state.incidents), sector, kind: "scheduled", status: "confirmed", origin: "bulletin", modelScore: null,
    detectedAt: state.now, utilityInputAt: state.now, startsAt, confirmedBy: personId, confirmSourceId: sourceId,
    cause: c.value || null, causeSource: cs.value || null, restoration: null, restorationSource: null,
    publishedAt: null, nextUpdateDue: null, lastUpdateAt: null, dispatchAt: null, receiptCheckAt: null, escalationLevel: 0,
  };
  const s = { ...state, incidents: [...state.incidents, inc] };
  return { ok: true, state: addLog(s, { at: state.now, type: "confirm", incidentId: inc.id, text: `Scheduled cut ${inc.id} in ${sector} at ${fmt(startsAt)} confirmed by ${personName(state, personId)}.` }) };
}

export function publishNotice(state: DeskState, id: string): Result {
  const lock = needUnlocked(state);
  if (lock) return { ok: false, error: lock };
  const inc = state.incidents.find((i) => i.id === id);
  if (!inc || inc.status !== "confirmed") return { ok: false, error: "Only a confirmed incident can be published." };
  if (inc.publishedAt !== null) return { ok: false, error: "Already published. Post an update instead." };
  const s = { ...state, incidents: state.incidents.map((i) => (i.id === id ? { ...i, publishedAt: state.now, nextUpdateDue: state.now + UPDATE_EVERY_MIN } : i)) };
  return { ok: true, state: addLog(s, { at: state.now, type: "publish", incidentId: id, text: `Notice for ${id} published (SMS preview + offline route). Next update due ${fmt(state.now + UPDATE_EVERY_MIN)}.` }) };
}

export function postUpdate(state: DeskState, id: string, note: string, close: boolean): Result {
  const r = validateText(note, 160);
  if (!r.ok) return { ok: false, error: `Update: ${r.error}` };
  const inc = state.incidents.find((i) => i.id === id);
  if (!inc || inc.publishedAt === null || inc.status !== "confirmed") return { ok: false, error: "Publish the notice first." };
  const s = {
    ...state,
    incidents: state.incidents.map((i) =>
      i.id === id ? { ...i, lastUpdateAt: state.now, nextUpdateDue: close ? null : state.now + UPDATE_EVERY_MIN, escalationLevel: 0 as const, status: close ? ("closed" as const) : i.status } : i,
    ),
  };
  return { ok: true, state: addLog(s, { at: state.now, type: "update", incidentId: id, text: `${id} ${close ? "closed" : "updated"}: ${r.value}${close ? "" : ` Next update due ${fmt(state.now + UPDATE_EVERY_MIN)}.`}` }) };
}

export function recordDispatch(state: DeskState, id: string): DeskState {
  const s = { ...state, incidents: state.incidents.map((i) => (i.id === id ? { ...i, dispatchAt: state.now } : i)) };
  return addLog(s, { at: state.now, type: "dispatch", incidentId: id, text: `Water truck dispatched for ${id}.` });
}

export function recordReceipt(state: DeskState, id: string): DeskState {
  const s = { ...state, incidents: state.incidents.map((i) => (i.id === id ? { ...i, receiptCheckAt: state.now } : i)) };
  return addLog(s, { at: state.now, type: "receipt", incidentId: id, text: `Community contact checked that notices were received for ${id}.` });
}

export function addCorrection(state: DeskState, sector: SectorId, channel: Correction["channel"], text: string, incidentId: string | null): Result {
  const r = validateText(text, 200);
  if (!r.ok) return { ok: false, error: `Report: ${r.error}` };
  const owner = state.sources.find((x) => x.kind === "utility-bulletin")?.ownerId ?? state.agreement.contactId;
  if (!owner) return { ok: false, error: "No owner for corrections. Name a utility contact first." };
  const c: Correction = {
    id: newId("COR-", state.corrections), incidentId, sector, channel, text: r.value, reportedAt: state.now,
    dueAt: state.now + CORRECTION_DUE_MIN, ownerId: owner, status: "open", resolvedAt: null, resolution: null,
  };
  const s = { ...state, corrections: [...state.corrections, c] };
  return { ok: true, state: addLog(s, { at: state.now, type: "correction", incidentId: incidentId ?? undefined, text: `${c.id} received by ${channel} (${sector}): "${r.value}". Owner ${personName(state, owner)}, due ${fmt(c.dueAt)}.` }) };
}

export function resolveCorrection(state: DeskState, id: string, accept: boolean, resolution: string): Result {
  const r = validateText(resolution, 160);
  if (!r.ok) return { ok: false, error: `Resolution: ${r.error}` };
  const c = state.corrections.find((x) => x.id === id);
  if (!c || c.status !== "open") return { ok: false, error: "This correction is already closed." };
  const s = { ...state, corrections: state.corrections.map((x) => (x.id === id ? { ...x, status: accept ? ("accepted" as const) : ("rejected" as const), resolvedAt: state.now, resolution: r.value } : x)) };
  const late = state.now > c.dueAt;
  return { ok: true, state: addLog(s, { at: state.now, type: "correction", incidentId: c.incidentId ?? undefined, text: `${id} ${accept ? "accepted, correction notice sent" : "rejected"}${late ? " (LATE)" : ""}: ${r.value}` }) };
}

export function householdRequest(state: DeskState, sector: SectorId, text: string): Result {
  const r = validateText(text, 200);
  if (!r.ok) return { ok: false, error: `Request: ${r.error}` };
  return { ok: true, state: addLog(state, { at: state.now, type: "rejected", text: `Household repair request in ${sector} not taken: "${r.value}". ${HOUSEHOLD_REJECTION}` }) };
}
