// Map views. Every view comes from real satellite data. InSAR views (motion, fringes, coherence, damage) are
// built from measured interferograms — NISAR GUNW or COMET LiCSAR Sentinel-1 — and only listed where fetched.
import type { RawLayerId, RegionData, Scenario } from "./data/types";

export type ViewId =
  | "vv" | "vh" | "change" | "water" | "wind" | "vigour" | "lband" | "nisar" | "nisardisp" | "nisarcoh" | "landcover" | "waterhist" | "elevation"
  | "deformation" | "phase" | "coherence" | "damage";

export interface ViewDef { id: ViewId; label: string; short: string; unit: string; stops: string[]; source: string; preview?: boolean }

const GRAY = ["#08090b", "#4a4d53", "#e9e9e4"];
const DIVERGE = ["#5fb4ff", "#1d3f6e", "#15171c", "#7a2c17", "#ff6a3d"];
const VIEWS: Record<ViewId, ViewDef> = {
  vv: { id: "vv", label: "Radar brightness (VV)", short: "Radar VV", unit: "dB", stops: GRAY, source: "s1" },
  vh: { id: "vh", label: "Radar brightness (VH)", short: "Radar VH", unit: "dB", stops: GRAY, source: "s1" },
  change: { id: "change", label: "Brightness change", short: "Change", unit: "dB", stops: DIVERGE, source: "s1" },
  water: { id: "water", label: "Water", short: "Water", unit: "", stops: GRAY, source: "s1" },
  wind: { id: "wind", label: "Sea-surface wind (approx.)", short: "Wind", unit: "m/s", stops: ["#0d1a2a", "#1f5f8b", "#7cc7e8", "#fff3b0", "#ff6a3d"], source: "s1" },
  vigour: { id: "vigour", label: "Crop vigour", short: "Vigour", unit: "", stops: ["#15171c", "#3a2f1a", "#4c8b3a", "#b6e06a"], source: "s1" },
  lband: { id: "lband", label: "L-band radar (HV, 2021)", short: "L-band", unit: "dB", stops: GRAY, source: "palsar" },
  nisar: { id: "nisar", label: "NISAR L-band (HH, latest pass)", short: "NISAR", unit: "dB", stops: GRAY, source: "asf" },
  nisardisp: { id: "nisardisp", label: "NISAR ground motion since its first pass", short: "NISAR motion", unit: "cm", stops: ["#ff6a3d", "#7a2c17", "#15171c", "#1d3f6e", "#5fb4ff"], source: "asf" },
  nisarcoh: { id: "nisarcoh", label: "NISAR coherence (12-day pair)", short: "NISAR coherence", unit: "", stops: ["#0d0e11", "#5a5d63", "#f2f2ee"], source: "asf" },
  landcover: { id: "landcover", label: "Land cover (2021)", short: "Land cover", unit: "", stops: GRAY, source: "worldcover" },
  waterhist: { id: "waterhist", label: "How often water is here (1984–2021)", short: "Water history", unit: "%", stops: ["#15171c", "#123a66", "#2f8cff", "#bfe0ff"], source: "gsw" },
  elevation: { id: "elevation", label: "Elevation", short: "Terrain", unit: "m", stops: ["#101215", "#3b3f45", "#8a8577", "#e8e2d0"], source: "dem" },
  deformation: { id: "deformation", label: "Ground motion since first pass (InSAR)", short: "Motion", unit: "cm", stops: ["#ff6a3d", "#7a2c17", "#15171c", "#1d3f6e", "#5fb4ff"], source: "insar" },
  phase: { id: "phase", label: "Interferogram fringes (re-wrapped motion)", short: "Fringes", unit: "rad", stops: ["#ff6a3d", "#ffd84a", "#46e3a0", "#2f8cff", "#b06bff", "#ff6a3d"], source: "insar" },
  coherence: { id: "coherence", label: "Coherence (12-day pair)", short: "Coherence", unit: "", stops: ["#0d0e11", "#5a5d63", "#f2f2ee"], source: "insar" },
  damage: { id: "damage", label: "Damage proxy (coherence loss)", short: "Damage", unit: "Δγ", stops: ["#15171c", "#5c1a12", "#ff4d2e", "#ffd2a8"], source: "insar" },
};

