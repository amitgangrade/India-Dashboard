#!/usr/bin/env python3
"""
Generate a synthetic, demographically representative population of India: 1.5 billion people,
one bit-packed 64-bit record each, written as one binary file per state/UT.

    python generate.py                     # full 1.5B run  (~12 GB, ~2-3 minutes on 4 cores)
    python generate.py --no-write          # same draws, nothing written except the dashboard extract
    python generate.py --total 15000000    # a smaller population for quick experiments

Outputs
  <out>/state_XX_AB.bin     raw little-endian uint64 records (see model.py for the bit layout)
  <out>/manifest.json       schema, labels, file list, row counts, calibrated parameters
  <out>/aggregates.npz      exact counts from the full population (state x urban x sex x age x metric)
  ../dashboard/data/        stratified ~1.3M-person extract (sample.js) + calibrated weights (meta.js)
"""
import argparse
import base64
import json
import os
import queue
import threading
import time

import numpy as np

import calibrate as C
import model as M
import params as P

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
N_BANDS = 21  # 5-year age bands, 100+ folded into the last band
TTY = os.isatty(1)


def calibrated_tables(iters):
    """Build tables and calibrate; result is cached keyed on the model/params source code."""
    import hashlib
    T = M.build_tables()
    h = hashlib.sha1()
    for f in ("params.py", "model.py", "calibrate.py"):
        h.update(open(os.path.join(HERE, f), "rb").read())
    h.update(str(iters).encode())
    cache = os.path.join(ROOT, "data", f"calibration_{h.hexdigest()[:12]}.npz")
    if os.path.exists(cache):
        z = np.load(cache)
        T["SP"][:], T["GP"][:] = z["SP"], z["GP"]
        print(f"Using cached calibration {os.path.basename(cache)}")
        return T, 0.0
    t0 = time.time()
    C.calibrate(T, C.segment_counts(), iterations=iters, verbose=True)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    np.savez(cache, SP=T["SP"], GP=T["GP"])
    return T, time.time() - t0


def _writer(q):
    while True:
        item = q.get()
        if item is None:
            break
        fh, buf = item
        buf.tofile(fh)
        q.task_done()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "full"))
    ap.add_argument("--total", type=int, default=P.TOTAL_POPULATION)
    ap.add_argument("--no-write", action="store_true", help="do not write the full population to disk")
    ap.add_argument("--sample-rate", type=float, default=1 / 1500, help="base sampling rate for the dashboard")
    ap.add_argument("--min-state-sample", type=int, default=20_000, help="minimum dashboard rows per state")
    ap.add_argument("--batch", type=int, default=32 * 2**20)
    ap.add_argument("--calib-iters", type=int, default=8)
    ap.add_argument("--seed", type=int, default=P.SEED)
    args = ap.parse_args()

    t_start = time.time()
    seg = C.segment_counts(args.total)
    print(f"Population {seg.sum():,} in {P.N_STATES} states/UTs ({seg[:, 1].sum() / seg.sum():.1%} urban)")

    t0 = time.time()
    C.run_segment(M.build_tables(), 0, 0, 1000, 1)  # JIT warm-up / cache load
    print(f"Kernel ready in {time.time() - t0:.1f}s")
    T, t_calib = calibrated_tables(args.calib_iters)

    if not args.no_write:
        os.makedirs(args.out, exist_ok=True)
        free = os.statvfs(args.out)
        need = seg.sum() * 8
        if free.f_bavail * free.f_frsize < need * 1.02:
            raise SystemExit(f"Not enough disk: need {need / 1e9:.1f} GB in {args.out}")

    q = queue.Queue(maxsize=2)
    wt = threading.Thread(target=_writer, args=(q,), daemon=True)
    wt.start()

    cube = np.zeros((P.N_STATES, 2, M.N_SEXAGE, M.N_METRIC), dtype=np.int64)
    cats = np.zeros((P.N_STATES, 2, M.N_CAT), dtype=np.int64)
    samples, files = [], []
    rate = np.minimum(1.0, np.maximum(args.sample_rate, args.min_state_sample / np.maximum(seg.sum(1), 1)))
    t_gen = time.time()
    done = 0
    for s, st in enumerate(P.STATES):
        fname = f"state_{s:02d}_{st['abbr']}.bin"
        fh = None if args.no_write else open(os.path.join(args.out, fname), "wb")
        offset_urban = int(seg[s, 0])
        for u in range(2):
            n_total = int(seg[s, u])
            b = 0
            for start in range(0, n_total, args.batch):
                n = min(args.batch, n_total - start)
                seed = (args.seed * 1_000_003 + s * 10_007 + u * 101 + b) % (2**62)
                out, smask, cb, ct = C.run_segment(T, s, u, n, seed, sample_rate=float(rate[s]),
                                                   chunk=1 << 20)
                cube[s, u] += cb
                cats[s, u] += ct
                samples.append(out[smask.view(bool)])
                if fh is not None:
                    q.put((fh, out))
                done += n
                b += 1
                el = time.time() - t_gen
                if TTY or start + n >= n_total and u == 1:
                    print(f"{'\r' if TTY else ''}  {done / seg.sum():6.1%}  {done:>13,} rows  "
                          f"{done / el / 1e6:5.1f} M rows/s  [{st['name'][:28]:<28}]",
                          end="" if TTY else "\n", flush=True)
        files.append(dict(file=fname, state=s, abbr=st["abbr"], name=st["name"], rows=int(seg[s].sum()),
                          rural_rows=int(seg[s, 0]), urban_rows=int(seg[s, 1]), urban_offset=offset_urban))
        if fh is not None:
            q.join()
            fh.close()
    q.put(None)
    wt.join()
    t_gen = time.time() - t_gen
    print(f"\nGenerated {done:,} people in {t_gen:.1f}s ({done / t_gen / 1e6:.1f} M rows/s, "
          f"{'written' if not args.no_write else 'not written'})")
    assert cube[..., M.M_COUNT].sum() == args.total

    sample = np.concatenate(samples)
    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)
    np.savez_compressed(os.path.join(out_dir, "aggregates.npz"), cube=cube, cats=cats, seg=seg,
                        metric_names=np.array(M.METRIC_NAMES))
    manifest = dict(
        description="Synthetic population of India (simulated data, not real people)",
        total=int(args.total), seed=args.seed, reference_year=P.REFERENCE_YEAR, record_bytes=8,
        byte_order="little", dtype="uint64", fields={k: dict(offset=o, bits=w) for k, (o, w) in M.FIELDS.items()},
        earnings_unit_rupees=M.EARNINGS_UNIT,
        row_order="within each state file: all rural rows, then all urban rows",
        labels=dict(sex=P.SEXES, religion=P.RELIGIONS, caste=P.CASTES, language=P.LANGUAGES,
                    education=P.EDUCATION, marital=P.MARITAL, activity=P.ACTIVITY, emp_type=P.EMP_TYPES,
                    wealth=P.WEALTH, state=[s["name"] for s in P.STATES]),
        files=files, written=not args.no_write,
        timings=dict(calibration_s=round(t_calib, 1), generation_s=round(t_gen, 1),
                     total_s=round(time.time() - t_start, 1)),
        calibrated=dict(SP=T["SP"].tolist(), GP=T["GP"].tolist()),
    )
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)

    export_dashboard(T, seg, cube, cats, sample, manifest)
    print(f"Done in {time.time() - t_start:.1f}s total.")


