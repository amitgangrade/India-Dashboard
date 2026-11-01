"""
Calibration: run a small pilot population through the same kernel and nudge intercepts until
state/national targets (literacy, LFPR, sectors, earnings, digital access, ...) are matched.
"""
import time

import numpy as np

import model as M
import params as P


def segment_counts(total=P.TOTAL_POPULATION):
    """Exact integer population per (state, urban) segment; sums to `total` exactly."""
    pops = np.array([s["pop"] for s in P.STATES], dtype=float)
    raw = pops / pops.sum() * total
    n = np.floor(raw).astype(np.int64)
    rem = total - n.sum()
    n[np.argsort(-(raw - n))[:rem]] += 1
    seg = np.zeros((P.N_STATES, 2), dtype=np.int64)
    for s, st in enumerate(P.STATES):
        u = int(round(n[s] * st["urb"] / 100.0))
        seg[s] = [n[s] - u, u]
    assert seg.sum() == total
    return seg  # [state, urban]


def run_segment(T, s, u, n, seed, sample_rate=0.0, chunk=262_144, out=None):
    nch = (n + chunk - 1) // chunk
    if out is None:
        out = np.empty(n, dtype=np.uint64)
    smask = np.empty(n, dtype=np.uint8)
    cube = np.zeros((nch, M.N_SEXAGE, M.N_METRIC), dtype=np.int64)
    cats = np.zeros((nch, M.N_CAT), dtype=np.int64)
    M.gen_block(s, u, n, seed, chunk, T["agesex"][2 * s + u], T["relig"][2 * s + u], T["caste"],
                T["lang_cdf"], T["SP"], T["GP"], T["AT"], T["NT"], T["LT"], sample_rate, out, smask, cube, cats)
    return out, smask, cube.sum(0), cats.sum(0)


def pilot(T, seg, size=2_500_000, min_seg=6000, seed=777):
    rows, weights = [], []
    for s in range(P.N_STATES):
        for u in range(2):
            N = seg[s, u]
            if N == 0:
                continue
            n = int(max(min_seg, round(N * size / seg.sum())))
            out, _, _, _ = run_segment(T, s, u, n, seed + 1000 * s + 17 * u, chunk=65_536)
            rows.append(out)
            weights.append(np.full(n, N / n))
    arr = np.concatenate(rows)
    return M.decode_all(arr), np.concatenate(weights)


