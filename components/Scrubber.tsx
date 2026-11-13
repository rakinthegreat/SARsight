"use client";
import { useEffect } from "react";
import Icon from "./Icon";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const num = (s: string, lang = "en") => (lang === "bn" ? s.replace(/\d/g, (d) => BN_DIGITS[+d]) : s);

const fmt = (iso: string, lang = "en") =>
  new Date(iso + "T00:00:00Z").toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export default function Scrubber({ epochs, t, onT, playing, onPlaying, event, sub, lang = "en" }: {
  sub?: string;
  epochs: string[];
  t: number;
  onT: (t: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  event?: { epoch: number; label: string; date: string };
  lang?: "en" | "bn";
}) {
  const last = epochs.length - 1;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => onT(t >= last ? 0 : t + 1), 650);
    return () => clearInterval(id);
  }, [playing, t, last, onT]);

  return (
    <div className="scrub">
      <button className="iconbtn big" onClick={() => onPlaying(!playing)} aria-label={playing ? (lang === "bn" ? "থামান" : "Pause") : (lang === "bn" ? "চালান" : "Play")}>
        <Icon name={playing ? "pause" : "play"} size={20} />
      </button>
      <div className="scrub-main">
        <div className="scrub-top">
          <span className="scrub-date">{fmt(epochs[t], lang)}</span>
          <span className="mono dim">{sub ?? (lang === "bn" ? "পাস" : "pass")} {num(String(t + 1), lang)}/{num(String(epochs.length), lang)}</span>
        </div>
        <div className="scrub-track">
          <input type="range" min={0} max={last} step={1} value={t} aria-label={lang === "bn" ? "গ্রহণের তারিখ" : "Acquisition date"}
            onChange={(e) => { onPlaying(false); onT(+e.target.value); }} />
          <div className="ticks" aria-hidden>
            {epochs.map((d, k) => <i key={d} className={k <= t ? "on" : ""} />)}
          </div>
          {event && (
            <div className="event" style={{ left: `calc(${((event.epoch - 0.5) / last) * 100}%)` }} title={`${event.label} · ${fmt(event.date, lang)}`}>
              <span>{event.label}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
