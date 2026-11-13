"use client";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useReducer, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import { geoEquirectangular, geoGraticule10, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { CatalogEntry, LonLat, RegionData } from "../lib/data/types";
import { colorize, type ViewId } from "../lib/views";
import { globeImagery, labelUrl, lat2y, lon2x, tileUrl, x2lon, y2lat } from "../lib/basemap";

const D2R = Math.PI / 180;
/** Matches THREE.SphereGeometry's UV layout so textures and markers line up. */
export function lonLatToVec3(lon: number, lat: number, r = 1) {
  const phi = (lon + 180) * D2R, theta = (90 - lat) * D2R;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
}
export function vec3ToLonLat(v: THREE.Vector3): LonLat {
  const r = v.length(), lat = 90 - Math.acos(v.y / r) / D2R;
  let lon = Math.atan2(v.z, -v.x) / D2R - 180;
  if (lon < -180) lon += 360;
  return [lon, lat];
}

function useDarkTexture(light = false) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let alive = true;
    // static files (public/geo) instead of bundled JSON: no webpack chunk to go stale, cached by the browser
    const get = (f: string) => fetch(`/geo/${f}`).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
    Promise.all([get("land-50m.json"), get("countries-50m.json")]).then(([lt, ct]) => {
      if (!alive) return;
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const land = feature(lt, lt.objects.land);
      const borders = mesh(ct, ct.objects.countries, (a: unknown, b: unknown) => a !== b);
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const W = 4096, H = 2048, c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d")!;
      const path = geoPath(geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]), ctx);
      if (light) {
        ctx.fillStyle = "#dce4ec"; ctx.fillRect(0, 0, W, H);
        ctx.beginPath(); path(geoGraticule10()); ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); path(land); ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.beginPath(); path(borders); ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.beginPath(); path(land); ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1.2; ctx.stroke();
      } else {
        ctx.fillStyle = "#0b0d11"; ctx.fillRect(0, 0, W, H);
        ctx.beginPath(); path(geoGraticule10()); ctx.strokeStyle = "#151922"; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); path(land); ctx.fillStyle = "#232833"; ctx.fill();
        ctx.beginPath(); path(borders); ctx.strokeStyle = "#2e343f"; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.beginPath(); path(land); ctx.strokeStyle = "#454c59"; ctx.lineWidth = 1.2; ctx.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      setTex(t);
    }).catch(() => { /* coastlines unavailable: globe stays plain dark */ });
    return () => { alive = false; };
  }, [light]);
  return tex;
}

function useSatTexture(on: boolean) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    if (!on || tex) return;
    globeImagery().then((c) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      setTex(t);
    }).catch(() => {});
  }, [on, tex]);
  return on ? tex : null;
}

/** Exact ray / unit-sphere hit (the rendered mesh is faceted and sits up to ~1 km under the true surface). */
function sphereHit(ray: THREE.Ray): THREE.Vector3 | null {
  const b = ray.origin.dot(ray.direction), c = ray.origin.lengthSq() - 1, disc = b * b - c;
  if (disc < 0) return null;
  const tt = -b - Math.sqrt(disc);
  return tt > 0 ? ray.at(tt, new THREE.Vector3()) : null;
}

function Earth({ satellite, onSurface, closeTo, light }: { satellite: boolean; onSurface: (ll: LonLat, closes: boolean) => void; closeTo: LonLat | null; light?: boolean }) {
  const { camera, size } = useThree();
  const dark = useDarkTexture(light), sat = useSatTexture(satellite);
  const map = sat ?? dark;
  const atmo = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
    fragmentShader: "varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1. - abs(dot(vN, vV)), 3.); gl_FragColor = vec4(vec3(0.35,0.5,0.75)*f, f*0.6); }",
  }), []);
  return (
    <group>
      {/* swallows events so far-side markers aren't clickable; reports surface taps */}
      <mesh
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation(); if (e.delta > 6) return;
          const hit = sphereHit(e.ray) ?? e.point;
          let closes = false; // finishing a shape: tap within ~22 px of its first corner
          if (closeTo) {
            const s = lonLatToVec3(closeTo[0], closeTo[1], 1).project(camera);
            const px = ((s.x + 1) / 2) * size.width, py = ((1 - s.y) / 2) * size.height;
            closes = Math.hypot(px - e.nativeEvent.offsetX, py - e.nativeEvent.offsetY) < 22;
          }
          onSurface(vec3ToLonLat(hit), closes);
        }}
        onPointerOver={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()}
      >
        <sphereGeometry args={[1, 160, 80]} />
        {map ? <meshBasicMaterial key={map.uuid} map={map} /> : <meshBasicMaterial key="plain" color={light ? "#dce4ec" : "#0b0d11"} />}
      </mesh>
      {!light && <mesh scale={1.035} material={atmo}><sphereGeometry args={[1, 64, 32]} /></mesh>}
    </group>
  );
}

