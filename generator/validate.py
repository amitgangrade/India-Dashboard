#!/usr/bin/env python3
"""Build VALIDATION.md: exact statistics of the generated 1.5B population vs. the benchmarks it was calibrated to."""
import json
import os

import numpy as np

import model as M
import params as P

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def main(data_dir=os.path.join(ROOT, "data", "full"), out=os.path.join(ROOT, "VALIDATION.md")):
    z = np.load(os.path.join(data_dir, "aggregates.npz"))
    man = json.load(open(os.path.join(data_dir, "manifest.json"), encoding="utf-8"))
    cube = z["cube"].astype(np.float64)  # state, urban, sexage, metric
    cats = z["cats"].astype(np.float64)  # state, urban, cat
    S = P.N_STATES
    ages = np.arange(M.N_AGE)
    c = cube.reshape(S, 2, 3, M.N_AGE, M.N_METRIC)

    def agg(sel_state=slice(None), sex=slice(None), amin=0, amax=200, metric=M.M_COUNT):
        a = (ages >= amin) & (ages <= amax)
        return c[sel_state, :, sex][..., a, metric].sum()

    def nat(metric, amin=0, sex=slice(None), denom=M.M_COUNT, dmin=None):
        return agg(sex=sex, amin=amin, metric=metric) / agg(sex=sex, amin=amin if dmin is None else dmin, metric=denom)

    def median_age(st=slice(None)):
        h = c[st, :, :, :, M.M_COUNT].reshape(-1, M.N_AGE).sum(0)
        cs = np.cumsum(h)
        return np.searchsorted(cs, cs[-1] / 2)

    tot = cube[..., M.M_COUNT].sum()
    rows = []
    def r(label, value, bench, src):
        rows.append((label, value, bench, src))

    r("Population", f"{tot:,.0f}", "1,500,000,000", "target")
    r("Urban share", f"{cube[:, 1, :, 0].sum() / tot:.1%}", "~35%", "2011: 31.1%, rising ~0.3pp/yr")
    r("Sex ratio (F per 1,000 M)", f"{1000 * agg(sex=1) / agg(sex=0):.0f}", "940-950", "Census 2011: 943")
    r("Median age", f"{median_age()}", "~29", "UN WPP 2024 (2026)")
    r("Aged 0-14", f"{agg(amax=14) / tot:.1%}", "~24-25%", "UN WPP 2024")
    r("Aged 60+", f"{agg(amin=60) / tot:.1%}", "~11-12%", "UN WPP 2024 / LASI")
    r("Literacy 7+, male", f"{agg(sex=0, amin=7, metric=M.M_LIT) / agg(sex=0, amin=7):.1%}", "~87%", "PLFS 2023-24")
    r("Literacy 7+, female", f"{agg(sex=1, amin=7, metric=M.M_LIT) / agg(sex=1, amin=7):.1%}", "~75%", "PLFS 2023-24")
    r("Graduates+, age 25+", f"{agg(amin=25, metric=M.M_GRAD) / agg(amin=25):.1%}", "~13-15%", "PLFS / AISHE trend")
    r("LFPR 15+, male", f"{agg(sex=0, amin=15, metric=M.M_LF) / agg(sex=0, amin=15):.1%}", "78.8%", "PLFS 2023-24 (usual status)")
    r("LFPR 15+, female", f"{agg(sex=1, amin=15, metric=M.M_LF) / agg(sex=1, amin=15):.1%}", "41.7%", "PLFS 2023-24")
    r("Unemployment rate 15+", f"{agg(amin=15, metric=M.M_UNEMP) / agg(amin=15, metric=M.M_LF):.1%}", "3.2%", "PLFS 2023-24")
    r("Smartphone, 15+", f"{agg(amin=15, metric=M.M_SMART) / agg(amin=15):.1%}", "~68%", "NFHS-5 trend, 2026 est.")
    r("Internet users, 15+", f"{agg(amin=15, metric=M.M_INTERNET) / agg(amin=15):.1%}", "~65%", "NFHS-5 / TRAI trend")
    r("Bank account, 15+", f"{agg(amin=15, metric=M.M_BANK) / agg(amin=15):.1%}", "~90%", "Global Findex 2021 + PMJDY")
    r("Health insurance / scheme", f"{cube[..., M.M_INS].sum() / tot:.1%}", "~45-50%", "NFHS-5 41% of households + PM-JAY")
    r("Disability", f"{cube[..., M.M_DIS].sum() / tot:.2%}", "2.2%", "Census 2011 / NSS 76th round")
    w = cube[..., M.M_WORKER].sum()
    r("Mean monthly earnings, workers", f"Rs {cube[..., M.M_EARN].sum() * 100 / w:,.0f}", "~Rs 15,000", "PLFS 2023-24 by employment type")
    cn = cats.sum((0, 1))
    off = M.CAT_OFFSETS
    rel = cn[off["religion"]: off["religion"] + 7] / tot
    r("Religion H/M/C/S/B/J/O", " / ".join(f"{x:.1%}" for x in rel), "79.8 / 14.2 / 2.3 / 1.7 / 0.7 / 0.4 / 0.9", "Census 2011")
    cs = cn[off["caste"]: off["caste"] + 4] / tot
    r("Social group Gen/OBC/SC/ST", " / ".join(f"{x:.1%}" for x in cs), "~30 / ~44 / 16.6 / 8.6", "Census 2011 (SC/ST), NSSO (OBC)")
    act = cn[off["activity"]: off["activity"] + 12]
    sec = act[P.FIRST_WORKER_ACTIVITY:] / act[P.FIRST_WORKER_ACTIVITY:].sum()
    r("Workers by sector (agri/mfg/constr/trade/svc/govt/prof)", " / ".join(f"{x:.1%}" for x in sec),
      " / ".join(f"{x:.1%}" for x in P.SECTOR_TARGET), "PLFS 2023-24 (grouped)")
    emp = cn[off["emp_type"] + 1: off["emp_type"] + 4] / cn[off["emp_type"] + 1: off["emp_type"] + 4].sum()
    r("Employment self/regular/casual", " / ".join(f"{x:.1%}" for x in emp), "58.4 / 21.7 / 19.8", "PLFS 2023-24")
    lang = cn[off["language"]: off["language"] + len(P.LANGUAGES)] / tot
    top = np.argsort(-lang)[:6]
    r("Top mother tongues", ", ".join(f"{P.LANGUAGES[k]} {lang[k]:.1%}" for k in top), "Hindi 43.6, Bengali 8.0, Marathi 6.9, Telugu 6.7, Tamil 5.7, Gujarati 4.6", "Census 2011")

    lines = ["# Validation report", "",
             f"Exact statistics computed over **all {tot:,.0f} generated records** (from `data/full/aggregates.npz`), "
             f"seed `{man['seed']}`, generated in {man['timings']['generation_s']}s.",
             "Benchmarks are the public figures the model was anchored to (projected to ~2026 where needed). "
             "This is simulated data, so close agreement is by construction rather than a finding.", "",
             "## National", "", "| Measure | Generated | Benchmark | Source |", "|---|---|---|---|"]
    lines += [f"| {a} | {b} | {c_} | {d} |" for a, b, c_, d in rows]
    lines += ["", "## States and union territories", "",
              "Targets: literacy is 2011 literacy with 30% of the illiteracy gap closed; female LFPR from PLFS; "
              "graduate shares are 2026 estimates.", "",
              "| State/UT | Population | Urban | Sex ratio | Median age | Literacy F (target) | Female LFPR (target) | Graduates 25+ (target) |",
              "|---|---:|---:|---:|---:|---:|---:|---:|"]
    T = M.build_tables()["targets"]
    for s, st in enumerate(P.STATES):
        pop = c[s, ..., M.M_COUNT].sum()
        urb = cube[s, 1, :, 0].sum() / pop
        sr = 1000 * agg(s, sex=1) / agg(s, sex=0)
        litf = agg(s, sex=1, amin=7, metric=M.M_LIT) / agg(s, sex=1, amin=7)
        flf = agg(s, sex=1, amin=15, metric=M.M_LF) / agg(s, sex=1, amin=15)
        grad = agg(s, amin=25, metric=M.M_GRAD) / agg(s, amin=25)
        lines.append(f"| {st['name']} | {pop:,.0f} | {urb:.1%} | {sr:.0f} | {median_age(s)} | {litf:.1%} ({T['lit'][s, 1]:.1f}%) | "
                     f"{flf:.1%} ({st['flfp']}%) | {grad:.1%} ({st['grad']}%) |")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines[:len(rows) + 9]))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
