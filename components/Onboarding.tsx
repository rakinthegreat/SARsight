"use client";
// First-run onboarding. Asks the few things we need (language, work, place) first, so satellite data for the place
// can be fetched in the background while the remaining slides explain NISAR and what SARsight does with it.
import { useEffect, useState } from "react";
import type { CatalogEntry, LonLat, ModuleId } from "../lib/data/types";
import { JOBS, JUDGE, ONBOARD as O, PERSONA, tr, type Job, type Lang, type Persona } from "../lib/assist";
import type { Status } from "../lib/analysis";
import Icon, { scenarioIcon } from "./Icon";
import PlaceSearch from "./PlaceSearch";
import { BANGLADESH } from "../lib/geocode";

export interface OnboardChoice { module: ModuleId; job: Job | null; ll?: LonLat; region?: string }
export type OnboardProgress = { state: "idle" | "working" | "ready" | "fallback"; stage?: string };

const STEPS = ["hello", "who", "where", "nisar", "hard", "simple", "you", "ready"] as const;
type StepId = (typeof STEPS)[number];
const GLYPH: Record<Status, string> = { ok: "✓", watch: "!", alert: "✕" };
const personaModule = (p: Persona): ModuleId => (p === "safe" ? "haz" : p === "study" ? "vis" : "econ");

