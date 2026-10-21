# Source Desk

**Who confirms, who corrects, who gets called.** This is the operating desk behind the Agua a Tiempo MX water-notice pilot.

A notice about a water cut is only useful if someone answers for it. Source Desk keeps the pilot **locked** until a utility contact accepts three duties: source verification, corrections and escalation. It also requires every information source to have a named owner and backup before anything goes out. Then it runs the day:

- **Live feed and map.** A **SIMULATED** sector pressure feed. An ML model (logistic regression trained in the browser on simulated history) raises **candidate** incidents. The map shows sectors only, never households.
- **Incidents and notices.** Only an authorized person can confirm. The SMS preview never invents a cause, restoration time or quality claim, and scheduled cuts are checked against the **12-hour** notice target.
- **Correction queue.** Wrong notices get a 2-hour deadline.
- **Escalation log.** A missed update goes to the backup owner, then to the supervisor, with every timestamp logged.
- **Scorecard.** Every rate shows its denominator. No events means inconclusive.

Every person, sector and reading is invented. Nothing is sent. Data stays in your browser and the **Reset demo** button clears it.

Week 11 · Business Bending · Team 7 Blueprint (Agua a Tiempo MX). See `docs/PACKET.md` and `docs/DECISIONS.md`.

## Run locally

```bash
npm install
npm run dev
npm test        # rules, engine and model checks
```

## Deploy

Vercel → import this repo → Deploy. No environment variables or secrets are needed.
