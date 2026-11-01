#!/usr/bin/env python3
"""Exactness test: the live engine must reproduce the counts recorded during generation (data/full/aggregates.npz)."""
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402


def main(data_dir=os.path.join(os.path.dirname(HERE), "data", "full")):
    eng = E.Engine(data_dir)
    t = time.time()
    eng.warm()
    print(f"warm pass over {eng.total:,} records: {time.time() - t:.1f}s")
    z = np.load(os.path.join(data_dir, "aggregates.npz"))
    cube, cats = z["cube"], z["cats"]          # [state, urban, sex*101+age, metric], [state, urban, category]
    M = E.METRICS
    for filters in ({}, {"urban": [1]}, {"state": [9, 10]}):
        r = eng.aggregate(filters)
        stm = np.array(r["stm"])
        g = r["groups"]
        sel = cube
        if "urban" in filters:
            sel = cube[:, filters["urban"]]
        if "state" in filters:
            sel = cube[filters["state"]]
        exp_pop = sel[..., 0].sum()
        got_pop = sum(r["ageSexSel"])
        assert got_pop == exp_pop, (filters, got_pop, exp_pop)
        if not filters:
            assert (stm[:, M.index("POP")] == cube[..., 0].sum((1, 2))).all()
            assert stm[:, M.index("WORK")].sum() == cube[..., E.np.int64(5)].sum()
            assert stm[:, M.index("EARN")].sum() == cube[..., 14].sum() * 100
            assert g[4] == cats.sum((0, 1))[0:7].tolist()       # religion
            assert g[6] == cats.sum((0, 1))[11:36].tolist()     # language
        print(f"ok  {filters or 'all India'}: {got_pop:,} people")
    print("engine matches the generation-time exact counts")


if __name__ == "__main__":
    main(*sys.argv[1:])
