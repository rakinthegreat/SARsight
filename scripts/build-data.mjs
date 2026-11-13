// Builds public/data from data/real (observed layers fetched by scripts/fetch_real_data.py). Nothing is simulated:
// every layer is a measurement (or computed from one in the app) and carries its provenance in the manifest.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CFG = JSON.parse(readFileSync(join(ROOT, "data", "regions.json"), "utf8"));
const REAL = join(ROOT, "data", "real");
const OUT = join(ROOT, "public", "data");
const N = CFG.grid;

// Farm regions get a plain 4 x 3 grid of blocks so plots can be compared; no other outlines are drawn, because we
// have no surveyed boundaries for pits, panels, leases or slopes.
function features(r) {
  const out = [];
  if (r.scenario === "agriculture") for (let py = 0; py < 3; py++) for (let px = 0; px < 4; px++) {
    const x0 = 0.02 + px * 0.245, y0 = 0.02 + py * 0.327, name = `${"ABC"[py]}${px + 1}`;
    out.push({ id: `block-${name}`, name: `Block ${name}`, kind: "plot", box: [x0, y0, x0 + 0.235, y0 + 0.317] });
  }
  return out;
}

// ---------- build ----------
const usedSources = {};

/** Builds one region from <realDir> (fetched observations) into <dir>; returns its catalog entry. */
function buildRegion(r, realDir, dir) {
  const meta = JSON.parse(readFileSync(join(realDir, "meta.json"), "utf8"));
  const dates = meta.dates, bbox = meta.bbox;
  const read = (id) => new Float32Array(readFileSync(join(realDir, `${id}.f32`)).buffer.slice(0));
  const eventEpoch = meta.event ? Math.max(0, dates.findIndex((d) => d >= meta.event.date)) : null;

  mkdirSync(dir, { recursive: true });
  const layers = [];
  for (const [id, L] of Object.entries(meta.layers)) {
    copyFileSync(join(realDir, `${id}.f32`), join(dir, `${id}.f32`));
    const a = read(id); let lo = Infinity, hi = -Infinity;
    for (const x of a) if (Number.isFinite(x)) { if (x < lo) lo = x; if (x > hi) hi = x; }
    layers.push({ id, unit: L.unit, label: L.label, file: `${id}.f32`, static: L.static, observed: true, source: L.source,
      range: [Math.floor(lo), Math.ceil(hi)], ...(L.date ? { date: L.date, granule: L.granule } : {}), ...(L.dates ? { dates: L.dates } : {}), ...(L.frame ? { frame: L.frame } : {}) });
    usedSources[L.source] = meta.sources[L.source];
  }
  for (const k of ["power", "usgs", "asf"]) usedSources[k] = meta.sources[k];
  const places = existsSync(join(realDir, "places.json"));
  if (places) copyFileSync(join(realDir, "places.json"), join(dir, "places.json"));

  const toLL = ([x, y]) => [+(bbox[0] + x * (bbox[2] - bbox[0])).toFixed(5), +(bbox[3] - y * (bbox[3] - bbox[1])).toFixed(5)];
  const feats = (r.custom ? [] : features(r)).map(({ box, ...rest }) => ({ ...rest, polygon: [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]].map(toLL) }));
  const entry = { id: r.id, name: r.name, place: r.place, country: r.country, scenario: r.scenario, modules: r.modules, center: r.center, bbox, observed: true, ...(r.custom ? { custom: true } : {}) };
  const manifest = { ...entry, grid: { cols: N, rows: N }, dtype: "float32", epochs: dates, orbit: meta.orbit, fetched: meta.fetched,
    ...(meta.event ? { event: { ...meta.event, epoch: eventEpoch } } : {}), layers, features: feats,
    ...(places ? { places: true } : {}), drivers: meta.drivers ?? null, quakes: meta.quakes ?? [], nisar: meta.nisar ?? [] };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return { ...entry, nisarPasses: (meta.nisar ?? []).length };
}

// on-demand area: node scripts/build-data.mjs --custom <id>   (data/custom/<id>/{region.json, real/} -> site/)
if (process.argv[2] === "--custom") {
  const id = process.argv[3], base = join(ROOT, "data", "custom", id);
  const r = JSON.parse(readFileSync(join(base, "region.json"), "utf8"));
  const entry = buildRegion(r, join(base, "real"), join(base, "site"));
  writeFileSync(join(base, "site", "entry.json"), JSON.stringify({ ...entry, sources: usedSources }));
  console.log(`built custom area ${id}`);
  process.exit(0);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const catalog = [];
for (const r of CFG.regions) {
  const realDir = join(REAL, r.id);
  if (!existsSync(join(realDir, "meta.json"))) { console.warn(`skip ${r.id}: run scripts/fetch_real_data.py first`); continue; }
  catalog.push(buildRegion(r, realDir, join(OUT, r.id)));
}

writeFileSync(join(OUT, "catalog.json"), JSON.stringify({ version: 2, regions: catalog, sources: usedSources }, null, 1));
console.log(`built ${catalog.length} regions into ${OUT}`);