export const L_BAND_CM = 23.84, C_BAND_CM = 5.5466;
export const OPEN_WATER_DB = -18; // C-band VV specular threshold
export const SLICK_DB = -22.5;
export const LANDCOVER: Record<number, { name: string; color: [number, number, number] }> = {
  10: { name: "Trees", color: [0, 100, 0] }, 20: { name: "Shrubland", color: [255, 187, 34] }, 30: { name: "Grassland", color: [255, 255, 76] },
  40: { name: "Cropland", color: [240, 150, 255] }, 50: { name: "Built-up", color: [250, 0, 0] }, 60: { name: "Bare", color: [180, 180, 180] },
  70: { name: "Snow / ice", color: [240, 240, 240] }, 80: { name: "Water", color: [0, 100, 200] }, 90: { name: "Wetland", color: [0, 150, 160] },
  95: { name: "Mangroves", color: [0, 207, 117] }, 100: { name: "Moss", color: [250, 230, 160] },
};
export const LANDCOVER_BN: Record<number, string> = {
  10: "গাছপালা", 20: "গুল্মভূমি", 30: "ঘাসজমি", 40: "ফসলি জমি", 50: "বসতি ও অবকাঠামো",
  60: "অনাবাদী জমি", 70: "বরফ / তুষার", 80: "জলাশয়", 90: "জলাভূমি", 95: "ম্যানগ্রোভ", 100: "মস / শৈবাল",
};
export const WATER_COLORS = { usual: [31, 95, 191], flood: [47, 170, 255], vegetation: [123, 216, 143], slick: [255, 181, 71] } as const;

export const VIEW_NAMES_BN: Record<ViewId, { short: string; label: string }> = {
  vv: { short: "রাডার VV", label: "রাডার উজ্জ্বলতা (VV)" },
  vh: { short: "রাডার VH", label: "রাডার উজ্জ্বলতা (VH)" },
  change: { short: "পরিবর্তন", label: "উজ্জ্বলতা পরিবর্তন" },
  water: { short: "পানি", label: "পানি / প্লাবন" },
  wind: { short: "বাতাস", label: "সমুদ্রপৃষ্ঠে বাতাসের গতি (আনুমানিক)" },
  vigour: { short: "ফসলের বৃদ্ধি", label: "ফসলের বৃদ্ধি ও স্বাস্থ্য" },
  lband: { short: "এল-ব্যান্ড", label: "এল-ব্যান্ড রাডার (HV, ২০২১)" },
  nisar: { short: "নিসার", label: "নিসার এল-ব্যান্ড (HH, সর্বশেষ পাস)" },
  nisardisp: { short: "নিসার গতিবিধি", label: "নিসারের প্রথম পাস থেকে মাটির গতিবিধি" },
  nisarcoh: { short: "নিসার সুসংগততা", label: "নিসার সুসংগততা (১২ দিনের জোড়া)" },
  landcover: { short: "ভূমির ব্যবহার", label: "ভূমির ব্যবহার ও আবরণ (২০২১)" },
  waterhist: { short: "পানির ইতিহাস", label: "পানির পুনরাবৃত্তি (১৯৮৪–২০২১)" },
  elevation: { short: "ভূপ্রকৃতি", label: "উচ্চতা / ভূপ্রকৃতি" },
  deformation: { short: "মাটির গতিবিধি", label: "মাটি দেবে/উঠে যাওয়া (ইনসার)" },
  phase: { short: "ফ্রিঞ্জেস", label: "ইন্টারফেরোগ্রাম ফ্রিঞ্জ" },
  coherence: { short: "সুসংগততা", label: "রাডার সুসংগততা" },
  damage: { short: "ক্ষয়ক্ষতি", label: "ক্ষয়ক্ষতির সূচক (সুসংগততা হ্রাস)" },
};