def export_dashboard(T, seg, cube, cats, sample, manifest):
    """Stratified extract + calibration weights so dashboard totals equal the full population."""
    D = M.decode_all(sample)
    S = P.N_STATES
    band = np.minimum(D["age"] // 5, N_BANDS - 1)
    cell = ((D["state"] * 2 + D["urban"]) * 3 + D["sex"]) * N_BANDS + band
    n_cells = S * 2 * 3 * N_BANDS
    samp = np.bincount(cell, minlength=n_cells).astype(float)
    full_age = cube[..., M.M_COUNT].reshape(S, 2, 3, M.N_AGE)
    full = np.zeros((S, 2, 3, N_BANDS))
    for b in range(N_BANDS):
        full[..., b] = full_age[..., b * 5: (b + 1) * 5 if b < N_BANDS - 1 else M.N_AGE].sum(-1)
    full = full.reshape(-1)
    w = np.where(samp > 0, full / np.maximum(samp, 1), 0.0)
    # mass of cells with no sampled person is spread over the rest of the (state, urban) segment
    seg_full = full.reshape(S * 2, -1).sum(1)
    seg_cov = (w * samp).reshape(S * 2, -1).sum(1)
    w = (w.reshape(S * 2, -1) * (seg_full / np.maximum(seg_cov, 1))[:, None]).reshape(-1)

    # shuffle so that any prefix of the extract is itself a random subset
    rng = np.random.default_rng(1)
    sample = sample[rng.permutation(len(sample))]
    data_dir = os.path.join(ROOT, "dashboard", "data")
    os.makedirs(data_dir, exist_ok=True)
    # base64 inside a <script> so the page also works from file:// and on static hosts that refuse .bin
    with open(os.path.join(data_dir, "sample.js"), "w") as f:
        f.write('window.SAMPLE_B64="')
        f.write(base64.b64encode(sample.astype("<u8").tobytes()).decode("ascii"))
        f.write('";\n')

    ages = np.arange(M.N_AGE)
    life = []
    for st in P.STATES:
        imr = float(np.clip(0.028 + (70 - st["e0"]) * 0.004, 0.006, 0.05))
        life.append([M._survival(st["e0"] - 1.4, imr * 1.05).round(6).tolist(),
                     M._survival(st["e0"] + 1.4, imr * 0.95).round(6).tolist()])
    full_sexage = cube[..., M.M_COUNT].sum(1)  # state, sexage
    metrics_state = cube.sum((1, 2))            # state, metric
    meta = dict(
        generated=time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
        total=int(seg.sum()), sample_rows=int(len(sample)), reference_year=P.REFERENCE_YEAR,
        fields={k: [o, b] for k, (o, b) in M.FIELDS.items()}, earnings_unit=M.EARNINGS_UNIT,
        n_bands=N_BANDS, weights=np.round(w, 4).tolist(),
        labels=manifest["labels"], first_worker=P.FIRST_WORKER_ACTIVITY,
        states=[dict(name=s["name"], abbr=s["abbr"], region=s["region"], tile=s["tile"], tfr=s["tfr"],
                     e0=s["e0"], rows=int(seg[i].sum())) for i, s in enumerate(P.STATES)],
        exact=dict(sexage=full_sexage.tolist(), metric_names=M.METRIC_NAMES,
                   metrics_state=metrics_state.tolist(), cats_state=cats.sum(1).tolist(),
                   cat_offsets=M.CAT_OFFSETS),
        life=life,
        timings=manifest["timings"], files=len(manifest["files"]), written=manifest["written"],
        bytes_on_disk=int(seg.sum()) * 8,
    )
    with open(os.path.join(data_dir, "meta.js"), "w") as f:
        f.write("window.META = ")
        json.dump(meta, f, separators=(",", ":"))
        f.write(";\n")
    print(f"Dashboard extract: {len(sample):,} people -> dashboard/data/sample.js "
          f"({len(sample) * 8 / 1e6:.1f} MB raw) + meta.js")


if __name__ == "__main__":
    main()
