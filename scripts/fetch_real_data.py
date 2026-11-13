"""
Fetch REAL, openly licensed observations for every SARsight region into data/real/<id>/.

Sources (no credentials needed):
  Sentinel-1 RTC (VV, VH, gamma0)      ESA Copernicus, processed by Catalyst; via Microsoft Planetary Computer
  ALOS-2 PALSAR-2 L-band mosaic (HH/HV)  JAXA; via Planetary Computer            (NISAR's L-band analogue)
  Copernicus DEM GLO-30                ESA; via Planetary Computer
  ESA WorldCover 2021                  ESA; via Planetary Computer
  JRC Global Surface Water occurrence  EC JRC; via Planetary Computer
  NASA POWER daily rainfall + soil wetness   NASA LaRC
  USGS earthquake catalogue            USGS
  NISAR pass catalogue + browse images ASF DAAC (search API, public browse PNGs)
  Sentinel-1 interferograms (LiCSAR)   COMET, Univ. Leeds; via JASMIN / CEDA     -> measured ground motion + coherence
  Place names                          OpenStreetMap contributors via Overpass     -> places.json (map labels)

Optional, needs a free NASA Earthdata login (set EARTHDATA_USERNAME / EARTHDATA_PASSWORD yourself):
  NISAR L2 GUNW / GCOV science layers  ASF DAAC  -> see fetch_nisar_science()  (GUNW pairs chained into a motion series)

Usage (from repo root, with the backend venv):
  backend/.venv/Scripts/python scripts/fetch_real_data.py [region-id ...]
Then:  npm run data:build
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import planetary_computer as pc
import pystac_client
import rasterio
import requests
from affine import Affine
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds as win_from_bounds

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((ROOT / "data" / "regions.json").read_text(encoding="utf8"))
OUT = ROOT / "data" / "real"


def load_env(path: Path) -> None:
    """Read KEY=VALUE lines from a gitignored .env (existing environment variables win)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf8").splitlines():
        k, sep, v = line.strip().partition("=")
        if sep and k and not k.startswith("#") and v.strip():
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env(ROOT / ".env")
N, EPOCHS = CFG["grid"], CFG["epochs"]
UA = {"User-Agent": "sarsight-data-fetch/1.0 (NASA Space Apps)"}
os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF,.tiff",
                  GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2", VSI_CACHE="TRUE",
                  GDAL_HTTP_SSL_OPTIONS="NO_REVOKE")  # Windows schannel cannot reach CEDA's revocation server; certs still verified

STAC = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)

SOURCES = {
    "s1": {"name": "Sentinel-1 RTC", "by": "ESA Copernicus · Catalyst · Microsoft Planetary Computer", "license": "Copernicus open data", "url": "https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc"},
    "palsar": {"name": "ALOS-2 PALSAR-2 mosaic 2021", "by": "JAXA · Microsoft Planetary Computer", "license": "JAXA open data", "url": "https://planetarycomputer.microsoft.com/dataset/alos-palsar-mosaic"},
    "dem": {"name": "Copernicus DEM GLO-30", "by": "ESA · Microsoft Planetary Computer", "license": "Copernicus DEM licence", "url": "https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30"},
    "worldcover": {"name": "ESA WorldCover 2021", "by": "ESA · Microsoft Planetary Computer", "license": "CC BY 4.0", "url": "https://planetarycomputer.microsoft.com/dataset/esa-worldcover"},
    "gsw": {"name": "JRC Global Surface Water", "by": "EC JRC / Google · Microsoft Planetary Computer", "license": "Copernicus / CC BY 4.0", "url": "https://planetarycomputer.microsoft.com/dataset/jrc-gsw"},
    "power": {"name": "NASA POWER (MERRA-2 / IMERG)", "by": "NASA Langley Research Center", "license": "Public domain", "url": "https://power.larc.nasa.gov"},
    "usgs": {"name": "USGS earthquake catalogue", "by": "U.S. Geological Survey", "license": "Public domain", "url": "https://earthquake.usgs.gov"},
    "asf": {"name": "NISAR (GUNW / GCOV) and pass catalogue", "by": "NASA-ISRO · ASF DAAC", "license": "Public", "url": "https://search.asf.alaska.edu"},
    "licsar": {"name": "Sentinel-1 interferograms (LiCSAR)", "by": "COMET, University of Leeds · ESA Copernicus · JASMIN/CEDA", "license": "CC BY 4.0", "url": "https://comet.nerc.ac.uk/COMET-LiCS-portal/"},
}
LIC = "https://gws-access.jasmin.ac.uk/public/nceo_geohazards/LiCSAR_products"
C_BAND_CM, L_BAND_CM = 5.5465763, 23.84


