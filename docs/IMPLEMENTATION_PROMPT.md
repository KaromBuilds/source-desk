# Implementation prompt — Source Desk

You are building **Source Desk**, the operator console for the Agua a Tiempo MX water-notice pilot. Read `docs/PACKET.md` first; it is the spec. Build in small, testable features, in this order, committing after each one.

**Stack:** Next.js 15 (App Router, TypeScript), no database, no accounts, state in `localStorage` with invented data and a "Reset demo" button. Leaflet + OpenStreetMap for the map. Node's built-in test runner for unit tests (`node --experimental-strip-types --test`). Deploy on Vercel. English UI. Household SMS text in Spanish.

## Feature 1 — Domain model and rules (`lib/types.ts`, `lib/rules.ts`, `lib/demo.ts`)
- Types: Sector, Source (owner, backup, method, canConfirm, verifiedAt), UtilityAgreement (contact, acceptedVerification, acceptedCorrections, acceptedEscalation, offlineRoute), Incident (candidate | confirmed | dismissed; kind scheduled | unexpected | household), Correction, EscalationEntry, LogEvent.
- `launchGate(state)` returns `{ locked, missing[] }`. Locked unless all three duties are accepted, an offline route is agreed, and every source has an owner and a backup.
- `noticeLeadHours(incident)` and `meets12h(incident)` for scheduled cuts.
- `buildSms(incident, source)`: Spanish, ≤ 160 characters if possible, includes who confirmed, "Causa: no confirmada" unless a sourced cause exists, never a restoration time unless sourced.
- `escalate(incident, now)`: if `nextUpdateDue < now` with no update, step 1 = backup owner, step 2 = utility supervisor (after 2 more hours).
- `validateText(s, max)`: trims, rejects empty or longer than max, strips control characters.
- **Acceptance:** unit tests for the gate, 12 h rule, SMS builder and escalation pass.

## Feature 2 — SIMULATED feed and ML (`lib/feed.ts`, `lib/ml.ts`)
- Seeded generator: 4 sectors, a reading every 15 minutes for 48 h, daily pressure pattern plus noise. Injected events: Sector 2 sustained drop (real), Sector 3 single-reading spike down (sensor glitch).
- Features per reading: drop vs. rolling baseline, z-score, persistence (consecutive low readings), share of other sectors also dropping.
- Logistic regression trained by gradient descent on a separately seeded SIMULATED labeled history. Report held-out accuracy. Threshold 0.7 creates a **candidate** incident, never a confirmed one.
- **Acceptance:** tests show the Sector 2 drop scores > 0.7 and the Sector 3 glitch scores < 0.7; held-out accuracy > 0.85.

## Feature 3 — Onboarding gate + source register UI
- Red banner while locked, naming what's missing. "Authorize field spending" disabled while locked.
- Utility agreement form with three duty checkboxes and an offline-route field.
- Source register table with add/edit, validation, "can confirm official events" flag.
- **Acceptance:** T1–T3 and T12 from the test plan.

## Feature 4 — Feed, map and incidents UI
- Simulated clock with "Advance 1 h" / "Advance 6 h". Sparkline per sector, map circles colored by status.
- Candidate list → confirm (owner must have `canConfirm`) or dismiss (logged as false alarm).
- Scheduled cut form (sector, start time, confirming source); 12 h badge.
- Household repair requests rejected with the Condition 3 message.
- SMS preview for confirmed incidents.
- **Acceptance:** T4–T8 and T11.

## Feature 5 — Correction queue, escalation log, scorecard
- Correction report form (channel: SMS / offline route), due in 2 h, resolve accept/reject with reason.
- Escalation runs whenever the clock advances. The log shows utility input delay, dispatch, receipt check, corrections and next update.
- Scorecard with denominators: scheduled notices ≥ 12 h, corrections closed on time, escalations, false alarms.
- **Acceptance:** T9–T10.

## Commit plan
1. Packet. 2. Scaffold + rules + tests. 3. Feed + ML + tests. 4. Gate + register UI. 5. Feed/map/incidents UI. 6. Corrections, escalation, scorecard. 7. Fixes from the test passes. Update `docs/DECISIONS.md` at the end of every session.

## Guardrails
- Every simulated element is labeled SIMULATED on screen.
- No household locations, no real names, no secrets in the repo.
- The model never states a cause, a restoration time or water quality.
