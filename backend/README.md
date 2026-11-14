# SARsight backend

FastAPI service that implements the architecture's backend and Area of Interest (AOI) engine. It reads the same measured data the frontend uses (`public/data`). Nothing is simulated.

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000           # interactive docs at http://localhost:8000/docs
```

| Route | Purpose | Status |
|---|---|---|
| `GET /api/health` | Shows whether an Earthdata login is configured | ✅ |
| `GET /api/catalog`, `/api/regions/{id}` | Region list and manifests | ✅ |
| `GET /api/granules?bbox&start&end&product` | **Live** NISAR granule search on the public ASF API (GUNW, GCOV, RSLC, GSLC…) | ✅ Live, no login needed |
| `POST /api/aoi/evaluate` | Zonal stats for a GeoJSON polygon: layer stats, velocity, location of maximum displacement, coherence loss, infrastructure safety, open water and flooded vegetation | ✅ Real computation using shapely and numpy |
| `GET /api/regions/{id}/timeseries?lon&lat` | Runs the pipeline at one pixel: builds a 12/24/36-day pair network from the measured motion, applies tropospheric correction, then SBAS inversion | ✅ Measured data (404 where a region has no InSAR) |
| `POST /api/areas` `{polygon, scenario, name?, window?}` | **On-demand area.** Builds a new region around a place the showcase squares don't cover, using the same free sources. Takes about a minute. | ✅ Real data |
| `GET /api/areas/{id}`, `GET /api/areas` | Job progress (queued, running and its stage, done, failed), and the list of prepared areas | ✅ |
| `GET /areas/{id}/site/*` | Files the app loads for a prepared area | ✅ |
| `GET /api/tiles/...` | Map tile server | ⛔ Returns 501; deploy TiTiler over the COGs |

## Pipeline (`app/pipeline`)

1. **`ingest.py`** searches the ASF DAAC live, with no login. Downloads need `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD` and `earthaccess`. Data for the app itself comes from `scripts/fetch_real_data.py`.
2. **`convert.py`** converts HDF5 to Cloud-Optimized GeoTIFF using `gdal_translate` commands, or directly with h5py and rasterio. It also handles unit conversion: phase to cm, and linear γ⁰ to dB.
3. **`processing.py`** has three steps, each with a production equivalent:

| Step | What runs today | Production equivalent |
|---|---|---|
| `unwrap` | Itoh unwrapping | SNAPHU |
| `troposphere` | phase–elevation regression | PyAPS with ERA5 |
| `sbas` | small-baseline least squares | GIAnT/MintPy-style inversion |

4. **`scripts/nisar_to_sarsight.py`** (repo root) resamples the COGs into the static grids the frontend reads.


## NISAR data

NISAR science data is live and already in the showcase places. `scripts/add_nisar.py` (see the root README) streams the
latest GCOV scan, plus chained GUNW motion for Mexico City and Campi Flegrei, straight into `public/data`.

For a NISAR download you already have on disk, the manual path still works:
1. Check the HDF5 dataset paths with `h5py.File(f).visit(print)`, and update `convert.DATASETS` if they differ.
2. Run `convert.h5_to_cogs()` (or the GDAL commands) for each granule.
3. Run `scripts/nisar_to_sarsight.py` for each region.

If the package is OPERA or ARIA data from Sentinel-1 rather than NISAR, these products map to SARsight layers:

| Product | SARsight layer |
|---|---|
| OPERA DISP | `deformation` |
| ARIA GUNW | `deformation` + `coherence` |
| OPERA DSWx | water (write it as `hh`: water = -25, land = -8) |

## On-demand areas

When someone draws or taps outside the 10 showcase regions, the app offers **Prepare this place** and calls `POST /api/areas`.

- **How a job runs:** the backend writes `data/custom/<id>/region.json`, then runs `scripts/fetch_real_data.py --custom` (without NISAR) and `node scripts/build-data.mjs --custom <id>` in a background queue, one job at a time. The area is marked done and opens as soon as this finishes, in about a minute.
- **Size of an area:** at least 0.06° (about 70 m cells) and at most 1°. Dates default to the last 150 days.
- **Where results go:** `data/custom/`, which is gitignored.
- **NISAR science layers** are a second step, off by default. With `SARSIGHT_CUSTOM_NISAR=1` and Earthdata credentials, a background thread runs `scripts/add_nisar.py --dir data/custom/<id>/site` (latest GCOV scan only, about 1.5 minutes) after the area is ready. `GET /api/areas/{id}` reports it as `nisar: {state, stage, pct}`; a failure only skips NISAR and never breaks the area.
- **Server:** see `deploy/server/README.md` for running this API with Docker and HTTPS.
- **Frontend address:** the frontend finds the backend through `NEXT_PUBLIC_API` (default `http://localhost:8000`).