export function viewDef(id: ViewId, scenario?: Scenario, lang: "en" | "bn" = "en", r?: RegionData): ViewDef {
  const src = r && (id === "deformation" || id === "phase" || id === "coherence" || id === "damage") ? r.manifest.layers.find((l) => l.id === (id === "coherence" || id === "damage" ? "coherence" : "deformation"))?.source : undefined;
  const v = src ? { ...VIEWS[id], source: src } : VIEWS[id];
  let res = v;
  if (id === "water" && scenario === "marine") {
    res = { ...v, label: "Oil slick candidates", short: "Slick" };
  }
  if (lang === "bn") {
    if (id === "water" && scenario === "marine") {
      return { ...res, label: "তেলের স্তরের সম্ভাবনা", short: "তেলের দাগ" };
    }
    const bn = VIEW_NAMES_BN[id];
    if (bn) return { ...res, label: bn.label, short: bn.short };
  }
  return res;
}

export const has = (r: RegionData, l: RawLayerId) => !!r.layers[l];

export function viewsFor(r: RegionData, module: "econ" | "haz" | "vis"): { observed: ViewId[]; preview: ViewId[] } {
  const sc = r.manifest.scenario;
  const table: Record<Scenario, [ViewId[], ViewId[]]> = {
    agriculture: [["vigour", "vh", "vv", "lband", "landcover"], ["coherence"]],
    marine: [["water", "wind", "vv", "landcover"], []],
    mine: [["change", "vv", "elevation", "landcover"], ["deformation", "phase", "coherence"]],
    extraction: [["change", "vv", "elevation", "landcover"], ["deformation", "phase"]],
    earthquake: [["change", "vv", "landcover", "elevation"], ["damage", "deformation", "phase", "coherence"]],
    flood: [["water", "vv", "waterhist", "landcover", "elevation"], ["coherence"]],
    subsidence: [["vv", "change", "landcover"], ["deformation", "phase", "coherence"]],
    landslide: [["change", "vv", "elevation", "landcover"], ["deformation", "damage"]],
    volcano: [["vv", "change", "elevation"], ["deformation", "phase"]],
  };
  let [observed, preview] = module === "vis"
    ? [["vv", "vh", "change", "water", "lband", "landcover", "waterhist", "elevation"] as ViewId[], ["deformation", "phase", "coherence"] as ViewId[]]
    : table[sc];
  const real: ViewId[] = [];
  if (has(r, "nisar_hh")) real.push("nisar");
  if (has(r, "nisar_disp")) real.push("nisardisp");
  if (has(r, "nisar_coh")) real.push("nisarcoh");
  const insar = (v: ViewId) => (v === "coherence" || v === "damage" ? has(r, "coherence") : has(r, "deformation"));
  observed = [...real, ...observed, ...preview.filter(insar)];
  return { observed, preview: [] };
}

const plane = (r: RegionData) => r.manifest.grid.cols * r.manifest.grid.rows;
const nan = (n: number) => new Float32Array(n).fill(NaN);

export function rawSlice(r: RegionData, layer: RawLayerId, t: number): Float32Array {
  const n = plane(r), a = r.layers[layer];
  if (!a) return nan(n);
  return a.length === n ? a : a.subarray(t * n, (t + 1) * n);
}

/** Reference pass for change: the last pass before the event, else the first pass. */
export const refEpoch = (r: RegionData, t: number) => {
  const e = r.manifest.event?.epoch;
  return e !== undefined && e > 0 && t >= e ? e - 1 : 0;
};

const baseCache = new WeakMap<RegionData, Float32Array>();
export function cohBaseline(r: RegionData): Float32Array {
  if (baseCache.has(r)) return baseCache.get(r)!;
  const n = plane(r), pre = Math.max(1, r.manifest.event?.epoch ?? 1), out = new Float32Array(n);
  for (let t = 0; t < pre; t++) { const s = rawSlice(r, "coherence", t); for (let k = 0; k < n; k++) out[k] += s[k] / pre; }
  baseCache.set(r, out);
  return out;
}

const wrap = (x: number) => x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI));
export const isSea = (lc: number) => !Number.isFinite(lc) || lc === 0 || lc === 80;

