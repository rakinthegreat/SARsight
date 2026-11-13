// Place names for the 2D map as real text (constant size at any zoom, Bangla names where OSM has them).
// Source: OpenStreetMap via the public Overpass API (free, no key). One request per region, cached.
import type { LonLat, RegionData } from "./data/types";
import type { Lang } from "./assist";

export interface PlaceLabel { rank: number; ll: LonLat; name: string; en?: string; bn?: string }

/** city / town always; finer places appear as you zoom in */
const RANK: Record<string, number> = { city: 0, town: 1, suburb: 2, village: 3, quarter: 4, neighbourhood: 5, hamlet: 6 };
const KEY = "sarsight.places.v1:";
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

/** Names for a region: the file baked in at build time if there is one, else a live Overpass query. */
export async function regionPlaces(r: RegionData): Promise<PlaceLabel[]> {
  if (r.manifest.places && r.root) {
    const res = await fetch(`${r.root}/places.json`).catch(() => null);
    if (res?.ok) return res.json();
  }
  const [w, s, e, n] = r.manifest.bbox, pw = (e - w) * 0.6, ph = (n - s) * 0.6;
  return placesIn([w - pw, s - ph, e + pw, n + ph]);
}
const memo = new Map<string, Promise<PlaceLabel[]>>();

export function placesIn([w, s, e, n]: [number, number, number, number]): Promise<PlaceLabel[]> {
  const key = [w, s, e, n].map((v) => v.toFixed(3)).join();
  if (memo.has(key)) return memo.get(key)!;
  const job = (async () => {
    try { const hit = sessionStorage.getItem(KEY + key); if (hit) return JSON.parse(hit) as PlaceLabel[]; } catch { /* storage unavailable */ }
    const q = `[out:json][timeout:25];node["place"~"^(${Object.keys(RANK).join("|")})$"]["name"](${s},${w},${n},${e});out body qt 4000;`;
    // two public Overpass servers, first answer wins
    const ask = async (url: string) => {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (!r.ok) throw new Error(`overpass ${r.status}`);
      return r.json() as Promise<{ elements: { lon: number; lat: number; tags: Record<string, string> }[] }>;
    };
    const j = await Promise.any(MIRRORS.map(ask));
    const out = j.elements.map((x) => ({ rank: RANK[x.tags.place] ?? 6, ll: [x.lon, x.lat] as LonLat, name: x.tags.name, en: x.tags["name:en"], bn: x.tags["name:bn"] }))
      .sort((a, b) => a.rank - b.rank);
    try { sessionStorage.setItem(KEY + key, JSON.stringify(out)); } catch { /* full or unavailable */ }
    return out;
  })();
  job.catch(() => memo.delete(key));
  memo.set(key, job);
  return job;
}

export const labelText = (p: PlaceLabel, lang: Lang) => (lang === "bn" ? p.bn ?? p.name : p.en ?? p.name);
