"use client";
// EconAssist / HazAssist for everyday users: who you are → where → tap your place → one colour, one sentence.
import { useMemo, useState, type ReactNode } from "react";
import type { CatalogEntry, ModuleId, RegionData } from "../lib/data/types";
import { EVENT, HOME, JOBS, UI, advise, eventLine, eventStatus, speak, stopSpeaking, useSpeaking, statusHistory, num, tr, type Job, type Lang, type Site } from "../lib/assist";
import type { Status } from "../lib/analysis";
import Icon, { scenarioIcon } from "./Icon";
import { useNearbyEvents } from "../lib/events";
import PlaceSearch from "./PlaceSearch";
import { BANGLADESH } from "../lib/geocode";
import type { LonLat } from "../lib/data/types";

export type Step = "who" | "where" | "site" | "card";
const GLYPH: Record<Status, string> = { ok: "✓", watch: "!", alert: "✕" };
const day = (iso: string, lang: Lang) => new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default function Assist(p: {
  lang: Lang; module: ModuleId; step: Step; job: Job | null; onJob: (j: Job | null) => void;
  list: CatalogEntry[]; onChoose: (id: string) => void; onLocate: () => void; onPlace: (ll: LonLat) => void;
  entry: CatalogEntry | null; region: RegionData | null; t: number; setT: (t: number) => void;
  site: Site | null; sites: Site[]; onSite: (id: string) => void; onAdd: () => void; onRemove: (id: string) => void;
  crossSites?: Site[];
  onEdit: () => void; onRename: (name: string) => void; editing: boolean; onMap: () => void;
  drawMode: "point" | "area" | null; onDrawMode: (m: "point" | "area") => void; onCheckArea: () => void; onCancel: (() => void) | null;
  detail: ReactNode;
  error?: string | null;
  progress?: [number, number] | null;
}) {
  const { lang, step, region, t } = p;
  const L = (s: [string, string]) => tr(s, lang);
  const job = JOBS.find((j) => j.id === p.job) ?? null;
  const words = p.module === "econ" && job ? job : HOME;
  const [more, setMore] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const speaking = useSpeaking();

  const advice = useMemo(() => (region && p.site && step === "card" ? advise(region, t, p.site.poly, lang) : null), [region, t, p.site, step, lang]);
  const center = useMemo<LonLat | null>(() => {
    const q = p.site?.poly;
    return p.module === "haz" && q?.length ? [q.reduce((a, v) => a + v[0], 0) / q.length, q.reduce((a, v) => a + v[1], 0) / q.length] : null;
  }, [p.site, p.module]);
  const events = useNearbyEvents(center);
  const history = useMemo(() => (region && p.site && step === "card" ? statusHistory(region, p.site.poly) : []), [region, p.site, step]);

  if (step === "who") return (
    <div className="assist">
      <h1 className="ahead">{L(UI.who)}</h1>
      <div className="jobs">
        {JOBS.map((j) => (
          <button key={j.id} className="job" onClick={() => p.onJob(j.id)}>
            <Icon name={j.icon} size={44} /><b>{L(j.name)}</b>
          </button>
        ))}
      </div>
    </div>
  );

  if (step === "where") return (
    <div className="assist">
      <div className="arow">
        {p.onCancel && <button className="iconbtn" onClick={p.onCancel} aria-label={L(UI.cancel)}><Icon name="back" /></button>}
        <h1 className="ahead">{L(words.place)}</h1>
      </div>
      <button className="action big" onClick={p.onLocate}><Icon name="locate" size={28} />{L(UI.locate)}</button>
      <PlaceSearch lang={lang} bias={BANGLADESH} onPick={(q) => p.onPlace(q.ll)} />
      {p.crossSites && p.crossSites.length > 0 && (
        <div className="saved-places">
          <div className="eyebrow mono">{lang === "bn" ? "সংরক্ষিত জায়গা" : "My saved places"}</div>
          <ul>
            {p.crossSites.map((s) => (
              <li key={s.id}>
                <button onClick={() => p.onChoose(s.region)}>
                  <Icon name="locate" size={20} />
                  <b>{s.name}</b>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="eyebrow mono">{L(UI.orPick)}</div>
      <ul className="regions">
        {p.list.map((r) => (
          <li key={r.id}>
            <button onClick={() => p.onChoose(r.id)}>
              <span className="ricon"><Icon name={scenarioIcon[r.scenario]} size={26} /></span>
              <span className="rtext"><b>{r.place}</b><small>{r.country}</small></span>
            </button>
          </li>
        ))}
      </ul>
      {p.module === "econ" && job && <button className="linkbtn" onClick={() => p.onJob(null)}><Icon name={job.icon} size={18} />{L(job.name)} · {L(UI.job)}</button>}
    </div>
  );

  if (step === "site") return (
    <div className="assist">
      <div className="arow">
        {p.onCancel && <button className="iconbtn" onClick={p.onCancel} aria-label={L(UI.cancel)}><Icon name="back" /></button>}
        <div><div className="eyebrow mono">{p.entry?.place}</div><h1 className="ahead">{p.drawMode === "area" ? L(UI.finishHint) : L(words.tap)}</h1></div>
      </div>
      <div className="tapcue"><Icon name={p.drawMode === "area" ? "pen" : "locate"} size={40} /></div>
      <button className="action ghost" onClick={() => p.onDrawMode(p.drawMode === "area" ? "point" : "area")}>
        <Icon name={p.drawMode === "area" ? "locate" : "pen"} />{p.drawMode === "area" ? L(words.tap) : L(UI.draw)}
      </button>
    </div>
  );

  if (!region || !p.site || !advice) {
    if (p.error) {
      return (
        <div className="assist">
          <div className="arow">
            <h1 className="ahead">{lang === "bn" ? "তথ্য লোড করা যায়নি" : "Could not load place"}</h1>
          </div>
          <p className="dim" style={{ margin: "16px 0", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--alert)" }}>
            {p.error}
          </p>
          <button className="action" onClick={p.onCancel ?? (() => p.onChoose(""))}>
            {lang === "bn" ? "অন্য জায়গা বাছুন" : "Choose another place"}
          </button>
        </div>
      );
    }
    return <div className="assist"><div className="loading mono">{p.progress ? num(L(UI.loadingOf).replace("{d}", String(p.progress[0])).replace("{n}", String(p.progress[1])), lang) : L(UI.loading)}</div></div>;
  }
  const e = region.manifest.epochs, h0 = Math.max(0, e.length - 12); // simple view: the last 12 passes
  return (
    <div className="assist">
      {p.sites.length > 1 || p.module === "haz" ? (
        <div className="sitechips">
          {p.sites.map((s) => <button key={s.id} className={s.id === p.site!.id ? "chip on" : "chip"} onClick={() => p.onSite(s.id)}>{s.name}</button>)}
          <button className="chip" onClick={p.onAdd} aria-label={L(UI.add)}>＋</button>
        </div>
      ) : null}

      <div className={`acard ${advice.status}`}>
        <div className="acard-top">
          {naming !== null ? (
            <input className="rename" autoFocus value={naming} maxLength={40} onChange={(ev) => setNaming(ev.target.value)}
              onBlur={() => { if (naming.trim()) p.onRename(naming.trim()); setNaming(null); }}
              onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); if (ev.key === "Escape") setNaming(null); }} />
          ) : <button className="sitename" onClick={() => setNaming(p.site!.name)} title={L(UI.rename)}>{p.site.name}<Icon name="pen" size={14} /></button>}
          {!p.editing && <button className="chip editshape" onClick={p.onEdit}><Icon name="map" size={16} />{L(UI.editShape)}</button>}
          <span className="mono">{p.entry?.place} · {day(e[t], lang)}</span>
        </div>
        <div className="acard-status"><i className="glyph" aria-hidden>{GLYPH[advice.status]}</i>{L(UI.status[advice.status])}</div>
        <p className="acard-say">{advice.lines[0]}</p>
        <div className="atiles">
          {advice.tiles.map((x) => (
            <div key={x.key} className={`atile ${x.status}`}>
              <Icon name={x.icon} size={36} />
              <b>{x.label}</b>
              <span><i className="glyph sm" aria-hidden>{GLYPH[x.status]}</i>{L(UI.status[x.status])}</span>
            </div>
          ))}
        </div>
        {advice.lines.slice(1).map((s, i) => <p key={`${i}-${s}`} className="acard-more">{s}</p>)}
        {advice.prediction && (
          <div className={`acard-pred ${advice.prediction.status}`}>
            <div className="pred-top">
              <span className="pred-badge"><Icon name="sparkle" size={15} />{lang === "bn" ? "ভবিষ্যৎ পূর্বাভাস" : "Forward forecast"}</span>
              <span className="mono dim small">{advice.prediction.horizon}</span>
            </div>
            <div className="pred-headline"><b>{advice.prediction.headline}</b></div>
            <p className="pred-detail">{advice.prediction.detail}</p>
          </div>
        )}
        {events && (
          <div className="near">
            <div className="eyebrow mono">{L(UI.nearby)}</div>
            {events.length ? events.slice(0, 3).map((x) => (
              <div key={x.id} className={`nev ${eventStatus(x)}`} title={x.title}>
                <Icon name={EVENT[x.kind].icon} size={26} /><span>{eventLine(x, lang)}</span><i className="glyph sm" aria-hidden>{GLYPH[eventStatus(x)]}</i>
              </div>
            )) : <div className="nev ok"><Icon name="check" size={22} /><span>{L(UI.noneNear)}</span></div>}
          </div>
        )}
        {speaking ? (
          <button className="listen playing" onClick={stopSpeaking}>
            <Icon name="stop" size={20} />{L(UI.stop)}
          </button>
        ) : (
          <button className="listen" onClick={() => speak([...advice.lines, ...(advice.prediction ? [advice.prediction.headline + "। " + advice.prediction.detail] : []), ...(events?.length ? events.slice(0, 3).map((x) => eventLine(x, lang) + ".") : [])].join(" "), lang)}>
            <Icon name="play" size={20} />{L(UI.listen)}
          </button>
        )}
      </div>

      <div className="hist">
        <div className="hist-dots">
          {history.map((s, i) => i >= h0 && <button key={i} className={`hd ${s}${i === t ? " on" : ""}`} onClick={() => p.setT(i)} aria-label={day(e[i], lang)} title={day(e[i], lang)} />)}
        </div>
        <div className="hist-ends mono"><span>{day(e[h0], lang)}</span><span>{day(e[e.length - 1], lang)}</span></div>
        <div className="dim small">{L(UI.passes)}</div>
      </div>

      <button className="action ghost mobile-only" onClick={p.onMap}><Icon name="map" />{L(UI.seeMap)}</button>
      <div className="row2">
        {p.module === "haz" ? <button className="action ghost" onClick={p.onCheckArea}><Icon name="pen" />{L(UI.drawArea)}</button>
          : <button className="action ghost" onClick={p.onAdd}><Icon name="locate" />{L(UI.add)}</button>}
        <button className="action ghost" onClick={() => setMore(!more)}><Icon name="layers" />{L(more ? UI.less : UI.more)}</button>
      </div>
      {more && p.detail}

      <div className="afoot">
        <span>
          {p.module === "econ" && job && <button className="linkbtn" onClick={() => p.onJob(null)}><Icon name={job.icon} size={18} />{L(UI.job)}</button>}
          <button className="linkbtn" onClick={() => p.onRemove(p.site!.id)}><Icon name="close" size={18} />{L(UI.remove)}</button>
        </span>
      </div>
    </div>
  );
}
