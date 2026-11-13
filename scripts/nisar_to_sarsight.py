"""
Convert real NISAR (or any SAR) rasters into the SARsight data repo format.

Input: one folder per region with per-date GeoTIFFs named <layer>_<YYYY-MM-DD>.tif
       layer in {deformation, coherence, backscatter, hh, sband, moisture}; deformation in cm (LOS),
       backscatter/hh/sband in dB, moisture in %, coherence 0..1. Missing layers are filled with NaN.
       Optional elevation.tif (DEM, metres, no date) for terrain profiles.
       (NISAR GUNW/GCOV HDF5 products: export the needed grids to GeoTIFF first, e.g. with
        gdal_translate HDF5:"file.h5"://science/LSAR/GUNW/grids/frequencyA/... out.tif,
        and convert unwrapped phase (rad) to cm with  -phase * wavelength / (4*pi) * 100,
        L-band wavelength = 0.2384 m.)

Usage:
  python scripts/nisar_to_sarsight.py --src ./nasa/dhaka --id dhaka --name "Dhaka Subsidence" \
      --place Dhaka --country Bangladesh --scenario subsidence --modules haz,vis --size 64

Requires: pip install rasterio numpy
Then rebuild public/data/catalog.json by re-running this for each region (it upserts).
"""
import argparse, json, pathlib, re
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds

LAYERS = {
    "deformation": ("cm", [-12, 12], "Ground motion (LOS, cumulative)"),
    "coherence": ("", [0, 1], "Interferometric coherence"),
    "backscatter": ("dB", [-25, 0], "Backscatter σ⁰ HV"),
    "hh": ("dB", [-25, 5], "Backscatter σ⁰ HH"),
    "sband": ("dB", [-25, 0], "S-band backscatter σ⁰ HV"),
    "moisture": ("%", [0, 50], "Volumetric soil moisture"),
    "elevation": ("m", [0, 1], "Elevation (DEM)"),  # static: supply elevation.tif (no date)
}

def main():
    ap = argparse.ArgumentParser()
    for k in ["src", "id", "name", "place", "country", "scenario"]:
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--modules", default="haz,vis")
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--out", default="public/data")
    ap.add_argument("--event-date"); ap.add_argument("--event-label", default="Event")
    a = ap.parse_args()

    src = pathlib.Path(a.src)
    files = {}
    for f in src.glob("*.tif"):
        m = re.match(r"(\w+)_(\d{4}-\d{2}-\d{2})\.tif$", f.name)
        if m and m.group(1) in LAYERS:
            files.setdefault(m.group(1), {})[m.group(2)] = f
    dates = sorted({d for v in files.values() for d in v})
    if not dates:
        raise SystemExit("no <layer>_<date>.tif files found")

    N = a.size
    bbox = None
    out = pathlib.Path(a.out) / a.id
    out.mkdir(parents=True, exist_ok=True)
    dem = src / "elevation.tif"
    if dem.exists():
        with rasterio.open(dem) as ds:
            z = ds.read(1, out_shape=(N, N), resampling=Resampling.average, masked=True).astype("f4").filled(np.nan)
        LAYERS["elevation"] = ("m", [float(np.nanmin(z)), float(np.nanmax(z))], "Elevation (DEM)")
    else:
        z = np.zeros((N, N), "f4")
    for layer in [l for l in LAYERS if l != "elevation"]:
        cube = np.full((len(dates), N, N), np.nan, dtype="<f4")
        for t, d in enumerate(dates):
            f = files.get(layer, {}).get(d)
            if not f:
                continue
            with rasterio.open(f) as ds:
                arr = ds.read(1, out_shape=(N, N), resampling=Resampling.average, masked=True).astype("f4")
                cube[t] = arr.filled(np.nan)
                if bbox is None:
                    bbox = [round(x, 5) for x in transform_bounds(ds.crs, "EPSG:4326", *ds.bounds)]
        if layer == "deformation":  # re-reference to first pass
            cube -= cube[0]
        cube.tofile(out / f"{layer}.f32")
    z.astype("<f4").tofile(out / "elevation.f32")

    w, s, e, n = bbox
    entry = dict(id=a.id, name=a.name, place=a.place, country=a.country, scenario=a.scenario,
                 modules=a.modules.split(","), center=[(w + e) / 2, (s + n) / 2], bbox=bbox, simulated=False)
    manifest = dict(entry, source="NASA/ISRO NISAR", grid=dict(cols=N, rows=N), dtype="float32", epochs=dates,
                    layers=[dict(id=k, unit=u, range=r, label=l, file=f"{k}.f32", **({"static": True} if k == "elevation" else {}))
                            for k, (u, r, l) in LAYERS.items()],
                    features=[])
    if a.event_date:
        ep = next((i for i, d in enumerate(dates) if d >= a.event_date), len(dates) - 1)
        manifest["event"] = dict(date=a.event_date, epoch=ep, label=a.event_label)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf8")

    cat_path = pathlib.Path(a.out) / "catalog.json"
    cat = json.loads(cat_path.read_text(encoding="utf8")) if cat_path.exists() else {"version": 1, "regions": []}
    cat["regions"] = [r for r in cat["regions"] if r["id"] != a.id] + [entry]
    cat_path.write_text(json.dumps(cat, indent=2, ensure_ascii=False), encoding="utf8")
    print(f"wrote {out} ({len(dates)} epochs)")

if __name__ == "__main__":
    main()
