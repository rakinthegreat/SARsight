"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogEntry, LonLat, ModuleId, NisarPass, RegionData, Source } from "../lib/data/types";
import { loadCatalog, loadRegion } from "../lib/data/provider";
import { LANDCOVER, LANDCOVER_BN, WATER_COLORS, gradientCss, viewDef, viewRange, viewsFor, type ViewId } from "../lib/views";
import { INDICATOR_LABELS_BN, INDICATOR_WORDS_BN, crop, fmtLL, moistureIndex, nextPassSchedule, pointInPolygon, polygonMask, regionIndicators, report, transect, type Indicator, type Report, type Status } from "../lib/analysis";
import { STORIES } from "../lib/stories";
import Icon, { scenarioIcon } from "./Icon";
import RegionMap, { type DrawMode } from "./RegionMap";
import Scrubber from "./Scrubber";
import Chart from "./Chart";
import Assist, { type Step } from "./Assist";
import { HOME, JOBS, ONBOARD, UI, getStoredProfile, num, prepProgress, squareAround, tr, useProfile } from "../lib/assist";
import Onboarding, { ONBOARDED, type OnboardChoice, type OnboardProgress } from "./Onboarding";
import PlaceSearch from "./PlaceSearch";
import { areaStatus, rememberArea, removeSavedArea, requestArea, savedAreas, serverAreas, type AreaJob } from "../lib/areas";
import type { Scenario } from "../lib/data/types";

const Globe = dynamic(() => import("./Globe"), { ssr: false, loading: () => <div className="globe-loading mono">Loading globe…</div> });

const MODULES: { id: ModuleId; name: [string, string]; tag: [string, string]; blurb: [string, string] }[] = [
  { id: "econ", name: ["EconAssist", "ইকনঅ্যাসিস্ট"], tag: ["Livelihoods", "জীবিকা"], blurb: ["Farms, seas, mines and oil fields, seen through clouds.", "মেঘের আড়ালে লুকানো খামার, সাগর, খনি ও তেলক্ষেত্রের তথ্য।"] },
  { id: "haz", name: ["HazAssist", "হ্যাজঅ্যাসিস্ট"], tag: ["Hazards", "দুর্যোগ"], blurb: ["Floods, quakes, volcanoes and sinking ground, mapped fast.", "বন্যা, ভূমিকম্প, আগ্নেয়গিরি ও দেবে যাওয়া ভূমির দ্রুত মানচিত্র।"] },
  { id: "vis", name: ["VisAssist", "ভিজঅ্যাসিস্ট"], tag: ["Explore", "অন্বেষণ"], blurb: ["Watch the surface move, pass by pass.", "প্রতিটি স্যাটেলাইট পাসে ভূপৃষ্ঠের সূক্ষ্ম পরিবর্তন ও গতিবিধি প্রত্যক্ষ করুন।"] },
];

const REGION_NAMES_BN: Record<string, { name: string; place: string; country: string }> = {
  "rajshahi-barind": { name: "বরেন্দ্র কৃষিজমি", place: "রাজশাহী", country: "বাংলাদেশ" },
  "bay-of-bengal": { name: "চট্টগ্রাম উপকূল", place: "বঙ্গোপসাগর", country: "বাংলাদেশ" },
  "barapukuria": { name: "বড়পুকুরিয়া কয়লা খনি", place: "দিনাজপুর", country: "বাংলাদেশ" },
  "bingham-canyon": { name: "বিংহাম ক্যানিয়ন পিট", place: "ইউটা", country: "যুক্তরাষ্ট্র" },
  "lost-hills": { name: "লস্ট হিলস তেলক্ষেত্র", place: "ক্যালিফোর্নিয়া", country: "যুক্তরাষ্ট্র" },
  "sylhet-haor": { name: "সুনামগঞ্জ হাওর প্লাবন", place: "সিলেট", country: "বাংলাদেশ" },
  "dhaka": { name: "ঢাকা ভূমি অবনমন", place: "ঢাকা", country: "বাংলাদেশ" },
  "rangamati": { name: "পার্বত্য ঢাল", place: "রাঙ্গামাটি", country: "বাংলাদেশ" },
  "kahramanmaras": { name: "কাহরামানমারাস ভূমিকম্প", place: "কাহরামানমারাস", country: "তুরস্ক" },
  "campi-flegrei": { name: "কাম্পি ফ্লেগ্রেই ক্যালডেরা", place: "পোজুওলি", country: "ইতালি" },
  "mexico-city": { name: "মেক্সিকো সিটি ভূমি অবনমন", place: "মেক্সিকো সিটি", country: "মেক্সিকো" },
  "sindh": { name: "মাঞ্চার হ্রদ প্লাবন", place: "সিন্ধ", country: "পাকিস্তান" },
};
const rName = (r: CatalogEntry, lang: "en" | "bn") => (lang === "bn" ? (REGION_NAMES_BN[r.id]?.name ?? (r.name === "Your area" ? "আপনার এলাকা" : r.name === "My field" ? "আমার জমি" : r.name)) : r.name);
const rPlace = (r: CatalogEntry, lang: "en" | "bn") => (lang === "bn" ? (REGION_NAMES_BN[r.id]?.place ?? r.place) : r.place);
const rCountry = (r: CatalogEntry, lang: "en" | "bn") => (lang === "bn" ? (REGION_NAMES_BN[r.id]?.country ?? r.country) : r.country);

const kmBetween = (a: LonLat, b: LonLat) => {
  const d = Math.PI / 180, x = Math.sin(((b[1] - a[1]) * d) / 2) ** 2 + Math.cos(a[1] * d) * Math.cos(b[1] * d) * Math.sin(((b[0] - a[0]) * d) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
};
const inBBox = ([lon, lat]: LonLat, [w, s, e, n]: CatalogEntry["bbox"]) => lon >= w && lon <= e && lat >= s && lat <= n;
const fmtDate = (iso: string, year = false, lang: "en" | "bn" = "en") => new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });

export default function App() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) {
    return (
      <div className="app m-text" lang="en">
        <header className="top">
          <div className="brand"><span className="logo" aria-hidden /><span className="wordmark">SARsight</span></div>
        </header>
        <main className="stage">
          <div className="globe-loading mono">Loading SARsight…</div>
        </main>
      </div>
    );
  }
  return <AppContent />;
}

