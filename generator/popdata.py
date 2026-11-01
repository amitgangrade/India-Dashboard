"""
Reader for the bit-packed population files written by generate.py.

    import popdata as pd_
    m = pd_.manifest()                                  # schema, labels, file list
    df = pd_.read_state("KL", n=1_000_000)              # pandas DataFrame with readable labels
    for chunk in pd_.iter_chunks(["age", "sex", "education"], states=["UP", "BR"]):
        ...                                             # dict of numpy arrays, ~16M rows at a time
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DIR = os.path.join(os.path.dirname(HERE), "data", "full")
LABELLED = {"sex", "religion", "caste", "language", "education", "marital", "activity", "emp_type", "wealth", "state"}


def manifest(data_dir=DEFAULT_DIR):
    with open(os.path.join(data_dir, "manifest.json")) as f:
        return json.load(f)


def decode(raw, field, m):
    spec = m["fields"][field]
    v = (raw >> np.uint64(spec["offset"])) & np.uint64((1 << spec["bits"]) - 1)
    if field == "earnings":
        return v.astype(np.int64) * m["earnings_unit_rupees"]
    return v.astype(np.uint8)


def state_files(m, states=None):
    files = m["files"]
    if states:
        want = {s.upper() for s in states}
        files = [f for f in files if f["abbr"].upper() in want or f["name"].upper() in want]
        if not files:
            raise SystemExit(f"No state matches {states}; use 2-letter codes like UP, KL, MH")
    return files


def chunk_tasks(m, states=None, chunk=16 * 2**20, data_dir=DEFAULT_DIR):
    tasks = []
    for f in state_files(m, states):
        for start in range(0, f["rows"], chunk):
            tasks.append((os.path.join(data_dir, f["file"]), start, min(chunk, f["rows"] - start)))
    return tasks


def read_raw(path, start, count):
    mm = np.memmap(path, dtype="<u8", mode="r", offset=start * 8, shape=(count,))
    return np.asarray(mm)


def iter_chunks(fields, states=None, chunk=16 * 2**20, data_dir=DEFAULT_DIR):
    m = manifest(data_dir)
    for path, start, count in chunk_tasks(m, states, chunk, data_dir):
        raw = read_raw(path, start, count)
        yield {f: decode(raw, f, m) for f in fields}


def to_frame(cols, m):
    import pandas as pd
    out = {}
    for k, v in cols.items():
        if k in LABELLED:
            out[k] = pd.Categorical.from_codes(v, categories=m["labels"][k]) if k != "state" else \
                pd.Categorical.from_codes(v, categories=m["labels"]["state"])
        elif k == "urban":
            out[k] = np.where(v == 1, "Urban", "Rural")
        elif k in ("bank", "smartphone", "internet", "insurance", "disability"):
            out[k] = v.astype(bool)
        else:
            out[k] = v
    return pd.DataFrame(out)


def read_state(state, n=None, fields=None, data_dir=DEFAULT_DIR, random=True, seed=0):
    """Return up to n people from one state as a pandas DataFrame (random rows by default)."""
    m = manifest(data_dir)
    f = state_files(m, [state])[0]
    path = os.path.join(data_dir, f["file"])
    mm = np.memmap(path, dtype="<u8", mode="r")
    if n is None or n >= len(mm):
        raw = np.asarray(mm)
    elif random:
        idx = np.sort(np.random.default_rng(seed).choice(len(mm), size=n, replace=False))
        raw = mm[idx]
    else:
        raw = np.asarray(mm[:n])
    fields = fields or list(m["fields"].keys())
    return to_frame({k: decode(raw, k, m) for k in fields}, m)
