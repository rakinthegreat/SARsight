"""
Step 2 — HDF5 → Cloud-Optimized GeoTIFF.

PLACEHOLDER: emits the GDAL commands a production deployment runs, and (if h5py + rasterio are
installed) performs the conversion directly in Python. Output COGs feed TiTiler (tiles) and the AOI
engine (zonal stats over HTTP range requests). `scripts/nisar_to_sarsight.py` then resamples COGs
into the static grids the frontend reads.
"""
from __future__ import annotations

from pathlib import Path

DATASETS = {
    "deformation": "//science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram/HH/unwrappedPhase",
    "coherence": "//science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram/HH/coherenceMagnitude",
    "nisar_hh": "//science/LSAR/GCOV/grids/frequencyA/HHHH",
    "nisar_hv": "//science/LSAR/GCOV/grids/frequencyA/HVHV",
}


def gdal_commands(h5: str, out_dir: str, date: str) -> list[str]:
    cmds = []
    for layer, ds in DATASETS.items():
        out = Path(out_dir) / f"{layer}_{date}.tif"
        cmds.append(f'gdal_translate -of COG -co COMPRESS=DEFLATE -co OVERVIEWS=AUTO HDF5:"{h5}":{ds} {out}')
    # unit conversions the SARsight layer conventions expect:
    cmds.append("# deformation: cm = -unwrappedPhase * 0.2384 / (4*pi) * 100   (gdal_calc.py)")
    cmds.append("# nisar_hh/nisar_hv: dB = 10*log10(gamma0 linear power)")
    return cmds


def h5_to_cogs(h5_path: str, out_dir: str, date: str, bbox: list[float]) -> list[Path]:
    """Direct conversion without the GDAL CLI (expects a real NISAR granule)."""
    import h5py
    import numpy as np
    import rasterio
    from rasterio.transform import from_bounds

    out = []
    with h5py.File(h5_path) as h5:
        for layer, ds in DATASETS.items():
            key = ds.lstrip("/")
            if key not in h5:
                continue
            a = h5[key][()].astype("f4")
            if layer == "deformation":
                a = -a * 0.2384 / (4 * np.pi) * 100
            elif layer in ("nisar_hh", "nisar_hv"):
                a = 10 * np.log10(np.maximum(a, 1e-6))
            p = Path(out_dir) / f"{layer}_{date}.tif"
            prof = dict(driver="COG", width=a.shape[1], height=a.shape[0], count=1, dtype="float32",
                        crs="EPSG:4326", transform=from_bounds(*bbox, a.shape[1], a.shape[0]), nodata=float("nan"))
            with rasterio.open(p, "w", **prof) as dst:
                dst.write(a, 1)
            out.append(p)
    return out