function AppContent() {
  const [baseCatalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [customs, setCustoms] = useState<CatalogEntry[]>([]);
  const catalog = useMemo(() => {
    const map = new Map<string, CatalogEntry>();
    for (const item of [...baseCatalog, ...customs]) {
      if (item && item.id && !map.has(item.id)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }, [baseCatalog, customs]);
  /** The "prepare this place" card; watching = it is showing the background job's progress. */
  const [prep, setPrep] = useState<{ poly: LonLat[]; scenario?: Scenario; error?: string; watching?: boolean } | null>(null);
  /** The area being built on the backend. Lives apart from the card, so it keeps going across modules and reloads. */
  const [bg, setBg] = useState<BgJob | null | undefined>(undefined); // undefined = not read from storage yet
  useEffect(() => setBg(loadBg()), []); // after mount, so the server render matches
  useEffect(() => { if (bg === undefined) return; try { if (bg?.job.id) localStorage.setItem(BG_KEY, JSON.stringify(bg)); else localStorage.removeItem(BG_KEY); } catch { /* storage unavailable */ } }, [bg]);
  const autoSite = useRef<LonLat[] | null>(null);
  const [edit, setEdit] = useState<{ orig: LonLat[]; hist: LonLat[][] } | null>(null);
  const [sources, setSources] = useState<Record<string, Source>>({});
  const [error, setError] = useState<string | null>(null);
  const [module, setModule] = useState<ModuleId>(() => {
    if (typeof window === "undefined") return "haz";
    const m = location.hash.slice(1).split("/")[0];
    return (m === "econ" || m === "haz" || m === "vis") ? (m as ModuleId) : "haz";
  });
  const [selected, setSelected] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const [m, r] = location.hash.slice(1).split("/");
    if (r) return r;
    const p = getStoredProfile();
    const assistMod = (m === "econ" || m === "haz") ? m : "haz";
    return p.sites[assistMod]?.[0]?.region ?? null;
  });
  const [region, setRegion] = useState<RegionData | null>(null);
  const [view, setView] = useState<ViewId>("vv");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stage, setStage] = useState<"globe" | "map">("globe");
  const [mode, setMode] = useState<DrawMode>(null);
  const [globeDraft, setGlobeDraft] = useState<LonLat[]>([]);
  const [polygon, setPolygon] = useState<LonLat[] | null>(null);
  const [polyName, setPolyName] = useState<string | null>(null);
  const [line, setLine] = useState<[LonLat, LonLat] | null>(null);
  const [pin, setPin] = useState<LonLat | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [satellite, setSatellite] = useState(true);
  const [labels, setLabels] = useState(true);
  const [mapOpen, setMapOpen] = useState(false); // phones, EconAssist/HazAssist: text first, map on request
  const [bigGlobe, setBigGlobe] = useState(false);
  const [fitTick, setFitTick] = useState(0); // phones, VisAssist: short globe strip unless enlarged
  const [opacity, setOpacity] = useState(0.6);
  const prof = useProfile();
  const [siteId, setSiteId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const m = location.hash.slice(1).split("/")[0];
    const p = getStoredProfile();
    const assistMod = (m === "econ" || m === "haz") ? m : "haz";
    return p.sites[assistMod]?.[0]?.id ?? null;
  });
  const [adding, setAdding] = useState(false);
  const [compare, setCompare] = useState(false);
  const [overlay, setOverlay] = useState<NisarPass | null>(null);
  const [showSources, setShowSources] = useState(false);
  const pending = useRef<LonLat[] | null>(null);
  const [onboard, setOnboard] = useState(false);
  const onbFrom = useRef<{ ll: LonLat; pool: CatalogEntry[] } | null>(null);
  const [onbFallback, setOnbFallback] = useState(false);
  useEffect(() => { // first visit with no saved places: show the onboarding
    try {
      if (localStorage.getItem(ONBOARDED)) return;
      const s = JSON.parse(localStorage.getItem("sarsight.profile.v1") || "{}").sites;
      if (!s?.econ?.length && !s?.haz?.length) setOnboard(true);
    } catch { /* storage unavailable */ }
  }, []);
  const finishOnboard = () => { try { localStorage.setItem(ONBOARDED, "1"); } catch { /* storage unavailable */ } setOnboard(false); };
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { panelRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, [pin, notice, selected]);

  useEffect(() => {
    const read = () => {
      const [m, r] = location.hash.slice(1).split("/");
      if (m === "econ" || m === "haz" || m === "vis") setModule(m);
      setSelected(r || null);
    };
    setCustoms(savedAreas());
    serverAreas().then((srv) => {
      if (srv.length) {
        setCustoms((c) => {
          const map = new Map<string, CatalogEntry>();
          for (const item of [...c, ...srv]) {
            if (item && item.id) map.set(item.id, item);
          }
          return Array.from(map.values());
        });
      }
    });
    read();
    addEventListener("hashchange", read);
    loadCatalog().then((c) => { setCatalog(c.regions); setSources(c.sources); }).catch((e) => setError(String(e)));
    return () => removeEventListener("hashchange", read);
  }, []);
  useEffect(() => { history.replaceState(null, "", `#${module}${selected ? "/" + selected : ""}`); }, [module, selected]);

  useEffect(() => {
    setError(null);
    setRegion(null); setPolygon(null); setPolyName(null); setLine(null); setMode(null); setPlaying(false); setStage("globe"); setCompare(false); setOverlay(null);
    if (!selected) return;
    setPin(null); setNotice(null);
    let alive = true;
    loadRegion(selected, catalog.find((c) => c.id === selected)?.base).then((r) => {
      if (!alive) return;
      setError(null);
      setRegion(r);
      setT(r.manifest.event ? r.manifest.event.epoch : r.manifest.epochs.length - 1);
      if (pending.current) { setPolygon(pending.current); setPolyName("Your area"); pending.current = null; }
    }).catch((e) => {
      if (!alive) return;
      setError(String(e));
      if (selected.startsWith("c-")) {
        removeSavedArea(selected);
        setCustoms((c) => c.filter((x) => x.id !== selected));
        if (module === "econ" || module === "haz") {
          const deadSites = prof.sites[module].filter((x) => x.region === selected);
          for (const ds of deadSites) prof.removeSite(module, ds.id);
        }
      }
      setSelected(null);
      setSiteId(null);
    });
    return () => { alive = false; };
  }, [selected]);

  useEffect(() => {
    if (!region) return;
    setView(viewsFor(region, module).observed[0]);
    if (module === "vis") { setStage("globe"); return; }
    const id = setTimeout(() => setStage("map"), 1700);
    return () => clearTimeout(id);
  }, [region, module]);

  const entry = catalog.find((r) => r.id === selected) ?? null;
  const list = catalog.filter((r) => r.modules.includes(module));
  const mod = MODULES.find((m) => m.id === module)!;

  const assist = module !== "vis", lang = prof.lang, theme = prof.theme;
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  const job = JOBS.find((j) => j.id === prof.job) ?? null;
  const assistList = module === "econ" ? (job ? list.filter((c) => job.scenarios.includes(c.scenario)) : []) : list;
  const sites = assist ? prof.sites[module].filter((x) => module === "haz" || assistList.some((c) => c.id === x.region)) : [];
  const site = sites.find((x) => x.id === siteId) ?? null;
  const step: Step = module === "econ" && !job ? "who" : site && !adding ? "card" : selected ? "site" : "where";
  useEffect(() => { if (assist && !adding && !site && sites.length && !error) setSiteId(sites[0].id); }, [assist, adding, site, sites, error]);
  useEffect(() => { if (assist && site && !adding && selected !== site.region) setSelected(site.region); }, [assist, site, adding, selected]);
  useEffect(() => {
    if (assist && site && !adding && region?.manifest.id === site.region) { setPolygon(site.poly); setPolyName(site.name); }
  }, [assist, site, adding, region]);
  useEffect(() => { if (assist && step === "site" && region && mode === null) { setStage("map"); setMode("point"); } }, [assist, step, region, mode]);
  const createSite = (poly: LonLat[], name?: string) => {
    if (!selected) return;
    if (entry && coverage(poly, entry.bbox) < 0.5) { setMode(null); setPrep({ poly }); return; }
    const base = tr(module === "econ" && job ? job.mine : HOME.mine, lang), n = sites.length;
    const id = Date.now().toString(36);
    prof.addSite(module, { id, region: selected, name: name ?? (n ? num(`${base} ${n + 1}`, lang) : base), poly });
    setSiteId(id); setAdding(false); setMode(null);
  };
  const siteStep = assist && step === "site";
  const needMap = assist && (siteStep || mode !== null || !!edit || mapOpen);
  useEffect(() => { setMapOpen(false); }, [module, siteId]);
  useEffect(() => { // when the map appears on a phone, bring it into view
    if (needMap && matchMedia("(max-width: 900px)").matches) scrollTo({ top: 0, behavior: "smooth" });
  }, [needMap]);
  const startEdit = () => {
    const poly = assist ? site?.poly : polygon;
    if (!poly) return;
    setEdit({ orig: poly, hist: [] }); setPolygon(poly); setStage("map"); setMode(null); setLine(null);
  };
  const saveEdit = () => {
    if (!edit || !polygon) return;
    if (assist && site) prof.updateSite(module, site.id, { poly: polygon });
    else setPolyName("Your area");
    setEdit(null);
    if (entry && coverage(polygon, entry.bbox) < 0.5) setPrep({ poly: polygon });
  };
  const cancelEdit = () => { if (edit) setPolygon(edit.orig); setEdit(null); };
  useEffect(() => { setEdit(null); }, [selected, module]);
  useEffect(() => {
    if (assist && step === "site" && region && autoSite.current && region.manifest.id === selected) { const q = autoSite.current; autoSite.current = null; createSite(q); }
  });

  const scenarioFor = (): Scenario => prep?.scenario ?? (module === "econ" && job ? job.scenarios[0] : module === "vis" && region ? region.manifest.scenario : "flood");
  const bgBusy = !!bg && !bg.ready && !bg.error && bg.job.state !== "failed";
  const startPrep = async () => {
    if (!prep || bgBusy) return;
    const poly = prep.poly, name = assist ? tr(module === "econ" && job ? job.mine : HOME.mine, lang) : "Your area";
    setPrep({ ...prep, error: undefined, watching: true });
    setBg({ poly, module, job: { id: "", state: "queued", stage: "Sending" } });
    try { const e = region?.manifest.epochs, win = !assist && e?.length ? [e[0], e[e.length - 1]] as [string, string] : undefined;
      const j = await requestArea(poly, scenarioFor(), name, win); setBg((b) => b && { ...b, job: j }); }
    catch (e) { setBg(null); setPrep((q) => q && { ...q, watching: false, error: e instanceof TypeError ? tr(UI.offline, lang) : String((e as Error).message ?? e) }); }
  };
  const bgId = bg?.job.id, bgState = bg?.job.state;
  useEffect(() => {
    if (!bgId || bgState === "failed" || bgState === "done") return;
    let alive = true, misses = 0, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await areaStatus(bgId);
        if (!alive) return;
        misses = 0;
        if (j.state === "done" && j.entry) {
          const { sources: src, ...e } = j.entry;
          rememberArea(e);
          setCustoms((c) => [...c.filter((x) => x.id !== e.id), e]);
          if (src) setSources((s) => ({ ...src, ...s }));
          setBg((b) => b && { ...b, job: j, ready: e });
          return;
        }
        const err = j.state === "failed" ? j.error ?? "failed" : j.state === "unknown" ? tr(UI.prepLost, lang) : undefined;
        setBg((b) => b && { ...b, job: j, error: err });
        if (!err) timer = setTimeout(tick, 2500);
      } catch {
        if (!alive) return;
        if (++misses >= 8) setBg((b) => b && { ...b, error: tr(UI.offline, lang) }); // backend gone for ~30 s
        else timer = setTimeout(tick, 4000);
      }
    };
    timer = setTimeout(tick, 1500);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgId, bgState]);
  /** Open a finished area: in EconAssist / HazAssist it becomes a saved site; in VisAssist the drawn shape is analysed. */
  const openArea = (e: CatalogEntry, poly: LonLat[]) => {
    const m = e.modules.includes(module) ? module : e.modules[0];
    if (m !== "vis") { autoSite.current = poly; setAdding(true); } else pending.current = poly;
    setBg(null); setPrep(null); setModule(m); setSelected(e.id);
  };
  // still watching the card when it finishes: open straight away; otherwise the floating pill offers "Open"
  useEffect(() => {
    if (bg?.ready && prep?.watching) openArea(bg.ready, bg.poly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bg?.ready, prep?.watching]);

  const switchModule = (m: ModuleId) => {
    setModule(m); setSiteId(null); setAdding(false); setMode(null); if (entry && !entry.modules.includes(m)) setSelected(null);
    if (prep?.watching && bgBusy) setPrep(null); // the build keeps going; its progress moves to the floating pill
  };
  const choose = useCallback((id: string) => {
    const r = catalog.find((c) => c.id === id);
    if (r && !r.modules.includes(module)) setModule(r.modules[0]);
    setSelected(id);
  }, [catalog, module]);
  const nearest = useCallback((ll: LonLat) => catalog.map((c) => ({ c, km: kmBetween(ll, c.center) })).sort((a, b) => a.km - b.km), [catalog]);

  const placePin = useCallback((ll: LonLat) => {
    setPin(ll); setNotice(null);
    const pool = assist ? assistList : catalog;
    const hit = pool.find((c) => inBBox(ll, c.bbox));
    if (hit) choose(hit.id);
    else if (assist && pool.length) {
      const nn = pool.map((c) => ({ c, km: kmBetween(ll, c.center) })).sort((a, b) => a.km - b.km)[0];
      setNotice(`${tr(UI.noData, lang)} ${nn.c.place} (${Math.round(nn.km).toLocaleString()} km)`);
      const d = 0.004; // ~400 m square around the spot
      setPrep({ poly: [[ll[0] - d, ll[1] + d], [ll[0] + d, ll[1] + d], [ll[0] + d, ll[1] - d], [ll[0] - d, ll[1] - d]] });
    }
  }, [catalog, choose, assist, assistList, lang]);
  const locate = () => {
    if (!navigator.geolocation) { setNotice("Location is not available in this browser."); return; }
    setNotice("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (p) => placePin([p.coords.longitude, p.coords.latitude]),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setNotice("Location blocked by system. On macOS, ensure Google Chrome is enabled in System Settings > Privacy & Security > Location Services.");
        } else if (err.code === err.TIMEOUT) {
          setNotice("Location request timed out. Tap the globe to pin a spot instead.");
        } else {
          setNotice("Location fix unavailable (no Wi-Fi/GPS fix). Tap the globe to pin a spot instead.");
        }
      },
      { timeout: 15000, enableHighAccuracy: false, maximumAge: 300000 }
    );
  };
  /** Onboarding answered "who" and "where": start getting that place ready while the remaining slides play. */
  const onboardPlace = (c: OnboardChoice) => {
    setOnbFallback(false); setPrep(null); setNotice(null); setPin(null); setMode(null); setSiteId(null);
    setModule(c.module);
    if (c.module === "econ") prof.setJob(c.job);
    const jd = JOBS.find((j) => j.id === c.job), simple = c.module !== "vis";
    const pool = catalog.filter((r) => r.modules.includes(c.module) && (!jd || jd.scenarios.includes(r.scenario)));
    if (c.region) { onbFrom.current = null; setAdding(simple); setSelected(c.region); return; }
    if (!c.ll) return;
    const ll = c.ll, d = 0.003, sq: LonLat[] = [[ll[0] - d, ll[1] + d], [ll[0] + d, ll[1] + d], [ll[0] + d, ll[1] - d], [ll[0] - d, ll[1] - d]];
    onbFrom.current = { ll, pool };
    setPin(ll);
    const hit = pool.find((r) => inBBox(ll, r.bbox));
    if (hit) { if (simple) { autoSite.current = sq; setAdding(true); } else pending.current = sq; setSelected(hit.id); return; }
    // outside every prepared region: build this place on demand from free satellite data
    const scenario: Scenario = jd ? jd.scenarios[0] : "flood";
    setSelected(null);
    setPrep({ poly: sq, scenario, watching: true });
    setBg({ poly: sq, module: c.module, job: { id: "", state: "queued", stage: "Sending" } });
    requestArea(sq, scenario, simple ? tr(jd ? jd.mine : HOME.mine, lang) : "Your area")
      .then((j) => setBg((b) => b && { ...b, job: j }))
      .catch(() => { setBg(null); setPrep((q) => q && { ...q, watching: false, error: "offline" }); });
  };
  const prepError = prep?.error ?? (prep?.watching ? bg?.error : undefined);
  useEffect(() => { // preparing failed during onboarding: fall back to the nearest place we already have
    if (!onboard || !prepError || !onbFrom.current) return;
    const { ll, pool } = onbFrom.current, nn = pool.map((r) => ({ r, km: kmBetween(ll, r.center) })).sort((a, b) => a.km - b.km)[0];
    onbFrom.current = null; setPrep(null); setBg(null); setOnbFallback(true);
    if (nn) { setAdding(module !== "vis"); setSelected(nn.r.id); }
  }, [onboard, prepError, module]);

  const finishGlobe = (poly: LonLat[]) => {
    setMode(null); setGlobeDraft([]);
    const c = [poly.reduce((a, q) => a + q[0], 0) / poly.length, poly.reduce((a, q) => a + q[1], 0) / poly.length] as LonLat;
    const hit = catalog.find((r) => poly.some((q) => inBBox(q, r.bbox)) || pointInPolygon(r.center, poly) || inBBox(c, r.bbox));
    if (!hit) { setPrep({ poly }); return; }
    if (hit.id === selected && region) { setPolygon(poly); setPolyName("Your area"); } else { pending.current = poly; choose(hit.id); }
  };
  const onSurface = (ll: LonLat, closes: boolean) => {
    if (mode === "area" && stage === "globe") {
      if (closes && globeDraft.length >= 3) { finishGlobe(globeDraft); return; }
      setGlobeDraft([...globeDraft, ll]);
      return;
    }
    if (!selected) placePin(ll);
  };
  const startArea = () => {
    if (mode === "area") { setMode(null); setGlobeDraft([]); return; }
    setPolygon(null); setPolyName(null); setLine(null); setGlobeDraft([]); setNotice(null); setMode("area");
  };
  const startLine = () => {
    if (mode === "line") { setMode(null); return; }
    setLine(null); setPolygon(null); setPolyName(null); setStage("map"); setMode("line");
  };

  const onbProgress: OnboardProgress = onbFallback ? { state: "fallback" }
    : prep?.watching && bg && !prepError ? { state: "working", stage: bg.job.position ? `#${bg.job.position}` : bg.job.stage }
    : !selected || (region?.manifest.id === selected && !autoSite.current) ? { state: "ready" } : { state: "working" };

  const rep = useMemo(() => (region && polygon ? report(region, t, polygon, lang) : null), [region, t, polygon, lang]);
  const indicators = useMemo(() => (region ? regionIndicators(region, t) : []), [region, t]);
  const views = region ? viewsFor(region, module) : { observed: [], preview: [] };
  const canSwipe = views.observed.includes("lband");
  const profile = useMemo(() => (region && line ? transect(region, view, t, line[0], line[1]) : null), [region, line, view, t]);
  const marks = useMemo(() => {
    const out: { ll: LonLat; label: string }[] = [];
    if (rep?.maxAt) out.push({ ll: rep.maxAt.ll, label: `${rep.maxAt.value > 0 ? "+" : ""}${num(rep.maxAt.value.toFixed(1), lang)} ${lang === "bn" ? "সেমি" : "cm"}` });
    region?.manifest.quakes.filter((q) => q.mag >= 6).slice(0, 3).forEach((q) => out.push({ ll: [q.lon, q.lat], label: `M${num(q.mag.toFixed(1), lang)}` }));
    return out;
  }, [rep, region, lang]);

  return (
    <div className={`app ${assist ? (needMap ? "m-map" : "m-text") : bigGlobe ? "m-vis m-big" : "m-vis"}`} data-theme={theme} lang={lang}>
      <header className="top">
        <div className="brand"><span className="logo" aria-hidden /><span className="wordmark">SARsight</span></div>
        <nav className="tabs desktop-only">
          {MODULES.map((m) => <button key={m.id} className={m.id === module ? "tab on" : "tab"} onClick={() => switchModule(m.id)}>{tr(m.name, lang)}</button>)}
        </nav>
        <div className="top-right">
          <button className="pill lang" onClick={() => prof.setLang(lang === "en" ? "bn" : "en")} lang={lang === "en" ? "bn" : "en"}>{lang === "en" ? "বাংলা" : "English"}</button>
          <button
            className="pill"
            onClick={() => prof.setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? tr(UI.themeLight, lang) : tr(UI.themeDark, lang)}
            title={theme === "dark" ? tr(UI.themeLight, lang) : tr(UI.themeDark, lang)}
          >
            <span className="pill-icon"><Icon name={theme === "dark" ? "sun" : "moon"} size={16} /></span>
            <span className="pill-text with-icon">
              <Icon name={theme === "dark" ? "sun" : "moon"} size={14} />
              {theme === "dark" ? tr(UI.themeLight, lang) : tr(UI.themeDark, lang)}
            </span>
          </button>
          <button className="pill" onClick={() => setOnboard(true)} aria-label={tr(ONBOARD.replay, lang)} title={tr(ONBOARD.replay, lang)}><span className="pill-icon">?</span><span className="pill-text">{tr(ONBOARD.replay, lang)}</span></button>
          <button className="pill mono" onClick={() => setShowSources(true)} aria-label={lang === "bn" ? "উপাত্তের উৎস" : "Data sources"} title={lang === "bn" ? "উপাত্তের উৎস" : "Data sources"}><span className="pill-icon">i</span><span className="pill-text">{lang === "bn" ? "উপাত্তের উৎস" : "DATA SOURCES"}</span></button>
        </div>
      </header>

      <main className="stage">
        <div className="globe-wrap">
          <Globe catalog={catalog} selected={selected} region={region} view={view} t={t} onSelect={choose} onSurface={onSurface}
            drawing={mode === "area" && stage === "globe"} draft={globeDraft} polygon={stage === "globe" ? polygon : null}
            pin={pin} satellite={satellite} labels={labels} opacity={opacity} theme={theme} />
        </div>
        {stage === "map" && region && (
          <div className="map-wrap">
            <RegionMap region={region} view={view} t={t} mode={mode} polygon={polygon} line={line}
              satellite={satellite} labels={labels} lang={lang} fit={fitTick} opacity={opacity} compare={compare && canSwipe ? (view === "lband" ? "vv" : "lband") : null}
              overlay={overlay ? { url: overlay.browse!, footprint: overlay.footprint } : null}
              onPolygon={(q) => { if (siteStep) createSite(q, module === "haz" ? num(`${tr(["Area", "এলাকা"], lang)} ${sites.length + 1}`, lang) : undefined); else { setMode(null); if (coverage(q, region.manifest.bbox) === 0) { setPrep({ poly: q }); return; } setPolygon(q); setPolyName("Your area"); } }}
              onPoint={(ll) => { if (siteStep) createSite(squareAround(region, ll, job?.id === "fisher" ? 5 : 1.5)); }}
              hint={edit ? tr(UI.editHint, lang) : siteStep ? (mode === "area" ? tr(UI.finishHint, lang) : tr(module === "econ" && job ? job.tap : HOME.tap, lang)) : undefined}
              onLine={(l) => { setLine(l); setMode(null); }} marks={marks}
              highlight={polyName ? region.manifest.features.find((f) => f.name === polyName)?.id : null}
              showFeatures={!assist}
              edit={edit ? { onStart: () => setEdit((e) => e && polygon ? { ...e, hist: [...e.hist, polygon] } : e), onChange: setPolygon } : null}
              onFeature={(id) => { if (edit) return; const f = region.manifest.features.find((x) => x.id === id)!;  setPolygon(f.polygon); setPolyName(f.name); }} />
          </div>
        )}
        <div className="stage-switch">
          {region && <button className={stage === "globe" ? "on" : ""} onClick={() => { setStage("globe"); if (mode === "line") setMode(null); }} aria-label={lang === "bn" ? "গ্লোব ভিউ" : "Globe view"} title={lang === "bn" ? "গ্লোব" : "Globe"}><Icon name="globe" /></button>}
          {region && <button className={stage === "map" ? "on" : ""} onClick={() => { setStage("map"); setGlobeDraft([]); }} aria-label={lang === "bn" ? "ম্যাপ ভিউ" : "Map view"} title={lang === "bn" ? "ম্যাপ" : "Map"}><Icon name="map" /></button>}
          <button className={satellite ? "on" : ""} onClick={() => setSatellite(!satellite)} aria-label={lang === "bn" ? "স্যাটেলাইট বেসম্যাপ" : "Satellite basemap"} title={lang === "bn" ? "স্যাটেলাইট বেসম্যাপ" : "Satellite basemap"}><Icon name="sat" /></button>
          <button className={labels ? "on" : ""} onClick={() => setLabels(!labels)} aria-label={tr(UI.labels, lang)} title={tr(UI.labels, lang)}><Icon name="label" /></button>
        </div>
        {edit && stage === "map" && (
          <div className="editbar">
            <button className="chip" disabled={!edit.hist.length} onClick={() => { const h = [...edit.hist], last = h.pop()!; setEdit({ ...edit, hist: h }); setPolygon(last); }}><Icon name="undo" size={18} />{tr(UI.undo, lang)}</button>
            <button className="chip" onClick={cancelEdit}><Icon name="close" size={18} />{tr(UI.cancel, lang)}</button>
            <button className="chip on" onClick={saveEdit}><Icon name="check" size={18} />{tr(UI.save, lang)}</button>
          </div>
        )}
        {region && !assist && !edit && (
          <div className="stage-bottom">
            <Scrubber epochs={region.manifest.epochs} t={t} onT={setT} playing={playing} onPlaying={setPlaying} event={region.manifest.event} sub={lang === "bn" ? "সেন্টিনেল-১ পাস" : "Sentinel-1 pass"} lang={lang} />
          </div>
        )}
        {satellite && stage === "globe" && <div className="attrib mono">{lang === "bn" ? "স্যাটেলাইট ছবি © Esri, Maxar, Earthstar Geographics" : "Imagery © Esri, Maxar, Earthstar Geographics"}</div>}
        {mode === "area" && stage === "globe" && <div className="maphint floating">{globeDraft.length < 3 ? (lang === "bn" ? "কোণ যোগ করতে গ্লোবে চাপুন" : "Tap the globe to add corners") : (lang === "bn" ? "প্রথম কোণে চাপুন, অথবা সম্পন্ন করুন" : "Tap the first corner, or Finish")}</div>}
        {assist && mapOpen && !siteStep && !edit && !mode && (
          <button className="pill stage-pill mobile-only" onClick={() => setMapOpen(false)}><Icon name="close" size={16} />{tr(UI.hideMap, lang)}</button>
        )}
        {!assist && (
          <button className="iconbtn stage-grow mobile-only" onClick={() => setBigGlobe(!bigGlobe)} aria-label={tr(bigGlobe ? UI.shrink : UI.grow, lang)}>
            <Icon name={bigGlobe ? "shrink" : "grow"} size={20} />
          </button>
        )}
        {!selected && !mode && <div className="stage-hint mono desktop-only">{lang === "bn" ? "ঘুরিয়ে দেখতে ড্র্যাগ করুন · মার্কার বা ভূমিতে ট্যাপ করে পিন করুন" : "Drag to spin · tap a marker · tap land to pin"}</div>}
      </main>

      <aside className="panel" ref={panelRef}>
        {error && <div className="error"><span>{error}</span><button className="iconbtn small" onClick={() => setError(null)} aria-label={lang === "bn" ? "বাতিল" : "Dismiss"}><Icon name="close" size={16} /></button></div>}
        {prep && <PrepareCard job={prep.watching ? bg?.job : undefined} error={prepError} busy={bgBusy && !prep.watching} lang={lang} pickScenario={module === "vis"} scenario={scenarioFor()}
          onScenario={(sc) => setPrep({ ...prep, scenario: sc })} onGo={startPrep}
          onCancel={() => { if (prep.watching && !bgBusy) setBg(null); setPrep(null); }} />}
        {notice && <div className="notice">{notice}<button className="iconbtn small" onClick={() => setNotice(null)} aria-label={lang === "bn" ? "বাতিল" : "Dismiss"}><Icon name="close" size={16} /></button></div>}
        {mode === "area" && stage === "globe" && (
          <div className="drawbar">
            <span>{num(String(globeDraft.length), lang)} {lang === "bn" ? "টি কোণ" : (globeDraft.length === 1 ? "corner" : "corners")}</span>
            <button className="chip" disabled={!globeDraft.length} onClick={() => setGlobeDraft(globeDraft.slice(0, -1))} aria-label={lang === "bn" ? "ফেরান" : "Undo"}><Icon name="undo" size={18} /></button>
            <button className="chip on" disabled={globeDraft.length < 3} onClick={() => finishGlobe(globeDraft)}><Icon name="check" size={18} /> {lang === "bn" ? "সম্পন্ন" : "Finish"}</button>
          </div>
        )}
        {assist ? (
          <Assist lang={lang} module={module} step={step} job={prof.job} onJob={(j) => { prof.setJob(j); setSiteId(null); if (j) setSelected(null); }}
            list={assistList} onChoose={choose} onLocate={locate} onPlace={placePin} entry={entry} region={region} t={t} setT={setT}
            site={site && edit && polygon ? { ...site, poly: polygon } : site} sites={sites} onSite={(id) => { setEdit(null); setSiteId(id); setAdding(false); }}
            crossSites={module === "econ" ? prof.sites.haz.filter((s) => catalog.some((c) => c.id === s.region)) : module === "haz" ? prof.sites.econ.filter((s) => catalog.some((c) => c.id === s.region)) : []}
            onEdit={startEdit} editing={!!edit} onMap={() => { setMapOpen(true); setStage("map"); setFitTick((x) => x + 1); }} onRename={(name) => site && prof.updateSite(module, site.id, { name })}
            onAdd={() => { setAdding(true); setMode(null); setSelected(null); }}
            onRemove={(id) => { prof.removeSite(module, id); setSiteId(null); setPolygon(null); setPolyName(null); if (sites.length <= 1) setSelected(null); }}
            drawMode={mode === "area" ? "area" : mode === "point" ? "point" : null} onDrawMode={(m) => { setStage("map"); setMode(m); }}
            onCheckArea={() => { setAdding(true); setPolygon(null); setPolyName(null); setStage("map"); setMode("area"); }}
            onCancel={adding && sites.length ? () => { setAdding(false); setMode(null); } : step === "site" ? () => { setMode(null); setSelected(null); } : null}
            detail={region && (<>
              {rep && <ReportCard rep={rep} name={polyName} region={region} t={t} onClose={() => {}} lang={lang} />}
              <Drivers region={region} t={t} lang={lang} />
              <StoryCard id={region.manifest.id} lang={lang} />
            </>)}
            error={error} />
        ) : !entry ? (
          <>
            <div className="intro">
              <div className="eyebrow mono">{tr(mod.tag, lang)}</div>
              <h1>{tr(mod.name, lang)}</h1>
              <p>{tr(mod.blurb, lang)}</p>
            </div>
            <div className="row2">
              <button className="action" onClick={locate}><Icon name="locate" /> {lang === "bn" ? "আমার অবস্থান" : "Use my location"}</button>
              <button className={mode === "area" ? "action on" : "action ghost"} onClick={() => { setStage("globe"); startArea(); }}><Icon name={mode === "area" ? "close" : "pen"} /> {mode === "area" ? (lang === "bn" ? "বাতিল" : "Cancel") : (lang === "bn" ? "এলাকা আঁকুন" : "Draw area")}</button>
            </div>
            <PlaceSearch lang={lang} onPick={(q) => placePin(q.ll)} />
            {pin && (
              <div className="pincard">
                <div className="eyebrow mono">{lang === "bn" ? "পিন করা হয়েছে" : "Pinned"} · {fmtLL(pin, lang)}</div>
                <ul>
                  {nearest(pin).slice(0, 3).map(({ c, km }) => (
                    <li key={c.id}><button onClick={() => choose(c.id)}><Icon name={scenarioIcon[c.scenario]} size={20} /><b>{rName(c, lang)}</b><span className="mono dim">{km < 1 ? (lang === "bn" ? "এখানে" : "here") : `${num(String(Math.round(km)), lang)} ${lang === "bn" ? "কিমি" : "km"}`}</span></button></li>
                  ))}
                </ul>
              </div>
            )}
            {(() => {
              const allSaved = [...prof.sites.econ, ...prof.sites.haz].filter(
                (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i && catalog.some((c) => c.id === s.region)
              );
              if (!allSaved.length) return null;
              return (
                <div className="saved-places">
                  <div className="eyebrow mono">{lang === "bn" ? "সংরক্ষিত জায়গা" : "My saved places"}</div>
                  <ul>
                    {allSaved.map((s) => {
                      const cat = catalog.find((c) => c.id === s.region)!;
                      return (
                        <li key={s.id}>
                          <button onClick={() => { choose(s.region); setPolygon(s.poly); setPolyName(s.name); }}>
                            <Icon name={scenarioIcon[cat.scenario]} size={20} />
                            <b>{s.name}</b>
                            <span className="mono dim">{rName(cat, lang)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
            <ul className="regions">
              {list.map((r) => (
                <li key={r.id}>
                  <button onClick={() => choose(r.id)}>
                    <span className="ricon"><Icon name={scenarioIcon[r.scenario]} size={26} /></span>
                    <span className="rtext"><b>{rName(r, lang)}</b><small>{rPlace(r, lang)} · {rCountry(r, lang)}{r.nisarPasses ? <em className="nisar-tag"> · {num(String(r.nisarPasses), lang)} {lang === "bn" ? "নিসার পাস" : "NISAR passes"}</em> : null}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="rhead">
              <button className="iconbtn" onClick={() => setSelected(null)} aria-label={lang === "bn" ? "তালিকায় ফিরুন" : "Back to list"}><Icon name="back" /></button>
              <div>
                <div className="eyebrow mono">{tr(mod.name, lang)} · {rPlace(entry, lang)}</div>
                <h2>{rName(entry, lang)}</h2>
              </div>
            </div>

            {!region ? <div className="loading mono">{lang === "bn" ? "রাডার পাস পড়া হচ্ছে…" : "Reading radar passes…"}</div> : (
              <>
                {rep && polygon && coverage(polygon, region.manifest.bbox) < 0.95 && (
                  <div className="notice partial">{tr(UI.partial, lang)}<button className="chip" onClick={() => setPrep({ poly: polygon })}>{tr(UI.prepWhole, lang)}</button></div>
                )}
                {rep ? <ReportCard rep={rep} name={polyName} region={region} t={t} onEdit={edit ? undefined : startEdit} onClose={() => { cancelEdit(); setPolygon(null); setPolyName(null); }} lang={lang} />
                  : <Indicators items={indicators} lang={lang} />}
                {profile && line && <ProfileCard p={profile} region={region} view={view} onClose={() => setLine(null)} lang={lang} />}
                {region.manifest.scenario === "agriculture" && (
                  <Plots region={region} t={t} active={polyName} onPick={(f) => { setPolygon(f.polygon); setPolyName(f.name); setStage("map"); }} lang={lang} />
                )}

                <div className="row2">
                  <button className={mode === "area" ? "action on" : "action"} onClick={startArea}><Icon name={mode === "area" ? "close" : "pen"} />{mode === "area" ? (lang === "bn" ? "বাতিল" : "Cancel") : (lang === "bn" ? "এলাকা পরীক্ষা" : "Check an area")}</button>
                  <button className={mode === "line" ? "action on" : "action ghost"} onClick={startLine}><Icon name={mode === "line" ? "close" : "ruler"} />{mode === "line" ? (lang === "bn" ? "বাতিল" : "Cancel") : (lang === "bn" ? "প্রোফাইল" : "Profile")}</button>
                </div>

                <section className="layers">
                  <LayerGroup title={lang === "bn" ? "পর্যবেক্ষিত উপাত্ত" : "Observed"} views={views.observed} view={view} setView={setView} region={region} lang={lang} />
                  {views.preview.length > 0 && <LayerGroup title={lang === "bn" ? "নিসার প্রিভিউ" : "NISAR preview"} hint={lang === "bn" ? "প্রকৃত পাসের তারিখে সিমুলেটেড ইনসার — নিসার GUNW উপাত্ত পেলে প্রতিস্থাপিত হবে" : "Simulated InSAR on real pass dates — replaced when NISAR GUNW data is fetched"} views={views.preview} view={view} setView={setView} region={region} preview lang={lang} />}
                  <Legend region={region} view={view} sources={sources} lang={lang} />
                  {canSwipe && (
                    <button className={compare ? "chip on wide" : "chip wide"} onClick={() => { setCompare(!compare); setStage("map"); if (view !== "vv" && view !== "lband") setView("vv"); }}>
                      <Icon name="swap" size={18} /> {lang === "bn" ? "সি-ব্যান্ড ↔ এল-ব্যান্ড সোয়াইপ" : "Swipe C-band ↔ L-band"}
                    </button>
                  )}
                  {satellite && (
                    <label className="opacity"><span className="mono dim">{lang === "bn" ? "রাডার স্বচ্ছতা" : "Radar opacity"}</span>
                      <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
                    </label>
                  )}
                </section>

                <Drivers region={region} t={t} lang={lang} />
                <StoryCard id={region.manifest.id} lang={lang} />
                <NisarPasses region={region} passes={region.manifest.nisar} active={overlay?.id ?? null} onPick={(p) => { setOverlay(overlay?.id === p.id ? null : p); setStage("map"); }} lang={lang} />
              </>
            )}
          </>
        )}
      </aside>

      <nav className="bottomnav mobile-only">
        {MODULES.map((m) => (
          <button key={m.id} className={m.id === module ? "on" : ""} onClick={() => switchModule(m.id)}>
            <Icon name={m.id === "econ" ? "leaf" : m.id === "haz" ? "quake" : "globe"} /><span>{lang === "bn" ? { econ: "জীবিকা", haz: "দুর্যোগ", vis: "অন্বেষণ" }[m.id] : m.name[0].replace("Assist", "")}</span>
          </button>
        ))}
      </nav>

      {bg && !prep?.watching && <PrepPill bg={bg} lang={lang} onShow={() => setPrep({ poly: bg.poly, watching: true })}
        onOpen={() => bg.ready && openArea(bg.ready, bg.poly)} onDismiss={() => setBg(null)} />}

      {showSources && <SourcesSheet sources={sources} onClose={() => setShowSources(false)} lang={lang} />}
      {onboard && <Onboarding lang={lang} setLang={prof.setLang} catalog={catalog} progress={onbProgress} onPlace={onboardPlace} onDone={finishOnboard} />}
    </div>
  );
}

/** Fraction of a polygon's area that lies inside a bbox (sampled on a 24x24 grid). */
function coverage(poly: LonLat[], [w, s, e, n]: CatalogEntry["bbox"]) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let inPoly = 0, inBoth = 0;
  for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++) {
    const p: LonLat = [x0 + ((i + 0.5) / 24) * (x1 - x0), y0 + ((j + 0.5) / 24) * (y1 - y0)];
    if (!pointInPolygon(p, poly)) continue;
    inPoly++; if (p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n) inBoth++;
  }
  return inPoly ? inBoth / inPoly : 0;
}

type BgJob = { poly: LonLat[]; module: ModuleId; job: AreaJob; error?: string; ready?: CatalogEntry };
const BG_KEY = "sarsight.prepJob";
function loadBg(): BgJob | null {
  try { const b = JSON.parse(localStorage.getItem(BG_KEY) ?? "null") as BgJob | null; return b?.job?.id ? b : null; } catch { return null; }
}

const PREP_SCENARIOS: { id: Scenario; label: [string, string] }[] = [
  { id: "flood", label: ["Floods", "বন্যা"] }, { id: "agriculture", label: ["Farming", "কৃষি"] }, { id: "subsidence", label: ["Ground motion", "মাটির গতিবিধি"] }, { id: "marine", label: ["Coast & sea", "উপকূল ও সাগর"] },
];

function PrepareCard({ job, error, busy, lang, pickScenario, scenario, onScenario, onGo, onCancel }: {
  job?: AreaJob; error?: string; busy: boolean; lang: "en" | "bn"; pickScenario: boolean; scenario: Scenario;
  onScenario: (s: Scenario) => void; onGo: () => void; onCancel: () => void;
}) {
  const L = (x: [string, string]) => tr(x, lang);
  const running = !!job && job.state !== "failed" && !error, p = prepProgress(job?.stage, job?.position, lang);
  return (
    <div className={`prepare${running ? " running" : ""}`}>
      <div className="prepare-head">
        <b>{running ? L(UI.prepWait) : error ? <><span className="fail" aria-hidden>✕ </span>{L(UI.prepFail)}</> : L(UI.prepTitle)}</b>
        <button className="iconbtn small" onClick={onCancel} aria-label={running ? L(UI.prepBg) : L(UI.cancel)}><Icon name="close" size={18} /></button>
      </div>
      {running ? (
        <>
          <ProgressBar pct={p.pct} />
          <div className="prepare-stage"><span className="small mono">{p.text}</span><b className="mono">{num(`${p.pct}%`, lang)}</b></div>
          <p className="dim small">{L(UI.prepBg)}</p>
        </>
      ) : (
        <>
          <p className="dim">{error ?? (busy ? L(UI.prepBusy) : L(UI.prepBody))}</p>
          {pickScenario && !error && !busy && (
            <div className="chips tight">{PREP_SCENARIOS.map((x) => <button key={x.id} className={x.id === scenario ? "chip on" : "chip"} onClick={() => onScenario(x.id)}>{tr(x.label, lang)}</button>)}</div>
          )}
          <button className="action" onClick={onGo} disabled={busy}><Icon name="sat" />{error ? L(UI.retry) : L(UI.prepGo)}</button>
        </>
      )}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return <div className="prepare-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>;
}

/** Floating status for an area being built in the background; visible in every module. */
function PrepPill({ bg, lang, onShow, onOpen, onDismiss }: { bg: BgJob; lang: "en" | "bn"; onShow: () => void; onOpen: () => void; onDismiss: () => void }) {
  const L = (x: [string, string]) => tr(x, lang), p = prepProgress(bg.job.stage, bg.job.position, lang);
  const failed = !!bg.error || bg.job.state === "failed";
  return (
    <div className={`prep-pill ${bg.ready ? "ok" : failed ? "alert" : "busy"}`} role="status">
      {bg.ready ? (
        <><span className="pill-sym" aria-hidden>✓</span><b>{L(UI.prepReady)}</b><button className="chip on" onClick={onOpen}>{L(UI.open)}</button></>
      ) : failed ? (
        <><span className="pill-sym" aria-hidden>✕</span><button className="pill-main" onClick={onShow}><b>{L(UI.prepFail)}</b></button></>
      ) : (
        <button className="pill-main" onClick={onShow}>
          <span className="pill-row"><b>{L(UI.prepWait)}</b><b className="mono">{num(`${p.pct}%`, lang)}</b></span>
          <ProgressBar pct={p.pct} />
          <span className="small mono dim">{p.text}</span>
        </button>
      )}
      {(bg.ready || failed) && <button className="iconbtn small" onClick={onDismiss} aria-label={L(UI.cancel)}><Icon name="close" size={16} /></button>}
    </div>
  );
}

function Dot({ s }: { s: Status }) { return <i className={`dot ${s}`} aria-hidden />; }

function Indicators({ items, lang = "en" }: { items: Indicator[]; lang?: "en" | "bn" }) {
  return (
    <div className="indicators">
      {items.map((i) => (
        <div key={i.key} className={`ind ${i.status}${i.preview ? " preview" : ""}`}>
          <div className="ind-label">
            {lang === "bn" ? (INDICATOR_LABELS_BN[i.key] ?? i.label) : i.label}
            {i.preview && <span className="ptag">{lang === "bn" ? "প্রিভিউ" : "preview"}</span>}
          </div>
          <div className={i.value.length > 6 ? "ind-value small" : "ind-value"}>
            {num(i.value, lang)}<small>{lang === "bn" && i.unit === "cm/yr" ? "সেমি/বছর" : lang === "bn" && i.unit === "m/s" ? "মি/সেকেন্ড" : i.unit}</small>
          </div>
          <div className="ind-word"><Dot s={i.status} />{lang === "bn" ? (INDICATOR_WORDS_BN[i.word] ?? i.word) : i.word}</div>
        </div>
      ))}
    </div>
  );
}

function LayerGroup({ title, hint, views, view, setView, region, preview, lang = "en" }: {
  title: string; hint?: string; views: ViewId[]; view: ViewId; setView: (v: ViewId) => void; region: RegionData; preview?: boolean; lang?: "en" | "bn";
}) {
  return (
    <div className="lgroup">
      <div className="lgroup-head"><span className="mono">{title}</span>{hint && <span className="dim small">{hint}</span>}</div>
      <div className="chips">
        {views.map((v) => <button key={v} className={`chip${v === view ? " on" : ""}${preview ? " pv" : ""}`} onClick={() => setView(v)}>{viewDef(v, region.manifest.scenario, lang, region).short}</button>)}
      </div>
    </div>
  );
}

const SERIES_COLORS = ["#ffb547", "#5fb4ff"];

function ReportCard({ rep, name, region, t, onClose, onEdit, lang = "en" }: {
  rep: Report; name: string | null; region: RegionData; t: number; onClose: () => void; onEdit?: () => void; lang?: "en" | "bn";
}) {
  const e = region.manifest.epochs;
  const areaStr = num(rep.areaKm2 < 10 ? rep.areaKm2.toFixed(1) : String(Math.round(rep.areaKm2)), lang);
  const titleName = name ? (lang === "bn" && name === "Your area" ? "আপনার এলাকা" : name) : (lang === "bn" ? "এলাকা" : "Area");
  return (
    <div className={`report ${rep.risk}`}>
      <div className="report-band">
        <span className="mono">{titleName} · {areaStr} {lang === "bn" ? "বর্গ কিমি" : "km²"}</span>
        <span className="band-btns">
          {onEdit && <button className="iconbtn small" onClick={onEdit} aria-label={lang === "bn" ? "আকার পরিবর্তন" : "Edit shape"} title={lang === "bn" ? "আকার পরিবর্তন" : "Edit shape"}><Icon name="pen" size={16} /></button>}
          <button className="iconbtn small" onClick={onClose} aria-label={lang === "bn" ? "রিপোর্ট বন্ধ" : "Close report"}><Icon name="close" size={18} /></button>
        </span>
      </div>
      <div className="report-risk">{rep.riskWord}</div>
      <div className="report-headline">{rep.headline}</div>
      {rep.series.length > 0 && (
        <div className="report-chart">
          <div className="chart-key">{rep.series.map((s, i) => <span key={`${s.label}-${i}`}><i style={{ background: SERIES_COLORS[i] }} />{s.label}{s.unit && ` (${s.unit})`}</span>)}</div>
          <Chart lines={rep.series.map((s, i) => ({ values: s.values, color: SERIES_COLORS[i], dashed: i > 0 || s.preview }))} independent marker={t} xLabels={[fmtDate(e[0], false, lang), fmtDate(e[e.length - 1], false, lang)]} />
        </div>
      )}
      {rep.prediction && (
        <div className={`report-pred ${rep.prediction.status}`}>
          <div className="pred-top">
            <span className="pred-badge"><Icon name="sparkle" size={14} />{lang === "bn" ? "ভবিষ্যৎ পূর্বাভাস" : "Forward forecast"}</span>
            <span className="mono dim small">{rep.prediction.horizon}</span>
          </div>
          <div className="pred-headline"><b>{rep.prediction.headline}</b></div>
          <p className="pred-detail">{rep.prediction.detail}</p>
        </div>
      )}
      <ul>{rep.sentences.map((s, i) => <li key={`${i}-${s}`}>{s}</li>)}</ul>
    </div>
  );
}

function ProfileCard({ p, region, view, onClose, lang = "en" }: {
  p: ReturnType<typeof transect>; region: RegionData; view: ViewId; onClose: () => void; lang?: "en" | "bn";
}) {
  const def = viewDef(view, region.manifest.scenario, lang, region), e = p.elev.filter(Number.isFinite);
  const finite = p.values.filter(Number.isFinite), span = finite.length ? Math.max(...finite) - Math.min(...finite) : NaN;
  const kmStr = num(p.lengthKm < 10 ? p.lengthKm.toFixed(1) : String(Math.round(p.lengthKm)), lang);
  return (
    <div className="profile">
      <div className="profile-head">
        <div><div className="eyebrow mono">{lang === "bn" ? "প্রোফাইল A → B" : "Profile A → B"}</div><b>{kmStr} {lang === "bn" ? "কিমি" : "km"}</b></div>
        <button className="iconbtn small" onClick={onClose} aria-label={lang === "bn" ? "প্রোফাইল বন্ধ" : "Close profile"}><Icon name="close" size={18} /></button>
      </div>
      <div className="chart-key">
        {e.length > 0 && <span><i style={{ background: "#8a8577" }} />{lang === "bn" ? "ভূপ্রকৃতি" : "Terrain"} {num(String(Math.round(Math.min(...e))), lang)}–{num(String(Math.round(Math.max(...e))), lang)} {lang === "bn" ? "মি" : "m"}</span>}
        <span><i style={{ background: "#ffb547" }} />{def.label}{def.unit && ` (${def.unit})`}</span>
      </div>
      <Chart lines={[{ values: p.values, color: "#ffb547" }, { values: p.elev, color: "#8a8577", area: true }]} independent xLabels={["A", `B · ${kmStr} ${lang === "bn" ? "কিমি" : "km"}`]} height={150} />
      {Number.isFinite(span) && view !== "landcover" && (
        <div className="mono dim">
          {lang === "bn" ? `রেখা বরাবর পরিবর্তন: ${num(span.toFixed(1), lang)} ${def.unit}` : `Change along line: ${span.toFixed(1)} ${def.unit}`}
        </div>
      )}
    </div>
  );
}

function Plots({ region, t, active, onPick, lang = "en" }: { region: RegionData; t: number; active: string | null; onPick: (f: RegionData["manifest"]["features"][number]) => void; lang?: "en" | "bn" }) {
  const rows = useMemo(() => {
    const smi = moistureIndex(region, t), lc = region.layers.landcover;
    return region.manifest.features.filter((f) => f.kind === "plot").map((f) => {
      const m = polygonMask(region, f.polygon);
      let sum = 0, n = 0;
      for (let k = 0; k < m.length; k++) if (m[k] && lc?.[k] === 40 && Number.isFinite(smi[k])) { sum += smi[k]; n++; }
      const v = sum / n, ms: Status = !n ? "watch" : v < 25 ? "alert" : v > 80 ? "watch" : "ok";
      const c = crop(region, t, m);
      return { f, ms, gs: c.status, stage: c.stage };
    });
  }, [region, t]);
  const bLabel = (name: string) => {
    const stripped = name.replace("Block ", "");
    return lang === "bn" ? ({ A: "ক", B: "খ", C: "গ", D: "ঘ" }[stripped] ?? num(stripped, lang)) : stripped;
  };
  return (
    <section className="plots">
      <div className="plots-grid">
        {rows.map(({ f, ms, gs, stage }) => (
          <button key={f.id} className={active === f.name ? "plot on" : "plot"} onClick={() => onPick(f)} title={stage}>
            <span className="plot-n">{bLabel(f.name)}</span>
            <span className={`pi ${ms}`}><Icon name="drop" size={18} /></span>
            <span className={`pi ${stage.startsWith("No") ? "none" : gs}`}><Icon name="sprout" size={18} /></span>
          </button>
        ))}
      </div>
      <div className="plots-key mono">
        <Icon name="drop" size={14} /> {lang === "bn" ? "আর্দ্রতা" : "moisture"}{" "}
        <Icon name="sprout" size={14} /> {lang === "bn" ? "ফসল" : "crop"}{" "}
        <Dot s="ok" /> {lang === "bn" ? "ভালো" : "good"}{" "}
        <Dot s="watch" /> {lang === "bn" ? "সতর্ক" : "watch"}{" "}
        <Dot s="alert" /> {lang === "bn" ? "পদক্ষেপ" : "act"}
      </div>
    </section>
  );
}

function Legend({ region, view, sources, lang = "en" }: { region: RegionData; view: ViewId; sources: Record<string, Source>; lang?: "en" | "bn" }) {
  const def = viewDef(view, region.manifest.scenario, lang, region), [lo, hi] = viewRange(region, view), src = sources[def.source];
  const sw = (c: readonly number[]) => ({ background: `rgb(${c.join(",")})` });
  const credit = src && (
    <div className={`credit${def.preview ? " pv" : ""}`}>
      {def.preview ? (lang === "bn" ? "সিমুলেটেড · " : "Simulated · ") : ""}{src.name} · {src.by}
    </div>
  );
  if (view === "water") {
    const marine = region.manifest.scenario === "marine";
    return (
      <div className="legend">
        <div className="legend inline wrap">
          {marine ? <span><i className="swatch" style={sw(WATER_COLORS.slick)} />{lang === "bn" ? "সমুদ্রের মসৃণ দাগ" : "Dark sea patch"}</span> : (<>
            <span><i className="swatch" style={sw(WATER_COLORS.flood)} />{lang === "bn" ? "প্লাবন জল" : "Flood water"}</span>
            <span><i className="swatch" style={sw(WATER_COLORS.usual)} />{lang === "bn" ? "স্বাভাবিক জল" : "Usual water"}</span>
            <span><i className="swatch" style={sw(WATER_COLORS.vegetation)} />{lang === "bn" ? "নিমজ্জিত গাছপালা" : "Flooded vegetation"}</span></>)}
        </div>
        {credit}
      </div>
    );
  }
  if (view === "landcover") {
    const present = new Set(Array.from(region.layers.landcover ?? []).filter(Number.isFinite));
    return (
      <div className="legend">
        <div className="legend inline wrap">
          {Object.entries(LANDCOVER).filter(([k]) => present.has(+k)).map(([k, c]) => (
            <span key={k}>
              <i className="swatch" style={sw(c.color)} />
              {lang === "bn" ? (LANDCOVER_BN[+k] ?? c.name) : c.name}
            </span>
          ))}
        </div>
        {credit}
      </div>
    );
  }
  const ends: Partial<Record<ViewId, [string, string]>> = {
    deformation: lang === "bn" ? ["দাবছে", "উঠছে"] : ["Sinking", "Rising"],
    nisardisp: lang === "bn" ? ["দূরে", "কাছে"] : ["Away", "Toward"],
    nisarcoh: lang === "bn" ? ["পরিবর্তন", "স্থির"] : ["Changing", "Stable"],
    damage: lang === "bn" ? ["অক্ষত", "পরিবর্তিত"] : ["Intact", "Changed"],
    coherence: lang === "bn" ? ["পরিবর্তন", "স্থির"] : ["Changing", "Stable"],
    change: lang === "bn" ? ["গাঢ়", "উজ্জ্বল"] : ["Darker", "Brighter"],
    phase: ["−π", "+π"],
    wind: lang === "bn" ? ["শান্ত", "ঝড়ো"] : ["Calm", "Storm"],
    vigour: lang === "bn" ? ["অনাবৃত", "ঘন"] : ["Bare", "Dense"],
    elevation: lang === "bn" ? ["নিচু", "উঁচু"] : ["Low", "High"],
    waterhist: lang === "bn" ? ["কখনও নয়", "সর্বদা"] : ["Never", "Always"],
  };
  const [a, b] = ends[view] ?? (lang === "bn" ? ["গাঢ়", "উজ্জ্বল"] : ["Dark", "Bright"]);
  const f = (v: number) => {
    if (view === "phase" || view === "vigour") return "";
    const val = Number.isInteger(v) ? String(v) : v.toFixed(1);
    const u = lang === "bn" && def.unit === "cm/yr" ? "সেমি/বছর" : lang === "bn" && def.unit === "m/s" ? "মি/সেকেন্ড" : def.unit;
    return `${num(val, lang)}${u ? " " + u : ""}`;
  };
  return (
    <div className="legend">
      <div className="ramp" style={{ background: gradientCss(view) }} />
      <div className="legend-ends"><span>{a} <b className="mono">{f(lo)}</b></span><span><b className="mono">{hi > 0 && (view === "deformation" || view === "change" || view === "nisardisp") ? "+" : ""}{f(hi)}</b> {b}</span></div>
      {view === "phase" && <div className="dim small">{lang === "bn" ? "এক রঙ চক্র = স্যাটেলাইটের দিকে বা বিপরীতে ১১.৯ সেমি চলন।" : "One colour cycle = 11.9 cm of motion toward or away from the satellite."}</div>}
      {view === "change" && <div className="dim small">{lang === "bn" ? (region.manifest.event ? "ঘটনার পূর্বের শেষ পাসের তুলনায়।" : "প্রথম পাসের তুলনায়।") : `Compared with ${region.manifest.event ? "the last pass before the event" : "the first pass"}.`}</div>}
      {credit}
    </div>
  );
}

function Drivers({ region, t, lang = "en" }: { region: RegionData; t: number; lang?: "en" | "bn" }) {
  const d = region.manifest.drivers;
  if (!d) return null;
  const e = region.manifest.epochs, i0 = d.dates.indexOf(e[0]), i1 = d.dates.indexOf(e[e.length - 1]);
  if (i0 < 0 || i1 < 0) return null;
  const rain = d.rain_mm.slice(i0, i1 + 1).map((v) => v ?? NaN), wet = d.wetness_top.slice(i0, i1 + 1).map((v) => (v ?? NaN) * 100);
  const marker = d.dates.indexOf(e[t]) - i0, total = rain.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const rainStr = num(String(Math.round(total)), lang);
  return (
    <section className="drivers">
      <div className="sec-head">
        <span className="mono">{lang === "bn" ? "আবহাওয়ার প্রভাব" : "Weather drivers"}</span>
        <span className="dim small">{lang === "bn" ? `নাসা পাওয়ার · এই সময়ে মোট ${rainStr} মিমি বৃষ্টিপাত` : `NASA POWER · ${Math.round(total)} mm rain over the period`}</span>
      </div>
      <div className="chart-key">
        <span><i style={{ background: "#5fb4ff" }} />{lang === "bn" ? "দৈনিক বৃষ্টিপাত (মিমি)" : "Daily rain (mm)"}</span>
        <span><i style={{ background: "#46e3a0" }} />{lang === "bn" ? "মাটির আর্দ্রতা (%)" : "Topsoil wetness (%)"}</span>
      </div>
      <Chart lines={[{ values: rain, color: "#5fb4ff", area: true }, { values: wet, color: "#46e3a0" }]} independent marker={marker} xLabels={[fmtDate(e[0], false, lang), fmtDate(e[e.length - 1], false, lang)]} height={120} />
    </section>
  );
}

function StoryCard({ id, lang = "en" }: { id: string; lang?: "en" | "bn" }) {
  const s = STORIES[id];
  const [open, setOpen] = useState(true);
  if (!s) return null;
  const content = lang === "bn" && s.bn ? s.bn : s;
  return (
    <section className="story">
      <button className="sec-head toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mono">{lang === "bn" ? "প্রেক্ষাপট ও ঘটনা" : "The story"}</span>
        <span className="dim small">{open ? (lang === "bn" ? "লুকান" : "Hide") : (lang === "bn" ? "দেখান" : "Show")}</span>
      </button>
      {open && (
        <div className="story-cards">
          <div><b>{lang === "bn" ? "কী ঘটছে" : "What's happening"}</b><p>{content.what}</p></div>
          <div><b>{lang === "bn" ? "রাডার যেভাবে দেখে" : "How radar sees it"}</b><p>{content.radar}</p></div>
          <div><b>{lang === "bn" ? "নিসার যা যোগ করে" : "What NISAR adds"}</b><p>{content.nisar}</p></div>
          <div className="look"><Icon name="play" size={14} /><p>{content.look}</p></div>
        </div>
      )}
    </section>
  );
}

function NisarPasses({ region, passes, active, onPick, lang = "en" }: { region?: RegionData; passes: NisarPass[]; active: string | null; onPick: (p: NisarPass) => void; lang?: "en" | "bn" }) {
  const nextPass = region ? nextPassSchedule(region) : null;
  if (!passes.length && !nextPass) return (
    <section className="nisar">
      <div className="sec-head">
        <span className="mono">{lang === "bn" ? "নিসার পাস" : "NISAR passes"}</span>
        <span className="dim small">{lang === "bn" ? "এই অঞ্চলে এখনও কোন পাস ক্যাটালগ করা হয়নি" : "None catalogued over this area yet"}</span>
      </div>
    </section>
  );
  const shown = passes.filter((p) => p.browse).slice(0, 6);
  const countStr = num(String(passes.length), lang);
  return (
    <section className="nisar">
      <div className="sec-head">
        <span className="mono">{lang === "bn" ? "নিসার পাস" : "NISAR passes"}</span>
        <span className="dim small">{lang === "bn" ? `${countStr}টি সাম্প্রতিক পাস · এএসএফ (ASF) থেকে সংগৃহীত` : `${passes.length} recent · real quick-looks from ASF`}</span>
      </div>
      {nextPass && (
        <div className="next-pass-banner">
          <span className="next-pass-icon"><Icon name="sparkle" size={16} /></span>
          <span className="next-pass-text">
            <b>{lang === "bn" ? "পরবর্তী উপগ্রহ পাস" : "Next satellite pass"}:</b>{" "}
            {lang === "bn"
              ? `${num(String(nextPass.daysRemaining), lang)} দিন বাকি (${fmtDate(nextPass.nextDate, true, lang)})`
              : `in ${nextPass.daysRemaining} days (${fmtDate(nextPass.nextDate, true, lang)})`}
          </span>
        </div>
      )}
      <div className="passes">
        {shown.map((p) => (
          <button key={p.id} className={active === p.id ? "pass on" : "pass"} onClick={() => onPick(p)} title={p.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.thumb && <img src={p.thumb} alt="" loading="lazy" />}
            <span className="pass-meta">
              <b>{p.level === "GUNW" ? (lang === "bn" ? "ইন্টারফেরোগ্রাম" : "Interferogram") : (lang === "bn" ? "ব্যাকস্ক্যাটার" : "Backscatter")}</b>
              <small className="mono">
                {fmtDate(p.start, true, lang)} · {p.direction === "ASCENDING" ? (lang === "bn" ? "উর্ধ্বমুখী" : "Asc") : (lang === "bn" ? "নিম্নমুখী" : "Desc")} T{num(String(p.track), lang)}
              </small>
            </span>
          </button>
        ))}
      </div>
      <p className="dim small">
        {lang === "bn"
          ? "মানচিত্রে দেখার জন্য যেকোনো পাসে চাপ দিন। পূর্ণ রেজোলিউশনের সায়েন্স উপাত্তের জন্য ফ্রি নাসা আর্থডাটা লগইন প্রয়োজন।"
          : "Tap a pass to drape it on the map. Full-resolution science data needs a free NASA Earthdata login (see README)."}
      </p>
    </section>
  );
}

type SourceGroup = "nasa" | "partner" | "other";
type SourceRow = Source & { key: string; group: SourceGroup; agency: string; use: [string, string] };

/** Who provides each catalog source and what the app uses it for; NASA first, then partner agencies, then third parties. */
const SOURCE_INFO: Record<string, Omit<SourceRow, keyof Source | "key">> = {
  asf: { group: "nasa", agency: "NASA · ISRO", use: ["NISAR radar images, ground motion and satellite pass dates", "নিসার রাডার ছবি, মাটির নড়াচড়া ও স্যাটেলাইট আসার তারিখ"] },
  power: { group: "nasa", agency: "NASA", use: ["Daily rain and temperature", "প্রতিদিনের বৃষ্টি ও তাপমাত্রা"] },
  s1: { group: "partner", agency: "ESA", use: ["Radar images every 12 days: water, crops, change", "প্রতি ১২ দিনে রাডার ছবি: পানি, ফসল, পরিবর্তন"] },
  dem: { group: "partner", agency: "ESA", use: ["Ground height", "জমির উচ্চতা"] },
  worldcover: { group: "partner", agency: "ESA", use: ["Land type: crops, trees, buildings, water", "জমির ধরন: ফসল, গাছ, ঘরবাড়ি, পানি"] },
  palsar: { group: "partner", agency: "JAXA", use: ["L-band radar picture (2021)", "এল-ব্যান্ড রাডার ছবি (২০২১)"] },
  licsar: { group: "other", agency: "COMET · Leeds", use: ["Ground motion measured from Sentinel-1", "সেন্টিনেল-১ থেকে মাপা মাটির নড়াচড়া"] },
  gsw: { group: "other", agency: "EC JRC", use: ["How often each place has water (1984–2021)", "কোন জায়গায় কত ঘন ঘন পানি থাকে (১৯৮৪–২০২১)"] },
  usgs: { group: "other", agency: "USGS", use: ["Earthquakes", "ভূমিকম্প"] },
};

/** Sources the browser calls directly, which are not in the data catalog. */
const LIVE_SOURCES: SourceRow[] = [
  { key: "eonet", group: "nasa", agency: "NASA", name: "NASA EONET (Earth Observatory Natural Event Tracker)", by: "NASA Goddard Space Flight Center", license: "Public domain", url: "https://eonet.gsfc.nasa.gov",
    use: ["Live natural events near your place", "আপনার এলাকার কাছে চলমান প্রাকৃতিক দুর্যোগ"] },
  { key: "esri", group: "other", agency: "Esri", name: "Esri World Imagery", by: "Esri, Maxar, Earthstar Geographics", license: "Esri terms · attribution required", url: "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9",
    use: ["Background satellite photo", "পেছনের স্যাটেলাইট ছবি"] },
  { key: "osm", group: "other", agency: "OpenStreetMap", name: "OpenStreetMap (Nominatim, Overpass)", by: "OpenStreetMap contributors", license: "ODbL", url: "https://www.openstreetmap.org/copyright",
    use: ["Place names and place search", "জায়গার নাম ও খোঁজা"] },
  { key: "natural-earth", group: "other", agency: "Natural Earth", name: "Natural Earth / world-atlas", by: "Natural Earth", license: "Public domain", url: "https://www.naturalearthdata.com",
    use: ["Coastlines and borders", "উপকূল ও সীমানা"] },
];

const SOURCE_GROUPS: { id: SourceGroup; title: [string, string]; note: [string, string]; tag: [string, string] }[] = [
  { id: "nasa", title: ["NASA data", "নাসার উপাত্ত"], tag: ["NASA", "নাসা"],
    note: ["Data from NASA missions and NASA archives.", "নাসার মিশন ও নাসার সংরক্ষণাগারের উপাত্ত।"] },
  { id: "partner", title: ["Space agency partner data", "সহযোগী মহাকাশ সংস্থার উপাত্ত"], tag: ["Partner", "সহযোগী"],
    note: ["From NASA Space Apps partner agencies: ESA (Europe) and JAXA (Japan).", "নাসা স্পেস অ্যাপসের সহযোগী সংস্থা থেকে: ইএসএ (ইউরোপ) ও জাক্সা (জাপান)।"] },
  { id: "other", title: ["Third-party data", "অন্যান্য উৎসের উপাত্ত"], tag: ["Third party", "অন্যান্য"],
    note: ["Universities, other agencies and open maps.", "বিশ্ববিদ্যালয়, অন্য সংস্থা ও উন্মুক্ত মানচিত্র।"] },
];

function sourceRows(sources: Record<string, Source>): SourceRow[] {
  const rows = Object.entries(sources).map(([key, s]): SourceRow => {
    const info = SOURCE_INFO[key] ?? { group: /\bNASA\b/.test(s.name + s.by) ? "nasa" : "other", agency: s.by.split(" · ")[0], use: ["", ""] as [string, string] };
    return { ...s, key, ...info };
  });
  const order = [...Object.keys(SOURCE_INFO), ...LIVE_SOURCES.map((l) => l.key)], rank = (k: string) => (order.indexOf(k) + 1 || order.length + 1);
  return [...rows, ...LIVE_SOURCES.filter((l) => !sources[l.key])].sort((x, y) => rank(x.key) - rank(y.key));
}

function SourcesSheet({ sources, onClose, lang = "en" }: { sources: Record<string, Source>; onClose: () => void; lang?: "en" | "bn" }) {
  const rows = sourceRows(sources);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={lang === "bn" ? "উপাত্তের উৎসসমূহ" : "Data sources"}>
        <div className="sheet-head">
          <h2>{lang === "bn" ? "উপাত্তের উৎসসমূহ" : "Data sources"}</h2>
          <button className="iconbtn" onClick={onClose} aria-label={lang === "bn" ? "বন্ধ করুন" : "Close"}><Icon name="close" /></button>
        </div>
        <p className="dim">
          {lang === "bn"
            ? <>প্রতিটি লেয়ার বাস্তব স্যাটেলাইট পরিমাপ, যা প্রতিটি অঞ্চলের গ্রিডে প্রক্রিয়াজাত করা হয়েছে। কিছুই সিমুলেটেড নয়। মাটির গতিবিধি আসে বাস্তব ইন্টারফেরোগ্রাম থেকে (নিসার GUNW অথবা সেন্টিনেল-১ LiCSAR); যেখানে তা নেই, সেখানে গতিবিধির লেয়ার দেখানো হয় না।</>
            : <>Every layer is a real satellite measurement, processed onto each region&apos;s grid. Nothing is simulated. Ground motion comes from real interferograms (NISAR GUNW or Sentinel-1 LiCSAR); where none exist, motion layers are not shown.</>}
        </p>
        <div className="src-summary">
          {SOURCE_GROUPS.map((g) => (
            <span key={g.id} className={`stag ${g.id}`}>{tr(g.tag, lang)} · {num(String(rows.filter((r) => r.group === g.id).length), lang)}</span>
          ))}
        </div>
        {SOURCE_GROUPS.map((g) => {
          const list = rows.filter((r) => r.group === g.id);
          return list.length > 0 && (
            <section key={g.id} className="src-group">
              <h3>{tr(g.title, lang)}</h3>
              <p className="dim small">{tr(g.note, lang)}</p>
              <ul className="sources">
                {list.map((s) => (
                  <li key={s.key} className={s.key === "nisar-preview" ? "pv" : ""}>
                    <span className="src-name"><b>{s.name}</b><span className={`stag ${g.id}`}>{s.agency.startsWith(g.tag[0]) ? tr(g.tag, lang) + s.agency.slice(g.tag[0].length) : g.id === "other" ? s.agency : `${tr(g.tag, lang)} · ${s.agency}`}</span></span>
                    {s.use[0] && <span>{tr(s.use, lang)}</span>}
                    <span className="dim small">{s.by}</span>
                    <span className="mono dim">{s.license} · <a href={s.url} target="_blank" rel="noreferrer">{s.url.replace(/^https?:\/\//, "").split("/")[0]}</a></span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