def bbox_of(r: dict) -> list[float]:
    lon, lat = r["center"]
    half_lon = r["span"] / np.cos(np.radians(lat)) / 2
    return [round(float(x), 5) for x in (lon - half_lon, lat - r["span"] / 2, lon + half_lon, lat + r["span"] / 2)]


def read_to_grid(href: str, bbox: list[float], resampling=Resampling.average, transform_fn=None, sign=True) -> np.ndarray:
    """Read the part of a (cloud-optimized) raster covering bbox, reprojected onto the N x N lon/lat grid."""
    dst = np.full((N, N), np.nan, "f4")
    with rasterio.open(pc.sign(href) if sign else "/vsicurl/" + href) as src:
        pad = [(bbox[2] - bbox[0]) * 0.02, (bbox[3] - bbox[1]) * 0.02]
        b = transform_bounds("EPSG:4326", src.crs, bbox[0] - pad[0], bbox[1] - pad[1], bbox[2] + pad[0], bbox[3] + pad[1])
        win = win_from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        try:
            win = win.intersection(Window(0, 0, src.width, src.height))
        except Exception:
            return dst
        if win.width < 1 or win.height < 1:
            return dst
        scale = max(1.0, max(win.width, win.height) / (3 * N))  # ~3 source px per output px, overviews used
        oh, ow = max(1, int(win.height / scale)), max(1, int(win.width / scale))
        data = src.read(1, window=win, out_shape=(oh, ow), resampling=Resampling.nearest if resampling == Resampling.mode else Resampling.average, masked=True)
        data = data.astype("f4").filled(np.nan)
        if transform_fn:
            data = transform_fn(data)
        wt = src.window_transform(win) * Affine.scale(win.width / ow, win.height / oh)
        reproject(data, dst, src_transform=wt, src_crs=src.crs, dst_transform=from_bounds(*bbox, N, N), dst_crs="EPSG:4326",
                  src_nodata=np.nan, dst_nodata=np.nan, resampling=resampling)
    return dst


def merge(grids: list[np.ndarray]) -> np.ndarray:
    out = np.full((N, N), np.nan, "f4")
    for g in grids:
        m = np.isnan(out) & ~np.isnan(g)
        out[m] = g[m]
    return out


def static_layer(collection: str, asset: str, bbox, query=None, resampling=Resampling.average, transform_fn=None, pick=None):
    items = list(STAC.search(collections=[collection], bbox=bbox, query=query or {}).items())
    if pick:
        items = pick(items)
    return merge([read_to_grid(i.assets[asset].href, bbox, resampling, transform_fn) for i in items if asset in i.assets])


def to_db(a):
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(a > 0, 10 * np.log10(a), np.nan).astype("f4")


def palsar_db(dn):  # JAXA calibration for the PALSAR-2 mosaic: gamma0 = 10 log10(DN^2) - 83
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(dn > 0, 10 * np.log10(dn.astype("f8") ** 2) - 83.0, np.nan).astype("f4")


# ---------------------------------------------------------------- Sentinel-1 time series
def window_of(r: dict) -> tuple[str, str]:
    """A region's time window; "latest" means the year up to today (with slack to find a full 12-day run)."""
    if r.get("window", "latest") == "latest":
        today = date.today()
        return (today - timedelta(days=EPOCHS * 12 + 60)).isoformat(), today.isoformat()
    return tuple(r["window"])


def twelve_day_run(dates: list[str], ev: str | None, recent: bool = False) -> list[str]:
    """The passes to show: a run on the 12-day repeat cycle of one track. 6-day neighbours from a second satellite
    are skipped; up to 3 missed acquisitions (24 or 36-day steps) are bridged. Prefers the run around the event,
    then (for "latest" windows) a run reaching the newest pass, then the longest."""
    if not dates:
        return []
    have = set(dates)
    step = lambda d, k=1: (date.fromisoformat(d) + timedelta(days=12 * k)).isoformat()  # noqa: E731
    runs = []
    for d in sorted(dates):
        run, skips = [d], 0
        while True:
            nxt = next((k for k in (1, 2, 3) if step(run[-1], k) in have and (k == 1 or skips < 3)), None)
            if nxt is None:
                break
            run.append(step(run[-1], nxt)); skips += nxt > 1
        runs.append(run)
    def gaps(run):
        return sum(1 for a, b in zip(run, run[1:]) if (date.fromisoformat(b) - date.fromisoformat(a)).days > 12)
    def score(run):
        if ev and run[0] < ev <= run[-1]:  # must straddle the event, with up to 8 passes before it
            before = sum(1 for x in run if x < ev)
            return (2, min(before, 8) + min(len(run) - before, EPOCHS - 8), -gaps(run), run[-1])
        fresh = recent and len(run) >= 12 and run[-1] >= newest  # keeps "latest" windows current
        return (1, fresh, min(len(run), EPOCHS), -gaps(run), run[-1])
    newest = (date.fromisoformat(max(dates)) - timedelta(days=24)).isoformat()
    best = max(runs, key=score)
    if ev and best[0] < ev <= best[-1]:
        k = sum(1 for x in best if x < ev)
        k0 = max(0, min(k - 8, len(best) - EPOCHS))
        return best[k0:k0 + EPOCHS]
    return best[-EPOCHS:]