export default function Onboarding(p: {
  lang: Lang; setLang: (l: Lang) => void; catalog: CatalogEntry[];
  progress: OnboardProgress; onPlace: (c: OnboardChoice) => void; onDone: () => void; onJudge: () => void;
}) {
  const { lang } = p;
  const L = (s: [string, string]) => tr(s, lang);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [placed, setPlaced] = useState(false);
  const [loc, setLoc] = useState<"idle" | "finding" | "failed">("idle");
  const step: StepId = STEPS[i];
  const go = (d: number) => { setDir(d); setI((x) => Math.max(0, Math.min(STEPS.length - 1, x + d))); };

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") p.onDone(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [p]);

  const module = persona ? personaModule(persona) : "haz";
  const job = persona && persona !== "safe" && persona !== "study" ? persona : null;
  const scenarios = job ? JOBS.find((j) => j.id === job)!.scenarios : null;
  const places = p.catalog.filter((c) => c.modules.includes(module) && (!scenarios || scenarios.includes(c.scenario)) && !c.custom);
  const place = (c: Omit<OnboardChoice, "module" | "job">) => { p.onPlace({ module, job, ...c }); setPlaced(true); go(1); };
  const locate = () => {
    if (!navigator.geolocation) { setLoc("failed"); return; }
    setLoc("finding");
    navigator.geolocation.getCurrentPosition((q) => { setLoc("idle"); place({ ll: [q.coords.longitude, q.coords.latitude] }); },
      () => setLoc("failed"), { timeout: 15000, maximumAge: 300000 });
  };
  const working = placed && p.progress.state === "working";

  return (
    <div className="onb" role="dialog" aria-modal aria-label="SARsight" lang={lang}>
      <div className="onb-sky" aria-hidden><i /><i /><i /></div>
      <div className="onb-top">
        <div className="onb-dots" aria-hidden>{STEPS.map((s, k) => <i key={s} className={k === i ? "on" : k < i ? "done" : ""} />)}</div>
        <button className="pill lang" onClick={() => p.setLang(lang === "en" ? "bn" : "en")} lang={lang === "en" ? "bn" : "en"}>{lang === "en" ? "বাংলা" : "English"}</button>
        <button className="iconbtn small" onClick={p.onDone} aria-label={L(O.skip)}><Icon name="close" size={18} /></button>
      </div>

      <div key={step} className={`onb-slide ${dir > 0 ? "fwd" : "bwd"}`}>
        {step === "hello" && (<>
          <Orbit />
          <h1 className="onb-h">{L(O.hello)}</h1>
          <p className="onb-p">{L(O.helloSub)}</p>
          <div className="onb-langs">
            <span className="eyebrow mono">{L(O.lang)}</span>
            <div className="row2">
              <button className={lang === "bn" ? "action" : "action ghost"} lang="bn" onClick={() => p.setLang("bn")}>বাংলা</button>
              <button className={lang === "en" ? "action" : "action ghost"} lang="en" onClick={() => p.setLang("en")}>English</button>
            </div>
          </div>
          <button className="action big onb-cta" onClick={() => go(1)}>{L(O.start)}<Icon name="back" size={20} className="flip" /></button>
          <button className="linkbtn judge-invite" onClick={p.onJudge}>★ {L(JUDGE.invite)}</button>
        </>)}

        {step === "who" && (<>
          <h1 className="onb-h">{L(O.who)}</h1>
          <p className="onb-p">{L(O.whoSub)}</p>
          <div className="onb-who">
            {[...JOBS.map((j) => ({ id: j.id as Persona, icon: j.icon, name: j.name })), { id: "safe" as Persona, icon: PERSONA.safe.icon, name: O.safe }, { id: "study" as Persona, icon: PERSONA.study.icon, name: O.study }]
              .map((x, k) => (
                <button key={x.id} className={persona === x.id ? "job on" : "job"} style={{ animationDelay: `${k * 60}ms` }}
                  onClick={() => { setPersona(x.id); setPlaced(false); go(1); }}>
                  <Icon name={x.icon} size={40} /><b>{L(x.name as [string, string])}</b>
                </button>
              ))}
          </div>
        </>)}

        {step === "where" && (<>
          <Pin />
          <h1 className="onb-h">{L(O.where)}</h1>
          <p className="onb-p">{L(O.whereSub)}</p>
          <button className="action big" onClick={locate} disabled={loc === "finding"}>
            <Icon name="locate" size={26} />{loc === "finding" ? L(O.finding) : tr(["Use my location", "আমার অবস্থান"], lang)}
          </button>
          {loc === "failed" && <p className="onb-warn">{L(O.noLoc)}</p>}
          <PlaceSearch lang={lang} bias={module === "vis" ? undefined : BANGLADESH} onPick={(q) => place({ ll: q.ll })} />
          <div className="eyebrow mono">{tr(["Or choose a place", "অথবা একটি জায়গা বাছুন"], lang)}</div>
          <ul className="regions onb-places">
            {places.map((c) => (
              <li key={c.id}><button onClick={() => place({ region: c.id })}>
                <span className="ricon"><Icon name={scenarioIcon[c.scenario]} size={24} /></span>
                <span className="rtext"><b>{c.place}</b><small>{c.country}</small></span>
              </button></li>
            ))}
          </ul>
          <button className="linkbtn" onClick={() => { setPlaced(false); go(1); }}>{L(O.skip)}</button>
        </>)}

        {step === "nisar" && (<>
          <Radar />
          <div className="eyebrow mono">{L(O.nisarEyebrow)}</div>
          <h1 className="onb-h">{L(O.nisar)}</h1>
          <ul className="onb-pts">
            {O.nisarPts.map((s, k) => <li key={k} style={{ animationDelay: `${200 + k * 140}ms` }}><Icon name={["sat", "storm", "play", "ruler"][k]} size={22} />{L(s)}</li>)}
          </ul>
        </>)}

        {step === "hard" && (<>
          <Untangle />
          <div className="eyebrow mono">{L(O.hardEyebrow)}</div>
          <h1 className="onb-h">{L(O.hard)}</h1>
          <p className="onb-p">{L(O.hardSub)}</p>
          <p className="onb-p strong">{L(O.hardFix)}</p>
        </>)}

        {step === "simple" && (<>
          <DemoCard lang={lang} />
          <div className="eyebrow mono">{L(O.simpleEyebrow)}</div>
          <h1 className="onb-h">{L(O.simple)}</h1>
          <p className="onb-p">{L(O.simpleSub)}</p>
        </>)}

        {step === "you" && (<>
          <div className="onb-badge"><Icon name={PERSONA[persona ?? "safe"].icon} size={56} /></div>
          <div className="eyebrow mono">{L(O.youEyebrow)}</div>
          <h1 className="onb-h">{L(O.you)}</h1>
          <ul className="onb-pts">
            {PERSONA[persona ?? "safe"].pts.map((s, k) => <li key={k} style={{ animationDelay: `${150 + k * 140}ms` }}><Icon name="check" size={22} />{L(s)}</li>)}
          </ul>
        </>)}

        {step === "ready" && (<>
          <Ring done={!placed || p.progress.state !== "working"} />
          <div className="eyebrow mono">{L(O.readyEyebrow)}</div>
          <h1 className="onb-h">{!placed ? L(O.allSet) : p.progress.state === "working" ? L(O.preparing) : L(O.ready)}</h1>
          {working && p.progress.stage && <p className="onb-p mono dim">{p.progress.stage}</p>}
          {placed && p.progress.state === "fallback" && <p className="onb-p">{L(O.failed)}</p>}
          {!placed && persona !== "study" && <p className="onb-p">{L(O.noPlace)}</p>}
          <button className="action big onb-cta" onClick={p.onDone}>{working ? L(O.later) : L(O.open)}</button>
        </>)}
      </div>

      <div className="onb-foot">
        {i > 0 ? <button className="linkbtn" onClick={() => go(-1)}><Icon name="back" size={18} />{L(O.back)}</button> : <span />}
        {working && step !== "ready" && (
          <span className="onb-fetch" aria-live="polite"><i className="spin" />{L(O.fetching)}</span>
        )}
        {i > 2 && i < STEPS.length - 1 ? <button className="action onb-next" onClick={() => go(1)}>{L(O.next)}<Icon name="back" size={18} className="flip" /></button> : <span />}
      </div>
    </div>
  );
}

