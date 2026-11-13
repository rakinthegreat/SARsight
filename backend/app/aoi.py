"""AOI engine: zonal statistics for a GeoJSON polygon over one region and pass (same data repo as the frontend)."""
from __future__ import annotations

import numpy as np
import shapely
from shapely.geometry import shape

from . import store


def _mask(region_id: str, geometry: dict) -> np.ndarray:
    lon, lat = store.cell_centers(region_id)
    return shapely.contains_xy(shape(geometry), lon, lat)


def _days(m: dict) -> np.ndarray:
    d = np.array(m["epochs"], dtype="datetime64[D]")
    return (d - d[0]).astype(float)


def _velocity(defo: np.ndarray, x: np.ndarray, t: int, window: int = 6) -> np.ndarray:
    t0 = max(0, t - window + 1)
    if t - t0 < 2:
        return np.full(defo.shape[1:], np.nan)
    xs, y = x[t0:t + 1], defo[t0:t + 1].reshape(t - t0 + 1, -1)
    slope = ((xs - xs.mean())[:, None] * (y - np.nanmean(y, 0))).sum(0) / ((xs - xs.mean()) ** 2).sum()
    return (slope * 365).reshape(defo.shape[1:])


def evaluate(region_id: str, geometry: dict, epoch: int | None = None) -> dict:
    m = store.manifest(region_id)
    t = len(m["epochs"]) - 1 if epoch is None else int(epoch)
    mask = _mask(region_id, geometry)
    if not mask.any():
        return {"error": "polygon does not overlap this region"}
    area = store.cell_area_km2(region_id)
    stat = lambda a: dict(mean=float(np.nanmean(a[mask])), min=float(np.nanmin(a[mask])), max=float(np.nanmax(a[mask])))  # noqa: E731
    out: dict = {"region": region_id, "epoch": t, "date": m["epochs"][t], "area_km2": float(mask.sum() * area), "layers": {}, "provenance": {}}
    with np.errstate(all="ignore"):
        for L in m["layers"]:
            a = store.layer(region_id, L["id"])
            out["layers"][L["id"]] = stat(a if L.get("static") else a[t])
            out["provenance"][L["id"]] = L.get("source", "observed")
        vv = store.layer(region_id, "s1_vv")
        lc = store.layer(region_id, "landcover")
        occ = store.layer(region_id, "water_occurrence")
        ev = (m.get("event") or {}).get("epoch")
        ref = ev - 1 if ev and t >= ev else 0
        change = vv[t] - vv[ref]
        built = (lc == 50) & mask
        out["infrastructure"] = {"built_km2": float(built.sum() * area),
                                 "changed_pct": float(((np.abs(change) > 3) & built).sum() / max(1, built.sum()) * 100), "basis": "Sentinel-1 VV change > 3 dB"}
        water = (vv[t] < -18) & mask
        out["surface_water"] = {"water_km2": float(water.sum() * area), "flood_km2": float((water & (occ < 50)).sum() * area),
                                "basis": "Sentinel-1 VV < -18 dB; flood = normally dry per JRC occurrence"}
        src = next((L["source"] for L in m["layers"] if L["id"] == "deformation"), None)
        if src is None:  # no measured interferograms for this region
            return out
        defo = store.layer(region_id, "deformation")
        out["velocity_cm_yr"] = {**stat(_velocity(defo, _days(m), t)), "provenance": src}
        d = np.where(mask, defo[t], np.nan)
        if np.isfinite(d).any():
            j, i = np.unravel_index(np.nanargmax(np.abs(d)), d.shape)
            lon, lat = store.cell_centers(region_id)
            out["max_displacement"] = dict(value_cm=float(d[j, i]), lon=float(lon[j, i]), lat=float(lat[j, i]), provenance=src)
    return out