/** A screen-size-stable dot/ring at a lon/lat. */
function Spot({ ll, color, ring = true, size = 1, onClick }: { ll: LonLat; color: string; ring?: boolean; size?: number; onClick?: () => void }) {
  const ref = useRef<THREE.Group>(null);
  const pos = useMemo(() => lonLatToVec3(ll[0], ll[1], 1.000004), [ll]);
  const [hover, setHover] = useState(false);
  useFrame(({ camera }) => { ref.current?.scale.setScalar(camera.position.distanceTo(pos) * 0.022 * size * (hover ? 1.25 : 1)); });
  const handlers = onClick ? {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick(); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; },
    onPointerOut: () => { setHover(false); document.body.style.cursor = ""; },
  } : {};
  return (
    <group ref={ref} position={pos} onUpdate={(g) => g.lookAt(pos.clone().multiplyScalar(2))}>
      {onClick && <mesh {...handlers}><circleGeometry args={[1.6, 24]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>}
      {ring && <mesh renderOrder={10}><ringGeometry args={[0.55, 0.8, 40]} /><meshBasicMaterial color={color} transparent opacity={hover ? 1 : 0.85} depthWrite={false} /></mesh>}
      <mesh renderOrder={10}><circleGeometry args={[0.24, 20]} /><meshBasicMaterial color={color} transparent depthWrite={false} /></mesh>
    </group>
  );
}

function GlobePath({ pts, closed, color }: { pts: LonLat[]; closed: boolean; color: string }) {
  const line = useMemo(() => {
    if (pts.length < 2) return [];
    const seq = closed ? [...pts, pts[0]] : pts, out: THREE.Vector3[] = [];
    for (let i = 0; i < seq.length - 1; i++) {
      const a = lonLatToVec3(seq[i][0], seq[i][1]), b = lonLatToVec3(seq[i + 1][0], seq[i + 1][1]);
      const steps = Math.max(2, Math.ceil(a.angleTo(b) / 0.005));
      for (let s = 0; s < steps; s++) out.push(a.clone().lerp(b, s / steps).normalize().multiplyScalar(1.000004));
    }
    const last = seq[seq.length - 1];
    out.push(lonLatToVec3(last[0], last[1], 1.000004));
    return out;
  }, [pts, closed]);
  if (pts.length < 2) return null;
  return <Line points={line} color={color} lineWidth={closed ? 2.5 : 2} transparent opacity={closed ? 1 : 0.8} depthTest={false} renderOrder={5} />;
}

function DataPatch({ region, view, t, opacity }: { region: RegionData; view: ViewId; t: number; opacity: number }) {
  const { cols, rows } = region.manifest.grid;
  const [w, s, e, n] = region.manifest.bbox;
  const tex = useMemo(() => {
    const d = new THREE.DataTexture(new Uint8Array(cols * rows * 4), cols, rows, THREE.RGBAFormat);
    d.magFilter = THREE.LinearFilter; d.minFilter = THREE.LinearFilter; d.colorSpace = THREE.SRGBColorSpace;
    return d;
  }, [cols, rows]);
  useEffect(() => {
    colorize(region, view, t, tex.image.data as Uint8Array, true);
    tex.needsUpdate = true;
  }, [region, view, t, tex]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh renderOrder={3}>
      <sphereGeometry args={[1.000003, 48, 48, (w + 180) * D2R, (e - w) * D2R, (90 - n) * D2R, (n - s) * D2R]} />
      <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4000} />
    </mesh>
  );
}

