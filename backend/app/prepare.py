"""
On-demand areas: a user draws or taps somewhere outside the showcase regions, and this module builds a new
SARsight region there from the same free sources (Sentinel-1 RTC, Copernicus DEM, WorldCover, JRC water,
ALOS-2, NASA POWER, USGS, ASF NISAR catalogue; real NISAR layers too when Earthdata credentials are set).

Each area lives in data/custom/<id>/:  region.json (config)  real/ (fetched)  site/ (what the app loads)  log.txt
Jobs run one at a time in a background thread, as two subprocesses: scripts/fetch_real_data.py --custom, then
node scripts/build-data.mjs --custom. The area is usable as soon as that finishes (about a minute). With
SARSIGHT_CUSTOM_NISAR=1 and an Earthdata login, a second step then adds the latest NISAR scan to the built site
(scripts/add_nisar.py --dir, about 1.5 min) in its own thread; status()["nisar"] reports its progress.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import queue
import shutil
import subprocess
import sys
import threading
from datetime import date, timedelta
from pathlib import Path

from .pipeline import ingest

ROOT = Path(__file__).resolve().parents[2]
CUSTOM = ROOT / "data" / "custom"
SCENARIOS = {"agriculture", "marine", "mine", "extraction", "earthquake", "flood", "subsidence", "landslide", "volcano"}
MODULE_OF = {"agriculture": "econ", "marine": "econ", "mine": "econ", "extraction": "econ"}

# progress: the fetch script's own output tells us which stage it is in
STAGES = [
    ("== ", "Finding Sentinel-1 passes"),
    ("S1 ", "Downloading Sentinel-1 radar passes"),
    ("lband_hh", "Reading L-band, elevation and land cover"),
    ("water_occurrence", "Reading 38 years of water history"),
    ("NISAR passes", "Checking NISAR passes"),
    ("Building layers", "Building layers"),
    ("done in", "Building layers"),
]

# second step: (marker in add_nisar.py output, stage, percent)
NISAR_STAGES = [("== ", "Checking NISAR passes", 10), ("NISAR GCOV", "Reading NISAR L-band radar", 30),
                ("nisar_hh", "Reading NISAR L-band radar", 65), ("nisar_hv", "Saving NISAR layers", 90)]

_jobs: dict[str, dict] = {}
_queue: "queue.Queue[str]" = queue.Queue()
_lock = threading.Lock()


def _fmt_ll(lon: float, lat: float) -> str:
    return f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'} {abs(lon):.2f}°{'E' if lon >= 0 else 'W'}"


def area_config(polygon: list[list[float]], scenario: str, name: str | None = None, window: list[str] | None = None) -> dict:
    """Square region around the polygon: at least 0.06° (≈70 m cells on the 96 grid), at most 1°."""
    if scenario not in SCENARIOS:
        raise ValueError(f"unknown scenario {scenario}")
    lons, lats = [p[0] for p in polygon], [p[1] for p in polygon]
    lon, lat = (min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2
    if not (-180 <= lon <= 180 and -80 <= lat <= 80):
        raise ValueError("outside Sentinel-1 coverage")
    extent = max(max(lats) - min(lats), (max(lons) - min(lons)) * math.cos(math.radians(lat)))
    span = round(min(1.0, max(0.06, extent * 1.4)), 3)
    end = date.today()
    if window:  # e.g. extending a historical showcase region: keep its dates (padded a little either side)
        w0, w1 = date.fromisoformat(window[0][:10]) - timedelta(days=6), date.fromisoformat(window[1][:10]) + timedelta(days=6)
    else:
        w0, w1 = end - timedelta(days=150), end
    key = f"{scenario}:{lon:.3f}:{lat:.3f}:{span}:{w0}:{w1}"
    rid = "c-" + hashlib.sha1(key.encode()).hexdigest()[:8]
    module = MODULE_OF.get(scenario, "haz")
    return {"id": rid, "name": name or "Your area", "place": _fmt_ll(lon, lat), "country": "", "scenario": scenario,
            "modules": [module, "vis"], "center": [round(lon, 5), round(lat, 5)], "span": span,
            "window": [w0.isoformat(), w1.isoformat()], "custom": True}


def entry(rid: str) -> dict | None:
    f = CUSTOM / rid / "site" / "entry.json"
    if not f.exists():
        return None
    try:
        d = json.loads(f.read_text(encoding="utf8"))
        d["id"] = rid
        return d
    except Exception:
        return None


def listing() -> list[dict]:
    if not CUSTOM.exists():
        return []
    seen = set()
    out = []
    for d in sorted(CUSTOM.glob("c-*")):
        if not d.is_dir():
            continue
        e = entry(d.name)
        if e and e.get("id") and e["id"] not in seen:
            seen.add(e["id"])
            out.append(e)
    return out


def status(rid: str) -> dict:
    with _lock:
        job = dict(_jobs.get(rid, {}))
    e = entry(rid)
    if e and job.get("state") not in ("queued", "running"):
        return {"id": rid, "state": "done", "entry": e, **({"nisar": job["nisar"]} if "nisar" in job else {})}
    if not job:
        return {"id": rid, "state": "unknown"}
    job.pop("proc", None)
    if job.get("state") in ("queued", "running"):
        with _lock:
            job["position"] = list(_queue.queue).index(rid) + 1 if rid in _queue.queue else 0
    return job


def submit(cfg: dict) -> dict:
    rid = cfg["id"]
    if entry(rid):
        return status(rid)
    with _lock:
        if _jobs.get(rid, {}).get("state") in ("queued", "running"):
            return {"id": rid, **{k: v for k, v in _jobs[rid].items() if k != "proc"}}
        d = CUSTOM / rid
        d.mkdir(parents=True, exist_ok=True)
        (d / "region.json").write_text(json.dumps(cfg, indent=1), encoding="utf8")
        _jobs[rid] = {"id": rid, "state": "queued", "stage": "Waiting to start", "config": cfg}
    _queue.put(rid)
    _ensure_worker()
    return status(rid)


def _set(rid: str, **kw):
    with _lock:
        _jobs[rid].update(kw)


def _run(rid: str):
    d = CUSTOM / rid
    log = (d / "log.txt").open("w", encoding="utf8")
    try:
        _set(rid, state="running", stage=STAGES[0][1])
        # first step builds without NISAR so the area opens in about a minute; NISAR is added afterwards
        env = {**os.environ, "SARSIGHT_SKIP_NISAR": "1"}
        p = subprocess.Popen([sys.executable, "-u", str(ROOT / "scripts" / "fetch_real_data.py"), "--custom", str(d / "region.json")],
                             cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf8", errors="replace")
        for line in p.stdout:  # type: ignore[union-attr]
            log.write(line); log.flush()
            for marker, label in STAGES:
                if marker in line:
                    _set(rid, stage=label)
        if p.wait() != 0:
            raise RuntimeError(_tail(d) or "fetch failed")
        node = shutil.which("node")
        if not node:
            raise RuntimeError("node is not on PATH")
        _set(rid, stage="Building layers")
        b = subprocess.run([node, str(ROOT / "scripts" / "build-data.mjs"), "--custom", rid], cwd=ROOT, capture_output=True, text=True)
        log.write(b.stdout + b.stderr)
        if b.returncode != 0:
            raise RuntimeError((b.stderr or b.stdout).strip().splitlines()[-1] if (b.stderr or b.stdout).strip() else "build failed")
        nisar = os.environ.get("SARSIGHT_CUSTOM_NISAR") == "1" and ingest.live()
        _set(rid, state="done", stage="Ready", **({"nisar": {"state": "running", "stage": "Checking NISAR passes", "pct": 5}} if nisar else {}))
        if nisar:
            threading.Thread(target=_add_nisar, args=(rid,), daemon=True, name=f"nisar-{rid}").start()
    except Exception as e:  # report the reason to the app; the log keeps the full output
        _set(rid, state="failed", stage="Failed", error=_friendly(str(e)))
    finally:
        log.close()


def _add_nisar(rid: str):
    """Second step: latest NISAR scan into the already-built site. Never breaks the area; failures only skip NISAR."""
    d = CUSTOM / rid
    env = {**os.environ, "SARSIGHT_NISAR_MOTION": "0"}  # chaining motion pairs would take far longer than anyone waits
    env.pop("SARSIGHT_SKIP_NISAR", None)
    added: list[str] = []
    try:
        with (d / "log.txt").open("a", encoding="utf8") as log:
            p = subprocess.Popen([sys.executable, "-u", str(ROOT / "scripts" / "add_nisar.py"), "--dir", str(d / "site")], cwd=ROOT, env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf8", errors="replace")
            for line in p.stdout:  # type: ignore[union-attr]
                log.write(line); log.flush()
                for marker, stage, pct in NISAR_STAGES:
                    if marker in line:
                        _set(rid, nisar={"state": "running", "stage": stage, "pct": pct})
                if "added:" in line:
                    added = [x.strip() for x in line.split("added:", 1)[1].split(",") if x.strip().startswith("nisar")]
            ok = p.wait() == 0
        _set(rid, nisar={"state": ("done" if added else "none") if ok else "failed", "layers": added, "pct": 100})
    except Exception as e:  # noqa: BLE001
        _set(rid, nisar={"state": "failed", "error": str(e)[-200:], "pct": 100})


def _tail(d: Path) -> str:
    lines = [l for l in (d / "log.txt").read_text(encoding="utf8", errors="replace").splitlines() if l.strip()]
    errs = [l for l in lines if "failed" in l or "Error" in l]
    return (errs or lines or [""])[-1].strip()


def _friendly(msg: str) -> str:
    if "Sentinel-1" in msg:
        return "Not enough recent Sentinel-1 passes over this spot. Try a slightly larger or different area."
    return msg[-300:]


_worker: threading.Thread | None = None


def _ensure_worker():
    global _worker
    if _worker and _worker.is_alive():
        return

    def loop():
        while True:
            rid = _queue.get()
            _run(rid)

    _worker = threading.Thread(target=loop, daemon=True, name="prepare-worker")
    _worker.start()
