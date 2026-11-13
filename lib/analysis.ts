// Turns radar observations into plain-language indicators, risk reports, time series and profiles.
// Everything here is computed from measured data. Ground-motion indicators appear only where a real InSAR
// time series (NISAR GUNW or COMET LiCSAR Sentinel-1) was fetched for the region.
import type { LonLat, RegionData } from "./data/types";
import { cohBaseline, field, has, isSea, rawSlice, refEpoch, sample, waterClass, type ViewId } from "./views";

export type Status = "ok" | "watch" | "alert";
export interface Indicator { key: string; label: string; value: string; unit?: string; status: Status; word: string; preview?: boolean; source?: string }
export interface Series { label: string; unit: string; values: number[]; preview?: boolean; dashed?: boolean }
export interface Prediction {
  horizon: string;
  headline: string;
  detail: string;
  status: Status;
  icon: string;
  kind: "crop" | "moisture" | "flood" | "subsidence" | "motion";
}
export interface Report {
  areaKm2: number; risk: Status; riskWord: string; headline: string;
  indicators: Indicator[]; sentences: string[]; series: Series[];
  maxAt?: { ll: LonLat; value: number };
  prediction?: Prediction;
}

const rank: Record<Status, number> = { ok: 0, watch: 1, alert: 2 };
const worst = (s: Status[]) => s.reduce<Status>((a, b) => (rank[b] > rank[a] ? b : a), "ok");
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const unitStr = (u?: string, lang = "en") => {
  if (!u) return "";
  if (lang === "bn") {
    if (u === "%") return "%";
    if (u === "cm") return " সেমি";
    if (u === "cm/yr") return " সেমি/বছর";
    if (u === "km²") return " বর্গ কিমি";
    if (u === "mm") return " মিমি";
    if (u === "m/s") return " মি/সেকেন্ড";
    if (u === "dB") return " ডিবি";
    if (u === "m") return " মি";
    return " " + u;
  }
  return u === "%" ? "%" : " " + u;
};
const dayDiff = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

export function cellAreaKm2(r: RegionData) {
  const [w, s, e, n] = r.manifest.bbox, { cols, rows } = r.manifest.grid;
  const lat = ((s + n) / 2) * (Math.PI / 180);
  return (((e - w) * 111.32 * Math.cos(lat)) / cols) * (((n - s) * 111.32) / rows);
}
export function cellLonLat(r: RegionData, i: number, j: number): LonLat {
  const [w, s, e, n] = r.manifest.bbox, { cols, rows } = r.manifest.grid;
  return [w + ((i + 0.5) / cols) * (e - w), n - ((j + 0.5) / rows) * (n - s)];
}
export function pointInPolygon(p: LonLat, poly: LonLat[]) {
  let c = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a], [xb, yb] = poly[b];
    if (ya > p[1] !== yb > p[1] && p[0] < ((xb - xa) * (p[1] - ya)) / (yb - ya) + xa) c = !c;
  }
  return c;
}
export function polygonMask(r: RegionData, poly?: LonLat[]): Uint8Array {
  const { cols, rows } = r.manifest.grid, m = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) m[j * cols + i] = !poly || pointInPolygon(cellLonLat(r, i, j), poly) ? 1 : 0;
  return m;
}
const andMask = (m: Uint8Array, pred: (k: number) => boolean) => m.map((v, k) => (v && pred(k) ? 1 : 0));

function stats(a: ArrayLike<number>, m: Uint8Array) {
  let sum = 0, n = 0, min = Infinity, max = -Infinity;
  for (let k = 0; k < m.length; k++) {
    if (!m[k] || Number.isNaN(a[k])) continue;
    sum += a[k]; n++; if (a[k] < min) min = a[k]; if (a[k] > max) max = a[k];
  }
  return { mean: n ? sum / n : NaN, min, max, n };
}
const fraction = (m: Uint8Array, pred: (k: number) => boolean) => {
  let n = 0, hit = 0;
  for (let k = 0; k < m.length; k++) if (m[k]) { n++; if (pred(k)) hit++; }
  return { n, hit, frac: n ? hit / n : NaN };
};

const short = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const addDays = (iso: string, d: number) => new Date(Date.parse(iso + "T00:00:00Z") + d * 864e5);

/** Per-pixel LOS velocity (cm/yr), least squares over a trailing window of passes ending at t. */
export function velocity(r: RegionData, t: number, window = 6): Float32Array {
  const n = r.manifest.grid.cols * r.manifest.grid.rows, out = new Float32Array(n).fill(NaN);
  const t0 = Math.max(0, t - window + 1), m = t - t0 + 1, e = r.manifest.epochs;
  if (m < 3) return out;
  const xs = Array.from({ length: m }, (_, q) => dayDiff(e[0], e[t0 + q])), xm = xs.reduce((a, b) => a + b) / m;
  const sxx = xs.reduce((a, x) => a + (x - xm) ** 2, 0);
  const sl = xs.map((_, q) => rawSlice(r, "deformation", t0 + q));
  for (let k = 0; k < n; k++) {
    let ym = 0; for (let q = 0; q < m; q++) ym += sl[q][k] / m;
    let sxy = 0; for (let q = 0; q < m; q++) sxy += (xs[q] - xm) * (sl[q][k] - ym);
    out[k] = (sxy / sxx) * 365;
  }
  return out;
}

/** Soil-moisture index from Sentinel-1 VV change detection: (σ − σdry) / (σwet − σdry), per pixel over the series. */
const smiCache = new WeakMap<RegionData, [Float32Array, Float32Array]>();
export function moistureIndex(r: RegionData, t: number): Float32Array {
  if (!smiCache.has(r)) {
    const n = r.manifest.grid.cols * r.manifest.grid.rows, lo = new Float32Array(n).fill(Infinity), hi = new Float32Array(n).fill(-Infinity);
    for (let q = 0; q < r.manifest.epochs.length; q++) { const s = rawSlice(r, "s1_vv", q); for (let k = 0; k < n; k++) if (Number.isFinite(s[k])) { lo[k] = Math.min(lo[k], s[k]); hi[k] = Math.max(hi[k], s[k]); } }
    smiCache.set(r, [lo, hi]);
  }
  const [lo, hi] = smiCache.get(r)!, s = rawSlice(r, "s1_vv", t), out = new Float32Array(s.length);
  for (let k = 0; k < s.length; k++) out[k] = hi[k] - lo[k] > 1 ? ((s[k] - lo[k]) / (hi[k] - lo[k])) * 100 : NaN;
  return out;
}

