"""
Add NISAR science layers to the built showcase data in public/data/<id>/, in place, without refetching anything else.

Uses each region's existing manifest (bbox, pass dates) and fetch_real_data.fetch_nisar_science(): GCOV backscatter
(nisar_hh / nisar_hv, latest pass) and GUNW pairs chained into a motion series (nisar_disp / nisar_coh). Where a
region has no Sentinel-1 InSAR, NISAR motion becomes its deformation / coherence layer, as in fetch_real_data.py.
Also refreshes the NISAR pass catalogue. Needs EARTHDATA_USERNAME / EARTHDATA_PASSWORD in .env.

Motion pairs are slow (one 2.3 GB file per 12 days), so they are only read for MOTION regions, where ground motion
is the story; every other region gets the latest scan only.

Usage (from repo root):  backend/.venv/bin/python scripts/add_nisar.py [region-id ...]
"""
from __future__ import annotations

import fcntl
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_real_data import SOURCES, fetch_nisar_science, nisar_catalogue  # noqa: E402

MOTION = {"campi-flegrei", "bingham-canyon", "lost-hills", "mexico-city"}
DATA = Path(__file__).resolve().parents[1] / "public" / "data"
LABELS = {"nisar_hh": "NISAR L-band HH", "nisar_hv": "NISAR L-band HV", "nisar_disp": "NISAR ground motion (cumulative)",
          "nisar_coh": "NISAR coherence (12-day pair)", "deformation": "Ground motion, NISAR L-band InSAR", "coherence": "Coherence, NISAR L-band InSAR"}


def add(rid: str) -> dict:
    d = DATA / rid
    m = json.loads((d / "manifest.json").read_text(encoding="utf8"))
    bbox, dates = m["bbox"], m["epochs"]
    print(f"== {rid}  {dates[0]} .. {dates[-1]}")
    try:
        m["nisar"] = nisar_catalogue(bbox)
    except Exception as e:
        print("    ASF catalogue failed, keeping the old one:", e)
    have = {L["id"] for L in m["layers"]}
    os.environ["SARSIGHT_NISAR_MOTION"] = "1" if rid in MOTION else "0"
    science = fetch_nisar_science({"id": rid}, bbox, m.get("nisar", []), dates)
    if "nisar_disp" in science and ("deformation" not in have or next(L for L in m["layers"] if L["id"] == "deformation")["source"] == "asf"):
        science["deformation"], science["coherence"] = science.pop("nisar_disp"), science.pop("nisar_coh")
    for lid, v in science.items():
        a = v.pop("data")
        a.astype("<f4").tofile(d / f"{lid}.f32")
        ok = a[np.isfinite(a)]
        layer = {"id": lid, "unit": "dB" if lid in ("nisar_hh", "nisar_hv") else ("cm" if lid in ("nisar_disp", "deformation") else ""),
                 "label": LABELS[lid], "file": f"{lid}.f32", "static": a.ndim == 2, "observed": True, "source": "asf",
                 "range": [int(np.floor(ok.min())), int(np.ceil(ok.max()))] if ok.size else [0, 0], **v}
        m["layers"] = [L for L in m["layers"] if L["id"] != lid] + [layer]
    (d / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print(f"    added: {', '.join(science) or 'nothing (no usable NISAR coverage)'}")
    return {"passes": len(m.get("nisar", [])), "layers": sorted(science)}


def save_catalog(rid: str, passes: int):
    """Several copies of this script may run at once (one per region): update the shared catalog under a file lock."""
    path = DATA / "catalog.json"
    with open(path, "a") as lock:  # lock the catalog itself; "a" does not truncate it
        fcntl.flock(lock, fcntl.LOCK_EX)
        cat = json.loads(path.read_text(encoding="utf8"))
        for entry in cat["regions"]:
            if entry["id"] == rid:
                entry["nisarPasses"] = passes
        cat["sources"]["asf"] = SOURCES["asf"]
        path.write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf8")


if __name__ == "__main__":
    ids = sys.argv[1:] or [e["id"] for e in json.loads((DATA / "catalog.json").read_text(encoding="utf8"))["regions"]]
    summary = {}
    for rid in ids:
        t0 = time.time()
        try:
            summary[rid] = res = add(rid)
            save_catalog(rid, res["passes"])
        except Exception as e:
            print(f"!! {rid} failed: {type(e).__name__}: {e}")
            summary[rid] = {"error": str(e)}
        print(f"   done in {time.time() - t0:.0f}s")
    print("\nSUMMARY")
    for rid, s in summary.items():
        print(f"  {rid:16s} {s}")