def s1_series(r: dict, bbox, orbit: int | None = None, allowed: set[str] | None = None):
    start, end = window_of(r)
    items = list(STAC.search(collections=["sentinel-1-rtc"], bbox=bbox, datetime=f"{start}/{end}").items())
    if not items:
        raise RuntimeError("no Sentinel-1 RTC items")
    by_orbit: dict[int, dict[str, list]] = {}
    for it in items:
        o = it.properties.get("sat:relative_orbit")
        d = it.datetime.date().isoformat()
        by_orbit.setdefault(o, {}).setdefault(d, []).append(it)
    if orbit is not None and orbit not in by_orbit:
        raise RuntimeError(f"no Sentinel-1 RTC passes on track {orbit}")
    # one viewing geometry => comparable passes. Pick the track whose footprints actually cover the region
    # (or the track of the InSAR frame, so motion and radar share their dates).
    from shapely.geometry import box, shape
    from shapely.ops import unary_union
    region = box(*bbox)
    cover = {o: {d: unary_union([shape(i.geometry) for i in its]).intersection(region).area / region.area for d, its in ds.items()}
             for o, ds in by_orbit.items() if orbit is None or o == orbit}
    ev = (r.get("event") or {}).get("date")
    recent = r.get("window", "latest") == "latest"
    newest = (date.fromisoformat(max(d for cv in cover.values() for d in cv)) - timedelta(days=24)).isoformat()
    options = []  # (fresh, passes, -threshold rank, orbit, run): then most passes, then the stricter coverage
    for rank, thr in enumerate((0.95, 0.8, 0.6)):
        for o, cv in cover.items():
            run = twelve_day_run([d for d, c in cv.items() if c >= thr and (allowed is None or d in allowed)], ev, recent)
            options.append((recent and len(run) >= 12 and bool(run) and run[-1] >= newest, len(run), -rank, o, run, thr))
    _, _, _, orbit, kept, thr = max(options, key=lambda x: x[:3])
    gaps = {(date.fromisoformat(b) - date.fromisoformat(a)).days for a, b in zip(kept, kept[1:])}
    print(f"    track {orbit}: {len(kept)} passes {kept[0]} .. {kept[-1]}, gaps {sorted(gaps)} days (>={thr:.0%} coverage)")
    if len(kept) < 4:
        raise RuntimeError(f"only {len(kept)} Sentinel-1 passes cover this area")
    vv = np.full((len(kept), N, N), np.nan, "f4")
    vh = np.full_like(vv, np.nan)

    def job(k_d):
        k, d = k_d
        its = by_orbit[orbit][d]
        a = merge([read_to_grid(i.assets["vv"].href, bbox) for i in its])
        b = merge([read_to_grid(i.assets["vh"].href, bbox) for i in its])
        return k, to_db(a), to_db(b)

    with ThreadPoolExecutor(6) as ex:
        for k, a, b in ex.map(job, enumerate(kept)):
            vv[k], vh[k] = a, b
            print(f"    S1 {kept[k]}  valid {np.isfinite(a).mean():.0%}")
    return kept, orbit, vv, vh


# ---------------------------------------------------------------- measured ground motion: LiCSAR Sentinel-1
_listing: dict[str, str] = {}


def licsar_listing(frame: str) -> str:
    if frame not in _listing:
        _listing[frame] = requests.get(f"{LIC}/{int(frame[:3])}/{frame}/interferograms/", headers=UA, timeout=300).text
    return _listing[frame]


def licsar_epochs(frame: str) -> set[str]:
    """Acquisition dates LiCSAR processed for this frame (ISO), so the radar series can stick to them."""
    return {f"{d[:4]}-{d[4:6]}-{d[6:]}" for pair in re.findall(r'href="(\d{8}_\d{8})/?"', licsar_listing(frame)) for d in pair.split("_")}