/**
 * Water classes from Sentinel-1 VV: 0 none · 1 usual water (JRC occurrence ≥ 50%) · 2 flood water (normally dry)
 * · 3 flooded vegetation (bright double bounce over trees/wetland). Marine regions: 1 = oil-slick candidate at sea.
 */
export function waterClass(r: RegionData, t: number): Float32Array {
  const vv = rawSlice(r, "s1_vv", t), vh = rawSlice(r, "s1_vh", t), lc = rawSlice(r, "landcover", 0), occ = rawSlice(r, "water_occurrence", 0);
  const out = new Float32Array(vv.length), marine = r.manifest.scenario === "marine";
  let seaMed = SLICK_DB + 4;
  if (marine) { // slicks are dark *relative to today's sea*: wind sets the background brightness
    const sea = Array.from(vv).filter((v, k) => isSea(lc[k]) && Number.isFinite(v)).sort((a, b) => a - b);
    if (sea.length) seaMed = sea[Math.floor(sea.length / 2)];
  }
  for (let k = 0; k < vv.length; k++) {
    if (!Number.isFinite(vv[k])) { out[k] = NaN; continue; }
    if (marine) { out[k] = isSea(lc[k]) && vv[k] < Math.min(-20, seaMed - 4) ? 1 : 0; continue; }
    if (vv[k] < OPEN_WATER_DB) out[k] = (occ[k] ?? 0) >= 50 ? 1 : 2;
    else out[k] = vv[k] > -6 && (lc[k] === 10 || lc[k] === 90 || lc[k] === 95) && vv[k] - vh[k] > 9 ? 3 : 0;
  }
  return out;
}

export function field(r: RegionData, view: ViewId, t: number): Float32Array {
  const n = plane(r);
  switch (view) {
    case "vv": return rawSlice(r, "s1_vv", t);
    case "vh": return rawSlice(r, "s1_vh", t);
    case "change": {
      const a = rawSlice(r, "s1_vv", t), b = rawSlice(r, "s1_vv", refEpoch(r, t)), out = new Float32Array(n);
      for (let k = 0; k < n; k++) out[k] = a[k] - b[k];
      return out;
    }
    case "water": return waterClass(r, t);
    case "wind": {
      const vv = rawSlice(r, "s1_vv", t), lc = rawSlice(r, "landcover", 0), out = nan(n);
      for (let k = 0; k < n; k++) if (isSea(lc[k]) && Number.isFinite(vv[k])) out[k] = Math.pow(10, (vv[k] + 29) / 20); // simplified C-band GMF, mid incidence
      return out;
    }
    case "vigour": {
      const vh = rawSlice(r, "s1_vh", t), out = new Float32Array(n);
      for (let k = 0; k < n; k++) out[k] = Math.max(0, Math.min(100, ((vh[k] + 22) / 10) * 100)); // VH volume scattering, -22..-12 dB
      return out;
    }
    case "lband": return rawSlice(r, "lband_hv", 0);
    case "nisar": return rawSlice(r, "nisar_hh", 0);
    case "nisardisp": return rawSlice(r, "nisar_disp", t);
    case "nisarcoh": return rawSlice(r, "nisar_coh", t);
    case "landcover": return rawSlice(r, "landcover", 0);
    case "waterhist": return rawSlice(r, "water_occurrence", 0);
    case "elevation": return rawSlice(r, "elevation", 0);
    case "deformation": return rawSlice(r, "deformation", t);
    case "coherence": return rawSlice(r, "coherence", t);
    case "phase": {
      const d = rawSlice(r, "deformation", t), out = new Float32Array(n);
      const lambda = r.manifest.layers.find((l) => l.id === "deformation")?.source === "licsar" ? C_BAND_CM : L_BAND_CM;
      for (let k = 0; k < n; k++) out[k] = Number.isNaN(d[k]) ? NaN : wrap((-4 * Math.PI * d[k]) / lambda);
      return out;
    }
    case "damage": {
      const b = cohBaseline(r), c = rawSlice(r, "coherence", t), out = new Float32Array(n);
      for (let k = 0; k < n; k++) out[k] = Math.max(0, b[k] - c[k]);
      return out;
    }
  }
}

