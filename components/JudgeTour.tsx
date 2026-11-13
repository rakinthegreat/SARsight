"use client";
// A short guided tour for NASA Space Apps judges: what SARsight is, where NISAR comes in, and the ready places that
// open instantly (building a new place takes a minute or two). Opened from the header, onboarding, or ?judge.
import { useEffect, useState } from "react";
import type { CatalogEntry } from "../lib/data/types";
import { JUDGE as J, tr, type Lang } from "../lib/assist";
import Icon, { scenarioIcon } from "./Icon";
import { Orbit, Radar } from "./Onboarding";

const STEPS = ["hello", "three", "nisar", "try", "any"] as const;

export default function JudgeTour({ lang, setLang, catalog, onPick, onClose }: {
  lang: Lang; setLang: (l: Lang) => void; catalog: CatalogEntry[]; onPick: (id: string) => void; onClose: () => void;
}) {
  const L = (s: [string, string]) => tr(s, lang);
  const [i, setI] = useState(0), [dir, setDir] = useState(1);
  const go = (k: number) => { setDir(k > i ? 1 : -1); setI(Math.max(0, Math.min(STEPS.length - 1, k))); };
  const step = STEPS[i], last = i === STEPS.length - 1;
  const ready = catalog.filter((c) => !c.custom).sort((a, b) => Number(!!b.nisarData) - Number(!!a.nisarData));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });

  return (
    <div className="onb judge" role="dialog" aria-modal aria-label={L(J.button)} lang={lang}>
      <div className="onb-sky" aria-hidden><i /><i /><i /></div>
      <div className="onb-top">
        <div className="onb-dots" aria-hidden>{STEPS.map((s, k) => <i key={s} className={k === i ? "on" : k < i ? "done" : ""} />)}</div>
        <button className="pill lang" onClick={() => setLang(lang === "en" ? "bn" : "en")} lang={lang === "en" ? "bn" : "en"}>{lang === "en" ? "বাংলা" : "English"}</button>
        <button className="iconbtn small" onClick={onClose} aria-label={L(J.explore)}><Icon name="close" size={18} /></button>
      </div>

      <div key={step} className={`onb-slide ${dir > 0 ? "fwd" : "bwd"}`}>
        {step === "hello" && (<>
          <Orbit />
          <div className="eyebrow mono">{L(J.eyebrow)}</div>
          <h1 className="onb-h">{L(J.hello)}</h1>
          <p className="onb-p">{L(J.helloSub)}</p>
        </>)}

        {step === "three" && (<>
          <h1 className="onb-h">{L(J.three)}</h1>
          <div className="judge-mods">
            {([["leaf", "EconAssist", J.econ], ["quake", "HazAssist", J.haz], ["globe", "VisAssist", J.vis]] as const).map(([icon, name, text], k) => (
              <div key={name} className="judge-mod" style={{ animationDelay: `${150 + k * 140}ms` }}>
                <Icon name={icon} size={30} /><span><b>{name}</b><span>{L(text)}</span></span>
              </div>
            ))}
          </div>
        </>)}

        {step === "nisar" && (<>
          <Radar />
          <div className="eyebrow mono">{L(J.nisarEyebrow)}</div>
          <h1 className="onb-h">{L(J.nisar)}</h1>
          <ul className="onb-pts">
            {J.nisarPts.map((s, k) => <li key={k} style={{ animationDelay: `${200 + k * 140}ms` }}><Icon name={["sat", "ruler", "storm", "check"][k]} size={22} />{L(s)}</li>)}
          </ul>
        </>)}

        {step === "try" && (<>
          <h1 className="onb-h">{L(J.try)}</h1>
          <p className="onb-p">{L(J.trySub)}</p>
          <ul className="regions onb-places judge-places">
            {ready.map((c) => (
              <li key={c.id}><button onClick={() => onPick(c.id)}>
                <span className="ricon"><Icon name={scenarioIcon[c.scenario]} size={24} /></span>
                <span className="rtext"><b>{c.name}</b><small>{c.place} · {c.country}</small></span>
                {c.nisarData && <span className="judge-tag mono">{L(J.nisarTag)}</span>}
              </button></li>
            ))}
          </ul>
        </>)}

        {step === "any" && (<>
          <div className="eyebrow mono">{L(J.anyEyebrow)}</div>
          <h1 className="onb-h">{L(J.any)}</h1>
          <ul className="onb-pts">
            {J.anyPts.map((s, k) => <li key={k} style={{ animationDelay: `${200 + k * 140}ms` }}><Icon name={["search", "sat", "sparkle"][k]} size={22} />{L(s)}</li>)}
          </ul>
          <p className="onb-p strong">{L(J.short)}</p>
          <p className="onb-p small">{L(J.server)}</p>
          <button className="action big onb-cta" onClick={() => go(3)}>{L(J.seeReady)}</button>
        </>)}
      </div>

      <div className="onb-foot">
        {i > 0 ? <button className="linkbtn" onClick={() => go(i - 1)}><Icon name="back" size={18} />{tr(["Back", "পেছনে"], lang)}</button> : <span />}
        {last
          ? <button className="action onb-next" onClick={onClose}>{L(J.explore)}<Icon name="back" size={18} className="flip" /></button>
          : <button className="action onb-next" onClick={() => go(i + 1)}>{tr(["Next", "পরের"], lang)}<Icon name="back" size={18} className="flip" /></button>}
      </div>
    </div>
  );
}
