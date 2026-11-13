"""
Step 3 — InSAR processing: phase unwrapping, tropospheric correction, SBAS time series.

These run on numpy over the measured grids. Production equivalents:
  unwrap()       -> SNAPHU / ISCE3 (NISAR GUNW already ships unwrapped phase; needed for RIFG/ARIA)
  troposphere()  -> PyAPS (pyaps3) with ECMWF ERA5; here: phase–elevation regression (a standard fallback)
  sbas()         -> GIAnT / MintPy small-baseline inversion; here: least squares over the 12-day network
"""
from __future__ import annotations

import numpy as np

L_BAND_CM = 23.84


def wrap(phase: np.ndarray) -> np.ndarray:
    return (phase + np.pi) % (2 * np.pi) - np.pi


def unwrap(wrapped: np.ndarray) -> np.ndarray:
    """Itoh row-then-column unwrapping. Fine for smooth, coherent fields; use SNAPHU for full-resolution real data."""
    a = np.nan_to_num(wrapped)
    col = np.unwrap(a[:, 0])                 # unwrap down the first column
    rows = np.unwrap(a, axis=1)              # then along every row, anchored to that column
    out = rows - rows[:, :1] + col[:, None]
    out[np.isnan(wrapped)] = np.nan
    return out


def troposphere(phase_cm: np.ndarray, elevation: np.ndarray, pyaps: bool = False) -> tuple[np.ndarray, float]:
    """Remove the stratified (elevation-correlated) delay from one interferogram.

    PLACEHOLDER for PyAPS: with pyaps3 + ECMWF credentials the delay would be computed from ERA5
    pressure/temperature/humidity. Returns (corrected, slope_cm_per_km).
    """
    if pyaps:
        raise NotImplementedError("configure ~/.cdsapirc and call pyaps3.Geogrid(...) here")
    ok = np.isfinite(phase_cm) & np.isfinite(elevation)
    if ok.sum() < 10:
        return phase_cm, 0.0
    slope, icpt = np.polyfit(elevation[ok] / 1000.0, phase_cm[ok], 1)
    return phase_cm - (slope * elevation / 1000.0 + icpt), float(slope)


def sbas(pairs: list[tuple[int, int]], ifgs_cm: np.ndarray, n_epochs: int) -> np.ndarray:
    """Small-baseline inversion: interferograms [P, ...] for (ref, sec) epoch pairs -> displacement [T, ...].

    Solves G · d = ifg in least squares with d[0] = 0 (GIAnT/MintPy-style, no regularisation).
    """
    G = np.zeros((len(pairs), n_epochs - 1))
    for k, (i, j) in enumerate(pairs):
        if j > 0:
            G[k, j - 1] += 1
        if i > 0:
            G[k, i - 1] -= 1
    shape = ifgs_cm.shape[1:]
    Y = np.nan_to_num(ifgs_cm.reshape(len(pairs), -1))
    sol, *_ = np.linalg.lstsq(G, Y, rcond=None)
    out = np.vstack([np.zeros((1, Y.shape[1])), sol]).reshape((n_epochs, *shape))
    out[:, np.isnan(ifgs_cm).all(axis=0)] = np.nan
    return out


def network(n_epochs: int, max_span: int = 3) -> list[tuple[int, int]]:
    """Small-baseline pair network: every pair up to `max_span` repeats (12, 24, 36 days)."""
    return [(i, j) for i in range(n_epochs) for j in range(i + 1, min(n_epochs, i + max_span + 1))]
