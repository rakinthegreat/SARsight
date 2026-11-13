"""Reads the SARsight data repo (same files the frontend uses)."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np

DATA_DIR = Path(os.environ.get("SARSIGHT_DATA", Path(__file__).resolve().parents[2] / "public" / "data"))


def catalog() -> list[dict]:
    return json.loads((DATA_DIR / "catalog.json").read_text(encoding="utf8"))["regions"]


@lru_cache(maxsize=32)
def manifest(region_id: str) -> dict:
    p = DATA_DIR / region_id / "manifest.json"
    if not p.exists():
        raise KeyError(region_id)
    return json.loads(p.read_text(encoding="utf8"))


@lru_cache(maxsize=128)
def layer(region_id: str, layer_id: str) -> np.ndarray:
    """Returns [epochs, rows, cols] (or [rows, cols] for static layers) float32, NaN = no data."""
    m = manifest(region_id)
    meta = next((l for l in m["layers"] if l["id"] == layer_id), None)
    if meta is None:
        shape = (m["grid"]["rows"], m["grid"]["cols"])
        return np.full(shape if layer_id in ("elevation", "landcover", "water_occurrence") else (len(m["epochs"]), *shape), np.nan, "f4")
    rows, cols = m["grid"]["rows"], m["grid"]["cols"]
    arr = np.fromfile(DATA_DIR / region_id / meta["file"], dtype="<f4")
    return arr.reshape((rows, cols) if meta.get("static") else (len(m["epochs"]), rows, cols))


def cell_centers(region_id: str) -> tuple[np.ndarray, np.ndarray]:
    m = manifest(region_id)
    w, s, e, n = m["bbox"]
    rows, cols = m["grid"]["rows"], m["grid"]["cols"]
    lon = w + (np.arange(cols) + 0.5) / cols * (e - w)
    lat = n - (np.arange(rows) + 0.5) / rows * (n - s)
    return np.meshgrid(lon, lat)


def cell_area_km2(region_id: str) -> float:
    m = manifest(region_id)
    w, s, e, n = m["bbox"]
    lat = np.radians((s + n) / 2)
    return ((e - w) * 111.32 * np.cos(lat) / m["grid"]["cols"]) * ((n - s) * 111.32 / m["grid"]["rows"])