// ---------- Google-Earth-style detail: stream XYZ tiles for whatever the camera looks at ----------
type TileKey = { z: number; x: number; y: number; key: string };
type TileEntry = { tex: THREE.Texture | null; failed: boolean; used: number };
const tileCache = new Map<string, TileEntry>();
const tileLoader = new THREE.TextureLoader().setCrossOrigin("anonymous");
const GRID = 3; // (2*GRID+1)^2 tiles around the view centre (covers wide screens)

function tilesInView(camera: THREE.Camera): { id: string; tiles: TileKey[] } {
  const alt = camera.position.length() - 1;
  const width = Math.min(2, 0.73 * alt); // visible ground width in radians (fov 40)
  const z = Math.min(18, Math.round(Math.log2((8 * Math.PI) / width)));
  if (z < 5) return { id: "", tiles: [] }; // the zoom-3 base texture is enough from orbit
  const [lon, lat] = vec3ToLonLat(camera.position), latC = Math.max(-85, Math.min(85, lat));
  const tiles: TileKey[] = [];
  const ring = (zz: number, r: number) => {
    const n = 2 ** zz, cx = Math.floor(lon2x(lon, zz)), cy = Math.floor(lat2y(latC, zz));
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const y = cy + dy, x = (((cx + dx) % n) + n) % n;
      if (y >= 0 && y < n) tiles.push({ z: zz, x, y, key: `${zz}/${x}/${y}` });
    }
    return `${zz}/${cx}/${cy}`;
  };
  // coarse ring two levels up covers the screen edges and horizon; sharp grid fills the centre
  const coarse = z - 2 >= 4 ? ring(z - 2, 2) : "";
  return { id: ring(z, GRID) + "|" + coarse, tiles };
}

function TileMesh({ t, tex, labels }: { t: TileKey; tex: THREE.Texture; labels: boolean }) {
  const geom = useMemo(() => {
    const seg = t.z < 9 ? 12 : 4, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      const v = lonLatToVec3(x2lon(t.x + i / seg, t.z), y2lat(t.y + j / seg, t.z), 1); // exact Mercator rows
      pos.push(v.x, v.y, v.z); uv.push(i / seg, 1 - j / seg);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }, [t.z, t.x, t.y]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} renderOrder={labels ? 4 : 1} raycast={() => null}>
      {/* deeper zooms win the depth test against coarser tiles and the base globe; labels sit above the data patch */}
      <meshBasicMaterial map={tex} depthWrite={false} transparent={labels} polygonOffset polygonOffsetFactor={labels ? -6 : -1} polygonOffsetUnits={(labels ? -6000 : 0) - 40 * t.z} />
    </mesh>
  );
}

