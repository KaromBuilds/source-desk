import type { Correction, DeskState, Incident, LogEvent, Minutes, Person, Source } from "./types.ts";
import { fmt, fmtEs } from "./time.ts";

export const TARGET_LEAD_MIN = 12 * 60; // Condition 4: 12-hour notice for scheduled cuts
export const UPDATE_EVERY_MIN = 4 * 60; // next update promised every 4 h
export const CORRECTION_DUE_MIN = 2 * 60; // corrections answered within 2 h
export const SUPERVISOR_AFTER_MIN = 2 * 60; // level 2 escalation 2 h after level 1

export const HOUSEHOLD_REJECTION =
  "Not public network. Household repairs are separate from public-network work, and this pilot has no pooled repair coverage (Condition 3).";

// ---------- validation (security floor #4) ----------
export function validateText(raw: unknown, max: number, required = true): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Invalid input." };
  // strip control characters and collapse whitespace
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (required && value.length === 0) return { ok: false, error: "This field is required." };
  if (value.length > max) return { ok: false, error: `Keep it under ${max} characters (now ${value.length}).` };
  return { ok: true, value };
}

// ---------- people & sources ----------
export function person(state: DeskState, id: string | null): Person | undefined {
  return id ? state.people.find((p) => p.id === id) : undefined;
}

export function personName(state: DeskState, id: string | null): string {
  const p = person(state, id);
  return p ? `${p.name} (${p.role})` : "Unassigned";
}

/** Only an authorized human confirms official events (Condition 2). */
export function isAuthorizedConfirmer(state: DeskState, personId: string, source: Source | undefined): boolean {
  if (!source || !source.canConfirm) return false;
  if (state.agreement.contactId === personId && source.kind === "utility-bulletin") return true;
  return source.ownerId === personId || source.backupId === personId;
}

// ---------- the launch gate (Condition 3) ----------
export function launchGate(state: DeskState): { locked: boolean; missing: string[] } {
  const a = state.agreement;
  const missing: string[] = [];
  if (!a.contactId) missing.push("No utility contact named");
  if (!a.acceptedVerification) missing.push("Utility contact has not accepted source verification");
  if (!a.acceptedCorrections) missing.push("Utility contact has not accepted corrections");
  if (!a.acceptedEscalation) missing.push("Utility contact has not accepted escalation");
  if (!a.supervisorId) missing.push("No escalation supervisor named");
  if (a.offlineRoute.trim().length === 0) missing.push("No offline contact route agreed (SMS-only is not enough)");
  if (state.sources.length === 0) missing.push("No sources registered");
  for (const s of state.sources) {
    if (!s.ownerId) missing.push(`Source "${s.label}" has no owner`);
    else if (!s.backupId) missing.push(`Source "${s.label}" has no backup owner`);
    else if (s.backupId === s.ownerId) missing.push(`Source "${s.label}" has the same person as owner and backup`);
  }
  if (!state.sources.some((s) => s.canConfirm)) missing.push("No source is allowed to confirm official events");
  return { locked: missing.length > 0, missing };
}

// ---------- 12-hour rule ----------
export function leadMinutes(i: Incident): number | null {
  // Notice lead only means something for a scheduled cut; an unexpected failure has no "before".
  if (i.kind !== "scheduled" || i.publishedAt === null) return null;
  return i.startsAt - i.publishedAt;
}

export function meets12h(i: Incident): boolean | null {
  if (i.kind !== "scheduled") return null;
  const lead = leadMinutes(i);
  if (lead === null) return null;
  return lead >= TARGET_LEAD_MIN;
}