/** NASA POWER context at a pass: rain over the preceding 12 days and topsoil wetness. */
export function drivers(r: RegionData, t: number) {
  const d = r.manifest.drivers, date = r.manifest.epochs[t];
  if (!d) return null;
  const i = d.dates.indexOf(date);
  if (i < 0) return null;
  const rain = d.rain_mm.slice(Math.max(0, i - 11), i + 1).reduce<number>((a, b) => a + (b ?? 0), 0);
  return { rain12: rain, wetness: (d.wetness_top[i] ?? NaN) * 100 };
}

/** Crop status from the Sentinel-1 VH series over cropland: seasonal CV, stage, harvest window, vigour. */
export function crop(r: RegionData, t: number, m0: Uint8Array) {
  const lc = rawSlice(r, "landcover", 0);
  const m = andMask(m0, (k) => lc[k] === 40);
  const series = Array.from({ length: t + 1 }, (_, q) => stats(rawSlice(r, "s1_vh", q), m).mean);
  const now = series[t], d3 = t >= 3 ? now - series[t - 3] : NaN, peak = Math.max(...series);
  let cv = NaN;
  if (t >= 2) {
    const lin = series.map((v) => Math.pow(10, v / 10)), mu = lin.reduce((a, b) => a + b) / lin.length;
    cv = Math.sqrt(lin.reduce((a, b) => a + (b - mu) ** 2, 0) / lin.length) / mu;
  }
  let stage: string, status: Status;
  if (!stats(lc, m).n) [stage, status] = ["No cropland", "watch"];
  else if (cv < 0.12) [stage, status] = ["No crop cycle", "watch"];
  else if (!Number.isFinite(d3)) [stage, status] = ["Too early", "ok"];
  else if ((d3 < -1 || (series.indexOf(peak) < t - 1 && now < peak - 1.5)) && peak > -17) [stage, status] = ["Harvested", "ok"];
  else if (d3 < -1) [stage, status] = ["Stressed", "alert"];
  else if (now < -19) [stage, status] = ["Bare / sown", "ok"];
  else if (d3 > 0.8) [stage, status] = ["Growing", "ok"];
  else if (now > -15.5) [stage, status] = ["Mature", "ok"];
  else [stage, status] = ["Stalled", "watch"];
  const e0 = r.manifest.epochs[t];
  let harvest = "—";
  if (stage === "Mature") harvest = `${short(addDays(e0, 12))} – ${short(addDays(e0, 24))}`;
  else if (stage === "Growing" || stage === "Bare / sown") {
    const slope = Math.max(0.3, (d3 || 1) / 3), k = Math.max(1, Math.ceil((-15.5 - now) / slope));
    harvest = `${short(addDays(e0, 12 * (k + 1)))} – ${short(addDays(e0, 12 * (k + 2)))}`;
  } else if (stage === "Stalled" || stage === "Stressed") harvest = "Delayed";
  else if (stage === "Harvested") harvest = "Done";
  return { cv, stage, status, harvest, vigour: stats(field(r, "vigour", t), m).mean, d3 };
}

const motionStatus = (cmyr: number): [Status, string] => {
  const a = Math.abs(cmyr);
  return a > 5 ? ["alert", "Unsafe"] : a > 1 ? ["watch", "Moving"] : ["ok", "Stable"];
};

