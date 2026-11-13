"""
SARsight backend (FastAPI).

Serves the measured region data in public/data (built by scripts/) and prepares new areas on demand.
  uvicorn app.main:app --reload --port 8000      (from backend/)
"""
from __future__ import annotations

from datetime import date
import hashlib

import numpy as np
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import aoi, prepare, store
from .pipeline import convert, ingest, processing

app = FastAPI(title="SARsight API", version="0.1.0",
              description="NISAR discovery, InSAR processing and AOI analytics on measured data.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _region(region_id: str) -> dict:
    try:
        return store.manifest(region_id)
    except KeyError:
        raise HTTPException(404, f"unknown region {region_id}")


@app.get("/api/health")
def health():
    return {"ok": True, "earthdata": ingest.live(), "data_dir": str(store.DATA_DIR)}


_TTS_CACHE: dict[str, bytes] = {}
_TTS_VOICES = {
    "bn": "bn-BD-NabanitaNeural",  # Fluent, natural Bengali (Bangladesh) neural voice
    "en": "en-US-AriaNeural",      # Warm, natural English (US) neural voice
}


@app.get("/api/tts")
async def tts(text: str, lang: str = "en"):
    """High-quality neural text-to-speech for EconAssist and HazAssist plain-language advice."""
    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(400, "text is required")
    key = hashlib.md5(f"{lang}:{clean_text}".encode("utf-8")).hexdigest()
    if key in _TTS_CACHE:
        return Response(content=_TTS_CACHE[key], media_type="audio/mpeg")

    voice = _TTS_VOICES.get(lang, "en-US-AriaNeural")
    try:
        import edge_tts

        comm = edge_tts.Communicate(clean_text, voice)
        chunks = [c["data"] async for c in comm.stream() if c["type"] == "audio"]
        audio_bytes = b"".join(chunks)
        if not audio_bytes:
            raise HTTPException(500, "TTS generation returned empty audio")
        _TTS_CACHE[key] = audio_bytes
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(500, f"TTS generation error: {e}")


class PrepareRequest(BaseModel):
    polygon: list[list[float]]
    scenario: str
    name: str | None = None
    window: list[str] | None = None  # [start, end] ISO dates; default: the last 150 days


@app.post("/api/areas")
def prepare_area(req: PrepareRequest):
    """Build a new region on demand around a drawn or tapped area. Poll GET /api/areas/{id}."""
    if len(req.polygon) < 1:
        raise HTTPException(400, "polygon needs at least one point")
    try:
        cfg = prepare.area_config(req.polygon, req.scenario, req.name, req.window)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return prepare.submit(cfg)


@app.get("/api/areas")
def list_areas():
    return prepare.listing()


@app.get("/api/areas/{area_id}")
def area_status(area_id: str):
    return prepare.status(area_id)


prepare.CUSTOM.mkdir(parents=True, exist_ok=True)
app.mount("/areas", StaticFiles(directory=prepare.CUSTOM), name="areas")  # data/custom/<id>/site/* for the app


@app.get("/api/catalog")
def catalog():
    return store.catalog()


@app.get("/api/regions/{region_id}")
def region(region_id: str):
    return _region(region_id)


@app.get("/api/granules")
def granules(bbox: str, start: date, end: date, product: str = "GUNW"):
    """Live ASF NISAR search (no login needed). bbox = west,south,east,north; product = GUNW | GCOV | RSLC | GSLC | …"""
    try:
        b = tuple(float(x) for x in bbox.split(","))
        return ingest.search(b, start, end, product)
    except ValueError as e:
        raise HTTPException(400, str(e))


class AOIRequest(BaseModel):
    region: str
    geometry: dict  # GeoJSON Polygon, lon/lat
    epoch: int | None = None


@app.post("/api/aoi/evaluate")
def aoi_evaluate(req: AOIRequest):
    _region(req.region)
    return aoi.evaluate(req.region, req.geometry, req.epoch)


@app.get("/api/regions/{region_id}/timeseries")
def timeseries(region_id: str, lon: float, lat: float):
    """One pixel through the pipeline: pairs from the measured cumulative motion -> troposphere fix -> SBAS."""
    m = _region(region_id)
    if not any(l["id"] == "deformation" for l in m["layers"]):
        raise HTTPException(404, "no measured ground motion for this region")
    w, s, e, n = m["bbox"]
    if not (w <= lon <= e and s <= lat <= n):
        raise HTTPException(400, "point outside region")
    rows, cols = m["grid"]["rows"], m["grid"]["cols"]
    i, j = min(cols - 1, int((lon - w) / (e - w) * cols)), min(rows - 1, int((n - lat) / (n - s) * rows))
    defo = store.layer(region_id, "deformation")
    elev = store.layer(region_id, "elevation")
    T = len(m["epochs"])
    pairs = processing.network(T)
    ifgs, slopes = [], []
    for a, b in pairs:
        ifg = defo[b] - defo[a]
        _, slope = processing.troposphere(ifg, elev)
        # remove only the elevation-correlated (stratified) delay; keep the pixel's deformation signal
        ifgs.append(ifg - slope * (elev - np.nanmean(elev)) / 1000.0)
        slopes.append(slope)
    series = processing.sbas(pairs, np.stack(ifgs), T)[:, j, i]
    return {"region": region_id, "pixel": [i, j], "dates": m["epochs"], "displacement_cm": [None if np.isnan(v) else round(float(v), 3) for v in series],
            "pairs": len(pairs), "tropo_slope_cm_per_km": [round(x, 4) for x in slopes], "method": "SBAS least squares (GIAnT-style) + phase–elevation tropo correction",
            "source": next(l["source"] for l in m["layers"] if l["id"] == "deformation")}


@app.get("/api/tiles/{region_id}/{layer}/{epoch}/{z}/{x}/{y}.png")
def tiles(region_id: str, layer: str, epoch: int, z: int, x: int, y: int):
    """PLACEHOLDER: production serves COG tiles via TiTiler (rio-tiler). The frontend currently draws
    region grids client-side, so this route is not used yet."""
    raise HTTPException(501, "Tile server not configured: deploy TiTiler over the COGs from pipeline.convert")
