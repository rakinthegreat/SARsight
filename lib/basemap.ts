// Satellite basemap from Esri World Imagery (Web Mercator XYZ tiles).
export const tileUrl = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
/** Transparent place names, borders and admin areas to draw over the imagery (Esri reference layer, free, no key). */
export const labelUrl = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`;
export const asLabels = <T extends { url: string }>(tiles: T[]) => tiles.map((t) => ({ ...t, url: t.url.replace("/World_Imagery/", "/Reference/World_Boundaries_and_Places/") }));
export const ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics";

export const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
export const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const y2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export interface Tile { url: string; west: number; south: number; east: number; north: number }

/** Tiles covering a bbox. With `px` (the bbox's on-screen width in CSS px) the zoom is the first one whose tiles
 *  are not enlarged on this screen (`density` = device pixels per CSS px, the screen's by default); without it,
 *  roughly 3 tiles across. `pad` grows the bbox by that many spans on every side; `dz` coarsens the zoom. */
export function tilesForBBox([w0, s0, e0, n0]: [number, number, number, number], pad = 0, dz = 0, px?: number, density?: number): Tile[] {
  const dpr = density ?? (typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1));
  const want = px ? Math.ceil(Math.log2(((px * dpr) / 256) * (360 / (e0 - w0)))) : Math.ceil(Math.log2(360 / (e0 - w0))) + 1;
  const z = Math.min(18, Math.max(3, want - dz));
  const pw = (e0 - w0) * pad, ph = (n0 - s0) * pad;
  const w = Math.max(-180, w0 - pw), e = Math.min(179.999, e0 + pw), s = Math.max(-85, s0 - ph), n = Math.min(85, n0 + ph);
  const x0 = Math.floor(lon2x(w, z)), x1 = Math.floor(lon2x(e, z));
  const y0 = Math.floor(lat2y(n, z)), y1 = Math.floor(lat2y(s, z));
  const out: Tile[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
    out.push({ url: tileUrl(z, x, y), west: x2lon(x, z), east: x2lon(x + 1, z), north: y2lat(y, z), south: y2lat(y + 1, z) });
  return out;
}

/** Whole-earth equirectangular canvas (for the globe), reprojected from zoom-3 Mercator tiles. */
let globeCanvas: Promise<HTMLCanvasElement> | null = null;
export function globeImagery(): Promise<HTMLCanvasElement> {
  if (globeCanvas) return globeCanvas;
  globeCanvas = (async () => {
    const z = 3, T = 2 ** z, S = 256;
    const merc = document.createElement("canvas");
    merc.width = merc.height = T * S;
    const mctx = merc.getContext("2d")!;
    await Promise.all(Array.from({ length: T * T }, (_, k) => new Promise<void>((res, rej) => {
      const x = k % T, y = Math.floor(k / T), img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { mctx.drawImage(img, x * S, y * S); res(); };
      img.onerror = () => rej(new Error("imagery tile failed"));
      img.src = tileUrl(z, x, y);
    })));
    const W = 2048, H = 1024, out = document.createElement("canvas");
    out.width = W; out.height = H;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#0b0d11"; ctx.fillRect(0, 0, W, H);
    for (let row = 0; row < H; row++) {
      const lat = 90 - ((row + 0.5) / H) * 180;
      if (Math.abs(lat) > 85.05) continue;
      const my = (lat2y(lat, z) / T) * merc.height;
      ctx.drawImage(merc, 0, Math.floor(my), merc.width, 1, 0, row, W, 1);
    }
    return out;
  })();
  globeCanvas.catch(() => { globeCanvas = null; });
  return globeCanvas;
}