function metrics(r: RegionData, t: number, m: Uint8Array): Indicator[] {
  const sc = r.manifest.scenario, area = cellAreaKm2(r), out: Indicator[] = [];
  const lc = rawSlice(r, "landcover", 0);
  const add = (key: string, label: string, value: string, unit: string, [status, word]: [Status, string]) =>
    out.push({ key, label, value, unit, status, word });
  const moving = has(r, "deformation"), coh = has(r, "coherence");
  const motion = () => {
    if (!moving) return;
    const v = stats(velocity(r, t), m), worstV = Math.abs(v.min) > Math.abs(v.max) ? v.min : v.max;
    add("velocity", sc === "landslide" ? "Slope speed" : sc === "volcano" ? "Uplift speed" : "Sinking speed", fmt(Math.abs(worstV)), "cm/yr",
      sc === "volcano" ? (worstV > 5 ? ["alert", "Unrest"] : worstV > 1 ? ["watch", "Inflating"] : ["ok", "Quiet"]) : motionStatus(worstV));
    const d = stats(rawSlice(r, "deformation", t), m), tot = sc === "volcano" ? d.max : Math.abs(d.min);
    add("total", sc === "volcano" ? "Raised so far" : "Moved so far", fmt(tot), "cm", motionStatus(tot * (365 / Math.max(12, dayDiff(r.manifest.epochs[0], r.manifest.epochs[t])))));
  };
  const changed = (mask: Uint8Array, threshold = 3) => {
    const ch = relativeChange(r, t);
    return fraction(mask, (k) => Math.abs(ch[k]) > threshold);
  };

  switch (sc) {
    case "agriculture": {
      const smi = stats(moistureIndex(r, t), andMask(m, (k) => lc[k] === 40)).mean;
      add("moisture", "Soil moisture", fmt(smi, 0), "%", smi < 25 ? ["alert", "Dry"] : smi > 80 ? ["watch", "Waterlogged"] : ["ok", "Good"]);
      const c = crop(r, t, m);
      add("stage", "Crop stage", Number.isFinite(c.cv) ? fmt(c.cv, 2) : "—", "CV", [c.status, c.stage]);
      add("vigour", "Crop vigour", fmt(c.vigour, 0), "/100", c.vigour > 60 ? ["ok", "Dense"] : c.vigour > 30 ? ["ok", "Building"] : ["watch", "Sparse"]);
      add("harvest", "Harvest window", c.harvest, "", c.harvest === "Delayed" ? ["watch", "Delayed"] : c.harvest === "—" ? ["ok", "Not yet"] : c.harvest === "Done" ? ["ok", "Harvested"] : ["ok", "Plan ahead"]);
      break;
    }
    case "marine": {
      const sea = andMask(m, (k) => isSea(lc[k]));
      const cls = waterClass(r, t), w = fraction(sea, (k) => cls[k] === 1), wf = field(r, "wind", t), wind = stats(wf, sea);
      const sorted = Array.from(wf).filter((v, k) => sea[k] && Number.isFinite(v)).sort((a, b) => a - b);
      const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : NaN; // robust to ships and coast-edge echoes
      const km = w.hit * area, calm = wind.mean < 3.5;
      // radar alone cannot confirm oil: dark patches are flagged for inspection, never declared spills
      add("slick", "Dark sea patches", fmt(km, 0), "km²", km < 2 ? ["ok", "Clear"] : calm ? ["watch", "Calm sea — likely look-alike"] : ["watch", "Inspect: oil or calm water"]);
      add("wind", "Wind at sea", fmt(wind.mean, 0), "m/s", wind.mean > 12 || p90 > 15 ? ["alert", "Stay ashore"] : wind.mean > 8 || p90 > 11 ? ["watch", "Fish with care"] : ["ok", "Safe to fish"]);
      break;
    }
    case "flood": {
      const cls = waterClass(r, t), f = fraction(m, (k) => cls[k] > 0), flood = fraction(m, (k) => cls[k] === 2), veg = fraction(m, (k) => cls[k] === 3);
      add("water", "Under water", fmt(f.frac * 100, 0), "%", f.frac > 0.4 ? ["alert", "Flooded"] : f.frac > 0.15 ? ["watch", "High water"] : ["ok", "Normal"]);
      add("new", "Normally-dry land flooded", fmt(flood.hit * area, 0), "km²", flood.hit * area > 50 ? ["alert", "Flooding"] : flood.hit * area > 5 ? ["watch", "Rising"] : ["ok", "Contained"]);
      add("forest", "Flooded vegetation", fmt(veg.hit * area, 0), "km²", veg.hit * area > 10 ? ["watch", "Submerged"] : ["ok", "Dry canopy"]);
      const d = drivers(r, t);
      if (d) add("rain", "Rain, last 12 days", fmt(d.rain12, 0), "mm", d.rain12 > 300 ? ["alert", "Extreme"] : d.rain12 > 120 ? ["watch", "Heavy"] : ["ok", "Moderate"]);
      break;
    }
    case "earthquake": {
      const built = andMask(m, (k) => lc[k] === 50), ch = changed(built, 2);
      const pct = ch.frac * 100;
      add("built", "Built-up area changed", fmt(pct, 0), "%", pct > 15 ? ["alert", "Heavy damage likely"] : pct > 5 ? ["watch", "Damage likely"] : ["ok", "Little change"]);
      if (coh) {
        const dmg = stats(field(r, "damage", t), m), base = stats(cohBaseline(r), m), loss = (dmg.mean / Math.max(0.05, base.mean)) * 100;
        add("cohloss", "Coherence loss", fmt(loss, 0), "%", loss > 15 ? ["alert", "High collapse risk"] : loss > 7 ? ["watch", "Damage likely"] : ["ok", "Intact"]);
      }
      if (moving) {
        const d = stats(rawSlice(r, "deformation", t), m), mx = Math.max(Math.abs(d.min), Math.abs(d.max));
        add("shift", "Ground shift", fmt(mx), "cm", mx > 20 ? ["alert", "Ruptured"] : mx > 3 ? ["watch", "Shifted"] : ["ok", "Stable"]);
      }
      break;
    }
    default: {
      motion();
      if (sc === "mine" && moving) {
        const holes = sinkholes(r, t, m);
        add("sinkholes", "Sinkholes", String(holes.length), "", holes.length ? ["alert", "Detected"] : ["ok", "None"]);
      }
      const ch = changed(andMask(m, (k) => !isSea(lc[k])));
      add("surface", "Surface changed", fmt(ch.frac * 100, 0), "%", ch.frac > 0.15 ? ["watch", "Active"] : ["ok", "Steady"]);
      const built = andMask(m, (k) => lc[k] === 50);
      if (moving && stats(lc, built).n) {
        const vel = velocity(r, t), risk = fraction(built, (k) => Math.abs(vel[k]) > 2);
        add("safety", "Built-up on moving ground", fmt(risk.frac * 100, 0), "%", risk.frac > 0.15 ? ["alert", "Inspect"] : risk.frac > 0.03 ? ["watch", "Monitor"] : ["ok", "Safe"]);
      }
    }
  }
  return out;
}

/** VV change minus the median change of the whole scene, so weather-driven shifts (snow, wet soil) cancel out. */
export function relativeChange(r: RegionData, t: number): Float32Array {
  const ch = field(r, "change", t), vals = Array.from(ch).filter(Number.isFinite).sort((a, b) => a - b);
  const med = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  return ch.map((v) => v - med);
}

