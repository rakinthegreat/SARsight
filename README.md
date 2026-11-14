# SARsight

SARsight is a 4D geospatial platform that democratizes NASA-ISRO SAR (NISAR) data by transforming complex microwave signals into actionable insights. It features a multi-interface architecture containing three specialized modules: 

**EconAssist** optimizes global livelihoods, like agriculture and maritime navigation, using L-band and S-band radar data 

**HazAssist** supports rapid disaster response by mapping floods, structural damage, and ground deformation through radar interferometry (InSAR) and coherence loss

**VisAssist** provides an interactive 3D globe with a 12-day orbital time-slider to visualize dynamic surface changes. A custom polygon tool generates plain-language regional risk assessments on demand.

## Team SARtorial
This project is to be built for the NASA Space Apps Challenge 2026.

**Local Event**: Rajshahi

**Team Members:**
- Abrar Nafis Sadeque
- Arshia Rawnak Sarwar
- Bikram Roy Utsa
- Md Rakinuzzaman Talukder
- Raisa Jaman
## Running it

```bash
npm install
npm run dev            # http://localhost:3000
npm run build && npm start
```

Built with Next.js 15 (App Router), three.js via React Three Fiber, and d3-geo with world-atlas for the globe base map. It works on desktop and mobile.

Deep links use the form `/#<module>/<region>`, for example `/#haz/sylhet-haor` or `/#econ/rajshahi-barind`.

## Data: real observations first

Every region uses **real satellite observations only — nothing is simulated**, pre-fetched onto a 96×96 grid so the app needs no live API during a demo:

| Layer | Source |
|---|---|
| Radar time series (VV/VH): up to 30 consecutive passes on one track, 12 days apart (about a year) | Sentinel-1 RTC (ESA Copernicus) via Microsoft Planetary Computer |
| **Ground motion and coherence (InSAR time series)** on the same pass dates | Sentinel-1 interferograms from COMET LiCSAR (no login), chained pass to pass |
| L-band radar, NISAR's analogue | ALOS-2 PALSAR-2 2021 mosaic (JAXA) |
| Terrain, land cover, 38-year water history | Copernicus DEM, ESA WorldCover, JRC Global Surface Water |
| Rain and soil wetness | NASA POWER |
| Earthquakes | USGS |
| Live floods, storms, fires reported near a HazAssist place (fetched live, last 30 days within 300 km) | NASA EONET |
| **NISAR passes and quick-look images** | ASF DAAC (real NISAR GUNW/GCOV, public browse images) |
| **NISAR ground motion series, L-band images** (with an Earthdata login) | NISAR GUNW pairs chained into cumulative motion; latest GCOV HH/HV |

Ground-motion layers appear only where real interferograms exist. Each region's window is chosen so the motion
covers the whole timeline: Kahramanmaraş spans the 2023 earthquake, Campi Flegrei and Mexico City run to June 2026
(the latest COMET LiCSAR interferograms), and the farm and coast regions end at the latest pass. Mexico City and
Campi Flegrei also carry NISAR ground motion; the farm, coast and flood regions have no ground-motion layer.

Refresh the data (no credentials needed, about 1 minute per region):

```bash
backend/.venv/Scripts/python scripts/fetch_real_data.py   # → data/real/   (macOS/Linux: backend/.venv/bin/python)
npm run data:build                                         # → public/data/
```

**Real NISAR science data:**
1. Create a free account at https://urs.earthdata.nasa.gov.
2. Copy `.env.example` to `.env` in the repo root and fill in `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`
   (or export them in your shell). `.env` is gitignored: never commit it.
3. Add NISAR to the ready places without refetching anything else:
   ```bash
   backend/.venv/Scripts/python scripts/add_nisar.py            # every region (macOS/Linux: backend/.venv/bin/python)
   backend/.venv/Scripts/python scripts/add_nisar.py dhaka      # or just some
   ```
   This writes the latest NISAR GCOV scan (HH/HV) straight into `public/data/<id>/` and updates `catalog.json`.
   Mexico City and Campi Flegrei also get NISAR ground motion (GUNW pairs chained over time); that part is slow,
   about one 2.3 GB file per 12 days. No `npm run data:build` is needed afterwards.

A full `scripts/fetch_real_data.py` run with the login set also adds NISAR, but refetches every other layer too.

Regions and dates are defined in `data/regions.json`. See [DATA.md](DATA.md) for the file format and [backend/README.md](backend/README.md) for the API.

## Any place, on demand

The 10 regions are showcases. To analyse any other place, run the backend:

```
cd backend
.venv\Scripts\activate
uvicorn app.main:app --port 8000
```

Then draw or tap anywhere in the app and choose **Prepare this place**. In about a minute the backend builds a new area from real Sentinel-1, elevation, land cover and water-history data. The app remembers the area and adds it to your places. With `SARSIGHT_CUSTOM_NISAR=1` and an Earthdata login, the latest NISAR scan is added a minute or two later, while the place is already open.

## Deploying

- **Frontend (Vercel):** set the variables in [`deploy/vercel.env`](deploy/vercel.env) under Project → Settings → Environment Variables, then redeploy.
- **Backend (any Linux server):** Docker + Caddy with automatic HTTPS. See [`deploy/server/README.md`](deploy/server/README.md).
  The image clones `main` from GitHub at build time, so rebuild it to pick up new commits.

## Settings

| Variable | Where | What it does |
|---|---|---|
| `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD` | `.env` or shell; `deploy/server/backend.env` on the server | Earthdata login for NISAR science layers. Secret. |
| `SARSIGHT_SKIP_NISAR=1` | data scripts | Skip NISAR entirely (credential-free runs, CI) |
| `SARSIGHT_CUSTOM_NISAR=1` | backend | Add NISAR to on-demand places (off by default) |
| `SARSIGHT_NISAR_MOTION=0/1` | `fetch_real_data.py` | Fetch NISAR ground motion; `add_nisar.py` sets it per region |
| `SARSIGHT_DATA` | backend | Data folder the API reads (default `public/data`) |
| `NEXT_PUBLIC_API` | frontend build | Backend address (default `http://localhost:8000`) |
| `NEXT_PUBLIC_DATA_BASE` | frontend build | Where the app loads region data (default `/data`) |
