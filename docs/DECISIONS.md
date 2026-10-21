# DECISIONS — Source Desk

## Session 1 (2026-10-21)
- Vacuum: Household water tools (Team 7 "Agua a Tiempo MX" Blueprint). My slice is the operating layer: onboarding, source-owner register, correction queue and escalation log (Conditions 3 and 4).
- **Launch gate before anything else.** The pilot stays LOCKED, with field spending disabled, until a utility contact accepts source verification, corrections and escalation, a supervisor is named, an offline route is agreed and every source has a different backup owner. That is Condition 3 written as code.
- **Dragon Stack vs. "do not invent another sensor".** The Blueprint says manual readings before hardware. The course requires IoT/sensing. I resolved it with a labeled **SIMULATED** feed standing in for the utility's existing sector loggers: no new hardware, and the feed can never confirm anything. The ML model only raises a **candidate**; only an authorized person turns it into an incident (Condition 2).
- **ML choice.** Logistic regression trained in the browser on SIMULATED labeled history, using four features: drop vs. a lagged baseline, z-score, persistence and neighbor drop. It's small, explainable and testable. On a fresh simulated history it flags 33/33 real drops and 0/46 one-reading glitches, with a median delay of 30 min. These numbers say nothing about real Mexican loggers, and the UI says so.
- **Geodata at sector level only.** Four fictional sectors on a Leaflet map. No household points (Condition 5).
- **Household repairs are rejected on purpose** and logged with the reason. There's no pooled coverage in this pilot (Condition 3).
- **No database and no accounts.** All data is invented and stays in localStorage with a reset button, so nothing personal sits on a server (security floor #2 and #5). No API keys are needed (floor #1). Every form goes through `validateText` (floor #4).
- **The SMS is a preview.** Valeria's slice owns the notice review and sending.

## Session 1, test pass — bugs found and fixed
- **Bug 1 (Condition 2):** a model-raised notice said *"Falla en suministro Sector 2 desde lun 13:30"*. 13:30 was the model's detection time, not a confirmed start, so the SMS presented a model output as fact. **Fix:** the SMS now says *"confirmada lun 14:00"*, the time the utility confirmed.
- **Bug 2:** the source label's English note *"(utility bulletin)"* leaked into the Spanish SMS. **Fix:** `smsName()` strips it.
- **Bug 3:** the segment counter assumed every message was GSM-7. *"Operación"* contains "ó", which forces UCS-2 (70 characters per SMS), so a notice shown as "1 SMS" really cost 3. That matters for the MX$15,000 pilot cap. **Fix:** a real GSM-7 / UCS-2 counter, plus `gsmSafe()` to swap accents outside GSM-7. "sáb" became "sab". The notice is back to 1 SMS.
- Regression tests were added for all three. `npm test`: 22/22 pass. End-to-end run of T1–T12: 20/20 checks pass, no console errors, no horizontal scroll at phone width.

## Session 1, second test pass (screenshots)
- **Bug 4:** the map stayed green while Sector 2 had a candidate. Leaflet loads asynchronously, and the color update ran before the circles existed. **Fix:** the loader reads the latest status from a ref.
- **Bug 5:** unexpected incidents showed a "-30 min" notice lead. Lead time only applies to scheduled cuts. **Fix:** it now shows "—".
- **Bug 6:** escalation lines didn't say which incident they were about (two identical lines). **Fix:** every line starts with the incident ID and sector.

## Persona test (Layer 1)
- Synthetic user: **Maribel Ortega**, 41, the pilot coordinator (see `PERSONA_Asael_W11.pdf`).
- **Worst confusion:** she read "Confirm with utility" as a button that contacts the utility, so she would have "confirmed" an incident nobody at the utility had confirmed. That breaks Condition 2.
- **Fix (deployed):** the button is now "Record the utility's confirmation". It's disabled until she picks **who** confirmed it and **how** she got the confirmation (phone call / message from the official number / written bulletin). A box says plainly "This app does not call anyone" and names the people she should call. The method is saved in the log.
- Logged, not fixed this week: "score 0.73" means nothing to her; "Condition 3" labels are team jargon; the locked banner doesn't link to where each item gets fixed; "Mark verified" looks mandatory but isn't part of the gate.

## Tomorrow's first move
- Turn the model score into plain words ("likely a real drop"), link each locked-banner item to its field, and hide Blueprint condition numbers behind a tooltip.