function TileLayer({ on, labels = false }: { on: boolean; labels?: boolean }) {
  const pre = labels ? "L" : "";
  const { camera } = useThree();
  const [wanted, setWanted] = useState<TileKey[]>([]);
  const [shown, setShown] = useState<TileKey[]>([]);
  const [tick, bump] = useReducer((x: number) => x + 1, 0);
  const viewId = useRef("");
  const lastCheck = useRef(0);

  useFrame(({ clock }) => {
    if (!on || clock.elapsedTime - lastCheck.current < 0.15) return;
    lastCheck.current = clock.elapsedTime;
    const { id, tiles } = tilesInView(camera);
    if (id !== viewId.current) { // labels only at the sharp level: scaled-up coarse labels are big and blurry
      viewId.current = id;
      const top = Math.max(0, ...tiles.map((t) => t.z));
      setWanted(labels ? tiles.filter((t) => t.z === top) : tiles);
    }
  });
  useEffect(() => { if (!on) { viewId.current = ""; setWanted([]); setShown([]); } }, [on]);

  useEffect(() => {
    const now = performance.now();
    for (const t of wanted) {
      const hit = tileCache.get(pre + t.key);
      if (hit) { hit.used = now; continue; }
      const e: TileEntry = { tex: null, failed: false, used: now };
      tileCache.set(pre + t.key, e);
      tileLoader.load((labels ? labelUrl : tileUrl)(t.z, t.x, t.y), (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        e.tex = tex; bump();
      }, undefined, () => { e.failed = true; bump(); });
    }
    if (tileCache.size > 400) { // evict least-recently-used textures that are off screen
      const keep = new Set([...wanted, ...shown].map((t) => pre + t.key));
      [...tileCache.entries()].filter(([k]) => !keep.has(k)).sort((a, b) => a[1].used - b[1].used)
        .slice(0, tileCache.size - 300).forEach(([k, e]) => { e.tex?.dispose(); tileCache.delete(k); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  // keep the previous level on screen until the new level has fully arrived (no blurry flash)
  useEffect(() => {
    if (wanted.every((t) => { const e = tileCache.get(pre + t.key); return e && (e.tex || e.failed); })) setShown(wanted);
  }, [wanted, tick]);

  if (!on) return null;
  const seen = new Set<string>(), list: TileKey[] = [];
  for (const t of labels ? shown : [...shown, ...wanted]) if (!seen.has(t.key)) { seen.add(t.key); list.push(t); } // labels: never two levels at once
  return <>{list.map((t) => { const e = tileCache.get(pre + t.key); return e?.tex ? <TileMesh key={t.key} t={t} tex={e.tex} labels={labels} /> : null; })}</>;
}

const HOME: LonLat = [88, 18];

function CameraRig({ focus, controls, zoomRef }: { focus: { center: LonLat; span: number } | null; controls: React.RefObject<OrbitImpl | null>; zoomRef: React.MutableRefObject<((dir: 1 | -1) => void) | null> }) {
  const { camera, gl } = useThree();
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number } | null>(null);
  const zoomTo = useRef<number | null>(null); // target altitude, eased in log space each frame
  useEffect(() => {
    const host = gl.domElement.parentElement; if (!host) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault(); ev.stopPropagation(); // keep OrbitControls' stepped dolly out of it; pinch stays native
      const px = ev.deltaY * (ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1);
      const cur = zoomTo.current ?? camera.position.length() - 1;
      zoomTo.current = Math.min(5, Math.max(0.00008, cur * Math.exp(Math.max(-300, Math.min(300, px)) * 0.0018)));
      anim.current = null;
    };
    host.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => host.removeEventListener("wheel", onWheel, { capture: true });
  }, [gl, camera]);
  // expose button-driven zoom so HTML buttons outside the canvas can trigger it
  useEffect(() => {
    zoomRef.current = (dir: 1 | -1) => {
      const alt = camera.position.length() - 1;
      zoomTo.current = Math.min(5, Math.max(0.00008, alt * Math.exp(dir * -300 * 0.0018)));
      anim.current = null;
    };
    return () => { zoomRef.current = null; };
  }, [camera, zoomRef]);
  const { size } = useThree();
  const aspect = size.height ? size.width / size.height : 1.5;
  useEffect(() => {
    const [lon, lat] = focus?.center ?? HOME;
    // from orbit, back off until the whole globe fits the narrower side (portrait phones)
    const fit = 1.12 / (Math.tan(20 * D2R) * Math.min(1, aspect)) - 1;
    const alt = focus ? Math.max(0.004, focus.span * D2R * 2.2) : Math.max(2.3, fit);
    zoomTo.current = null;
    anim.current = { from: camera.position.clone(), to: lonLatToVec3(lon, lat - (focus ? focus.span * 0.25 : 0), 1 + alt), t: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, camera, focus ? 0 : Math.round(aspect * 10)]);
  useEffect(() => {
    const c = controls.current; if (!c) return;
    const stop = () => { anim.current = null; };
    c.addEventListener("start", stop);
    return () => { c.removeEventListener("start", stop); };
  }, [controls]);
  useFrame((_, dt) => {
    const c = controls.current, a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / 1.6);
      const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      const r0 = a.from.length(), r1 = a.to.length();
      const f = a.from.clone().normalize(), to = a.to.clone().normalize();
      const dir = f.clone().lerp(to, k).normalize();
      const lift = Math.sin(Math.PI * k) * Math.min(1.2, f.angleTo(to) * 0.8);
      camera.position.copy(dir.multiplyScalar(r0 + (r1 - r0) * k + lift));
      camera.lookAt(0, 0, 0);
      if (a.t >= 1) anim.current = null;
    } else if (zoomTo.current !== null) {
      const alt0 = camera.position.length() - 1, goal = zoomTo.current;
      const next = Math.exp(Math.log(alt0) + (Math.log(goal) - Math.log(alt0)) * (1 - Math.exp(-dt * 9)));
      camera.position.setLength(1 + next);
      if (Math.abs(Math.log(next / goal)) < 0.002) zoomTo.current = null;
    }
    const alt = camera.position.length() - 1, cam = camera as THREE.PerspectiveCamera;
    const near = Math.max(1e-6, alt * 0.25), far = alt + 3;
    if (Math.abs(cam.near - near) / near > 0.05 || cam.far !== far) { cam.near = near; cam.far = far; cam.updateProjectionMatrix(); }
    if (c) {
      c.rotateSpeed = Math.min(0.6, Math.max(0.00005, alt * 0.35));
      c.zoomSpeed = 0.8;
      c.update();
    }
  });
  return null;
}

export default function Globe(props: {
  catalog: CatalogEntry[];
  selected: string | null;
  region: RegionData | null;
  view: ViewId;
  t: number;
  onSelect: (id: string) => void;
  onSurface: (ll: LonLat, closes: boolean) => void;
  drawing: boolean;
  draft: LonLat[];
  polygon: LonLat[] | null;
  pin: LonLat | null;
  satellite: boolean;
  labels: boolean;
  opacity: number;
  theme?: "dark" | "light";
}) {
  const isLight = props.theme === "light";
  const selColor = isLight ? "#d97706" : "#ffb547";
  const unselColor = isLight ? "#475569" : "#e9e9e4";
  const controls = useRef<OrbitImpl | null>(null);
  const zoomRef = useRef<((dir: 1 | -1) => void) | null>(null);
  const zoom = useCallback((dir: 1 | -1) => { zoomRef.current?.(dir); }, []);
  const sel = props.catalog.find((r) => r.id === props.selected);
  const pinFocus = props.pin && !sel ? { center: props.pin, span: 8 } : null;
  const focus = useMemo(() => (sel ? { center: sel.center, span: sel.bbox[3] - sel.bbox[1] } : pinFocus),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, props.pin?.[0], props.pin?.[1]]);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Canvas dpr={[1, 1.75]} camera={{ fov: 40, near: 0.0005, far: 50, position: lonLatToVec3(HOME[0], HOME[1], 3.3).toArray() }} gl={{ antialias: true }}>
        <color attach="background" args={[isLight ? "#f8f9fa" : "#050608"]} />
        <Earth satellite={props.satellite} onSurface={props.onSurface} closeTo={props.drawing && props.draft.length >= 3 ? props.draft[0] : null} light={isLight} />
        <TileLayer on={props.satellite} />
        <TileLayer on={props.labels} labels />
        {props.region && props.region.manifest.id === props.selected && <DataPatch region={props.region} view={props.view} t={props.t} opacity={props.opacity} />}
        {props.catalog.map((r) => (
          <Spot key={r.id} ll={r.center} color={r.id === props.selected ? selColor : unselColor} onClick={props.drawing ? undefined : () => props.onSelect(r.id)} />
        ))}
        {props.pin && <Spot ll={props.pin} color={selColor} ring={false} size={1.6} />}
        {props.draft.map((p, i) => <Spot key={i} ll={p} color={selColor} ring={i === 0} size={0.6} />)}
        <GlobePath pts={props.draft} closed={false} color={selColor} />
        {props.polygon && <GlobePath pts={props.polygon} closed color={selColor} />}
        <OrbitControls ref={controls} enablePan={false} minDistance={1.00008} maxDistance={6} enableDamping dampingFactor={0.08} />
        <CameraRig focus={focus} controls={controls} zoomRef={zoomRef} />
      </Canvas>
      <div className="globe-zoom">
        <button className="iconbtn" onClick={() => zoom(1)} aria-label="Zoom in">＋</button>
        <button className="iconbtn" onClick={() => zoom(-1)} aria-label="Zoom out">－</button>
      </div>
    </div>
  );
}