const rangeCache = new WeakMap<RegionData, Map<ViewId, [number, number]>>();
export function viewRange(r: RegionData, view: ViewId): [number, number] {
  let m = rangeCache.get(r);
  if (!m) rangeCache.set(r, (m = new Map()));
  if (m.has(view)) return m.get(view)!;
  const fixed: Partial<Record<ViewId, [number, number]>> = {
    vv: [-25, 0], vh: [-30, -8], change: [-6, 6], water: [-25, 0], wind: [0, 16], vigour: [0, 100], lband: [-30, -8], nisar: [-25, 0],
    waterhist: [0, 100], phase: [-Math.PI, Math.PI], coherence: [0, 1], nisarcoh: [0, 1], damage: [0, 0.6], landcover: [0, 100],
  };
  let range = fixed[view];
  if (!range && (view === "deformation" || view === "nisardisp")) {
    const a = view === "deformation" ? r.layers.deformation : r.layers.nisar_disp; let mx = 1;
    if (a) for (let k = 0; k < a.length; k++) if (Math.abs(a[k]) > mx) mx = Math.abs(a[k]);
    range = [-Math.ceil(mx * 0.85), Math.ceil(mx * 0.85)];
  }
  if (!range) range = r.manifest.layers.find((l) => l.id === "elevation")?.range ?? [0, 1];
  m.set(view, range);
  return range;
}

function hex(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const lutCache = new Map<string, Uint8Array>();
function lut(stops: string[]): Uint8Array {
  const key = stops.join();
  if (lutCache.has(key)) return lutCache.get(key)!;
  const c = stops.map(hex), out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (c.length - 1), a = Math.floor(Math.min(x, c.length - 2)), f = x - a;
    for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = Math.round(c[a][ch] + (c[a + 1][ch] - c[a][ch]) * f);
  }
  lutCache.set(key, out);
  return out;
}
export const gradientCss = (view: ViewId) => `linear-gradient(90deg, ${VIEWS[view].stops.join(", ")})`;

/** Colourise a view into RGBA. flipY puts row 0 (north) at the bottom, for GPU textures. */
export function colorize(r: RegionData, view: ViewId, t: number, out: Uint8ClampedArray | Uint8Array, flipY = false) {
  const { cols, rows } = r.manifest.grid, [lo, hi] = viewRange(r, view), L = lut(VIEWS[view].stops);
  const f = view === "water" ? rawSlice(r, "s1_vv", t) : field(r, view, t);
  const cls = view === "water" ? waterClass(r, t) : null, marine = r.manifest.scenario === "marine";
  const put = (o: number, c: readonly number[]) => { out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, o = ((flipY ? rows - 1 - j : j) * cols + i) * 4, v = f[k];
    if (Number.isNaN(v)) { out[o + 3] = 0; continue; }
    if (view === "landcover") { const c = LANDCOVER[v]; if (c) put(o, c.color); else out[o + 3] = 0; continue; }
    if (cls && cls[k]) { put(o, marine ? WATER_COLORS.slick : cls[k] === 1 ? WATER_COLORS.usual : cls[k] === 2 ? WATER_COLORS.flood : WATER_COLORS.vegetation); continue; }
    const idx = Math.round(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 255) * 3;
    out[o] = L[idx]; out[o + 1] = L[idx + 1]; out[o + 2] = L[idx + 2]; out[o + 3] = 255;
  }
}

/** Bilinear sample of a field at fractional grid coords (x, y in 0..1). */
export function sample(f: Float32Array, cols: number, rows: number, x: number, y: number) {
  const fx = Math.min(cols - 1.001, Math.max(0, x * cols - 0.5)), fy = Math.min(rows - 1.001, Math.max(0, y * rows - 0.5));
  const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, g = (ii: number, jj: number) => f[jj * cols + ii];
  return g(i, j) * (1 - a) * (1 - b) + g(i + 1, j) * a * (1 - b) + g(i, j + 1) * (1 - a) * b + g(i + 1, j + 1) * a * b;
}