/** Sinkholes: compact clusters that dropped > 3 cm between consecutive passes (measured InSAR). */
export function sinkholes(r: RegionData, t: number, m: Uint8Array) {
  const { cols, rows } = r.manifest.grid, hit = new Float32Array(cols * rows);
  for (let q = 1; q <= t; q++) {
    const a = rawSlice(r, "deformation", q - 1), b = rawSlice(r, "deformation", q);
    for (let k = 0; k < hit.length; k++) if (m[k] && b[k] - a[k] < -3) hit[k] = Math.min(hit[k], b[k] - a[k]);
  }
  const seen = new Uint8Array(hit.length), found: { ll: LonLat; drop: number }[] = [];
  for (let k = 0; k < hit.length; k++) {
    if (!hit[k] || seen[k]) continue;
    const stack = [k]; let best = k, size = 0; seen[k] = 1;
    while (stack.length) {
      const c = stack.pop()!, i = c % cols, j = (c - i) / cols; size++;
      if (hit[c] < hit[best]) best = c;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj, nk = jj * cols + ii;
        if (ii >= 0 && jj >= 0 && ii < cols && jj < rows && hit[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
      }
    }
    if (size <= 60) found.push({ ll: cellLonLat(r, best % cols, Math.floor(best / cols)), drop: hit[best] });
  }
  return found;
}

function plotsMask(r: RegionData) {
  const plots = r.manifest.features.filter((f) => f.kind === "plot");
  if (!plots.length) return null;
  const m = new Uint8Array(r.manifest.grid.cols * r.manifest.grid.rows);
  for (const f of plots) polygonMask(r, f.polygon).forEach((v, k) => { if (v) m[k] = 1; });
  return m;
}
export const indicatorsFor = (r: RegionData, t: number, poly: LonLat[]) => metrics(r, t, polygonMask(r, poly));
export const regionIndicators = (r: RegionData, t: number) => metrics(r, t, plotsMask(r) ?? polygonMask(r));

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const numBn = (s: string) => s.replace(/\d/g, (d) => BN_DIGITS[+d]);
const MONTHS_BN: Record<string, string> = {
  Jan: "জানুয়ারি", Feb: "ফেব্রুয়ারি", Mar: "মার্চ", Apr: "এপ্রিল", May: "মে", Jun: "জুন",
  Jul: "জুলাই", Aug: "আগস্ট", Sep: "সেপ্টেম্বর", Oct: "অক্টোবর", Nov: "নভেম্বর", Dec: "ডিসেম্বর",
};
const dateBn = (s: string) => {
  let out = numBn(s);
  for (const [k, v] of Object.entries(MONTHS_BN)) out = out.replaceAll(k, v);
  return out;
};

export const INDICATOR_LABELS_BN: Record<string, string> = {
  moisture: "মাটির আর্দ্রতা",
  stage: "ফসলের পর্যায়",
  vigour: "ফসলের বৃদ্ধি",
  harvest: "ফসল কাটার সময়",
  slick: "সমুদ্রে কালো দাগ",
  wind: "সমুদ্রে বাতাসের গতি",
  water: "পানির নিচে",
  new: "নতুন প্লাবিত এলাকা",
  forest: "নিমজ্জিত গাছপালা",
  rain: "বৃষ্টি (গত ১২ দিন)",
  built: "অবকাঠামো পরিবর্তন",
  cohloss: "সুসংগততা হ্রাস",
  shift: "মাটি সরে যাওয়া",
  velocity: "গতিবেগ",
  total: "মোট স্থানান্তর",
  sinkholes: "সিঙ্কহোল",
  surface: "ভূপৃষ্ঠ পরিবর্তন",
  safety: "ঝুঁকিপূর্ণ স্থাপনা",
};

export const INDICATOR_WORDS_BN: Record<string, string> = {
  "Dry": "শুষ্ক",
  "Waterlogged": "জলাবদ্ধ",
  "Good": "ভালো",
  "Dense": "ঘন",
  "Building": "বাড়ছে",
  "Sparse": "পাতলা",
  "Delayed": "বিলম্বিত",
  "Not yet": "এখনো নয়",
  "Harvested": "কাটা সম্পন্ন",
  "Plan ahead": "প্রস্তুতি নিন",
  "Clear": "স্বাভাবিক",
  "Calm sea — likely look-alike": "শান্ত সমুদ্র — তেলের মতো দৃশ্য",
  "Inspect: oil or calm water": "যাচাই করুন: তেল বা শান্ত পানি",
  "Stay ashore": "তীরে থাকুন",
  "Fish with care": "সতর্কভাবে মাছ ধরুন",
  "Safe to fish": "মাছ ধরা নিরাপদ",
  "Flooded": "প্লাবিত",
  "High water": "উচ্চ পানি",
  "Normal": "স্বাভাবিক",
  "Flooding": "বন্যা হচ্ছে",
  "Rising": "বাড়ছে",
  "Contained": "নিয়ন্ত্রিত",
  "Submerged": "নিমজ্জিত",
  "Dry canopy": "শুকনো পাতার শামিয়ানা",
  "Extreme": "চরম বৃষ্টি",
  "Heavy": "ভারী বৃষ্টি",
  "Moderate": "মাঝারি বৃষ্টি",
  "Heavy damage likely": "ব্যাপক ক্ষতির আশঙ্কা",
  "Damage likely": "ক্ষতির আশঙ্কা",
  "Little change": "সামান্য পরিবর্তন",
  "High collapse risk": "ধসে পড়ার উচ্চ ঝুঁকি",
  "Intact": "অক্ষত",
  "Ruptured": "ফাটল সৃষ্টি",
  "Shifted": "স্থানচ্যুত",
  "Stable": "স্থিতিশীল",
  "Unsafe": "অনিরাপদ",
  "Moving": "নড়াচড়া করছে",
  "Unrest": "অস্থির",
  "Inflating": "স্ফীত হচ্ছে",
  "Quiet": "শান্ত",
  "None": "নেই",
  "Detected": "শনাক্ত",
  "Active": "সক্রিয়",
  "Steady": "স্থিতিশীল",
  "Inspect": "যাচাই প্রয়োজন",
  "Monitor": "নজরদারিতে রাখুন",
  "Safe": "নিরাপদ",
};

/** Forward projections derived from physical rates of change, crop phenology, and elevation drainage. */
export function predict(r: RegionData, t: number, target: Uint8Array | LonLat[], lang: "en" | "bn" = "en"): Prediction | null {
  const m = Array.isArray(target) ? polygonMask(r, target) : target;
  const sc = r.manifest.scenario, lc = rawSlice(r, "landcover", 0);
  const isBn = lang === "bn";

  if (sc === "agriculture") {
    const cropMask = andMask(m, (k) => lc[k] === 40);
    const c = crop(r, t, m);
    const smiNow = stats(moistureIndex(r, t), cropMask).mean;

    if (t >= 1 && Number.isFinite(smiNow)) {
      const smiPrev = stats(moistureIndex(r, t - 1), cropMask).mean;
      const drop = smiPrev - smiNow;
      if (smiNow < 38 && drop > 3.5) {
        const ratePerDay = Math.max(0.3, drop / 12);
        const days = Math.max(2, Math.min(21, Math.round((smiNow - 20) / ratePerDay)));
        return {
          horizon: isBn ? `আগামী ${numBn(String(days))} দিন` : `Next ${days} days`,
          headline: isBn ? "মাটির আর্দ্রতা আশঙ্কাজনকভাবে হ্রাস পাচ্ছে" : "Soil moisture depleting rapidly",
          detail: isBn
            ? `মাটির রস প্রতিদিন প্রায় ${numBn(ratePerDay.toFixed(1))}% হারে কমছে। সেচ বা বৃষ্টি না পেলে আগামী প্রায় ${numBn(String(days))} দিনে অতিরিক্ত শুষ্কতা দেখা দিতে পারে।`
            : `Topsoil moisture is declining at ~${ratePerDay.toFixed(1)}%/day. Without rain or irrigation, critical soil dryness is projected in ~${days} days.`,
          status: "watch",
          icon: "drop",
          kind: "moisture",
        };
      }
    }

    if (c.stage === "Mature") {
      return {
        horizon: isBn ? "আগামী ১২–২৪ দিন" : "Next 12–24 days",
        headline: isBn ? "ফসল পরিপক্বতা অর্জন করছে" : "Crop reaching harvest maturity",
        detail: isBn
          ? `গাছের শামিয়ানা পূর্ণতা পেয়েছে এবং শীষ শুকানোর পর্যায়ে রয়েছে। সম্ভাব্য ফসল তোলার সময়: ${dateBn(c.harvest)}।`
          : `Canopy biomass has saturated and grain heads are drying. Estimated harvest window: ${c.harvest}.`,
        status: "ok",
        icon: "sprout",
        kind: "crop",
      };
    }

    if (c.stage === "Growing") {
      return {
        horizon: isBn ? "৩–৬ সপ্তাহের মধ্যে" : "In 3–6 weeks",
        headline: isBn ? "ফসলের বৃদ্ধি সন্তোষজনক" : "Vegetative growth on track",
        detail: isBn
          ? `রাডার সংকেত অনুযায়ী গাছপালা দ্রুত বাড়ছে ও কান্ড মজবুত হচ্ছে। সম্ভাব্য ফসল তোলার সময়: ${dateBn(c.harvest)}।`
          : `Radar volume scattering confirms healthy stem elongation. Projected harvest window: ${c.harvest}.`,
        status: "ok",
        icon: "sprout",
        kind: "crop",
      };
    }
    return null;
  }

  if (sc === "flood") {
    const cls = waterClass(r, t);
    const fNow = fraction(m, (k) => cls[k] > 0).frac;
    if (fNow > 0.08) {
      if (t >= 1) {
        const clsPrev = waterClass(r, t - 1);
        const fPrev = fraction(m, (k) => clsPrev[k] > 0).frac;
        const deltaF = fPrev - fNow;
        if (deltaF > 0.015) {
          const days = Math.max(3, Math.min(30, Math.round(((fNow - 0.05) / (deltaF / 12)))));
          const pctDrop = Math.max(1, Math.round(deltaF * 100));
          return {
            horizon: isBn ? `প্রায় ${numBn(String(days))} দিন` : `~${days} days`,
            headline: isBn ? "প্লাবনের পানি নামছে" : "Floodwaters receding along elevation contours",
            detail: isBn
              ? `গত পাসের চেয়ে প্লাবিত এলাকা প্রায় ${numBn(String(pctDrop))}% কমেছে। বর্তমান নিষ্কাশন হার বজায় থাকলে জমিটি প্রায় ${numBn(String(days))} দিনের মধ্যে জেগে উঠবে।`
              : `Water coverage dropped by ~${pctDrop}% since the previous pass. At current drainage rate, land is projected to clear in ~${days} days.`,
            status: "ok",
            icon: "wave",
            kind: "flood",
          };
        }
      }
      return {
        horizon: isBn ? "আগামী ১–২ সপ্তাহ" : "Next 1–2 weeks",
        headline: isBn ? "নিচু জমিতে প্লাবন অব্যাহত" : "Inundation persisting across low-lying land",
        detail: isBn
          ? "স্বাভাবিক নিষ্কাশনের চেয়ে পানির উচ্চতা বেশি রয়েছে। গবাদিপশু ও শুকনো খাবার উঁচু স্থানে নিরাপদে রাখুন।"
          : "Water levels remain elevated above natural drainage thresholds. Keep livestock and grain stores on high ground.",
        status: "alert",
        icon: "wave",
        kind: "flood",
      };
    }
    return null;
  }

  if (has(r, "deformation") && ["subsidence", "mine", "landslide", "volcano"].includes(sc)) {
    const v = stats(velocity(r, t), m);
    const worstV = Math.abs(v.min) > Math.abs(v.max) ? v.min : v.max;
    const spd = Math.abs(worstV);

    if (t >= 2) {
      const dNow = stats(rawSlice(r, "deformation", t), m).mean;
      const dMid = stats(rawSlice(r, "deformation", t - 1), m).mean;
      const dOld = stats(rawSlice(r, "deformation", Math.max(0, t - 2)), m).mean;
      const vRecent = Math.abs(dNow - dMid) * (365 / 12);
      const vPrior = Math.abs(dMid - dOld) * (365 / 12);
      if (vRecent > 1.4 * vPrior && vRecent > 2.5) {
        return {
          horizon: isBn ? "জরুরি নজরদারি" : "Immediate watch",
          headline: isBn ? "মাটির স্থানচ্যুতি দ্রুত বাড়ছে" : "Surface displacement accelerating",
          detail: isBn
            ? `সাম্প্রতিক পাসে মাটির গতিবেগ বেড়ে বছরে প্রায় ${numBn(vRecent.toFixed(1))} সেমিতে পৌঁছেছে। ধস বা দেয়ালে নতুন ফাটল সৃষ্টির উচ্চ আশঙ্কা।`
            : `Deformation speed has surged to ~${vRecent.toFixed(1)} cm/yr over recent passes. Heightened risk of slope failure or structural cracks.`,
          status: "alert",
          icon: "mountain",
          kind: "motion",
        };
      }
    }

    if (spd > 1.2) {
      const proj6 = spd * 0.5;
      const proj12 = spd;
      return {
        horizon: isBn ? "৬ মাসের রূপরেখা" : "6-month outlook",
        headline: isBn ? "ভূমি অবনমনের ধারাবাহিক পূর্বাভাস" : "Steady ground subsidence projected",
        detail: isBn
          ? `বর্তমান হারে (${numBn(spd.toFixed(1))} সেমি/বছর), আগামী ৬ মাসে মাটি আরও প্রায় ${numBn(proj6.toFixed(1))} সেমি দেবে যাওয়ার আশঙ্কা (১ বছরে প্রায় ${numBn(proj12.toFixed(1))} সেমি)।`
          : `At current rate (${spd.toFixed(1)} cm/yr), ground is projected to subside an additional ${proj6.toFixed(1)} cm over the next 6 months (~${proj12.toFixed(1)} cm in 1 year).`,
        status: spd > 4 ? "alert" : "watch",
        icon: "city",
        kind: "subsidence",
      };
    }
  }

  if (sc === "marine") {
    const sea = andMask(m, (k) => isSea(lc[k]));
    const wf = field(r, "wind", t);
    const windMean = stats(wf, sea).mean;
    if (windMean < 6) {
      return {
        horizon: isBn ? "আগামী ২৪–৪৮ ঘণ্টা" : "Next 24–48 hrs",
        headline: isBn ? "সমুদ্র শান্ত থাকার পূর্বাভাস" : "Calm sea state expected to persist",
        detail: isBn
          ? "রাডার প্যাটার্ন অনুযায়ী সাগর শান্ত এবং ঢেউয়ের তীব্রতা কম। সাধারণ ট্রলারে মাছ ধরার অনুকূল আবহাওয়া।"
          : "Radar surface roughness indicates light winds and low swell. Safe operational window for artisanal fishers.",
        status: "ok",
        icon: "ship",
        kind: "motion",
      };
    } else {
      return {
        horizon: isBn ? "আগামী ২৪–৩৬ ঘণ্টা" : "Next 24–36 hrs",
        headline: isBn ? "উত্তাল সমুদ্র সতর্কতা" : "Rough surface waters detected",
        detail: isBn
          ? `উপকূলবর্তী বাতাসে গতিবেগ প্রায় ${numBn(String(Math.round(windMean)))} মি/সেকেন্ড। সাবধানে চলুন এবং নিরাপদ দূরত্বের মধ্যে থাকুন।`
          : `Estimated coastal winds around ${Math.round(windMean)} m/s. Exercise caution and remain near safe harbors.`,
        status: "watch",
        icon: "ship",
        kind: "motion",
      };
    }
  }

  return null;
}

/** Computes the projected next satellite acquisition date from the 12-day orbital repeat cycle. */
export function nextPassSchedule(r: RegionData): { nextDate: string; daysRemaining: number } {
  const epochs = r.manifest.epochs;
  const last = epochs[epochs.length - 1];
  const lastTime = Date.parse(last + "T00:00:00Z");
  const now = Date.now();
  const periodMs = 12 * 864e5;
  let target = lastTime + periodMs;
  while (target < now) target += periodMs;
  const daysRemaining = Math.max(1, Math.round((target - now) / 864e5));
  const nextDate = new Date(target).toISOString().slice(0, 10);
  return { nextDate, daysRemaining };
}

/** Time series of the headline quantities over every pass, for a mask. */
export function seriesFor(r: RegionData, m: Uint8Array, lang: "en" | "bn" = "en"): Series[] {
  const T = r.manifest.epochs.length, area = cellAreaKm2(r), sc = r.manifest.scenario, lc = rawSlice(r, "landcover", 0);
  const each = (fn: (t: number) => number) => Array.from({ length: T }, (_, t) => fn(t));
  const rain = each((t) => drivers(r, t)?.rain12 ?? NaN);
  const bn = lang === "bn";
  switch (sc) {
    case "agriculture": {
      const crop = andMask(m, (k) => lc[k] === 40);
      return [
        { label: bn ? "ফসলের শামিয়ানা (VH)" : "Crop canopy (VH)", unit: bn ? "ডিবি" : "dB", values: each((t) => stats(rawSlice(r, "s1_vh", t), crop).mean) },
        { label: bn ? "মাটির আর্দ্রতা" : "Soil moisture", unit: "%", values: each((t) => stats(moistureIndex(r, t), crop).mean) },
      ];
    }
    case "marine": {
      const sea = andMask(m, (k) => isSea(lc[k]));
      return [
        { label: bn ? "কালো দাগ" : "Dark patches", unit: bn ? "বর্গ কিমি" : "km²", values: each((t) => fraction(sea, (k) => waterClass(r, t)[k] === 1).hit * area) },
        { label: bn ? "বাতাস" : "Wind", unit: bn ? "মি/সেকেন্ড" : "m/s", values: each((t) => stats(field(r, "wind", t), sea).mean) },
      ];
    }
    case "flood":
      return [
        { label: bn ? "পানির নিচে" : "Under water", unit: "%", values: each((t) => { const c = waterClass(r, t); return fraction(m, (k) => c[k] > 0).frac * 100; }) },
        { label: bn ? "১২ দিনের বৃষ্টি" : "Rain, 12 days", unit: bn ? "মিমি" : "mm", values: rain },
      ];
    case "earthquake": {
      const built = andMask(m, (k) => lc[k] === 50);
      return [
        { label: bn ? "অবকাঠামো পরিবর্তন" : "Built-up changed", unit: "%", values: each((t) => { const ch = relativeChange(r, t); return fraction(built, (k) => Math.abs(ch[k]) > 2).frac * 100; }) },
        ...(has(r, "deformation") ? [{ label: bn ? "গড় গতিবিধি" : "Mean motion", unit: bn ? "সেমি" : "cm", values: each((t) => stats(rawSlice(r, "deformation", t), m).mean) }] : []),
      ];
    }
    default:
      return [
        ...(has(r, "deformation") ? [{ label: bn ? (sc === "volcano" ? "গড় স্ফীতি" : "গড় গতিবিধি") : (sc === "volcano" ? "Mean uplift" : "Mean motion"), unit: bn ? "সেমি" : "cm", values: each((t) => stats(rawSlice(r, "deformation", t), m).mean) }] : []),
        { label: bn ? "রাডার VV" : "Radar VV", unit: bn ? "ডিবি" : "dB", values: each((t) => stats(rawSlice(r, "s1_vv", t), m).mean) },
      ];
  }
}

export function report(r: RegionData, t: number, poly: LonLat[], lang: "en" | "bn" = "en"): Report | null {
  const m = polygonMask(r, poly);
  const cells = m.reduce((a, b) => a + b, 0);
  if (cells === 0) return null;
  const indicators = metrics(r, t, m);
  const risk = worst(indicators.map((i) => i.status));
  // prefer an observed indicator to explain the risk; say so when only the NISAR preview drives it
  const top = indicators.find((i) => i.status === risk && !i.preview) ?? indicators.find((i) => i.status === risk) ?? indicators[0];
  const isBn = lang === "bn";
  const riskWord = isBn
    ? ({ ok: "কম ঝুঁকি", watch: "মাঝারি ঝুঁকি", alert: "উচ্চ ঝুঁকি" }[risk] + (top?.preview ? " · প্রিভিউ" : ""))
    : ({ ok: "Low risk", watch: "Moderate risk", alert: "High risk" }[risk] + (top?.preview ? " · preview" : ""));
  const headline = top
    ? (isBn
        ? `${numBn(top.value)}${unitStr(top.unit, lang)} ${(INDICATOR_LABELS_BN[top.key] ?? top.label)} — ${INDICATOR_WORDS_BN[top.word] ?? top.word}`
        : `${top.value}${unitStr(top.unit)} ${top.label.toLowerCase()} — ${top.word}`)
    : riskWord;
  const sentences = indicators.map((i) => sentence(i, r.manifest.epochs[t], lang));
  const pred = predict(r, t, m, lang);
  if (pred) {
    sentences.push(isBn ? `🔮 পূর্বাভাস (${pred.horizon}): ${pred.detail}` : `🔮 Forecast (${pred.horizon}): ${pred.detail}`);
  }
  let maxAt: Report["maxAt"];
  if (has(r, "deformation") && !["agriculture", "marine", "flood"].includes(r.manifest.scenario)) {
    const d = rawSlice(r, "deformation", t), { cols } = r.manifest.grid;
    let best = -1;
    for (let k = 0; k < m.length; k++) if (m[k] && !Number.isNaN(d[k]) && (best < 0 || Math.abs(d[k]) > Math.abs(d[best]))) best = k;
    if (best >= 0 && Math.abs(d[best]) > 0.5) {
      maxAt = { ll: cellLonLat(r, best % cols, Math.floor(best / cols)), value: d[best] };
      if (isBn) {
        sentences.push(`সর্বোচ্চ পরিমাপকৃত গতিবিধি: ${numBn(fmt(Math.abs(maxAt.value)))} সেমি ${maxAt.value < 0 ? "নিচে" : "উপরে"}, অবস্থান ${fmtLL(maxAt.ll, lang)} (ইনস্যার পরিমাপ)।`);
      } else {
        sentences.push(`Largest measured movement, ${fmt(Math.abs(maxAt.value))} cm ${maxAt.value < 0 ? "down" : "up"}, at ${fmtLL(maxAt.ll)} (InSAR).`);
      }
    }
  }
  return { areaKm2: cells * cellAreaKm2(r), risk, riskWord, headline, indicators, sentences, series: seriesFor(r, m, lang), maxAt, prediction: pred ?? undefined };
}

export const fmtLL = ([lon, lat]: LonLat, lang: "en" | "bn" = "en") => {
  const latStr = `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? (lang === "bn" ? "উ" : "N") : (lang === "bn" ? "দ" : "S")}`;
  const lonStr = `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? (lang === "bn" ? "পূ" : "E") : (lang === "bn" ? "প" : "W")}`;
  return lang === "bn" ? numBn(`${latStr} ${lonStr}`) : `${latStr} ${lonStr}`;
};

function sentence(i: Indicator, date: string, lang: "en" | "bn" = "en"): string {
  if (lang === "bn") {
    const v = `${numBn(i.value)}${unitStr(i.unit, lang)}`, tag = i.preview ? " (নিসার প্রিভিউ)" : "";
    const w = INDICATOR_WORDS_BN[i.word] ?? i.word;
    switch (i.key) {
      case "moisture": return `তারিখ ${date}: মাটির আর্দ্রতা সূচক ${v} — অবস্থা ${w}।`;
      case "stage": return i.word === "No crop cycle" ? "এখানে সক্রিয় কোনো ফসলের চক্র নেই।" : `ফসলের পর্যায়: ${w} (মৌসুমি VH তারতম্য ${numBn(i.value)})।`;
      case "vigour": return `ফসলের বৃদ্ধি ও ঘনত্ব ${v} (ভিএইচ ভলিউম স্ক্যাটারিং)।`;
      case "harvest": return i.value === "—" ? "এখনও ফসল তোলার সময় হয়নি।" : i.value === "Delayed" ? "ফসল তোলায় বিলম্ব হতে পারে: বৃদ্ধি ধীর হয়েছে।" : i.value === "Done" ? "গাছের শামিয়ানা কমেছে: ফসল তোলা সম্পন্ন।" : `সম্ভাব্য ফসল তোলার সময়: ${dateBn(i.value)}।`;
      case "slick": return i.word === "Clear" ? "সমুদ্রে কোনো অস্বাভাবিক কালো দাগ নেই।" : i.word.startsWith("Calm") ? `${v} অন্ধকার জলসীমা দেখা যাচ্ছে, তবে বাতাস শান্ত থাকায় তেল নাকি শান্ত পানি তা নিশ্চিত নয়।` : `${v} সমুদ্রপৃষ্ঠ আশেপাশের চেয়ে অনেক বেশি অন্ধকার — ছোট ছোট ঢেউ থেমে গেছে। তেল বা শান্ত পানি হতে পারে, খতিয়ে দেখা দরকার।`;
      case "wind": return `সমুদ্রপৃষ্ঠের ভিত্তিতে বাতাসের গতি: ${v}, অবস্থা ${w}।`;
      case "water": return `${date}-এ এই এলাকার ${v} অংশ পানির নিচে নিমজ্জিত।`;
      case "new": return `স্বাভাবিকভাবে শুকনো থাকা ${v} জমি বর্তমানে প্লাবিত (৩৮ বছরের উপাত্তের সাথে তুলনামূলক)।`;
      case "forest": return `${v} এলাকার গাছপালা বা জলাভূমি পানিতে নিমজ্জিত (উজ্জ্বল ডাবল-বাউন্স প্রতিফলন)।`;
      case "rain": return `নাসা পাওয়ার: এই পাসের আগের ১২ দিনে ${v} বৃষ্টিপাত রেকর্ড হয়েছে।`;
      case "built": return `আগের স্বাভাবিক অবস্থার তুলনায় বসতি এলাকার ${v} অংশে রাডার উজ্জ্বলতা ২ ডেসিবেলের বেশি পরিবর্তিত হয়েছে।`;
      case "cohloss": return `সুসংগততা হ্রাস পেয়েছে ${v}${tag}।`;
      case "shift": return `মাটি সর্বোচ্চ ${v} পর্যন্ত স্থানচ্যুত হয়েছে${tag}।`;
      case "velocity": return `মাটি সর্বোচ্চ ${v} গতিতে নড়াচড়া করছে${tag}।`;
      case "total": return `প্রথম পাসের পর থেকে মোট স্থানচ্যুতি: ${v}${tag}।`;
      case "sinkholes": return i.value === "0" ? `কোনো সিঙ্কহোল শনাক্ত হয়নি${tag}।` : `${numBn(i.value)}টি সিঙ্কহোল শনাক্ত হয়েছে${tag}।`;
      case "surface": return `ভূমির ${v} অংশে রাডার উজ্জ্বলতা ৩ ডেসিবেলের বেশি পরিবর্তিত হয়েছে।`;
      case "safety": return `অবকাঠামোর ${v} অংশ বছরে ২ সেমির বেশি নড়াচড়া করা ঝুঁকিপূর্ণ মাটিতে অবস্থিত${tag}।`;
      default: return `${INDICATOR_LABELS_BN[i.key] ?? i.label}: ${v}${tag}।`;
    }
  }
  const v = `${i.value}${unitStr(i.unit)}`, tag = i.preview ? " (NISAR preview)" : "";
  switch (i.key) {
    case "moisture": return `Topsoil moisture index ${v} on ${date}, from radar brightness relative to this season's driest and wettest passes: ${i.word.toLowerCase()}.`;
    case "stage": return i.word === "No crop cycle" ? "Radar sees little seasonal change here, so no active crop cycle." : `Crop stage: ${i.word.toLowerCase()} (seasonal VH variation ${i.value}).`;
    case "vigour": return `Crop canopy vigour ${v}, from VH volume scattering.`;
    case "harvest": return i.value === "—" ? "No harvest expected yet." : i.value === "Delayed" ? "Harvest likely delayed: growth has slowed." : i.value === "Done" ? "Canopy has dropped: fields appear harvested." : `Likely harvest window: ${i.value}.`;
    case "slick": return i.word === "Clear" ? "No unusually dark sea patches." : i.word.startsWith("Calm") ? `${v} of dark sea, but winds are too low to tell oil from calm water.` : `${v} of sea is much darker than its surroundings — oil dampens small waves, but so do calm patches and rain. Worth inspecting.`;
    case "wind": return `Wind estimated from sea-surface roughness: ${v}, ${i.word.toLowerCase()}.`;
    case "water": return `${v} of this area is under water on ${date}.`;
    case "new": return `${v} of normally-dry land is flooded (compared with 38 years of water history).`;
    case "forest": return `${v} of trees or wetland stand in water (bright double-bounce echoes).`;
    case "rain": return `NASA POWER: ${v} of rain fell in the 12 days before this pass.`;
    case "built": return `${v} of built-up area changed radar brightness by more than 2 dB relative to the surrounding land, since the last pre-event pass.`;
    case "cohloss": return `Coherence dropped ${v}${tag}.`;
    case "shift": return `Ground shifted up to ${v}${tag}.`;
    case "velocity": return `Ground moving up to ${v}${tag}.`;
    case "total": return `Total movement since the first pass: ${v}${tag}.`;
    case "sinkholes": return i.value === "0" ? `No sinkholes detected${tag}.` : `${i.value} sinkhole(s) detected${tag}.`;
    case "surface": return `${v} of the land surface changed radar brightness by more than 3 dB.`;
    case "safety": return `${v} of built-up area sits on ground moving faster than 2 cm/yr${tag}.`;
    default: return `${i.label}: ${v}${tag}.`;
  }
}

export interface Transect { km: number[]; values: number[]; elev: number[]; lengthKm: number }
export function transect(r: RegionData, view: ViewId, t: number, a: LonLat, b: LonLat, n = 96): Transect {
  const [w, s, e, nn] = r.manifest.bbox, { cols, rows } = r.manifest.grid;
  const f = field(r, view, t), elevF = rawSlice(r, "elevation", 0);
  const latm = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const lengthKm = Math.hypot((b[0] - a[0]) * 111.32 * Math.cos(latm), (b[1] - a[1]) * 111.32);
  const km: number[] = [], values: number[] = [], elev: number[] = [];
  for (let q = 0; q < n; q++) {
    const p = q / (n - 1), x = (a[0] + (b[0] - a[0]) * p - w) / (e - w), y = (nn - (a[1] + (b[1] - a[1]) * p)) / (nn - s);
    km.push(p * lengthKm); values.push(sample(f, cols, rows, x, y)); elev.push(sample(elevF, cols, rows, x, y));
  }
  return { km, values, elev, lengthKm };
}

export { refEpoch };