// ---------- SMS (Condition 2: only confirmed facts) ----------
// GSM-7 basic set (plus extension chars counted as 2). Anything else forces UCS-2: 70 chars per SMS.
const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export function smsSegments(text: string): { encoding: "GSM-7" | "UCS-2"; units: number; segments: number } {
  const chars = [...text];
  if (chars.every((c) => GSM7.includes(c) || GSM7_EXT.includes(c))) {
    const units = chars.reduce((n, c) => n + (GSM7_EXT.includes(c) ? 2 : 1), 0);
    return { encoding: "GSM-7", units, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  const units = text.length;
  return { encoding: "UCS-2", units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

/** Swap accents outside GSM-7 (á í ó ú Á Í Ó Ú) for plain letters so a notice stays 1 SMS instead of 3. */
export function gsmSafe(text: string): string {
  const map: Record<string, string> = { á: "a", í: "i", ó: "o", ú: "u", Á: "A", Í: "I", Ó: "O", Ú: "U", É: "E" };
  return [...text].map((c) => map[c] ?? c).join("");
}

/** Source name for the household: drops the English note in parentheses. */
export function smsName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function buildSms(state: DeskState, i: Incident): { text: string; chars: number; segments: number; encoding: "GSM-7" | "UCS-2" } {
  const src = state.sources.find((s) => s.id === i.confirmSourceId);
  const who = src ? smsName(src.label) : "sin confirmar";
  const sector = `Sector ${i.sector.slice(1)}`;
  // A model-raised incident has no confirmed start time: the SMS only says when the utility confirmed it.
  const what =
    i.kind === "scheduled"
      ? `Corte programado ${sector}, ${fmtEs(i.startsAt)}`
      : `Falla en suministro ${sector}, confirmada ${fmtEs(i.utilityInputAt ?? i.detectedAt)}`;
  const cause = i.cause && i.causeSource ? `Causa: ${i.cause}` : "Causa: no confirmada";
  const rest = i.restoration !== null && i.restorationSource ? `Regreso estimado: ${fmtEs(i.restoration)}` : null;
  const next = i.nextUpdateDue !== null ? `Siguiente aviso: ${fmtEs(i.nextUpdateDue)}` : null;
  const parts = [`Agua a Tiempo: ${what}.`, `Confirma: ${who}.`, `${cause}.`];
  if (rest) parts.push(`${rest}.`);
  if (next) parts.push(`${next}.`);
  const text = gsmSafe(parts.join(" "));
  const seg = smsSegments(text);
  return { text, chars: seg.units, segments: seg.segments, encoding: seg.encoding };
}

// ---------- escalation (Condition 4) ----------
/** Returns the escalation level an incident should be at, given the clock. */
export function requiredEscalation(i: Incident, now: Minutes): 0 | 1 | 2 {
  // Posting an update moves nextUpdateDue forward, so a due time in the past means it was missed.
  if (i.status !== "confirmed" || i.nextUpdateDue === null) return 0;
  if (now <= i.nextUpdateDue) return 0;
  if (now > i.nextUpdateDue + SUPERVISOR_AFTER_MIN) return 2;
  return 1;
}

export function correctionLate(c: Correction, now: Minutes): boolean {
  return c.status === "open" && now > c.dueAt;
}

/** Runs escalation for incidents and corrections; returns new state and log events. Pure. */
export function runEscalation(state: DeskState, now: Minutes): DeskState {
  const log: LogEvent[] = [];
  const utilitySrc = state.sources.find((s) => s.kind === "utility-bulletin");
  const incidents = state.incidents.map((i) => {
    const need = requiredEscalation(i, now);
    if (need <= i.escalationLevel) return i;
    const at = need === 1 ? (i.nextUpdateDue as number) + 1 : (i.nextUpdateDue as number) + SUPERVISOR_AFTER_MIN + 1;
    if (i.escalationLevel < 1) {
      log.push({ at: (i.nextUpdateDue as number) + 1, type: "escalation", incidentId: i.id, text: `${i.id} (${i.sector}): update missed (due ${fmt(i.nextUpdateDue)}). Level 1: escalated to backup owner ${personName(state, utilitySrc?.backupId ?? null)}.` });
    }
    if (need === 2) {
      log.push({ at, type: "escalation", incidentId: i.id, text: `${i.id} (${i.sector}): still no update 2 h later. Level 2: escalated to utility supervisor ${personName(state, state.agreement.supervisorId)}.` });
    }
    return { ...i, escalationLevel: need };
  });
  const seen = new Set(state.log.filter((e) => e.type === "escalation" && e.text.startsWith("Correction")).map((e) => e.text));
  for (const c of state.corrections) {
    if (correctionLate(c, now)) {
      const text = `Correction ${c.id} not answered by ${fmt(c.dueAt)}. Escalated to backup owner ${personName(state, utilitySrc?.backupId ?? null)}.`;
      if (!seen.has(text)) log.push({ at: c.dueAt + 1, type: "escalation", text });
    }
  }
  return { ...state, incidents, log: [...state.log, ...log].sort((a, b) => a.at - b.at) };
}

// ---------- scorecard (Condition 6: report denominators) ----------
export function scorecard(state: DeskState) {
  const scheduled = state.incidents.filter((i) => i.kind === "scheduled" && i.publishedAt !== null);
  const onTime = scheduled.filter((i) => meets12h(i) === true).length;
  const closed = state.corrections.filter((c) => c.status !== "open");
  const closedOnTime = closed.filter((c) => c.resolvedAt !== null && c.resolvedAt <= c.dueAt).length;
  const modelCandidates = state.incidents.filter((i) => i.origin === "model");
  const falseAlarms = modelCandidates.filter((i) => i.status === "dismissed").length;
  const escalated = state.incidents.filter((i) => i.escalationLevel > 0).length;
  return {
    scheduled: { num: onTime, den: scheduled.length },
    corrections: { num: closedOnTime, den: closed.length, open: state.corrections.filter((c) => c.status === "open").length },
    falseAlarms: { num: falseAlarms, den: modelCandidates.length },
    escalated: { num: escalated, den: state.incidents.filter((i) => i.status === "confirmed" || i.status === "closed").length },
  };
}

export function ratio(n: number, d: number): string {
  return d === 0 ? "no events yet (inconclusive)" : `${n} / ${d} (${Math.round((n / d) * 100)}%)`;
}

export function newId(prefix: string, existing: { id: string }[]): string {
  let n = existing.length + 1;
  while (existing.some((e) => e.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
