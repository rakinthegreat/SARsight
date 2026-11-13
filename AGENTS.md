# AGENTS.md: working on SARsight

This file is for collaborators and their coding agents (Claude Code, Codex, Cursor and others). Read it before changing anything.

## What this is

SARsight is **"NISAR for ordinary people"**. It takes radar data that is hard to use and turns it into answers people can act on.

| Module | Who it's for | What it should feel like |
|---|---|---|
| **EconAssist** | Farmers, fishers, mine and oil workers | Pick your work, tap your field, then get **one colour, one sentence and two pictures**. It must work for people who can barely read: big targets, Bangla, read-aloud. |
| **HazAssist** | Residents | "Is my home safe, and what should I do?" Same simple card. Keeps the polygon tool. |
| **VisAssist** | Researchers and professionals | The full 4D globe: every layer, a time slider, swipe, profiles, sources. Technical terms are fine here. |

**Rule of thumb:** dB, coherence, VV/VH and source credits belong in VisAssist only. Never let them leak into EconAssist or HazAssist.

## Run it

```bash
npm install
npm run dev                          # frontend at http://localhost:3000

cd backend                           # optional: needed for on-demand areas and the API
python -m venv .venv && .venv\Scripts\activate    # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

**Checking your work:**
- **Type-check:** `npx tsc --noEmit -p .`. This is the main check.
- **Do not run `next build` into `.next` while someone has `npm run dev` open.** It breaks their dev server with a ChunkLoadError. To test a production build, use `NEXT_DIST=.next-verify npx next build`, then delete `.next-verify` and run `git checkout tsconfig.json`, because Next rewrites that file.
- **Test in a real browser:** check desktop and a phone width of about 400 px, plus both languages.

## Git: this branch is private

- **Work on `private-build`.** Push only to the private repo, `github.com/rakinthegreat/SARsight-private`.
- **Never push this work to the public `rakinthegreat/SARsight`.** Never merge it into any branch that goes there.
- **Install the guard hook once per clone.** It blocks pushes of private commits to any other remote:
  ```bash
  git config core.hooksPath scripts/git-hooks
  git config sarsight.privateRoot 223082473d153f1e4d05f82bc4a94fff46ffcb95
  ```
- **Never commit:** `.env`, `data/real/`, `data/custom/`, `.venv`, `.next*`. All of these are already gitignored.

## Secrets

- **Earthdata credentials** go in a local `.env`, copied from `.env.example`, as `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`. They are only needed for real NISAR HDF5 layers.
- **Never paste credentials into chat, code, commits, logs or URLs.** Agents must not read `.env` back or log in with someone else's account.
- **For credential-free runs, set `SARSIGHT_SKIP_NISAR=1`.** This covers agent testing and CI. Everything else, such as Sentinel-1, the DEM, WorldCover, JRC water, ALOS-2, NASA POWER, USGS and the ASF catalogue, needs no login.

## Layout

```
app/                Next.js 15 App Router shell (layout, globals.css with all styles)
components/
  App.tsx           State + layout for all three modules; VisAssist panel lives here
  Assist.tsx        EconAssist / HazAssist flow: who → where → tap site → status card
  Globe.tsx         three.js globe (R3F): streaming Esri tiles, smooth zoom, exact sphere picking
  RegionMap.tsx     2D map: zoom/pan, draw anywhere, tap-a-point, shape editing handles
  Chart, Scrubber, Icon
lib/
  assist.ts         Plain-language advice, ALL user-facing EN/BN strings, profile (localStorage)
  analysis.ts       Indicators, risk report, crop/moisture/flood/wind/motion logic
  views.ts          Map layers, colour ramps, derived fields
  areas.ts          On-demand area client (talks to the backend)
  events.ts         Live natural events near a place from NASA EONET (no key; HazAssist card)
  data/             Types + loader (the only place that fetches region data)
scripts/
  fetch_real_data.py  Real observations → data/real/<id>/   (or --custom for one on-demand area)
  build-data.mjs      data/real → public/data (copies + manifest); --custom <id> for one area
backend/app/
  main.py           FastAPI routes; prepare.py = on-demand area job queue
  aoi.py, store.py, pipeline/ (ASF search, HDF5→COG, InSAR processing), sim/
data/regions.json   The 10 showcase regions
public/data/        Built showcase data the app loads (committed)
```

## Data rules

- **Showcase regions:** edit `data/regions.json`, then run `python scripts/fetch_real_data.py <id>` followed by `npm run data:build`. The file format is documented in `DATA.md`.
- **Nothing is simulated.** Every layer is a measurement with a `source`. Never add modelled or synthetic layers, never present derived values as more than they are, and never call a dark sea patch an "oil spill".
- **On-demand areas** are built by the backend into `data/custom/<id>/` and served at `/areas/<id>/site/`. The frontend finds the backend through `NEXT_PUBLIC_API`, which defaults to `http://localhost:8000`.

## Code conventions

- **Imports:** relative only, with no `@/` alias.
- **TypeScript:** pinned to 6.x, because TypeScript 7 breaks the Next toolchain.
- **Style:** small, dense, readable code. No new dependencies without a strong reason. Don't add comments that only restate the code.
- **User-facing text in EconAssist and HazAssist lives in `lib/assist.ts`** as `[English, Bangla]` pairs. Always add both. Bangla should be simple, spoken-style language. Have a native speaker check advice text.
- **Status** is always one of `ok | watch | alert`, shown with a colour **and** a symbol (✓ ! ✕), so it doesn't rely on colour alone.
- **UI:** dark, high contrast, large targets of at least 44 px, very little text. Every layout must work at 400 px wide.
- **Pointer math:** map hit-testing uses the square's on-screen rectangle, so anything placed inside `.rmap` automatically follows zoom and pan. Keep it that way.

## Before you push

1. `npx tsc --noEmit -p .` passes.
2. You clicked through your change in the browser at desktop width and phone width, with no console errors.
3. If you changed the data scripts, `npm run data:build` gives identical output for untouched regions (`git status public/data`).
4. You're on `private-build` and pushing to the `private` remote.