/* ---------- illustrations: pure SVG + CSS, no assets ---------- */

function Earth({ r = 70 }: { r?: number }) {
  return (<>
    <defs>
      <radialGradient id="onb-earth" cx="38%" cy="35%" r="70%"><stop offset="0" stopColor="#1f5f8b" /><stop offset=".65" stopColor="#0f2a44" /><stop offset="1" stopColor="#070d16" /></radialGradient>
      <clipPath id="onb-clip"><circle r={r} /></clipPath>
    </defs>
    <circle r={r + 10} className="onb-glow" />
    <circle r={r} fill="url(#onb-earth)" />
    <g clipPath="url(#onb-clip)">
      {[-0.55, 0, 0.55].map((y) => <line key={y} x1={-r} x2={r} y1={y * r} y2={y * r} className="onb-mer" />)}
      <g className="onb-spin" style={{ ["--sp" as string]: `${(r * 2) / 3}px` }}>
        {[-3, -2, -1, 0, 1, 2, 3, 4].map((k) => <ellipse key={k} cx={(k * r * 2) / 3} rx={r * 0.32} ry={r} className="onb-mer" />)}
      </g>
    </g>
  </>);
}

export function Orbit() {
  return (
    <svg className="onb-art" viewBox="-130 -110 260 220" aria-hidden>
      <Earth />
      <ellipse rx="118" ry="40" transform="rotate(-18)" className="onb-orbit" />
      <g transform="rotate(-18)">
        <g className="onb-sat"><Sat /></g>
      </g>
      <circle cx="18" cy="-8" r="4" className="onb-hit" />
      <circle cx="18" cy="-8" r="4" className="onb-ping" />
      <circle cx="18" cy="-8" r="4" className="onb-ping late" />
    </svg>
  );
}

function Sat() {
  return (<g>
    <rect x="-5" y="-4" width="10" height="8" rx="1.5" fill="#e9e9e4" />
    <rect x="-19" y="-2.5" width="12" height="5" fill="#2f8cff" /><rect x="7" y="-2.5" width="12" height="5" fill="#2f8cff" />
    <circle cy="7" r="3.5" fill="none" stroke="#ffb547" strokeWidth="1.5" />
  </g>);
}

