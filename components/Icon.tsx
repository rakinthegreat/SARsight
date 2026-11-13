const P: Record<string, string> = {
  grow: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  shrink: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm5-2 5 5",
  label: "M3 12V4h8l10 10-8 8L3 12zm5-4h.01",
  fire: "M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-1 3-3 4-3 6-1-1-1.5-2-1.5-3C7 10 6 12.5 6 15a6 6 0 0 0 6 6z",
  storm: "M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 7.5 3.8 3.8 0 0 1 17.5 15M13 12l-3 5h4l-3 5",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  drop: "M12 3c3.5 4.4 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.6 6-11z",
  sprout: "M12 21v-9m0 0c0-4 3-6 7-6 0 4-3 6-7 6zm0 0C12 8 9.5 6 5 6c0 4 2.5 6 7 6",
  wave: "M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2",
  ship: "M4 15l1.5 4h13L20 15H4zm3-1V8h6l3 6M10 8V4",
  quake: "M2 12h4l2-5 3 10 3-12 2 7h6",
  city: "M3 21V9l6-3v15m0 0h12V11l-6-3M9 21V6m4 4h.01M13 14h.01M17 14h.01",
  mountain: "M2 20l7-12 4 6 2-3 7 9H2z",
  pit: "M3 6h18l-3 6H6L3 6zm4 6l2 6h6l2-6",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14",
  play: "M7 4l13 8-13 8V4z",
  pause: "M7 4h4v16H7zM13 4h4v16h-4z",
  stop: "M6 6h12v12H6z",
  pen: "M4 20l4-1L19 8l-3-3L5 16l-1 4zM14 7l3 3",
  close: "M6 6l12 12M18 6L6 18",
  back: "M15 5l-7 7 7 7",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  layers: "M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5",
  leaf: "M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7",
  ruler: "M3 17L17 3l4 4L7 21l-4-4zm4-4l2 2m1-5l2 2m1-5l2 2",
  sat: "M13 7l4 4m-9 1l4 4m-6.5-1.5l7-7 2.5 2.5-7 7zM15 5l2-2 4 4-2 2M5 15l-2 2 4 4 2-2",
  locate: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm0-5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v2m0 16v2M2 12h2m16 0h2",
  check: "M5 12l5 5L20 7",
  swap: "M7 4L3 8l4 4M3 8h14m0 4l4 4-4 4m4-4H7",
  volcano: "M2 20l6-9h2l2 3 2-3h2l6 9H2zM10 8l1-3m2 3l2-3",
  derrick: "M8 21l4-18 4 18M9 15h6M10 10h4M5 21h14",
  sparkle: "M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3z",
  trend: "M23 6l-9.5 9.5-5-5L1 18m22-12h-6m6 0v6",
};

export type IconName = keyof typeof P;

export default function Icon({ name, size = 22, className }: { name: string; size?: number; className?: string }) {
  const fill = name === "play" || name === "pause" || name === "stop";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden
      fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name]} />
    </svg>
  );
}

export const scenarioIcon: Record<string, string> = {
  agriculture: "sprout", marine: "ship", mine: "pit", earthquake: "quake", flood: "wave", subsidence: "city", landslide: "mountain", volcano: "volcano", extraction: "derrick",
};