def licsar_series(frame: str, dates: list[str], bbox):
    """Cumulative line-of-sight motion (cm, + towards the satellite) and coherence on `dates`, chained from COMET
    LiCSAR interferograms of the same track. Each step takes the shortest-baseline path between passes."""
    import heapq
    track = int(frame[:3])
    html = licsar_listing(frame)
    d8 = lambda d: d.replace("-", "")  # noqa: E731
    lo, hi = d8(dates[0]), d8(dates[-1])
    edges: dict[str, list[tuple[str, int]]] = {}
    for a, b in re.findall(r'href="(\d{8})_(\d{8})/?"', html):
        if lo <= a < b <= hi:
            days = (datetime.strptime(b, "%Y%m%d") - datetime.strptime(a, "%Y%m%d")).days
            if days <= 48:
                edges.setdefault(a, []).append((b, days))
    # Dijkstra with cost = days²: prefers chains of short (6/12-day) pairs, which keep coherence
    best, prev, heap = {lo: 0}, {}, [(0, lo)]
    while heap:
        c, a = heapq.heappop(heap)
        if c > best.get(a, 1e18):
            continue
        for b, days in edges.get(a, []):
            if c + days * days < best.get(b, 1e18):
                best[b], prev[b] = c + days * days, a
                heapq.heappush(heap, (best[b], b))
    paths = {}
    for d in map(d8, dates[1:]):
        p, x = [], d
        while x in prev:
            p.append(f"{prev[x]}_{x}"); x = prev[x]
        paths[d] = p[::-1] if x == lo else None
    need = sorted({q for p in paths.values() if p for q in p})
    missing = [d for d, p in paths.items() if p is None]
    print(f"    LiCSAR {frame}: {len(need)} interferograms to read" + (f", no path to {len(missing)} passes" if missing else ""))

    def job(pair):
        try:
            return read_pair(pair)
        except Exception as e:  # one damaged file only loses the passes that depend on it
            print(f"      {pair}: {type(e).__name__}")
            return pair, None, None

    def read_pair(pair):
        page = requests.get(f"{LIC}/{track}/{frame}/interferograms/{pair}", headers=UA, timeout=120).text
        links = re.findall(r"href=['\"]([^'\"]+)['\"]", page)
        url = lambda suf: next((u for u in links if u.endswith(pair + suf)), None)  # noqa: E731
        unw, cc = url(".geo.unw.tif"), url(".geo.cc.tif")
        if not unw:
            return pair, None, None
        disp = -read_to_grid(unw, bbox, sign=False) * C_BAND_CM / (4 * np.pi)
        if np.isfinite(disp).any():
            disp -= np.nanmedian(disp)  # each interferogram has its own phase offset: reference to the area's median
        coh = read_to_grid(cc, bbox, sign=False) if cc else np.full((N, N), np.nan, "f4")
        if np.nanmax(coh, initial=0) > 1.5:
            coh = coh / 255.0
        return pair, disp, coh

    got = {}
    with ThreadPoolExecutor(6) as ex:
        for pair, disp, coh in ex.map(job, need):
            got[pair] = (disp, coh)
    T = len(dates)
    cum, coh = np.full((T, N, N), np.nan, "f4"), np.full((T, N, N), np.nan, "f4")
    cum[0] = 0
    for t, d in enumerate(map(d8, dates[1:]), 1):
        p = paths[d]
        if not p or any(got.get(q, (None,))[0] is None for q in p):
            continue
        cum[t] = np.sum([got[q][0] for q in p], axis=0)
        coh[t] = got[p[-1]][1]
    coh[0] = coh[1] if T > 1 else coh[0]
    # motion is meaningless where pairs decorrelate (water, dense vegetation, fresh rubble): mask by typical coherence
    typical = np.nanmedian(coh, axis=0)
    cum[:, ~(typical >= 0.25)] = np.nan
    cum[0][np.isfinite(cum[1:]).any(axis=0)] = 0
    ok = np.isfinite(cum[1:]).any(axis=(1, 2)).sum()
    print(f"    LiCSAR motion on {ok + 1}/{T} passes, valid pixels {np.isfinite(cum[-1]).mean():.0%}")
    return cum, coh


# ---------------------------------------------------------------- context APIs
PLACE_RANK = {"city": 0, "town": 1, "suburb": 2, "village": 3, "quarter": 4, "neighbourhood": 5, "hamlet": 6}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]


def osm_places(bbox, pad=0.6):
    """OpenStreetMap place names around the region (English + Bangla), most important first, for the 2D map."""
    w, s_, e, n = bbox
    pw, ph = (e - w) * pad, (n - s_) * pad
    q = (f'[out:json][timeout:90];node["place"~"^({"|".join(PLACE_RANK)})$"]["name"]'
         f"({s_ - ph},{w - pw},{n + ph},{e + pw});out body qt 4000;")
    for url in OVERPASS:
        try:
            r = requests.post(url, data={"data": q}, headers=UA, timeout=120)
            r.raise_for_status()
            out = [{"rank": PLACE_RANK.get(x["tags"].get("place"), 6), "ll": [round(x["lon"], 5), round(x["lat"], 5)], "name": x["tags"]["name"],
                    **({"en": x["tags"]["name:en"]} if "name:en" in x["tags"] else {}), **({"bn": x["tags"]["name:bn"]} if "name:bn" in x["tags"] else {})}
                   for x in r.json()["elements"]]
            return sorted(out, key=lambda p: p["rank"])
        except Exception as ex:
            print(f"    places via {url.split('/')[2]} failed: {type(ex).__name__}")
    return None


