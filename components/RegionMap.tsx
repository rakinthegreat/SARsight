"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LonLat, RegionData } from "../lib/data/types";
import { colorize, field, viewDef, type ViewId } from "../lib/views";
import { cellAreaKm2 } from "../lib/analysis";
import { ATTRIBUTION, asLabels, tilesForBBox } from "../lib/basemap";
import { labelText, regionPlaces, type PlaceLabel } from "../lib/places";
import type { Lang } from "../lib/assist";
import Icon from "./Icon";

type XY = [number, number];
export type DrawMode = "area" | "line" | "point" | null;

function useLayerCanvas(region: RegionData, view: ViewId | null, t: number) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cols, rows } = region.manifest.grid;
  useEffect(() => {
    const c = ref.current; if (!c || !view) return;
    const ctx = c.getContext("2d")!, img = ctx.createImageData(cols, rows);
    colorize(region, view, t, img.data);
    ctx.putImageData(img, 0, 0);
  }, [region, view, t, cols, rows]);
  return ref;
}

export default function RegionMap(p: {
  region: RegionData;
  view: ViewId;
  t: number;
  mode: DrawMode;
  polygon: LonLat[] | null;
  onPolygon: (poly: LonLat[]) => void;
  line: [LonLat, LonLat] | null;
  onLine: (l: [LonLat, LonLat]) => void;
  onPoint?: (ll: LonLat) => void;
  hint?: string | null;
  highlight?: string | null;
  onFeature?: (id: string) => void;
  marks?: { ll: LonLat; label: string }[];
  satellite: boolean;
  labels?: boolean;
  lang?: Lang;
  /** bump to zoom the map to the current polygon */
  fit?: number;
  opacity: number;
  compare: ViewId | null;
  overlay?: { url: string; footprint: [number, number, number, number] } | null;
  /** shape editing: drag corners, drag a "+" midpoint to add one, double-click or long-press a corner to remove it */
  edit?: { onStart: () => void; onChange: (poly: LonLat[]) => void } | null;
  showFeatures?: boolean;
}) {
  const { region, view, t, mode } = p;
  const { cols, rows } = region.manifest.grid;
  const [w, s, e, n] = region.manifest.bbox;
  const main = useLayerCanvas(region, view, t);
  const second = useLayerCanvas(region, p.compare, t);
  const [draft, setDraft] = useState<XY[]>([]);
  const [probe, setProbe] = useState<{ x: number; y: number; v: number } | null>(null);
  const [split, setSplit] = useState(0.5);
  const dragging = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  // ---- zoom & pan: a CSS transform on the square (origin top-left). Everything inside keeps using the
  // square's on-screen rect for hit-testing, so drawing and editing work unchanged at any zoom.
  type V = { k: number; x: number; y: number };
  const [vw, setVw] = useState<V>({ k: 1, x: 0, y: 0 });
  const vwRef = useRef(vw); vwRef.current = vw;
  const anim = useRef(0);
  /** move the view; animated moves are eased frame by frame so overlays (place names) stay locked to the map */
  const goal = useRef<{ k: number; sx: number; sy: number; lx: number; ly: number } | null>(null);
  const go = (to: V, animate: boolean) => {
    cancelAnimationFrame(anim.current); goal.current = null;
    if (!animate) { vwRef.current = to; setVw(to); return; }
    const from = vwRef.current, t0 = performance.now();
    const step = (now: number) => {
      const a = Math.min(1, (now - t0) / 220), q = 1 - (1 - a) ** 3;
      const nv = { k: from.k * (to.k / from.k) ** q, x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q };
      vwRef.current = nv; setVw(nv);
      if (a < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(anim.current), []);
  const panned = useRef(false);
  useEffect(() => { setVw({ k: 1, x: 0, y: 0 }); }, [region]);
  const geom = () => {
    const F = frame.current!.getBoundingClientRect(), b = box.current!;
    return { F, ox: F.left + b.offsetLeft, oy: F.top + b.offsetTop, W: b.offsetWidth, H: b.offsetHeight };
  };
  const clampV = (v: V): V => {
    const k = Math.min(48, Math.max(1, v.k));
    if (k <= 1.001) return { k: 1, x: 0, y: 0 };
    const { F, ox, oy, W, H } = geom(), cx = F.left + F.width / 2 - ox, cy = F.top + F.height / 2 - oy;
    // the view centre may roam over the context imagery around the square (half a span beyond each edge)
    return { k, x: Math.min(cx + 0.5 * k * W, Math.max(cx - 1.5 * k * W, v.x)), y: Math.min(cy + 0.5 * k * H, Math.max(cy - 1.5 * k * H, v.y)) };
  };
  /** Zoom about a screen point. Animated zooms ease the scale toward a goal while the map point under the cursor
   *  stays pinned, so repeated wheel ticks only raise the goal instead of restarting (and wobbling) an animation. */
  const zoomAt = (px: number, py: number, factor: number, animate = true) => {
    const v = vwRef.current, { ox, oy } = geom();
    const lx = (px - ox - v.x) / v.k, ly = (py - oy - v.y) / v.k; // map point under the cursor right now
    const k = Math.min(48, Math.max(1, (animate && goal.current ? goal.current.k : v.k) * factor));
    if (!animate) { go(clampV({ k, x: px - ox - k * lx, y: py - oy - k * ly }), false); return; }
    const running = !!goal.current;
    goal.current = { k, sx: px - ox, sy: py - oy, lx, ly };
    if (running) return;
    cancelAnimationFrame(anim.current);
    const step = () => {
      const g = goal.current; if (!g) return;
      const cur = vwRef.current.k, done = Math.abs(Math.log(g.k / cur)) < 0.003;
      const nk = done ? g.k : cur * (g.k / cur) ** 0.28; // exponential ease in log space
      const nv = clampV({ k: nk, x: g.sx - nk * g.lx, y: g.sy - nk * g.ly });
      vwRef.current = nv; setVw(nv);
      if (done) goal.current = null; else anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  const zoomCenter = (factor: number) => { const { F } = geom(); zoomAt(F.left + F.width / 2, F.top + F.height / 2, factor); };
  const fitTo = (poly: LonLat[], most = 48) => {
    const { F, ox, oy, W, H } = geom(), xy = poly.map(toXY);
    const x0 = Math.min(...xy.map((q) => q[0])), x1 = Math.max(...xy.map((q) => q[0])), y0 = Math.min(...xy.map((q) => q[1])), y1 = Math.max(...xy.map((q) => q[1]));
    const k = Math.min(most, Math.max(1, 0.5 * Math.min(F.width / (W * Math.max(1e-4, x1 - x0)), F.height / (H * Math.max(1e-4, y1 - y0)))));
    if (!W || !H || !F.height || ![k, x0, x1, y0, y1].every(Number.isFinite)) return; // not laid out yet
    go(clampV({ k, x: F.left + F.width / 2 - ox - k * W * ((x0 + x1) / 2), y: F.top + F.height / 2 - oy - k * H * ((y0 + y1) / 2) }), true);
  };
  useEffect(() => { if (p.edit && p.polygon) fitTo(p.polygon); }, [!!p.edit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // asked to show the shape: zoom to it once the map has laid out
    if (!p.fit || !p.polygon) return;
    let tries = 0, id: ReturnType<typeof setTimeout>;
    const attempt = () => { // the map may still be sliding open on phones: wait until it has a real size
      const f = frame.current?.getBoundingClientRect();
      if (f && f.height > 120 && box.current?.offsetHeight) { if (p.polygon) fitTo(p.polygon, 6); }
      else if (tries++ < 20) id = setTimeout(attempt, 100);
    };
    id = setTimeout(attempt, 450);
    return () => clearTimeout(id);
  }, [p.fit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = frame.current; if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const px = ev.deltaY * (ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1);
      zoomAt(ev.clientX, ev.clientY, Math.exp(-Math.max(-300, Math.min(300, px)) * 0.002));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  const onFramePointerDown = (ev: React.PointerEvent) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const pts = new Map<number, [number, number]>([[ev.pointerId, [ev.clientX, ev.clientY]]]);
    let v0 = vwRef.current, start = [ev.clientX, ev.clientY], pinch: { d: number; mx: number; my: number; v: V } | null = null;
    panned.current = false;
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, v: vwRef.current }; panned.current = true; }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const { ox, oy } = geom(), v = pinch.v, k = Math.min(48, Math.max(1, v.k * (d / pinch.d)));
        const lx = (pinch.mx - ox - v.x) / v.k, ly = (pinch.my - oy - v.y) / v.k;
        go(clampV({ k, x: mx - ox - k * lx, y: my - oy - k * ly }), false);
        return;
      }
      if (!panned.current && Math.hypot(e.clientX - start[0], e.clientY - start[1]) < 6) return;
      if (!panned.current) { panned.current = true; v0 = vwRef.current; start = [e.clientX, e.clientY]; }
      if (vwRef.current.k > 1) go(clampV({ ...v0, x: v0.x + e.clientX - start[0], y: v0.y + e.clientY - start[1] }), false);
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size) return;
      removeEventListener("pointerdown", down); removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      setTimeout(() => { panned.current = false; }, 0); // the map's own tap handler has already seen this release
    };
    addEventListener("pointerdown", down); addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };

  const removeCorner = (k: number) => {
    if (!p.polygon || p.polygon.length <= 3 || !p.edit) return;
    p.edit.onStart();
    p.edit.onChange(p.polygon.filter((_, q) => q !== k));
  };
  const startDrag = (ev: React.PointerEvent, k: number, insert: boolean) => {
    if (!p.polygon || !p.edit || !box.current) return;
    ev.preventDefault(); ev.stopPropagation();
    const edit = p.edit, rect = box.current.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY;
    const poly = p.polygon.map((q) => [...q] as LonLat);
    edit.onStart();
    if (insert) { const a = poly[k - 1], b = poly[k % poly.length]; poly.splice(k, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); edit.onChange([...poly]); }
    let moved = false;
    const hold = insert ? null : setTimeout(() => { if (!moved) { done(); removeCorner(k); } }, 650); // long-press removes (touch)
    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < 4) return;
      moved = true;
      poly[k] = toLL([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
      edit.onChange([...poly]);
    };
    const done = () => { if (hold) clearTimeout(hold); removeEventListener("pointermove", move); removeEventListener("pointerup", done); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", done);
  };

  const toXY = ([lon, lat]: LonLat): XY => [(lon - w) / (e - w), (n - lat) / (n - s)];
  const toLL = ([x, y]: XY): LonLat => [w + x * (e - w), n - y * (n - s)];

  useEffect(() => { setDraft([]); setProbe(null); }, [mode]);

  const values = useMemo(() => field(region, view === "water" ? "vv" : view, t), [region, view, t]);
  const def = viewDef(view, region.manifest.scenario);
  // imagery at the zoom this screen can actually show: the square, sharp surroundings, a coarse outer ring for panning,
  // and (when zoomed in) the visible part at full resolution
  // the square's unscaled layout box inside the frame (CSS px); its on-screen rect is that box, translated and scaled by vw
  const [lay, setLay] = useState({ L: 0, T: 0, W: 500, H: 500 });
  const measure = () => {
    const b = box.current; if (!b || !b.offsetWidth) return;
    const next = { L: b.offsetLeft, T: b.offsetTop, W: b.offsetWidth, H: b.offsetHeight };
    setLay((q) => (q.L === next.L && q.T === next.T && q.W === next.W && q.H === next.H ? q : next));
  };
  useLayoutEffect(measure); // cheap reads after every render: the square's box changes with panel/stage sizes and aspect
  useEffect(() => {
    const f = frame.current; if (!f) return;
    const ro = new ResizeObserver(measure); ro.observe(f);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sq = lay.W;
  const bbox = region.manifest.bbox;
  const tiles = useMemo(() => (p.satellite ? tilesForBBox(bbox, 0, 0, sq) : []), [p.satellite, region, sq]); // eslint-disable-line react-hooks/exhaustive-deps
  const context = useMemo(() => (p.satellite ? [...tilesForBBox(bbox, 1.5, 1), ...tilesForBBox(bbox, 0.5, 0, sq)] : []), [p.satellite, region, sq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [settled, setSettled] = useState<V>(vw);
  useEffect(() => { const id = setTimeout(() => setSettled(vw), 180); return () => clearTimeout(id); }, [vw]);
  const visible = useMemo(() => {
    if (settled.k < 1.8 || !frame.current || !box.current) return null;
    const { F, ox, oy, W, H } = geom();
    const u0 = (F.left - ox - settled.x) / (settled.k * W), u1 = (F.right - ox - settled.x) / (settled.k * W);
    const v0 = (F.top - oy - settled.y) / (settled.k * H), v1 = (F.bottom - oy - settled.y) / (settled.k * H);
    const c = (a: number) => Math.min(2, Math.max(-1, a));
    return { bb: [w + c(u0) * (e - w), n - c(v1) * (n - s), w + c(u1) * (e - w), n - c(v0) * (n - s)] as [number, number, number, number], px: F.width };
  }, [settled, region]); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = useMemo(() => (p.satellite && visible ? tilesForBBox(visible.bb, 0, 0, visible.px).slice(0, 120) : []), [p.satellite, visible]);
  // place names: OpenStreetMap places drawn as text at a constant size (Esri label tiles only if OSM is unreachable)
  const [places, setPlaces] = useState<PlaceLabel[] | "failed" | null>(null);
  useEffect(() => {
    if (!p.labels) return;
    let live = true; setPlaces(null);
    regionPlaces(region).then((x) => live && setPlaces(x), () => live && setPlaces("failed"));
    return () => { live = false; };
  }, [p.labels, region]); // eslint-disable-line react-hooks/exhaustive-deps
  // Esri label tiles stand in while names load, or if OSM is unreachable
  const labelTiles = useMemo(() => (!p.labels || Array.isArray(places) ? [] : asLabels(visible ? tilesForBBox(visible.bb, 0, 0, visible.px, 1) : tilesForBBox(bbox, 0.6, 0, sq, 1))),
    [p.labels, places, visible, region, sq]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownPlaces = useMemo(() => {
    if (!p.labels || !Array.isArray(places) || !frame.current) return [];
    const FW = frame.current.clientWidth, FH = frame.current.clientHeight, out: { k: string; x: number; y: number; r: number; t: string }[] = [];
    const boxes: [number, number, number, number][] = [], most = vw.k < 1.4 ? 3 : vw.k < 4 ? 5 : 6;
    for (const q of places) { // most important first; skip anything that would overlap a placed name
      if (q.rank > most || out.length >= 140) continue;
      const x = lay.L + vw.x + vw.k * lay.W * ((q.ll[0] - w) / (e - w)), y = lay.T + vw.y + vw.k * lay.H * ((n - q.ll[1]) / (n - s));
      if (x < -40 || y < -20 || x > FW + 40 || y > FH + 20) continue;
      const t = labelText(q, p.lang ?? "en"), hw = t.length * (q.rank <= 1 ? 4.6 : 3.7) + 6, hh = q.rank <= 1 ? 11 : 9;
      if (boxes.some(([a, b, c, d]) => x - hw < c && x + hw > a && y - hh < d && y + hh > b)) continue;
      boxes.push([x - hw, y - hh, x + hw, y + hh]);
      out.push({ k: `${q.ll[0]},${q.ll[1]}`, x: Math.round(x), y: Math.round(y), r: q.rank, t }); // whole pixels: no shimmer
    }
    return out;
  }, [p.labels, p.lang, places, vw, lay, region]); // eslint-disable-line react-hooks/exhaustive-deps
  const place = (tl: { west: number; east: number; north: number; south: number }) => ({
    left: `${((tl.west - w) / (e - w)) * 100}%`, width: `${((tl.east - tl.west) / (e - w)) * 100}%`,
    top: `${((n - tl.north) / (n - s)) * 100}%`, height: `${((tl.north - tl.south) / (n - s)) * 100}%` });

  const local = (ev: React.PointerEvent, el: Element): XY => {
    const b = el.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height))];
  };

  const click = (ev: React.PointerEvent<SVGSVGElement>) => {
    // relative to the data square, unclamped: shapes may extend beyond it (the report covers the part inside)
    const b = ev.currentTarget.parentElement!.getBoundingClientRect();
    const q: XY = [(ev.clientX - b.left) / b.width, (ev.clientY - b.top) / b.height];
    if (p.edit || panned.current) return; // drag releases and pans land here; they are not taps
    if (mode === "point") { p.onPoint?.(toLL(q)); return; }
    if (mode === "line") {
      if (draft.length === 0) setDraft([q]);
      else { p.onLine([toLL(draft[0]), toLL(q)]); setDraft([]); }
      return;
    }
    if (mode === "area") {
      if (draft.length >= 3 && Math.hypot(q[0] - draft[0][0], q[1] - draft[0][1]) < 0.045 / vw.k) { p.onPolygon(draft.map(toLL)); setDraft([]); }
      else setDraft([...draft, q]);
      return;
    }
    if (q[0] < 0 || q[0] > 1 || q[1] < 0 || q[1] > 1) { setProbe(null); return; }
    const i = Math.min(cols - 1, Math.floor(q[0] * cols)), j = Math.min(rows - 1, Math.floor(q[1] * rows));
    setProbe({ x: q[0], y: q[1], v: values[j * cols + i] });
  };

  const kmW = (e - w) * 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180), kmH = (n - s) * 111.32;
  const bar = niceKm(kmW / vw.k / 4);
  const pts = (a: XY[]) => a.map((q) => q.join(",")).join(" ");
  const sw = 0.006, px = Math.sqrt(cellAreaKm2(region));
  const lineXY = p.line?.map(toXY);
  const hint = p.hint !== undefined && mode ? p.hint : mode === "point" ? "Tap a spot" : mode === "line" ? (draft.length ? "Tap the end point" : "Tap the start point")
    : mode === "area" ? (draft.length < 3 ? "Tap to add corners" : "Tap the first corner to finish") : null;
  const unit = def.unit === "dB" || view === "water" ? "dB" : def.unit;

  return (
    <div className={mode ? "map-box" : vw.k > 1 ? "map-box pannable" : "map-box"} ref={frame} onPointerDown={onFramePointerDown}>
      {(context.length > 0 || labelTiles.length > 0) && (
        // Imagery is laid out in screen pixels (not inside the scaled square): every tile is drawn at its real size and
        // only what is on screen gets painted, so zooming stays smooth and sharp at any scale.
        <div className="imagery" aria-hidden>
          <div className="plane" style={{ left: lay.L + vw.x, top: lay.T + vw.y, width: lay.W * vw.k, height: lay.H * vw.k }}>
            {/* eslint-disable @next/next/no-img-element */}
            {context.length > 0 && <div className="ctx">{uniq([...context, ...detail]).map((tl) => <img key={tl.url} src={tl.url} alt="" draggable={false} style={place(tl)} />)}</div>}
            {tiles.length > 0 && <div className="clip">{uniq([...tiles, ...detail]).map((tl) => <img key={tl.url} src={tl.url} alt="" draggable={false} style={place(tl)} />)}</div>}
            {labelTiles.length > 0 && <div className="labels">{labelTiles.map((tl) => <img key={tl.url} src={tl.url} alt="" draggable={false} style={place(tl)} />)}</div>}
            {/* eslint-enable @next/next/no-img-element */}
          </div>
        </div>
      )}
      <div ref={box} className={p.satellite ? "rmap sat-on" : "rmap"} style={{ aspectRatio: `${kmW} / ${kmH}`, ["--ar" as string]: kmW / kmH,
        ["--k" as string]: vw.k, transform: `translate(${vw.x}px, ${vw.y}px) scale(${vw.k})` }}
        onPointerMove={(ev) => { if (dragging.current) setSplit(local(ev, ev.currentTarget)[0]); }}
        onPointerUp={() => { dragging.current = false; }}>
        <canvas ref={main} width={cols} height={rows} style={{ opacity: p.overlay ? 0.25 : p.satellite ? p.opacity : 1 }} />
        {p.overlay && (() => {
          const [fw, fs, fe, fn] = p.overlay.footprint; // real NISAR quick-look, geocoded (LATLON) over its footprint
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.overlay.url} alt="NISAR quick-look" className="sat nisar-ql" draggable={false} style={{
              left: `${((fw - w) / (e - w)) * 100}%`, width: `${((fe - fw) / (e - w)) * 100}%`,
              top: `${((n - fn) / (n - s)) * 100}%`, height: `${((fn - fs) / (n - s)) * 100}%` }} />
          );
        })()}
        {p.overlay && <div className="swipe-tag left">NISAR quick-look</div>}
        {p.compare && (
          <>
            <canvas ref={second} width={cols} height={rows} style={{ opacity: p.satellite ? p.opacity : 1, clipPath: `inset(0 0 0 ${split * 100}%)` }} />
            <div className="swipe-tag left">{viewDef(view).short}</div>
            <div className="swipe-tag right">{viewDef(p.compare).short}</div>
          </>
        )}
        <svg viewBox="-1.5 -1.5 4 4" preserveAspectRatio="none" onPointerUp={click} className={mode ? "draw-layer drawing" : "draw-layer"}>
          {(p.showFeatures === false ? [] : region.manifest.features).map((f) => {
            const xy = f.polygon.map(toXY), on = p.highlight === f.id;
            const cx = xy.reduce((a, q) => a + q[0], 0) / xy.length, cy = xy.reduce((a, q) => a + q[1], 0) / xy.length;
            return (
              <g key={f.id} onPointerUp={(ev) => { if ((!mode || mode === "point") && p.onFeature) { ev.stopPropagation(); p.onFeature(f.id); } }} style={{ cursor: p.onFeature && !mode ? "pointer" : undefined }}>
                <polygon points={pts(xy)} fill="transparent" stroke={on ? "#ffb547" : "rgba(242,242,238,.55)"} strokeWidth={on ? sw * 1.6 : sw * 0.7} vectorEffect="non-scaling-stroke" />
                {f.kind === "plot" && <text x={cx} y={cy} className="flabel">{f.name.replace(/^(Plot|Block) /, "")}</text>}
              </g>
            );
          })}
          {p.polygon && <polygon points={pts(p.polygon.map(toXY))} className="poly" vectorEffect="non-scaling-stroke" />}
          {lineXY && <line x1={lineXY[0][0]} y1={lineXY[0][1]} x2={lineXY[1][0]} y2={lineXY[1][1]} className="tline" vectorEffect="non-scaling-stroke" />}
          {draft.length > 0 && <polyline points={pts(draft)} className="draft" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* HTML overlays keep round dots and crisp labels regardless of aspect ratio */}
        {draft.map((q, k) => <i key={k} className={k === 0 ? "vtx first" : "vtx"} style={{ left: `${q[0] * 100}%`, top: `${q[1] * 100}%` }} />)}
        {lineXY && ["A", "B"].map((l, k) => <span key={l} className="tend" style={{ left: `${lineXY[k][0] * 100}%`, top: `${lineXY[k][1] * 100}%` }}>{l}</span>)}
        {p.marks?.map((m, k) => { const [x, y] = toXY(m.ll); return <span key={k} className="mark" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}><b>{m.label}</b></span>; })}
        {p.compare && (
          <div className="swipe" style={{ left: `${split * 100}%` }} onPointerDown={(ev) => { ev.stopPropagation(); dragging.current = true; ev.currentTarget.parentElement?.setPointerCapture(ev.pointerId); }}>
            <span />
          </div>
        )}
        {probe && !mode && (
          <div className="probe" style={{ left: `${probe.x * 100}%`, top: `${probe.y * 100}%` }}>
            {Number.isNaN(probe.v) ? "no data" : `${probe.v.toFixed(view === "coherence" || view === "damage" || view === "phase" ? 2 : 1)} ${unit}`}
          </div>
        )}
        {p.edit && p.polygon && (() => {
          const xy = p.polygon.map(toXY);
          return (<>
            {xy.map((a, k) => {
              const b = xy[(k + 1) % xy.length], wpx = (box.current?.offsetWidth ?? 600) * vw.k;
              if (Math.hypot((b[0] - a[0]) * wpx, (b[1] - a[1]) * wpx / ((kmW / kmH) || 1)) < 56) return null; // too short to fit a "+" between corners
              return <i key={`m${k}`} className="vtx mid" style={{ left: `${((a[0] + b[0]) / 2) * 100}%`, top: `${((a[1] + b[1]) / 2) * 100}%` }} onPointerDown={(ev) => startDrag(ev, k + 1, true)} />; })}
            {xy.map((q, k) => <i key={`v${k}`} className="vtx edit" style={{ left: `${q[0] * 100}%`, top: `${q[1] * 100}%` }} onPointerDown={(ev) => startDrag(ev, k, false)} onDoubleClick={() => removeCorner(k)} />)}
          </>);
        })()}
      </div>
      {shownPlaces.length > 0 && (
        <div className="plabels" aria-hidden>
          {shownPlaces.map((q) => <span key={q.k} className={`r${Math.min(q.r, 3)}`} style={{ left: q.x, top: q.y }}>{q.t}</span>)}
        </div>
      )}
      <div className="map-ui">
        {(hint || (p.edit && p.hint)) && <div className="maphint">{hint ?? p.hint}</div>}
        <div className="scalebar"><span style={{ width: `${(bar / kmW) * (box.current?.offsetWidth ?? 400) * vw.k}px` }} />{bar < 1 ? `${Math.round(bar * 1000)} m` : `${bar} km`}</div>
        <div className="cellsize mono">{p.satellite ? ATTRIBUTION + (Array.isArray(places) && p.labels ? " · Names © OpenStreetMap" : "") : px < 1 ? `${Math.round(px * 1000)} m px` : `${px.toFixed(1)} km px`}</div>
        <div className="zoombtns">
          <button onClick={() => zoomCenter(2)} aria-label="Zoom in">+</button>
          <button onClick={() => zoomCenter(0.5)} aria-label="Zoom out" disabled={vw.k <= 1}>−</button>
          <button onClick={() => (p.polygon && vw.k === 1 ? fitTo(p.polygon) : go({ k: 1, x: 0, y: 0 }, true))} aria-label={vw.k === 1 && p.polygon ? "Zoom to shape" : "Show whole area"} disabled={vw.k === 1 && !p.polygon}><Icon name={vw.k === 1 && p.polygon ? "locate" : "map"} size={18} /></button>
        </div>
      </div>
    </div>
  );
}

const uniq = <T extends { url: string }>(a: T[]) => a.filter((x, i) => a.findIndex((y) => y.url === x.url) === i);

function niceKm(x: number) {
  const q = Math.pow(10, Math.floor(Math.log10(x))), m = x / q;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * q;
}
