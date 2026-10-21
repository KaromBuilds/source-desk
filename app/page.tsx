"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { DeskState, Incident, SectorId, Source } from "@/lib/types";
import { SECTORS, demoState } from "@/lib/demo";
import { demoSeries, DEMO_HOURS } from "@/lib/feed";
import { trainModel, scoreSeries, evaluateEvents, THRESHOLD } from "@/lib/ml";
import * as E from "@/lib/engine";
import { buildSms, launchGate, leadMinutes, meets12h, personName, ratio, scorecard, correctionLate, isAuthorizedConfirmer, TARGET_LEAD_MIN } from "@/lib/rules";
import { fmt, fmtDur } from "@/lib/time";
import Sparkline from "@/components/Sparkline";
import type { SectorStatus } from "@/components/SectorMap";

const SectorMap = dynamic(() => import("@/components/SectorMap"), { ssr: false, loading: () => <div className="map" /> });

const KEY = "source-desk-v1";
type Tab = "onboarding" | "feed" | "incidents" | "corrections" | "log" | "score";

function load(): DeskState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as DeskState;
      if (s && s.version === 1) return s;
    }
  } catch {}
  return demoState();
}

export default function Page() {
  const [state, setState] = useState<DeskState>(demoState);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("onboarding");
  const [error, setError] = useState<string | null>(null);

  // model trained once in the browser on SIMULATED history
  const model = useMemo(() => trainModel(), []);
  const events = useMemo(() => evaluateEvents(model), [model]);
  const scored = useMemo(() => scoreSeries(model, demoSeries()), [model]);

  useEffect(() => {
    setState(load());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }, [state, ready]);

  const gate = launchGate(state);
  const run = (r: E.Result) => {
    if (r.ok) {
      setState(r.state);
      setError(null);
      return true;
    }
    setError(r.error);
    return false;
  };
  const advance = (min: number) => {
    setError(null);
    setState((s) => E.advanceClock(s, Math.min(s.now + min, DEMO_HOURS * 60 - 15), scored));
  };

  const openCandidates = state.incidents.filter((i) => i.status === "candidate").length;
  const lateCorrections = state.corrections.filter((c) => correctionLate(c, state.now)).length;
  const escalated = state.incidents.filter((i) => i.escalationLevel > 0 && i.status === "confirmed").length;

  const sectorStatus = Object.fromEntries(
    SECTORS.map((s) => {
      const open = state.incidents.filter((i) => i.sector === s.id && (i.status === "candidate" || i.status === "confirmed") && (i.kind === "unexpected" || i.startsAt <= state.now + 12 * 60));
      const st: SectorStatus = open.some((i) => i.status === "confirmed") ? "confirmed" : open.length ? "candidate" : "ok";
      return [s.id, st];
    }),
  ) as Record<SectorId, SectorStatus>;

  return (
    <>
      <header className="top">
        <div className="in">
          <div>
            <h1>Source Desk</h1>
            <div className="sub">Agua a Tiempo MX pilot · who confirms, who corrects, who gets called</div>
          </div>
          <div className="sub">Fictional pilot · invented people · <span className="sim">SIMULATED feed</span></div>
        </div>
      </header>
      <main className="wrap">
        {gate.locked ? (
          <div className="banner locked" role="alert">
            <b>🔒 Pilot LOCKED. Field spending disabled.</b> Nothing goes to households until every item below is done:
            <ul>{gate.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        ) : (
          <div className="banner open">
            <b>✅ Pilot UNLOCKED.</b> The utility contact accepted verification, corrections and escalation. Every source has an owner and a backup.
            {state.spendingAuthorized ? " Field spending authorized." : " Field spending can now be authorized."}
          </div>
        )}

        <div className="clock">
          <span>Simulated clock:</span> <b>{fmt(state.now)}</b>
          <button className="btn sm" onClick={() => advance(15)}>+15 min</button>
          <button className="btn sm" onClick={() => advance(60)}>+1 h</button>
          <button className="btn sm" onClick={() => advance(360)}>+6 h</button>
          <span className="help" style={{ margin: 0 }}>The demo runs Mon 00:00 to Tue 23:45.</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm danger" onClick={() => { setState(demoState()); setError(null); setTab("onboarding"); }}>Reset demo</button>
        </div>

        <nav className="tabs" aria-label="Sections">
          {([
            ["onboarding", "1 · Onboarding & sources", 0],
            ["feed", "2 · Live feed & map", 0],
            ["incidents", "3 · Incidents & notices", openCandidates],
            ["corrections", "4 · Correction queue", lateCorrections],
            ["log", "5 · Escalation log", escalated],
            ["score", "6 · Scorecard", 0],
          ] as [Tab, string, number][]).map(([id, label, n]) => (
            <button key={id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => { setTab(id); setError(null); }}>
              {label}{n > 0 && <span className="cnt">{n}</span>}
            </button>
          ))}
        </nav>

        {error && <div className="err" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

        {tab === "onboarding" && <Onboarding state={state} run={run} />}
        {tab === "feed" && <Feed state={state} scored={scored} model={model} events={events} sectorStatus={sectorStatus} goIncidents={() => setTab("incidents")} />}
        {tab === "incidents" && <Incidents state={state} run={run} setState={setState} />}
        {tab === "corrections" && <Corrections state={state} run={run} />}
        {tab === "log" && <Log state={state} />}
        {tab === "score" && <Score state={state} />}

        <p className="foot">
          Week 11 · Business Bending · Team 7 Blueprint (Agua a Tiempo MX). Every person, sector and reading here is invented. The pressure feed is SIMULATED and the model only raises candidates; a named person confirms.
          No household locations, no real personal data, nothing is sent. Data stays in this browser.
        </p>
      </main>
    </>
  );
}

// ---------------------------------------------------------------- Onboarding
function Onboarding({ state, run }: { state: DeskState; run: (r: E.Result) => boolean }) {
  const a = state.agreement;
  const [route, setRoute] = useState(a.offlineRoute);
  useEffect(() => setRoute(a.offlineRoute), [a.offlineRoute]);
  const [editing, setEditing] = useState<Source | null>(null);
  const gate = launchGate(state);
  const utility = state.people.filter((p) => p.role.startsWith("Utility"));

  return (
    <>
      <section className="card">
        <h2>Step 1 · Utility contact accepts the duties</h2>
        <p className="help">The pilot can&apos;t spend money in the field until a utility contact accepts all three duties (Condition 3). Residents never need a smartphone: an offline route is required (Condition 1).</p>
        <div className="grid2">
          <label>Utility contact
            <select value={a.contactId ?? ""} onChange={(e) => run(E.saveAgreement(state, { contactId: e.target.value || null }))}>
              <option value="">Choose…</option>
              {utility.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
            </select>
          </label>
          <label>Escalation supervisor (level 2)
            <select value={a.supervisorId ?? ""} onChange={(e) => run(E.saveAgreement(state, { supervisorId: e.target.value || null }))}>
              <option value="">Choose…</option>
              {utility.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={a.acceptedVerification} onChange={(e) => run(E.saveAgreement(state, { acceptedVerification: e.target.checked }))} /> <span><b>Source verification:</b> the utility confirms every official event before it reaches households.</span></label>
        <label className="check"><input type="checkbox" checked={a.acceptedCorrections} onChange={(e) => run(E.saveAgreement(state, { acceptedCorrections: e.target.checked }))} /> <span><b>Corrections:</b> wrong notices are answered within 2 hours.</span></label>
        <label className="check"><input type="checkbox" checked={a.acceptedEscalation} onChange={(e) => run(E.saveAgreement(state, { acceptedEscalation: e.target.checked }))} /> <span><b>Escalation:</b> a missed update goes to the backup owner, then to the supervisor.</span></label>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label style={{ flex: 1, minWidth: 240 }}>Offline contact route agreed with the community
            <input value={route} maxLength={220} placeholder="e.g. Two community contacts per sector call or visit each household" onChange={(e) => setRoute(e.target.value)} />
          </label>
          <button className="btn" onClick={() => run(E.saveAgreement(state, { offlineRoute: route }))}>Save route</button>
        </div>
        <div className="row">
          <button className="btn primary" disabled={gate.locked || state.spendingAuthorized} onClick={() => run(E.authorizeSpending(state))}>
            {state.spendingAuthorized ? "Field spending authorized" : "Authorize field spending (MX$15,000 cap)"}
          </button>
          {gate.locked && <span className="help" style={{ margin: 0 }}>Disabled while the pilot is locked.</span>}
        </div>
      </section>

      <section className="card">
        <h2>Step 2 · Source register</h2>
        <p className="help">Every source of information has an owner, a backup and a way to verify it. Only sources marked &quot;can confirm&quot; may confirm official events, and a sensor feed never can.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Source</th><th>Owner</th><th>Backup</th><th>Verification method</th><th>Can confirm</th><th>Verified</th><th /></tr></thead>
            <tbody>
              {state.sources.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.label}</b></td>
                  <td>{personName(state, s.ownerId)}</td>
                  <td>{s.backupId ? personName(state, s.backupId) : <span className="chip bad">missing</span>}</td>
                  <td>{s.method}</td>
                  <td>{s.canConfirm ? <span className="chip ok">yes</span> : <span className="chip unk">no</span>}</td>
                  <td>{s.verifiedAt !== null ? <span className="chip ok">{fmt(s.verifiedAt)}</span> : <button className="btn sm" onClick={() => run({ ok: true, state: E.verifySource(state, s.id) })}>Mark verified</button>}</td>
                  <td><button className="btn sm" onClick={() => setEditing(s)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setEditing({ id: "", label: "", kind: "community-route", method: "", ownerId: "", backupId: null, canConfirm: false, verifiedAt: null })}>+ Add source</button>
        </div>
        {editing && <SourceForm key={editing.id || "new"} state={state} src={editing} onDone={() => setEditing(null)} run={run} />}
      </section>
    </>
  );
}

function SourceForm({ state, src, onDone, run }: { state: DeskState; src: Source; onDone: () => void; run: (r: E.Result) => boolean }) {
  const [f, setF] = useState<Source>(src);
  return (
    <div className="note" style={{ background: "#fff", border: "1px solid var(--line)" }}>
      <h3 style={{ marginTop: 0 }}>{src.id ? `Edit "${src.label}"` : "New source"}</h3>
      <div className="grid3">
        <label>Label<input value={f.label} maxLength={100} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
        <label>Type
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Source["kind"] })}>
            <option value="utility-bulletin">Utility bulletin</option>
            <option value="pressure-feed">Pressure feed (sensor)</option>
            <option value="community-route">Community route</option>
            <option value="provider-dispatch">Provider dispatch</option>
          </select>
        </label>
        <label>Verification method<input value={f.method} maxLength={180} onChange={(e) => setF({ ...f, method: e.target.value })} /></label>
        <label>Owner
          <select value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>
            <option value="">Choose…</option>
            {state.people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
          </select>
        </label>
        <label>Backup
          <select value={f.backupId ?? ""} onChange={(e) => setF({ ...f, backupId: e.target.value || null })}>
            <option value="">None yet</option>
            {state.people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
          </select>
        </label>
        <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={f.canConfirm} onChange={(e) => setF({ ...f, canConfirm: e.target.checked })} /> Can confirm official events</label>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => { if (run(E.saveSource(state, f))) onDone(); }}>Save source</button>
        <button className="btn" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Feed
function Feed({ state, scored, model, events, sectorStatus, goIncidents }: {
  state: DeskState; scored: ReturnType<typeof scoreSeries>; model: ReturnType<typeof trainModel>; events: ReturnType<typeof evaluateEvents>;
  sectorStatus: Record<SectorId, SectorStatus>; goIncidents: () => void;
}) {
  const cands = state.incidents.filter((i) => i.status === "candidate");
  return (
    <>
      <div className="grid2">
        <section className="card">
          <h2>Pilot sectors <span className="help">(sector level only, no households)</span></h2>
          <SectorMap sectors={SECTORS} status={sectorStatus} />
          <div className="row" style={{ fontSize: ".82rem" }}>
            <span className="chip ok">normal</span><span className="chip warn">candidate, unconfirmed</span><span className="chip bad">confirmed incident</span>
          </div>
        </section>
        <section className="card">
          <h2>Sector pressure <span className="sim">SIMULATED feed</span></h2>
          <p className="help">Readings every 15 min, last 12 h. Red dots = readings the model scores ≥ {THRESHOLD}. A dot is a reason to ask the utility, not a fact.</p>
          <div className="grid2">
            {SECTORS.map((s) => {
              const last = scored[s.id].filter((r) => r.minute <= state.now).at(-1);
              return (
                <div key={s.id} className="sector">
                  <div className="h"><span>{s.id}</span><span className="help" style={{ margin: 0 }}>{last ? `${last.pressure.toFixed(2)} bar · score ${last.score.toFixed(2)}` : "no data"}</span></div>
                  <Sparkline data={scored[s.id]} now={state.now} />
                </div>
              );
            })}
          </div>
          {cands.length > 0 && (
            <div className="inc candidate">
              <b>{cands.length} candidate incident{cands.length > 1 ? "s" : ""} awaiting authorized confirmation</b>
              <div className="row"><button className="btn primary sm" onClick={goIncidents}>Review in Incidents</button></div>
            </div>
          )}
        </section>
      </div>
      <section className="card">
        <h2>The model, honestly</h2>
        <p className="help">Logistic regression trained in your browser on SIMULATED labeled history (real drops vs. one-reading sensor glitches). Inputs: drop below the last hours&apos; baseline, how unusual it is for that sector, how many readings in a row, and whether neighbor sectors drop too.</p>
        <div className="grid4">
          <div className="kpi"><div className="v">{events.realDetected}/{events.realTotal}</div><div className="l">real drops flagged in a fresh simulated history</div></div>
          <div className="kpi"><div className="v">{events.glitchFlagged}/{events.glitchTotal}</div><div className="l">sensor glitches flagged by mistake</div></div>
          <div className="kpi"><div className="v">{events.medianDelayMin ?? "—"} min</div><div className="l">median time from drop to flag</div></div>
          <div className="kpi"><div className="v">{Math.round(model.heldOut.precision * 100)}%</div><div className="l">held-out precision per reading (n = {model.heldOut.n})</div></div>
        </div>
        <div className="note">It never says why the water stopped, when it comes back, or whether it&apos;s safe to drink (Condition 2). It has never seen a real Mexican utility logger; real data would change these numbers.</div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Incidents
function Incidents({ state, run, setState }: { state: DeskState; run: (r: E.Result) => boolean; setState: (s: DeskState) => void }) {
  const cands = state.incidents.filter((i) => i.status === "candidate");
  const active = state.incidents.filter((i) => i.status === "confirmed");
  const closed = state.incidents.filter((i) => i.status === "closed" || i.status === "dismissed");
  return (
    <>
      <section className="card">
        <h2>Candidates from the feed</h2>
        <p className="help">Only an authorized person can confirm an official event. The feed itself can never confirm.</p>
        {cands.length === 0 && <p className="help">No candidates right now. Advance the clock to Mon 13:30 to see the Sector 2 drop.</p>}
        {cands.map((i) => <CandidateCard key={i.id} state={state} inc={i} run={run} />)}
      </section>

      <ScheduledCutForm state={state} run={run} />

      <section className="card">
        <h2>Confirmed incidents and notices</h2>
        {active.length === 0 && <p className="help">Nothing confirmed yet.</p>}
        {active.map((i) => <ActiveCard key={i.id} state={state} inc={i} run={run} setState={setState} />)}
      </section>

      <HouseholdBox state={state} run={run} />

      {closed.length > 0 && (
        <section className="card">
          <h2>Closed and dismissed</h2>
          <div className="tablewrap"><table><thead><tr><th>ID</th><th>Sector</th><th>Type</th><th>Status</th><th>Detected</th></tr></thead>
            <tbody>{closed.map((i) => <tr key={i.id}><td>{i.id}</td><td>{i.sector}</td><td>{i.kind}</td><td><span className={`chip ${i.status === "dismissed" ? "unk" : "ok"}`}>{i.status === "dismissed" ? "false alarm" : "closed"}</span></td><td>{fmt(i.detectedAt)}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}

function CandidateCard({ state, inc, run }: { state: DeskState; inc: Incident; run: (r: E.Result) => boolean }) {
  const confirmers = state.sources.filter((s) => s.canConfirm);
  const [src, setSrc] = useState(confirmers[0]?.id ?? "");
  const [who, setWho] = useState("");
  const [reason, setReason] = useState("");
  const source = state.sources.find((s) => s.id === src);
  const allowed = state.people.filter((p) => isAuthorizedConfirmer(state, p.id, source));
  return (
    <div className="inc candidate">
      <div className="h">
        <b>{inc.id} · {inc.sector} · unexpected pressure drop</b>
        <span><span className="chip warn">candidate · score {inc.modelScore}</span> <span className="help">flagged {fmt(inc.detectedAt)} · waiting {fmtDur(state.now - inc.detectedAt)}</span></span>
      </div>
      <div className="grid3" style={{ marginTop: 8 }}>
        <label>Confirming source
          <select value={src} onChange={(e) => setSrc(e.target.value)}>{confirmers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <label>Confirmed by
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose…</option>
            {state.people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role}){allowed.some((a) => a.id === p.id) ? "" : " · not authorized"}</option>)}
          </select>
        </label>
        <div style={{ alignSelf: "end" }}><button className="btn primary" disabled={!who} onClick={() => run(E.confirmIncident(state, inc.id, who, src))}>Confirm with utility</button></div>
      </div>
      <div className="row">
        <input style={{ flex: 1, minWidth: 220 }} maxLength={180} placeholder="Why is it a false alarm? (e.g. engineer checked: logger reset)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn danger sm" onClick={() => run(E.dismissIncident(state, inc.id, reason))}>Dismiss as false alarm</button>
      </div>
    </div>
  );
}

function ScheduledCutForm({ state, run }: { state: DeskState; run: (r: E.Result) => boolean }) {
  const confirmers = state.sources.filter((s) => s.canConfirm);
  const [sector, setSector] = useState<SectorId>("S1");
  const [day, setDay] = useState(1);
  const [time, setTime] = useState("06:00");
  const [src, setSrc] = useState(confirmers[0]?.id ?? "");
  const [who, setWho] = useState(state.agreement.contactId ?? "");
  const [cause, setCause] = useState("");
  const [causeSrc, setCauseSrc] = useState("");
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  const startsAt = m ? day * 1440 + Number(m[1]) * 60 + Number(m[2]) : NaN;
  const lead = Number.isFinite(startsAt) ? startsAt - state.now : null;
  return (
    <section className="card">
      <h2>Scheduled cut from the utility bulletin</h2>
      <p className="help">Target: households hear about a scheduled cut at least 12 hours before it starts (Condition 4). Leave the cause empty unless the utility gave one; the SMS will say &quot;no confirmada&quot;.</p>
      <div className="grid4">
        <label>Sector<select value={sector} onChange={(e) => setSector(e.target.value as SectorId)}>{SECTORS.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>
        <label>Day<select value={day} onChange={(e) => setDay(Number(e.target.value))}><option value={0}>Mon</option><option value={1}>Tue</option></select></label>
        <label>Start time (HH:MM)<input value={time} maxLength={5} onChange={(e) => setTime(e.target.value)} /></label>
        <label>Confirmed by
          <select value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose…</option>{state.people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}</select>
        </label>
        <label>Confirming source<select value={src} onChange={(e) => setSrc(e.target.value)}>{confirmers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label>Cause (optional)<input value={cause} maxLength={90} placeholder="only if the utility said it" onChange={(e) => setCause(e.target.value)} /></label>
        <label>Who said the cause<input value={causeSrc} maxLength={90} placeholder="e.g. Mesa de Operación, call 09:10" onChange={(e) => setCauseSrc(e.target.value)} /></label>
        <div style={{ alignSelf: "end" }}>
          <button className="btn primary" onClick={() => { if (!Number.isFinite(startsAt)) return run({ ok: false, error: "Start time must look like 06:00." }); run(E.addScheduledCut(state, sector, startsAt, who, src, cause, causeSrc)); }}>Add scheduled cut</button>
        </div>
      </div>
      {lead !== null && lead > 0 && (
        <div className="note">If published now: {fmtDur(lead)} of notice. {lead >= TARGET_LEAD_MIN ? <span className="chip ok">meets 12-hour target</span> : <span className="chip bad">below 12-hour target</span>}</div>
      )}
    </section>
  );
}

function ActiveCard({ state, inc, run, setState }: { state: DeskState; inc: Incident; run: (r: E.Result) => boolean; setState: (s: DeskState) => void }) {
  const [note, setNote] = useState("");
  const sms = buildSms(state, inc);
  const ok12 = meets12h(inc);
  const lead = leadMinutes(inc);
  const overdue = inc.nextUpdateDue !== null && state.now > inc.nextUpdateDue;
  return (
    <div className="inc confirmed">
      <div className="h">
        <b>{inc.id} · {inc.sector} · {inc.kind === "scheduled" ? `scheduled cut ${fmt(inc.startsAt)}` : `unexpected drop since ${fmt(inc.startsAt)}`}</b>
        <span>
          {inc.publishedAt === null ? <span className="chip warn">not published</span> : <span className="chip ok">published {fmt(inc.publishedAt)}</span>}{" "}
          {ok12 === true && <span className="chip ok">≥ 12 h notice</span>}
          {ok12 === false && <span className="chip bad">below 12 h ({fmtDur(lead)})</span>}{" "}
          {inc.escalationLevel > 0 && <span className="chip esc">escalated L{inc.escalationLevel}</span>}
        </span>
      </div>
      <p className="help" style={{ margin: "6px 0" }}>Confirmed by {personName(state, inc.confirmedBy)}. Next update due: {fmt(inc.nextUpdateDue)}{overdue ? " (MISSED)" : ""}.</p>
      <div><span className="help">SMS to households (Spanish) · {sms.chars} characters · {sms.segments} SMS · preview only, nothing is sent</span>
        <div className="sms">{sms.text}</div>
        <div className="help" style={{ marginTop: 4 }}>Same message goes by the offline route: {state.agreement.offlineRoute || "no route agreed"}</div>
      </div>
      <div className="row">
        {inc.publishedAt === null && <button className="btn primary" onClick={() => run(E.publishNotice(state, inc.id))}>Publish notice</button>}
        {inc.publishedAt !== null && (
          <>
            <input style={{ flex: 1, minWidth: 220 }} maxLength={180} placeholder="Update from the utility (what they confirmed, and when)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn sm" onClick={() => { if (run(E.postUpdate(state, inc.id, note, false))) setNote(""); }}>Post update</button>
            <button className="btn sm" onClick={() => { if (run(E.postUpdate(state, inc.id, note, true))) setNote(""); }}>Close incident</button>
          </>
        )}
      </div>
      <div className="row">
        <button className="btn sm" disabled={inc.dispatchAt !== null} onClick={() => setState(E.recordDispatch(state, inc.id))}>{inc.dispatchAt !== null ? `Truck dispatched ${fmt(inc.dispatchAt)}` : "Log water-truck dispatch"}</button>
        <button className="btn sm" disabled={inc.receiptCheckAt !== null || inc.publishedAt === null} onClick={() => setState(E.recordReceipt(state, inc.id))}>{inc.receiptCheckAt !== null ? `Receipt checked ${fmt(inc.receiptCheckAt)}` : "Log receipt check"}</button>
      </div>
    </div>
  );
}

function HouseholdBox({ state, run }: { state: DeskState; run: (r: E.Result) => boolean }) {
  const [text, setText] = useState("");
  const [sector, setSector] = useState<SectorId>("S1");
  return (
    <section className="card">
      <h2>Household repair request</h2>
      <p className="help">Inside-the-home problems (tinaco, valve, pump) are not public-network work. This pilot logs them and says so; it never sells or pools repair coverage (Condition 3).</p>
      <div className="row">
        <select style={{ width: 90 }} value={sector} onChange={(e) => setSector(e.target.value as SectorId)}>{SECTORS.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}</select>
        <input style={{ flex: 1, minWidth: 220 }} maxLength={220} placeholder="e.g. Our tinaco float valve is broken" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" onClick={() => { if (run(E.householdRequest(state, sector, text))) setText(""); }}>Log request</button>
      </div>
      {state.log.filter((e) => e.type === "rejected").slice(-1).map((e) => <div key={e.at + e.text} className="note">{e.text}</div>)}
    </section>
  );
}

// ---------------------------------------------------------------- Corrections
function Corrections({ state, run }: { state: DeskState; run: (r: E.Result) => boolean }) {
  const [sector, setSector] = useState<SectorId>("S2");
  const [channel, setChannel] = useState<"SMS" | "offline route">("offline route");
  const [text, setText] = useState("");
  const [inc, setInc] = useState("");
  const published = state.incidents.filter((i) => i.publishedAt !== null);
  return (
    <>
      <section className="card">
        <h2>New correction report</h2>
        <p className="help">Someone says a notice is wrong. It goes to the utility owner with a 2-hour deadline. If nobody answers, it escalates.</p>
        <div className="grid4">
          <label>Sector<select value={sector} onChange={(e) => setSector(e.target.value as SectorId)}>{SECTORS.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>
          <label>Came in by<select value={channel} onChange={(e) => setChannel(e.target.value as "SMS" | "offline route")}><option value="offline route">Offline route (call / visit)</option><option value="SMS">SMS reply</option></select></label>
          <label>About notice<select value={inc} onChange={(e) => setInc(e.target.value)}><option value="">None / unknown</option>{published.map((i) => <option key={i.id} value={i.id}>{i.id} ({i.sector})</option>)}</select></label>
          <label>What they reported<input value={text} maxLength={220} placeholder="e.g. Our street still has no water" onChange={(e) => setText(e.target.value)} /></label>
        </div>
        <div className="row"><button className="btn primary" onClick={() => { if (run(E.addCorrection(state, sector, channel, text, inc || null))) setText(""); }}>Add to queue</button></div>
      </section>
      <section className="card">
        <h2>Correction queue</h2>
        {state.corrections.length === 0 && <p className="help">The queue is empty.</p>}
        {state.corrections.map((c) => <CorrectionRow key={c.id} state={state} c={c} run={run} />)}
      </section>
    </>
  );
}

function CorrectionRow({ state, c, run }: { state: DeskState; c: DeskState["corrections"][number]; run: (r: E.Result) => boolean }) {
  const [res, setRes] = useState("");
  const late = correctionLate(c, state.now);
  const chip = c.status === "open" ? (late ? <span className="chip bad">late, escalated</span> : <span className="chip warn">open · {fmtDur(c.dueAt - state.now)} left</span>) : <span className={`chip ${c.status === "accepted" ? "ok" : "unk"}`}>{c.status}{c.resolvedAt !== null && c.resolvedAt > c.dueAt ? " (late)" : ""}</span>;
  return (
    <div className="inc">
      <div className="h"><b>{c.id} · {c.sector} · “{c.text}”</b>{chip}</div>
      <p className="help" style={{ margin: "4px 0" }}>By {c.channel} at {fmt(c.reportedAt)} · about {c.incidentId ?? "no notice"} · owner {personName(state, c.ownerId)} · due {fmt(c.dueAt)}{c.resolution ? ` · resolution: ${c.resolution}` : ""}</p>
      {c.status === "open" && (
        <div className="row">
          <input style={{ flex: 1, minWidth: 220 }} maxLength={180} placeholder="What the utility checked and decided" value={res} onChange={(e) => setRes(e.target.value)} />
          <button className="btn sm primary" onClick={() => run(E.resolveCorrection(state, c.id, true, res))}>Accept and send correction</button>
          <button className="btn sm" onClick={() => run(E.resolveCorrection(state, c.id, false, res))}>Reject with reason</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Log
function Log({ state }: { state: DeskState }) {
  const tracked = state.incidents.filter((i) => i.status !== "candidate" && i.status !== "dismissed");
  return (
    <>
      <section className="card">
        <h2>Escalation log by incident</h2>
        <p className="help">Every timestamp the Blueprint asks for (Condition 4): utility input delay, dispatch, receipt check, corrections, next update.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Incident</th><th>Detected</th><th>Utility input delay</th><th>Published</th><th>Notice lead</th><th>Dispatch</th><th>Receipt check</th><th>Corrections</th><th>Next update</th><th>Escalation</th></tr></thead>
            <tbody>
              {tracked.length === 0 && <tr><td colSpan={10} className="help">No confirmed incidents yet.</td></tr>}
              {tracked.map((i) => {
                const cs = state.corrections.filter((c) => c.incidentId === i.id);
                return (
                  <tr key={i.id}>
                    <td><b>{i.id}</b> {i.sector}<br /><span className="help">{i.kind}</span></td>
                    <td>{fmt(i.detectedAt)}</td>
                    <td>{i.utilityInputAt !== null ? fmtDur(i.utilityInputAt - i.detectedAt) : "—"}</td>
                    <td>{fmt(i.publishedAt)}</td>
                    <td>{leadMinutes(i) !== null ? fmtDur(leadMinutes(i)) : "—"}</td>
                    <td>{fmt(i.dispatchAt)}</td>
                    <td>{fmt(i.receiptCheckAt)}</td>
                    <td>{cs.length ? `${cs.length} (${cs.filter((c) => c.status !== "open").length} closed)` : "0"}</td>
                    <td>{i.status === "closed" ? "closed" : fmt(i.nextUpdateDue)}{i.nextUpdateDue !== null && state.now > i.nextUpdateDue && i.status === "confirmed" ? <span className="chip bad"> missed</span> : null}</td>
                    <td>{i.escalationLevel === 0 ? <span className="chip ok">none</span> : <span className="chip esc">L{i.escalationLevel} · {i.escalationLevel === 1 ? "backup owner" : "supervisor"}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card log">
        <h2>Full event log</h2>
        <div className="tablewrap"><table><thead><tr><th>When</th><th>Type</th><th>What happened</th></tr></thead>
          <tbody>{[...state.log].reverse().map((e, k) => <tr key={k}><td>{fmt(e.at)}</td><td><span className={`chip ${e.type === "escalation" ? "esc" : e.type === "rejected" || e.type === "dismiss" ? "unk" : e.type === "candidate" ? "warn" : "ok"}`}>{e.type}</span></td><td>{e.text}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Score
function Score({ state }: { state: DeskState }) {
  const sc = scorecard(state);
  return (
    <section className="card">
      <h2>Pilot scorecard</h2>
      <p className="help">Every number shows its denominator (Condition 6). No events means inconclusive, not success.</p>
      <div className="grid4">
        <div className="kpi"><div className="v">{ratio(sc.scheduled.num, sc.scheduled.den)}</div><div className="l">scheduled notices published ≥ 12 h early (target ≥ 90%)</div></div>
        <div className="kpi"><div className="v">{ratio(sc.corrections.num, sc.corrections.den)}</div><div className="l">corrections closed within 2 h · {sc.corrections.open} still open</div></div>
        <div className="kpi"><div className="v">{ratio(sc.falseAlarms.num, sc.falseAlarms.den)}</div><div className="l">model candidates that were false alarms</div></div>
        <div className="kpi"><div className="v">{ratio(sc.escalated.num, sc.escalated.den)}</div><div className="l">confirmed incidents that needed escalation</div></div>
      </div>
      <div className="note">Comprehension (≥ 80%) and preparation (≥ 70%) are measured with households in the team&apos;s other slices, not here.</div>
    </section>
  );
}
