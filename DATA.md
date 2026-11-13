# SARsight data repo

The app reads only the static files in `public/data/`. Two scripts produce them:

1. `scripts/fetch_real_data.py` downloads real observations into `data/real/<region>/`. This is gitignored and needs no credentials.
2. `scripts/build-data.mjs` copies those observations into `public/data/` with a manifest. Nothing is simulated.

The regions and their date windows are defined in `data/regions.json`.

```
public/data/
  catalog.json             { version, regions: [CatalogEntry], sources: {key: Source} }
  <region-id>/
    manifest.json          Manifest (lib/data/types.ts): epochs, layers + provenance, features, drivers, quakes, nisar passes
    s1_vv.f16  s1_vh.f16   Sentinel-1 RTC γ⁰ in dB, [epoch][row][col]                          observed
    lband_hh.f16 lband_hv.f16  ALOS-2 PALSAR-2 2021 γ⁰ in dB, [row][col]                       observed
    elevation.f16          Copernicus DEM, metres                                               observed
    landcover.f16          ESA WorldCover 2021 class codes (10 trees … 50 built-up … 80 water)  observed
    water_occurrence.f16   JRC % of months with water, 1984–2021                                observed
    deformation.f16        cumulative LOS motion in cm (+ towards the satellite), [epoch][row][col]   LiCSAR or NISAR, where available
    coherence.f16          coherence of the pair ending at each pass, [epoch][row][col]               LiCSAR or NISAR, where available
    nisar_hh/hv.f16        latest NISAR GCOV pass, dB, [row][col]                                     only with Earthdata login
    nisar_disp/coh.f16     NISAR GUNW chained motion + coherence, [epoch][row][col]                   only with Earthdata login
```

Each `.f16` file holds raw little-endian IEEE half-precision (float16) values; `manifest.dtype` says so, and older `float32` areas still load. Row 0 is the northern edge and `NaN` means no data. The grid is regular in lon/lat over `bbox = [west, south, east, north]`.

Every layer in a manifest carries `observed: true` and a `source` key into `catalog.sources`; the app credits the source of every layer.

**Pass dates.** `fetch_real_data.py` keeps one Sentinel-1 track and an unbroken run of passes exactly 12 days apart
(a single missed acquisition may leave one 24-day step). With a `licsar` frame in `regions.json` the track is the
frame's track, so the motion series shares the radar's dates exactly.

**Motion.** Interferograms between consecutive passes (shortest-baseline path through LiCSAR's network) are converted
to cm, referenced to the area's median, and summed. Pixels whose typical coherence is below 0.25 are masked.
NISAR GUNW pairs are chained the same way; NISAR values are shown from its first pass inside the window onwards.

## Derived in the app (no extra files)

| Product | Derived from |
|---|---|
| water classes | VV < −18 dB. Split into usual water vs. flood water using JRC occurrence ≥ 50%. Flooded vegetation where VV > −6 dB, VV − VH > 9 dB, over trees or wetland. |
| brightness change | VV(t) − VV(reference). The reference is the last pre-event pass, or the first pass. |
| relative change | brightness change minus the scene median, which removes weather-driven shifts |
| soil-moisture index | VV change detection against each pixel's driest and wettest pass |
| crop stage, CV, vigour, harvest window | VH time series over WorldCover cropland |
| sea wind | approximate inversion of a simplified C-band VV model |
| dark sea patches | VV more than 4 dB below the day's sea median. Flagged for inspection only, never declared spills. |
| fringes, velocity, damage proxy, sinkholes | from the measured deformation and coherence layers; hidden where a region has none |

## Adding a region

1. Add an entry to `data/regions.json` with `id`, `name`, `place`, `country`, `scenario`, `modules`, `center`, `span` (degrees) and a date `window` (or `"latest"` for the year up to today). Add `event` if there is a known event date, and `licsar` (a COMET frame id covering the area) for measured ground motion.
2. Run `python scripts/fetch_real_data.py <id>`, then `npm run data:build`.

Valid `scenario` values are `agriculture`, `marine`, `mine`, `extraction`, `earthquake`, `flood`, `subsidence`, `landslide` and `volcano`.