def nasa_power(lon, lat, d0: str, d1: str):
    s = (date.fromisoformat(d0) - timedelta(days=30)).strftime("%Y%m%d")
    e = date.fromisoformat(d1).strftime("%Y%m%d")
    r = requests.get("https://power.larc.nasa.gov/api/temporal/daily/point", headers=UA, timeout=120, params=dict(
        parameters="PRECTOTCORR,GWETTOP,GWETROOT", community="AG", longitude=lon, latitude=lat, start=s, end=e, format="JSON"))
    r.raise_for_status()
    p = r.json()["properties"]["parameter"]
    days = sorted(p["PRECTOTCORR"])
    clean = lambda v: None if v is None or v < -900 else round(float(v), 3)  # noqa: E731
    return {"dates": [f"{d[:4]}-{d[4:6]}-{d[6:]}" for d in days], "rain_mm": [clean(p["PRECTOTCORR"][d]) for d in days],
            "wetness_top": [clean(p["GWETTOP"][d]) for d in days], "wetness_root": [clean(p["GWETROOT"][d]) for d in days]}


def usgs_quakes(bbox, d0, d1, minmag=4.5):
    pad = 0.5
    r = requests.get("https://earthquake.usgs.gov/fdsnws/event/1/query", headers=UA, timeout=120, params=dict(
        format="geojson", starttime=d0, endtime=d1, minlatitude=bbox[1] - pad, maxlatitude=bbox[3] + pad,
        minlongitude=bbox[0] - pad, maxlongitude=bbox[2] + pad, minmagnitude=minmag, orderby="magnitude", limit=20))
    r.raise_for_status()
    return [{"time": datetime.fromtimestamp(f["properties"]["time"] / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "mag": f["properties"]["mag"],
             "place": f["properties"]["place"], "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1],
             "url": f["properties"]["url"]} for f in r.json()["features"]]


def nisar_catalogue(bbox, limit=40):
    out = []
    for level in ("GUNW", "GCOV"):
        r = requests.get("https://api.daac.asf.alaska.edu/services/search/param", headers=UA, timeout=120, params=dict(
            dataset="NISAR", processingLevel=level, bbox=",".join(map(str, bbox)), output="geojson", maxResults=limit))
        r.raise_for_status()
        for f in r.json().get("features", []):
            p = f["properties"]
            if "_PR_" not in p["fileID"] and "_UR_" not in p["fileID"]:
                continue
            xs = [c[0] for c in f["geometry"]["coordinates"][0]]
            ys = [c[1] for c in f["geometry"]["coordinates"][0]]
            browse = [b for b in (p.get("browse") or []) if b.endswith("_LATLON.png")]
            thumb = [b for b in (p.get("browse") or []) if b.endswith("_LATLON_thumbnail.png")]
            out.append({"id": p["fileID"], "level": level, "start": p["startTime"], "stop": p["stopTime"],
                        "direction": p.get("flightDirection"), "track": p.get("pathNumber"),
                        "urgent": "_UR_" in p["fileID"], "footprint": [min(xs), min(ys), max(xs), max(ys)],
                        "browse": browse[0] if browse else None, "thumb": thumb[0] if thumb else None, "url": p["url"]})
    # keep one entry per acquisition (prefer standard "PR" over urgent-response "UR" processing)
    best: dict[str, dict] = {}
    for g in out:
        key = g["level"] + g["start"]
        if key not in best or (best[key]["urgent"] and not g["urgent"]):
            best[key] = g
    return sorted(best.values(), key=lambda g: g["start"], reverse=True)[:24]


def gunw_chain(bbox, d0: str, d1: str, limit=30):
    """NISAR GUNW pairs over the region between d0 and d1 that chain end-to-start on one track and frame."""
    from shapely.geometry import box, shape
    r = requests.get("https://api.daac.asf.alaska.edu/services/search/param", headers=UA, timeout=180, params=dict(
        dataset="NISAR", processingLevel="GUNW", bbox=",".join(map(str, bbox)), output="geojson", maxResults=1000,
        start=(date.fromisoformat(d0) - timedelta(days=13)).isoformat(), end=d1 + "T23:59:59Z"))
    r.raise_for_status()
    region, groups = box(*bbox), {}
    for f in r.json().get("features", []):
        p = f["properties"]
        if "_PR_" not in p["fileID"] or shape(f["geometry"]).intersection(region).area < 0.9 * region.area:
            continue
        g = {"id": p["fileID"], "url": p["url"], "ref": p["startTime"][:10], "sec": p["stopTime"][:10]}
        groups.setdefault((p.get("pathNumber"), p.get("flightDirection"), p.get("frameNumber")), {})[g["ref"]] = g
    best = []
    for by_ref in groups.values():
        chain = []
        for ref in sorted(by_ref):
            if chain and ref != chain[-1]["sec"]:
                best = max(best, chain, key=len)
                chain = []
            chain.append(by_ref[ref])
        best = max(best, chain, key=len)
    return best[-limit:]


def fetch_nisar_science(r, bbox, cat, dates):
    """NISAR onto the grid. Needs an Earthdata login.
      GCOV  latest pass -> nisar_hh / nisar_hv (static, dB)
      GUNW  consecutive 12-day pairs on one track, chained -> nisar_disp (cumulative cm) / nisar_coh, held at each
            radar pass date from the latest NISAR acquisition on or before it (NaN before NISAR's first pass).
    Dataset discovery walks the HDF5 tree by name so it tolerates product path differences.
    """
    netrc = Path.home() / ("_netrc" if os.name == "nt" else ".netrc")
    has_netrc = netrc.exists() and "urs.earthdata.nasa.gov" in netrc.read_text(errors="ignore")
    has_env = bool(os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD"))
    if not (has_env or has_netrc) or os.environ.get("SARSIGHT_SKIP_NISAR"):  # skip switch for credential-free runs
        return {}
    import earthaccess
    import h5py

    if not earthaccess.login(strategy="environment" if has_env else "netrc").authenticated:
        print("    Earthdata login failed — check your credentials")
        return {}
    layers = {}

    def find(h5, name):
        # Direct lookup on standard NISAR HDF5 dataset paths first (avoids walking entire remote HDF5 tree)
        for cand in (
            f"science/LSAR/GCOV/grids/frequencyA/{name}",
            f"science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram/{name}",
            f"science/LSAR/GUNW/grids/frequencyA/{name}",
            f"science/LSAR/{level}/grids/frequencyA/{name}",
        ):
            if cand in h5 and isinstance(h5[cand], h5py.Dataset):
                return [cand]
        hits = []
        h5.visititems(lambda k, v: hits.append(k) if isinstance(v, h5py.Dataset) and k.endswith("/" + name) and "frequencyA" in k else None)
        return sorted(hits, key=lambda k: ("unwrapped" not in k.lower(), len(k)))  # prefer the unwrapped-interferogram group

    def grid_from(h5, ds_path, transform_fn, zero_is_nodata):
        """Read only the window over this region (decimated to ~3 px per output px), then reproject onto the grid."""
        grp = ds_path.rsplit("/", 1)[0]
        for up in (grp, grp.rsplit("/", 1)[0], grp.rsplit("/", 2)[0]):
            if up + "/xCoordinates" in h5:
                x, y = h5[up + "/xCoordinates"][()], h5[up + "/yCoordinates"][()]
                proj = h5.get(up + "/projection")
                epsg = int(proj.attrs.get("epsg_code", proj[()])) if proj is not None else 4326
                break
        else:
            raise KeyError("coordinates not found for " + ds_path)
        dx, dy = float(x[1] - x[0]), float(y[1] - y[0])
        left, bottom, right, top = transform_bounds("EPSG:4326", f"EPSG:{epsg}", *bbox)
        c = sorted(((left - x[0]) / dx, (right - x[0]) / dx))
        rr = sorted(((top - y[0]) / dy, (bottom - y[0]) / dy))
        c0, c1 = max(0, int(np.floor(c[0]))), min(len(x), int(np.ceil(c[1])) + 1)
        r0, r1 = max(0, int(np.floor(rr[0]))), min(len(y), int(np.ceil(rr[1])) + 1)
        dst = np.full((N, N), np.nan, "f4")
        if c1 - c0 < 2 or r1 - r0 < 2:
            print(f"      {ds_path.rsplit('/', 1)[-1]}: granule does not cover this region")
            return dst
        step = max(1, int(max(r1 - r0, c1 - c0) / (3 * N)))
        a = h5[ds_path][r0:r1:step, c0:c1:step].astype("f4")
        if zero_is_nodata:
            a[a == 0] = np.nan
        a = transform_fn(a)
        st = Affine(dx * step, 0, float(x[c0]) - dx / 2, 0, dy * step, float(y[r0]) - dy / 2)
        reproject(a, dst, src_transform=st, src_crs=f"EPSG:{epsg}", dst_transform=from_bounds(*bbox, N, N), dst_crs="EPSG:4326",
                  src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.average)
        return dst

    for level, wanted in (("GCOV", {"HHHH": "nisar_hh", "HVHV": "nisar_hv"}),):
        granules = [g for g in cat if g["level"] == level]
        if level == "GCOV":
            # Prioritize dual-pol HH/HV granules over VV/VH
            dhdh = [g for g in granules if "_DHDH_" in g.get("id", "") or "_SHSH_" in g.get("id", "")]
            if dhdh:
                granules = dhdh
        for g in granules[:2]:  # newest first; fall back if a pass only clips the region
            print(f"    NISAR {level}: streaming {g['id'][:60]}…")
            got = {}
            fh = earthaccess.open([g["url"]])[0]
            try:
                with h5py.File(fh, "r") as h5:
                    for name, lid in wanted.items():
                        paths = find(h5, name)
                        if not paths:
                            print(f"      {name}: not found in granule")
                            continue
                        fn = to_db if level == "GCOV" else ((lambda p: -p * 23.84 / (4 * np.pi)) if name == "unwrappedPhase" else (lambda v: v))
                        grid = grid_from(h5, paths[0], fn, zero_is_nodata=level == "GCOV")
                        if name == "unwrappedPhase" and np.isfinite(grid).any():
                            grid = grid - np.nanmedian(grid)  # unwrapped phase has an arbitrary 2π·k offset: reference to the scene median
                        cov = np.isfinite(grid).mean()
                        print(f"      {lid:10s} from {paths[0]}  valid {cov:.0%}")
                        if cov >= 0.6:
                            got[lid] = {"data": grid, "date": g["start"][:10], "granule": g["id"]}
            finally:
                fh.close()
            if len(got) == len(wanted):
                layers.update(got)
                break
            print("      coverage too low, trying the previous pass")

    # ---- GUNW: chain consecutive pairs into a cumulative motion series
    level = "GUNW"  # noqa: F841  (read by find())
    chain = gunw_chain(bbox, dates[0], dates[-1])
    print(f"    NISAR GUNW: {len(chain)} chained pairs" + (f" {chain[0]['ref']} .. {chain[-1]['sec']}" if chain else ""))
    if len(chain) < 2:
        return layers

    def read_pair(g):
        fh = earthaccess.open([g["url"]])[0]
        try:
            with h5py.File(fh, "r") as h5:
                ph, cc = find(h5, "unwrappedPhase"), find(h5, "coherenceMagnitude")
                if not ph:
                    return None, None
                disp = grid_from(h5, ph[0], lambda p: -p * L_BAND_CM / (4 * np.pi), zero_is_nodata=False)
                coh = grid_from(h5, cc[0], lambda v: v, zero_is_nodata=False) if cc else np.full((N, N), np.nan, "f4")
        finally:
            fh.close()
        if np.isfinite(disp).any():
            disp -= np.nanmedian(disp)  # unwrapped phase has an arbitrary 2pi*k offset: reference to the area's median
        return disp, coh

    acq, cum, coh = [chain[0]["ref"]], [np.zeros((N, N), "f4")], [None]
    for g in chain:
        print(f"      {g['ref']} -> {g['sec']}")
        disp, c = read_pair(g)
        if disp is None:
            break
        acq.append(g["sec"]); cum.append(cum[-1] + disp); coh.append(c)
    if len(acq) < 2:
        return layers
    coh[0] = coh[1]
    typical = np.nanmedian(np.stack(coh[1:]), axis=0)
    T = len(dates)
    disp_s, coh_s = np.full((T, N, N), np.nan, "f4"), np.full((T, N, N), np.nan, "f4")
    for t, d in enumerate(dates):
        k = max((i for i, a in enumerate(acq) if a <= d), default=None)
        if k is not None:
            disp_s[t], coh_s[t] = cum[k], coh[k]
    first = next((t for t in range(T) if np.isfinite(disp_s[t]).any()), None)
    if first is None:
        return layers
    disp_s[first:] -= disp_s[first].copy()  # motion since the first NISAR pass inside this window
    disp_s[:, ~(typical >= 0.3)] = np.nan
    info = {"dates": acq, "granules": [g["id"] for g in chain[: len(acq) - 1]]}
    layers["nisar_disp"] = {"data": disp_s, **info}
    layers["nisar_coh"] = {"data": coh_s, **info}
    return layers


# ---------------------------------------------------------------- region driver
def fetch(r: dict, d: Path | None = None):
    bbox = bbox_of(r)
    d = d or OUT / r["id"]
    d.mkdir(parents=True, exist_ok=True)
    print(f"== {r['id']}  bbox {bbox}")
    frame = r.get("licsar")
    dates, orbit, vv, vh = s1_series(r, bbox, int(frame[:3]) if frame else None, licsar_epochs(frame) if frame else None)
    vv.tofile(d / "s1_vv.f32"); vh.tofile(d / "s1_vh.f32")
    layers = {"s1_vv": {"source": "s1", "static": False, "unit": "dB", "label": "Sentinel-1 C-band VV"},
              "s1_vh": {"source": "s1", "static": False, "unit": "dB", "label": "Sentinel-1 C-band VH"}}

    def save(lid, arr, source, unit, label, extra=None):
        arr.astype("<f4").tofile(d / f"{lid}.f32")
        layers[lid] = {"source": source, "static": True, "unit": unit, "label": label, **(extra or {})}
        print(f"    {lid:17s} valid {np.isfinite(arr).mean():.0%}")

    if frame:
        try:
            cum, coh = licsar_series(frame, dates, bbox)
            for lid, arr, unit, label in (("deformation", cum, "cm", "Ground motion, Sentinel-1 InSAR (LiCSAR)"),
                                          ("coherence", coh, "", "Coherence, Sentinel-1 InSAR (LiCSAR)")):
                arr.astype("<f4").tofile(d / f"{lid}.f32")
                layers[lid] = {"source": "licsar", "static": False, "unit": unit, "label": label, "frame": frame}
        except Exception as e:  # keep the observed radar layers even if the InSAR archive is unreachable
            print(f"    LiCSAR failed: {type(e).__name__}: {e}")

    pick21 = lambda items: [i for i in items if i.datetime and i.datetime.year == 2021] or items  # noqa: E731
    save("lband_hh", static_layer("alos-palsar-mosaic", "HH", bbox, transform_fn=palsar_db, pick=pick21), "palsar", "dB", "ALOS-2 L-band HH (2021)")
    save("lband_hv", static_layer("alos-palsar-mosaic", "HV", bbox, transform_fn=palsar_db, pick=pick21), "palsar", "dB", "ALOS-2 L-band HV (2021)")
    save("elevation", static_layer("cop-dem-glo-30", "data", bbox), "dem", "m", "Elevation")
    wc = static_layer("esa-worldcover", "map", bbox, resampling=Resampling.mode, pick=lambda its: [i for i in its if "2021" in i.id] or its)
    save("landcover", wc, "worldcover", "class", "Land cover (2021)")
    occ = static_layer("jrc-gsw", "occurrence", bbox, transform_fn=lambda a: np.where(a > 100, np.nan, a))
    save("water_occurrence", np.nan_to_num(occ, nan=0.0) if np.isfinite(wc).any() else occ, "gsw", "%", "Water occurrence 1984–2021")

    meta = {"id": r["id"], "bbox": bbox, "grid": N, "dates": dates, "orbit": orbit, "layers": layers,
            "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sources": SOURCES}
    lon, lat = r["center"]
    try:
        meta["drivers"] = nasa_power(lon, lat, dates[0], dates[-1])
    except Exception as e:
        print("    POWER failed:", e)
    try:
        meta["quakes"] = usgs_quakes(bbox, dates[0], (date.fromisoformat(dates[-1]) + timedelta(days=1)).isoformat())
    except Exception as e:
        print("    USGS failed:", e)
    try:
        meta["nisar"] = nisar_catalogue(bbox)
        print(f"    NISAR passes: {len(meta['nisar'])}")
    except Exception as e:
        print("    ASF failed:", e)
        meta["nisar"] = []
    try:
        science = fetch_nisar_science(r, bbox, meta.get("nisar", []), dates)
    except Exception as e:  # never lose the observed layers because of the optional NISAR step
        print(f"    NISAR science skipped: {type(e).__name__}: {e}")
        science = {}
    if "deformation" not in layers and "nisar_disp" in science:  # no Sentinel-1 InSAR here: NISAR is the motion layer
        science["deformation"], science["coherence"] = science.pop("nisar_disp"), science.pop("nisar_coh")
    labels = {"nisar_hh": "NISAR L-band HH", "nisar_hv": "NISAR L-band HV", "nisar_disp": "NISAR ground motion (cumulative)",
              "nisar_coh": "NISAR coherence (12-day pair)", "deformation": "Ground motion, NISAR L-band InSAR", "coherence": "Coherence, NISAR L-band InSAR"}
    for lid, v in science.items():
        a = v.pop("data")
        a.astype("<f4").tofile(d / f"{lid}.f32")
        layers[lid] = {"source": "asf", "static": a.ndim == 2, "unit": "dB" if lid in ("nisar_hh", "nisar_hv") else ("cm" if lid in ("nisar_disp", "deformation") else ""),
                       "label": labels[lid], **v}
    if r.get("event"):  # only events with a known date (earthquakes); nothing is inferred
        meta["event"] = r["event"]
    places = osm_places(bbox)
    if places is not None:
        (d / "places.json").write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
        print(f"    place names: {len(places)}")
    (d / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf8")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--custom":  # on-demand area: data/custom/<id>/region.json -> .../real/
        cfg_path = Path(sys.argv[2]).resolve()
        r = json.loads(cfg_path.read_text(encoding="utf8"))
        t0 = time.time()
        fetch(r, cfg_path.parent / "real")
        print(f"   done in {time.time() - t0:.0f}s")
        sys.exit(0)
    want = set(sys.argv[1:])
    for r in CFG["regions"]:
        if want and r["id"] not in want:
            continue
        t0 = time.time()
        try:
            fetch(r)
            print(f"   done in {time.time() - t0:.0f}s")
        except Exception as e:
            print(f"!! {r['id']} failed: {e}")
