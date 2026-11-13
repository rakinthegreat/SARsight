// The only place the app touches the data repo. Point NEXT_PUBLIC_DATA_BASE at another
// folder/URL with the same layout (catalog.json + <region>/manifest.json + <layer>.f32) to swap data.
import type { CatalogEntry, Manifest, RawLayerId, RegionData, Source } from "./types";

const BASE = (process.env.NEXT_PUBLIC_DATA_BASE ?? "/data").replace(/\/$/, "");
const cache = new Map<string, Promise<RegionData>>();
const stale = new Set<string>();

/** Drop a region from the cache so its next load fetches the files again (e.g. NISAR layers were just added). */
export function forgetRegion(id: string) { cache.delete(id); stale.add(id); }

export async function loadCatalog(): Promise<{ regions: CatalogEntry[]; sources: Record<string, Source> }> {
  const res = await fetch(`${BASE}/catalog.json`);
  if (!res.ok) throw new Error(`catalog: ${res.status}`);
  const j = await res.json();
  return { regions: j.regions, sources: j.sources ?? {} };
}

export function loadRegion(id: string, base?: string): Promise<RegionData> {
  if (!cache.has(id)) {
    const root = base ?? `${BASE}/${id}`, init: RequestInit = stale.delete(id) ? { cache: "reload" } : {};
    const p = (async () => {
      const res = await fetch(`${root}/manifest.json`, init);
      if (!res.ok) throw new Error(`${id}: ${res.status}`);
      const manifest: Manifest = await res.json();
      const { cols, rows } = manifest.grid;
      const entries = await Promise.all(manifest.layers.map(async (l) => {
        const arr = new Float32Array(await (await fetch(`${root}/${l.file}`, init)).arrayBuffer());
        const want = l.static ? cols * rows : cols * rows * manifest.epochs.length;
        if (arr.length !== want) throw new Error(`${id}/${l.file}: ${arr.length} values, expected ${want}`);
        return [l.id, arr] as const;
      }));
      return { manifest, root, layers: Object.fromEntries(entries) as Partial<Record<RawLayerId, Float32Array>> };
    })();
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return cache.get(id)!;
}
