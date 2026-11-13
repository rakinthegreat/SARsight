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
covers the whole timeline: Kahramanmaraş spans the 2023 earthquake, Campi Flegrei and Mexico City run to autumn 2026,
and the farm and coast regions end at the latest pass. Regions without an InSAR archive get motion from NISAR once
you run the fetch with your Earthdata login.

Refresh the data (no credentials needed, about 1 minute per region):

```bash
backend/.venv/Scripts/python scripts/fetch_real_data.py   # → data/real/   (macOS/Linux: backend/.venv/bin/python)
npm run data:build                                         # → public/data/
```

**Real NISAR science data:**
1. Create a free account at https://urs.earthdata.nasa.gov.
2. Set the credentials in your own shell. Never commit them:
   ```bash
   export EARTHDATA_USERNAME=...
   export EARTHDATA_PASSWORD=...
   ```
3. Install the extra libraries and re-run the fetch:
   ```bash
   pip install earthaccess h5py
   ```

The latest NISAR GCOV (HH/HV) and GUNW (motion, coherence) for each region are then added as observed layers.

Regions and dates are defined in `data/regions.json`. See [DATA.md](DATA.md) for the file format and [backend/README.md](backend/README.md) for the API.

## Any place, on demand

The 10 regions are showcases. To analyse any other place, run the backend:

```
cd backend
.venv\Scripts\activate
uvicorn app.main:app --port 8000
```

Then draw or tap anywhere in the app and choose **Prepare this place**. In about a minute the backend builds a new area from real Sentinel-1, elevation, land cover and water-history data. The app remembers the area and adds it to your places.