export function Radar() {
  return (
    <svg className="onb-art" viewBox="-130 -110 260 220" aria-hidden>
      <g transform="translate(0 26)"><Earth r={62} /></g>
      <polygon points="0,-82 -30,-30 30,-30" className="onb-beam" />
      <g className="onb-cloud c1"><ellipse cx="-44" cy="-34" rx="30" ry="10" /><ellipse cx="-28" cy="-41" rx="17" ry="10" /></g>
      <g className="onb-cloud c2"><ellipse cx="40" cy="-26" rx="26" ry="9" /><ellipse cx="52" cy="-33" rx="14" ry="9" /></g>
      <g transform="translate(0 -88)"><Sat /></g>
      <g transform="translate(-63 98)">{Array.from({ length: 12 }, (_, k) => <rect key={k} x={k * 11} y="0" width="7" height="7" rx="2" className="onb-day" style={{ animationDelay: `${k * 0.18}s` }} />)}</g>
    </svg>
  );
}

function Untangle() {
  const cells = Array.from({ length: 36 }, (_, k) => k);
  return (
    <svg className="onb-art" viewBox="-130 -90 260 180" aria-hidden>
      <g transform="translate(-118 -66)" className="onb-raw">
        {cells.map((k) => <rect key={k} x={(k % 6) * 17} y={Math.floor(k / 6) * 22} width="15" height="20" rx="2" style={{ animationDelay: `${(k * 37) % 900}ms`, fill: `hsl(${(k * 47) % 360} 70% 55%)` }} />)}
      </g>
      <path d="M-6 0h28m-8-8 8 8-8 8" className="onb-arrow" />
      <g transform="translate(40 -46)" className="onb-mini">
        <rect width="84" height="92" rx="10" />
        <rect width="84" height="8" rx="4" className="ok" />
        <circle cx="20" cy="36" r="12" className="ok" />
        <path d="M14 36l4 4 8-8" className="tick" />
        <rect x="38" y="30" width="36" height="5" rx="2.5" className="bar" />
        <rect x="38" y="40" width="24" height="5" rx="2.5" className="bar" />
        <rect x="10" y="58" width="30" height="24" rx="5" className="bar" /><rect x="44" y="58" width="30" height="24" rx="5" className="bar" />
      </g>
    </svg>
  );
}

function DemoCard({ lang }: { lang: Lang }) {
  const order: Status[] = ["ok", "watch", "alert"];
  const [k, setK] = useState(0);
  useEffect(() => { const id = setInterval(() => setK((x) => (x + 1) % 3), 2600); return () => clearInterval(id); }, []);
  const s = order[k];
  return (
    <div className={`acard onb-demo ${s}`} aria-hidden>
      <div className="acard-status"><i className="glyph">{GLYPH[s]}</i>{tr({ ok: ["Good", "ভালো"], watch: ["Careful", "সতর্ক"], alert: ["Danger", "বিপদ"] }[s] as [string, string], lang)}</div>
      <p key={s} className="acard-say onb-swap">{tr(O.demo[s], lang)}</p>
      <div className="atiles">
        <div className={`atile ${s}`}><Icon name="drop" size={30} /><b>{tr(["Soil water", "মাটির পানি"], lang)}</b></div>
        <div className={`atile ${k === 2 ? "alert" : "ok"}`}><Icon name="sprout" size={30} /><b>{tr(["Crop", "ফসল"], lang)}</b></div>
      </div>
      <div className="listen"><Icon name="play" size={18} />{tr(["Listen", "শুনুন"], lang)}</div>
    </div>
  );
}

function Pin() {
  return (
    <svg className="onb-art small" viewBox="-60 -50 120 100" aria-hidden>
      <ellipse cy="34" rx="34" ry="9" className="onb-shadow" />
      <circle cy="34" r="6" className="onb-ping" /><circle cy="34" r="6" className="onb-ping late" />
      <g className="onb-drop"><path d="M0 34c-14-18-22-28-22-40a22 22 0 1 1 44 0c0 12-8 22-22 40z" className="onb-pinbody" /><circle cy="-6" r="8" fill="#050608" /></g>
    </svg>
  );
}

function Ring({ done }: { done: boolean }) {
  return (
    <svg className={`onb-art small onb-ring${done ? " done" : ""}`} viewBox="-50 -50 100 100" aria-hidden>
      <circle r="38" className="track" />
      <circle r="38" className="arc" />
      <path d="M-14 0l9 9 19-19" className="tick" />
    </svg>
  );
}

export const ONBOARDED = "sarsight.onboarded.v1";