def _logit(p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


def _wmean(mask, w, sel=None):
    if sel is not None:
        mask, w = mask[sel], w[sel]
    return (w * mask).sum() / max(w.sum(), 1e-9)


def _by_group(val, w, grp, ngrp, sel):
    num = np.bincount(grp[sel], weights=(w * val)[sel], minlength=ngrp)
    den = np.bincount(grp[sel], weights=w[sel], minlength=ngrp)
    return num / np.maximum(den, 1e-9)


def measure(D, w, T):
    S = P.N_STATES
    age, sex, st, act, edu = D["age"], D["sex"], D["state"], D["activity"], D["education"]
    out = {}
    lit = (edu >= 1).astype(float)
    a7 = age >= 7
    a15 = age >= 15
    out["lit"] = np.stack([_by_group(lit, w, st, S, a7 & (sex == k)) for k in (0, 1)], 1) * 100
    lfp = ((act == 3) | (act >= P.FIRST_WORKER_ACTIVITY)).astype(float)
    out["lfp"] = np.stack([_by_group(lfp, w, st, S, a15 & (sex == k)) for k in (0, 1)], 1) * 100
    a25 = age >= 25
    out["edu"] = np.array([_wmean(edu >= k, w, a25) for k in range(2, 8)])
    out["grad"] = _by_group((edu >= 6).astype(float), w, st, S, a25) * 100
    inlf = a15 & (lfp > 0)
    out["ue"] = np.array([_wmean(act == 3, w, inlf & (sex == k)) for k in (0, 1)])
    wk = act >= P.FIRST_WORKER_ACTIVITY
    sec = act - P.FIRST_WORKER_ACTIVITY
    out["sector"] = np.array([_wmean(sec == k, w, wk) for k in range(7)])
    out["agri"] = _by_group((sec == 0).astype(float), w, st, S, wk) * 100
    earn = D["earnings"] * M.EARNINGS_UNIT
    out["earn"] = np.array([_by_group(earn.astype(float), w, D["emp_type"], 4, wk)[k] for k in (1, 2, 3)])
    out["smart"] = np.array([_wmean(D["smartphone"] == 1, w, a15 & (sex == k)) for k in (0, 1)])
    out["net"] = np.array([_wmean(D["internet"] == 1, w, a15 & (sex == k)) for k in (0, 1)])
    out["bank"] = np.array([_wmean(D["bank"] == 1, w, a15 & (sex == k)) for k in (0, 1)])
    out["ins"] = _by_group(D["insurance"].astype(float), w, st, S, np.ones_like(a7)) * 100
    out["dis"] = _wmean(D["disability"] == 1, w)
    out["wealth"] = np.array([_wmean(D["wealth"] <= k, w) for k in range(4)])
    return out


def calibrate(T, seg, iterations=9, verbose=True):
    tg = T["targets"]
    SP, GP = T["SP"], T["GP"]
    t0 = time.time()
    for it in range(iterations):
        D, w = pilot(T, seg)
        m = measure(D, w, T)
        SP[:, M.SP_LIT_M] += 1.2 * (_logit(tg["lit"][:, 0] / 100) - _logit(m["lit"][:, 0] / 100))
        SP[:, M.SP_LIT_F] += 1.2 * (_logit(tg["lit"][:, 1] / 100) - _logit(m["lit"][:, 1] / 100))
        SP[:, M.SP_LF_M] += 1.2 * (_logit(tg["lfp"][:, 0] / 100) - _logit(m["lfp"][:, 0] / 100))
        SP[:, M.SP_LF_F] += 1.2 * (_logit(tg["lfp"][:, 1] / 100) - _logit(m["lfp"][:, 1] / 100))
        for k, t in enumerate(P.EDU_25PLUS_AT_LEAST):
            if t is not None:
                GP[M.G_CUT + k] -= 1.2 * (_logit(np.array(t)) - _logit(np.array(m["edu"][k])))
        SP[:, M.SP_HIGH] += 1.2 * (_logit(tg["grad"] / 100) - _logit(m["grad"] / 100))
        GP[M.G_CUT:M.G_CUT + 6] = np.maximum.accumulate(np.maximum(GP[M.G_CUT:M.G_CUT + 6], 0.05))
        GP[M.G_UE:M.G_UE + 2] += 1.1 * (_logit(np.array(P.UNEMPLOYMENT_TARGET)) - _logit(m["ue"]))
        ts = np.array(P.SECTOR_TARGET)
        ref = np.log(ts[4] / max(m["sector"][4], 1e-6))
        for k in (1, 2, 3, 5, 6):
            GP[M.G_SECT + k] += np.log(ts[k] / max(m["sector"][k], 1e-6)) - ref
        SP[:, M.SP_AGRI] += 1.1 * (_logit(tg["agri"] / 100) - _logit(m["agri"] / 100))
        for j, k in enumerate((1, 2, 3)):
            GP[M.G_INC + j] += np.log(P.EARNINGS_TARGET[k] / max(m["earn"][j], 1.0))
        GP[M.G_DIG:M.G_DIG + 2] += 1.2 * (_logit(np.array(P.SMARTPHONE_TARGET)) - _logit(m["smart"]))
        GP[M.G_INT:M.G_INT + 2] -= 1.2 * (_logit(np.array(P.INTERNET_TARGET)) - _logit(m["net"]))
        GP[M.G_BANK:M.G_BANK + 2] += 1.2 * (_logit(np.array(P.BANK_TARGET)) - _logit(m["bank"]))
        SP[:, M.SP_INS] += 1.2 * (_logit(tg["ins"] / 100) - _logit(m["ins"] / 100))
        GP[M.G_DIS] += 1.1 * (_logit(np.array(P.DISABILITY_TARGET)) - _logit(np.array(m["dis"])))
        wt = np.array([0.2, 0.4, 0.6, 0.8])
        GP[M.G_WCUT:M.G_WCUT + 4] -= 0.9 * (_logit(m["wealth"]) - _logit(wt))
        GP[M.G_WCUT:M.G_WCUT + 4] = np.sort(GP[M.G_WCUT:M.G_WCUT + 4])
        if verbose:
            err_lit = np.abs(m["lit"] - tg["lit"]).max()
            err_lfp = np.abs(m["lfp"] - tg["lfp"]).max()
            err_grad = np.abs(m["grad"] - tg["grad"]).max()
            print(f"  calib iter {it + 1}: max|lit err|={err_lit:5.2f}pp  max|lfp err|={err_lfp:5.2f}pp  max|grad err|={err_grad:4.2f}pp  "
                  f"ue={m['ue'].round(4)}  sector={m['sector'].round(3)}  earn={m['earn'].round(0)}  "
                  f"wealth={m['wealth'].round(3)}  ({time.time() - t0:.1f}s)")
    return T
