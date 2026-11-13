// Schema of the SARsight data repo (built by scripts/build-data.mjs). See DATA.md.
export type ModuleId = "econ" | "haz" | "vis";
export type RawLayerId =
  | "s1_vv" | "s1_vh"                       // Sentinel-1 C-band time series (observed)
  | "deformation" | "coherence"             // NISAR InSAR time series (preview until GUNW is fetched)
  | "lband_hh" | "lband_hv"                 // ALOS-2 L-band 2021 (observed, static)
  | "nisar_hh" | "nisar_hv" | "nisar_disp" | "nisar_coh" // latest real NISAR pass (static, optional)
  | "elevation" | "landcover" | "water_occurrence";
export type Scenario = "agriculture" | "marine" | "mine" | "earthquake" | "flood" | "subsidence" | "landslide" | "extraction" | "volcano";
export type LonLat = [number, number];

export interface CatalogEntry {
  id: string;
  name: string;
  place: string;
  country: string;
  scenario: Scenario;
  modules: ModuleId[];
  center: LonLat;
  bbox: [number, number, number, number]; // west, south, east, north
  observed: boolean;
  nisarPasses?: number;
  /** on-demand area built by the backend; its files are served from `base` */
  custom?: boolean;
  base?: string;
}

export interface Source { name: string; by: string; license: string; url: string }

export interface LayerMeta {
  id: RawLayerId;
  unit: string;
  range: [number, number];
  label: string;
  file: string; // little-endian float32, [epoch][row][col] (or [row][col] if static), row 0 = north, NaN = no data
  static?: boolean;
  observed: boolean;
  source: string; // key into catalog.sources
  date?: string;
  granule?: string;
}

export interface Feature { id: string; name: string; kind: "plot" | "zone"; polygon: LonLat[] }

export interface Drivers { dates: string[]; rain_mm: (number | null)[]; wetness_top: (number | null)[]; wetness_root: (number | null)[] }
export interface Quake { time: string; mag: number; place: string; lon: number; lat: number; url: string }
export interface NisarPass {
  id: string; level: "GUNW" | "GCOV"; start: string; stop: string; direction: string; track: number;
  footprint: [number, number, number, number]; browse: string | null; thumb: string | null; url: string;
}

export interface Manifest extends CatalogEntry {
  /** region has a places.json of OpenStreetMap place names */
  places?: boolean;
  grid: { cols: number; rows: number };
  dtype: "float32";
  epochs: string[];
  orbit?: number;
  fetched?: string;
  event?: { date: string; epoch: number; label: string };
  layers: LayerMeta[];
  features: Feature[];
  drivers: Drivers | null;
  quakes: Quake[];
  nisar: NisarPass[];
}

export interface RegionData {
  manifest: Manifest;
  /** folder the region's files were loaded from */
  root?: string;
  layers: Partial<Record<RawLayerId, Float32Array>>;
}
