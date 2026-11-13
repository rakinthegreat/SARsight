// The only place the app touches the data repo. Point NEXT_PUBLIC_DATA_BASE at another
// folder/URL with the same layout (catalog.json + <region>/manifest.json + <layer>.f16|.f32) to swap data.
import type { CatalogEntry, LayerMeta, Manifest, RawLayerId, RegionData, Source } from "./types";

const BASE = (process.env.NEXT_PUBLIC_DATA_BASE ?? "/data").replace(/\/$/, "");
const MOTION = new Set(["subsidence", "landslide", "volcano", "earthquake", "mine", "extraction"]);
const PARALLEL = 2; // a few files at a time, so the first ones finish early instead of all finishing together

type Listener = (r: RegionData) => void;
interface Entry { data: RegionData; core: Promise<RegionData>; listeners: Set<Listener>; progress: Set<(done: number, total: number) => void> }
const cache = new Map<string, Entry>();
const stale = new Set<string>();

/** Drop a region from the cache so its next load fetches the files again (e.g. NISAR layers were just added). */
export function forgetRegion(id: string) { cache.delete(id); stale.add(id); }

export async function loadCatalog(): Promise<{ regions: CatalogEntry[]; sources: Record<string, Source> }> {
  const res = await fetch(`${BASE}/catalog.json`);
  if (!res.ok) throw new Error(`catalog: ${res.status}`);
  const j = await res.json();
  return { regions: j.regions, sources: j.sources ?? {} };
}

let HALF: Float32Array | null = null;
/** IEEE half-precision bits -> float32, via a 64k lookup table built once. */
function fromHalf(buf: ArrayBuffer): Float32Array {
  if (!HALF) {
    HALF = new Float32Array(65536);
    for (let h = 0; h < 65536; h++) {
      const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
      HALF[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15);
    }
  }
  const u = new Uint16Array(buf), out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = HALF[u[i]];
  return out;
}

/** Layers the status cards and reports need to be correct; everything else streams in afterwards. */
function coreLayers(m: Manifest): Set<string> {
  const core = new Set(m.layers.filter((l) => l.static).map((l) => l.id).concat(["s1_vv", "s1_vh"]));
  if (MOTION.has(m.scenario)) { core.add("deformation"); core.add("coherence"); }
  return core;
}

/**
 * Resolves once the core layers are in (small static layers first, then the radar series), so a place opens quickly.
 * The remaining layers keep loading; `onUpdate` receives a fresh RegionData each time one arrives, `onProgress` counts files.
 */
export function loadRegion(id: string, base?: string, onUpdate?: Listener, onProgress?: (done: number, total: number) => void): Promise<RegionData> {
  let e = cache.get(id);
  if (!e) {
    const root = base ?? `${BASE}/${id}`, init: RequestInit = stale.delete(id) ? { cache: "reload" } : {};
    const entry: Entry = { data: undefined as unknown as RegionData, core: undefined as unknown as Promise<RegionData>, listeners: new Set(), progress: new Set() };
    entry.core = (async () => {
      const res = await fetch(`${root}/manifest.json`, init);
      if (!res.ok) throw new Error(`${id}: ${res.status}`);
      const manifest: Manifest = await res.json();
      const { cols, rows } = manifest.grid, half = manifest.dtype === "float16";
      const core = coreLayers(manifest), size = (l: LayerMeta) => (l.static ? 1 : manifest.epochs.length);
      const queue = [...manifest.layers].sort((a, b) => Number(!core.has(a.id)) - Number(!core.has(b.id)) || size(a) - size(b));
      const layers: Partial<Record<RawLayerId, Float32Array>> = {}, total = queue.length;
      entry.data = { manifest, root, layers, loading: { done: 0, total } };
      let done = 0, coreLeft = queue.filter((l) => core.has(l.id)).length, fail: unknown = null;
      let release!: () => void;
      const coreReady = new Promise<void>((ok) => { release = ok; if (!coreLeft) ok(); });
      const fetchOne = async (l: LayerMeta) => {
        const buf = await (await fetch(`${root}/${l.file}`, init)).arrayBuffer();
        const arr = half ? fromHalf(buf) : new Float32Array(buf);
        if (arr.length !== cols * rows * size(l)) throw new Error(`${id}/${l.file}: ${arr.length} values, expected ${cols * rows * size(l)}`);
        layers[l.id] = arr; done++;
        entry.data = { ...entry.data, layers: { ...layers }, loading: done < total ? { done, total } : undefined };
        entry.progress.forEach((f) => f(done, total));
        if (core.has(l.id) && !--coreLeft) release();
        else if (!core.has(l.id)) entry.listeners.forEach((f) => f(entry.data));
      };
      const worker = async () => { for (let l; (l = queue.shift()); ) await fetchOne(l).catch((err) => { fail ??= err; release(); }); };
      const all = Promise.all(Array.from({ length: PARALLEL }, worker));
      await coreReady;
      if (fail) throw fail;
      all.then(() => { if (fail) cache.delete(id); });
      return entry.data;
    })();
    entry.core.catch(() => cache.delete(id));
    cache.set(id, (e = entry));
  }
  if (onUpdate) e.listeners.add(onUpdate);
  if (onProgress) e.progress.add(onProgress);
  return e.core.then(() => e!.data);
}

/** Stop sending updates for a region (the view moved on). */
export function unwatchRegion(id: string, onUpdate?: Listener, onProgress?: (done: number, total: number) => void) {
  const e = cache.get(id);
  if (onUpdate) e?.listeners.delete(onUpdate);
  if (onProgress) e?.progress.delete(onProgress);
}
