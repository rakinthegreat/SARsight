// Live natural-event reports near a place, from NASA EONET (public, no key, CORS-open).
import { useEffect, useState } from "react";
import type { LonLat } from "./data/types";

export type EventKind = "floods" | "severeStorms" | "wildfires" | "earthquakes" | "volcanoes" | "landslides" | "drought" | "tempExtremes" | "dustHaze";
export interface NearEvent { id: string; kind: EventKind; title: string; km: number; date: string; open: boolean; link: string }

const KINDS = new Set<string>(["floods", "severeStorms", "wildfires", "earthquakes", "volcanoes", "landslides", "drought", "tempExtremes", "dustHaze"]);
export const RADIUS_KM = 300, DAYS = 30;
const cache = new Map<string, Promise<NearEvent[]>>();

const km = (a: LonLat, b: LonLat) => {
  const r = Math.PI / 180, dl = (b[1] - a[1]) * r, dn = (b[0] - a[0]) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dn / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const points = (g: { type: string; coordinates: unknown }): LonLat[] =>
  g.type === "Point" ? [g.coordinates as LonLat] : g.type === "Polygon" ? (g.coordinates as LonLat[][]).flat() : [];

export function nearbyEvents(at: LonLat): Promise<NearEvent[]> {
  const key = at.map((v) => v.toFixed(1)).join();
  if (cache.has(key)) return cache.get(key)!;
  const dy = RADIUS_KM / 111, dx = dy / Math.max(0.2, Math.cos((at[1] * Math.PI) / 180));
  const bbox = [at[0] - dx, at[1] + dy, at[0] + dx, at[1] - dy].map((v) => v.toFixed(3)).join();
  const job = fetch(`https://eonet.gsfc.nasa.gov/api/v3/events?status=all&days=${DAYS}&bbox=${bbox}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((j: { events: { id: string; title: string; link: string; closed: string | null; categories: { id: string }[]; geometry: { date: string; type: string; coordinates: unknown }[] }[] }) =>
      j.events.flatMap((e) => {
        const kind = e.categories.find((c) => KINDS.has(c.id))?.id as EventKind | undefined;
        const pts = e.geometry.flatMap(points);
        if (!kind || !pts.length) return [];
        const d = Math.min(...pts.map((q) => km(at, q)));
        const date = e.geometry.map((g) => g.date).sort().pop()!;
        return d <= RADIUS_KM ? [{ id: e.id, kind, title: e.title, km: Math.round(d), date, open: !e.closed, link: e.link }] : [];
      }).sort((a, b) => a.km - b.km))
    .catch((err) => { cache.delete(key); throw err; });
  cache.set(key, job);
  return job;
}

/** null while loading or if EONET can't be reached; [] means nothing reported nearby */
export function useNearbyEvents(at: LonLat | null) {
  const [ev, setEv] = useState<NearEvent[] | null>(null);
  const key = at?.join();
  useEffect(() => {
    setEv(null);
    if (!at) return;
    let live = true;
    nearbyEvents(at).then((x) => live && setEv(x), () => live && setEv(null));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return ev;
}
