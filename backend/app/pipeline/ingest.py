"""
Step 1 — Discovery and download from ASF DAAC.

search()   is LIVE: the ASF search API is public, so real NISAR (GUNW, GCOV, RSLC, GSLC…) and Sentinel-1
           granules are listed without credentials.
download() needs a free NASA Earthdata login: set EARTHDATA_USERNAME / EARTHDATA_PASSWORD in your
           environment (never commit them). Uses `earthaccess` if installed.
"""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

import requests

CACHE = Path(__file__).resolve().parents[2] / "cache"
_ENV = Path(__file__).resolve().parents[3] / ".env"  # repo-root .env (gitignored)
if _ENV.exists():
    for _line in _ENV.read_text(encoding="utf8").splitlines():
        _k, _sep, _v = _line.strip().partition("=")
        if _sep and _k and not _k.startswith("#") and _v.strip():
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
ASF = "https://api.daac.asf.alaska.edu/services/search/param"
UA = {"User-Agent": "sarsight-backend/1.0"}


def live() -> bool:
    return bool(os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD"))


def search(bbox, start: date, end: date, product: str = "GUNW", limit: int = 100) -> list[dict]:
    """product: a NISAR processing level (GUNW, GCOV, RSLC, GSLC, GOFF…)."""
    level = product.replace("L2_", "")
    r = requests.get(ASF, headers=UA, timeout=60, params=dict(dataset="NISAR", processingLevel=level, output="geojson",
                     bbox=",".join(map(str, bbox)), start=start.isoformat(), end=end.isoformat(), maxResults=limit))
    r.raise_for_status()
    out = []
    for f in r.json().get("features", []):
        p = f["properties"]
        out.append(dict(granule=p["fileID"], product=level, mission="NISAR", url=p["url"], start_time=p["startTime"], stop_time=p["stopTime"],
                        direction=p.get("flightDirection"), track=p.get("pathNumber"), browse=p.get("browse") or [],
                        size_mb=round(sum(v.get("bytes", 0) for v in (p.get("bytes") or {}).values() if isinstance(v, dict)) / 1e6, 1),
                        footprint=f.get("geometry")))
    return out


def download(granules: list[dict]) -> list[Path]:
    """Download real granules to backend/cache (requires Earthdata login)."""
    real = granules
    if not real:
        return []
    if not live():
        raise PermissionError("Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD (free account at urs.earthdata.nasa.gov)")
    import earthaccess

    CACHE.mkdir(exist_ok=True)
    earthaccess.login(strategy="environment")
    return [Path(p) for p in earthaccess.download([g["url"] for g in real], str(CACHE))]
