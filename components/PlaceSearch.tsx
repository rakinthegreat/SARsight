"use client";
// Type a village, town or area name and pick it: for people who can't (or won't) share their location.
import { useEffect, useRef, useState } from "react";
import { UI, tr, type Lang } from "../lib/assist";
import { searchPlaces, type Place } from "../lib/geocode";
import Icon from "./Icon";

export default function PlaceSearch({ lang, onPick, bias }: { lang: Lang; onPick: (p: Place) => void; bias?: [number, number, number, number] }) {
  const L = (s: [string, string]) => tr(s, lang);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Place[] | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const open = !!res || state === "failed";

  useEffect(() => { // close the dropdown on a click elsewhere
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) { setRes(null); setState("idle"); } };
    addEventListener("pointerdown", away);
    return () => removeEventListener("pointerdown", away);
  }, [open]);

  const go = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (res?.length) { pick(res[hi]); return; } // Enter with results open picks the highlighted one
    if (q.trim().length < 2 || state === "busy") return;
    setState("busy");
    try { setRes(await searchPlaces(q.trim(), lang, bias)); setHi(0); setState("idle"); } catch { setRes(null); setState("failed"); }
  };
  const pick = (p: Place) => { onPick(p); setRes(null); setQ(p.name); input.current?.blur(); };
  const clear = () => { setQ(""); setRes(null); setState("idle"); input.current?.focus(); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setRes(null); setState("idle"); }
    if (!res?.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % res.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + res.length) % res.length); }
  };

  return (
    <div className={open ? "psearch open" : "psearch"} ref={root}>
      <form role="search" onSubmit={go}>
        <Icon name="search" size={20} />
        <input ref={input} value={q} onChange={(ev) => { setQ(ev.target.value); setRes(null); setState("idle"); }} onKeyDown={key}
          placeholder={L(UI.search)} aria-label={L(UI.search)} enterKeyHint="search" autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={!!res?.length} aria-controls="psearch-list" />
        {q && <button type="button" className="psearch-x" onClick={clear} aria-label={L(UI.cancel)}><Icon name="close" size={16} /></button>}
        <button className="psearch-go" disabled={state === "busy" || q.trim().length < 2}>
          {state === "busy" ? <i className="spin" aria-label="…" /> : L(UI.searchGo)}
        </button>
      </form>
      {open && (
        <div className="psearch-pop">
          {res?.length ? (
            <ul id="psearch-list" role="listbox">
              {res.map((p, k) => (
                <li key={k} role="option" aria-selected={k === hi} style={{ animationDelay: `${k * 30}ms` }}>
                  <button className={k === hi ? "on" : ""} onMouseEnter={() => setHi(k)} onClick={() => pick(p)}>
                    <Icon name="locate" size={20} /><span><b>{p.name}</b>{p.detail && <small>{p.detail}</small>}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="psearch-msg">{state === "failed" ? L(UI.searchFail) : L(UI.noResults)}</p>}
          {res && res.length > 0 && <div className="psearch-credit mono">© OpenStreetMap contributors</div>}
        </div>
      )}
    </div>
  );
}
