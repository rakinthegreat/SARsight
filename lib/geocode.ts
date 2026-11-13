// Place search with OpenStreetMap Nominatim (free, no key). Its usage policy allows at most one request per second
// and no search-as-you-type, so we only search on submit and space requests out.
import type { LonLat } from "./data/types";
import type { Lang } from "./assist";

export interface Place { name: string; detail: string; ll: LonLat }

/** Bangladesh: results inside rank first for EconAssist / HazAssist users (others still appear). */
export const BANGLADESH: [number, number, number, number] = [88.0, 20.6, 92.7, 26.7];

let last = 0;
export async function searchPlaces(q: string, lang: Lang, bias?: [number, number, number, number]): Promise<Place[]> {
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const params = new URLSearchParams({ format: "jsonv2", limit: "6", q, "accept-language": lang === "bn" ? "bn,en" : "en" });
  if (bias) params.set("viewbox", bias.join(","));
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!r.ok) throw new Error(`search ${r.status}`);
  const rows: { name?: string; display_name: string; lon: string; lat: string }[] = await r.json();
  return rows.map((x) => {
    const parts = x.display_name.split(", ").filter((p) => !/^\d[\d -]*$/.test(p)); // drop postcodes
    const name = x.name || parts[0], rest = parts.slice(1);
    // nearest two areas plus the country, e.g. "Mirpur · Dhaka District · Bangladesh"
    const detail = [...new Set([...rest.slice(0, Math.min(2, rest.length - 1)), rest[rest.length - 1]])].filter(Boolean).join(", ");
    return { name, detail, ll: [+x.lon, +x.lat] as LonLat };
  });
}
