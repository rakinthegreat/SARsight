// On-demand areas: ask the backend to build a new region around a place the showcase squares don't cover.
// Prepared areas are remembered on this device and re-listed from the backend when it is reachable.
import type { CatalogEntry, LonLat, Scenario, Source } from "./data/types";

export const API = (process.env.NEXT_PUBLIC_API ?? "http://localhost:8000").replace(/\/$/, "");
const KEY = "sarsight.areas.v1";

export interface AreaJob { id: string; state: "queued" | "running" | "done" | "failed" | "unknown"; stage?: string; error?: string; position?: number; entry?: CatalogEntry & { sources?: Record<string, Source> } }

const withBase = (e: CatalogEntry): CatalogEntry => ({ ...e, custom: true, base: `${API}/areas/${e.id}/site` });

export function savedAreas(): CatalogEntry[] {
  try {
    const list = (JSON.parse(localStorage.getItem(KEY) ?? "[]") as CatalogEntry[]).map(withBase);
    const seen = new Set<string>();
    return list.filter((x) => x && x.id && !seen.has(x.id) && seen.add(x.id));
  } catch { return []; }
}
export function rememberArea(e: CatalogEntry) {
  try {
    const all = savedAreas().filter((x) => x.id !== e.id);
    const { base: _b, ...plain } = e; // base is re-derived, so a changed API address still works
    localStorage.setItem(KEY, JSON.stringify([...all, plain]));
  } catch { /* storage unavailable */ }
}
export function removeSavedArea(id: string) {
  try {
    const all = savedAreas().filter((x) => x.id !== id);
    localStorage.setItem(KEY, JSON.stringify(all.map(({ base: _, ...p }) => p)));
  } catch { /* storage unavailable */ }
}
export async function serverAreas(): Promise<CatalogEntry[]> {
  try {
    const r = await fetch(`${API}/api/areas`);
    if (!r.ok) return [];
    const list = ((await r.json()) as CatalogEntry[]).map(withBase);
    const seen = new Set<string>();
    return list.filter((x) => x && x.id && !seen.has(x.id) && seen.add(x.id));
  } catch { return []; }
}

export async function requestArea(polygon: LonLat[], scenario: Scenario, name?: string, window?: [string, string]): Promise<AreaJob> {
  const r = await fetch(`${API}/api/areas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ polygon, scenario, name, window }) });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `server error ${r.status}`);
  return r.json();
}
export async function areaStatus(id: string): Promise<AreaJob> {
  const r = await fetch(`${API}/api/areas/${id}`);
  if (!r.ok) throw new Error(`server error ${r.status}`);
  const j: AreaJob = await r.json();
  if (j.entry) j.entry = withBase(j.entry) as AreaJob["entry"];
  return j;
}
