#!/usr/bin/env python3
"""
Query the full 1.5-billion-person dataset (parallel scan over the bit-packed files).

Examples
  python query.py --by state                                   # population by state
  python query.py --by education --where "age >= 25 and sex == 'Female'"
  python query.py --by religion urban --states UP BR --mean earnings --where "activity >= 5"
  python query.py --where "state == 'Kerala' and age >= 100" --show 10
  python query.py --where "education == 'Post-graduate+' and urban == 0" --csv rural_pg.csv --limit 100000

Fields: state urban sex age religion caste language education marital disability activity
        emp_type wealth hh_size bank smartphone internet insurance earnings (Rs/month)
In --where, labelled fields can be compared with their label text ('Female', 'Graduate', 'Kerala', ...).
"""
import argparse
import ast
import os
import sys
import time
from multiprocessing import Pool

import numpy as np

import popdata

M = None
ARGS = None


class _ToBitwise(ast.NodeTransformer):
    """Turn `a and b`, `a or b`, `not a` and chained comparisons into numpy-friendly & | ~."""

    def visit_BoolOp(self, node):
        self.generic_visit(node)
        op = ast.BitAnd() if isinstance(node.op, ast.And) else ast.BitOr()
        expr = node.values[0]
        for v in node.values[1:]:
            expr = ast.BinOp(left=expr, op=op, right=v)
        return expr

    def visit_UnaryOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, ast.Not):
            return ast.UnaryOp(op=ast.Invert(), operand=node.operand)
        return node

    def visit_Compare(self, node):
        self.generic_visit(node)
        # resolve string labels to codes: sex == 'Female' -> sex == 1
        def code(name_node, const):
            if isinstance(name_node, ast.Name) and isinstance(const, ast.Constant) and isinstance(const.value, str):
                labels = M["labels"].get(name_node.id)
                if name_node.id == "urban":
                    labels = ["Rural", "Urban"]
                if labels is None:
                    raise SystemExit(f"Field {name_node.id!r} has no labels")
                low = [l.lower() for l in labels]
                v = const.value.lower()
                if v not in low:
                    raise SystemExit(f"{const.value!r} is not a {name_node.id} label; choose from {labels}")
                return ast.Constant(low.index(v))
            return const
        left = node.left
        comps = [code(left if i == 0 else node.comparators[i - 1], c) for i, c in enumerate(node.comparators)]
        parts = []
        prev = left
        for op, c in zip(node.ops, comps):
            parts.append(ast.Compare(left=prev, ops=[op], comparators=[c]))
            prev = c
        expr = parts[0]
        for p in parts[1:]:
            expr = ast.BinOp(left=expr, op=ast.BitAnd(), right=p)
        return expr


def compile_where(expr):
    if not expr:
        return None, set()
    tree = _ToBitwise().visit(ast.parse(expr, mode="eval"))
    ast.fix_missing_locations(tree)
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    bad = names - set(M["fields"])
    if bad:
        raise SystemExit(f"Unknown field(s) in --where: {sorted(bad)}")
    return compile(tree, "<where>", "eval"), names


def _init(manifest, args):
    global M, ARGS
    M, ARGS = manifest, args


def _work(task):
    path, start, count = task
    raw = popdata.read_raw(path, start, count)
    code, names = compile_where(ARGS.where)
    cols = {}
    need = set(names) | set(ARGS.by) | ({ARGS.mean} if ARGS.mean else set())
    for f in need:
        cols[f] = popdata.decode(raw, f, M)
    mask = None
    if code is not None:
        mask = np.asarray(eval(code, {"__builtins__": {}}, {k: v.astype(np.int64) for k, v in cols.items()}), dtype=bool)
    if ARGS.show or ARGS.csv:
        sel = raw if mask is None else raw[mask]
        return ("rows", sel[: ARGS.limit])
    sizes = [_card(f) for f in ARGS.by]
    key = np.zeros(count, dtype=np.int64)
    for f, n in zip(ARGS.by, sizes):
        key = key * n + cols[f].astype(np.int64)
    if mask is not None:
        key = key[mask]
    total = int(np.prod(sizes)) if sizes else 1
    cnt = np.bincount(key, minlength=total)
    sm = None
    if ARGS.mean:
        v = cols[ARGS.mean].astype(np.float64)
        if mask is not None:
            v = v[mask]
        sm = np.bincount(key, weights=v, minlength=total)
    return ("agg", cnt, sm)


def _card(field):
    if field in M["labels"]:
        return len(M["labels"][field])
    return 1 << M["fields"][field]["bits"]


def _label(field, code):
    if field in M["labels"]:
        return M["labels"][field][code]
    if field == "urban":
        return ["Rural", "Urban"][code]
    if field in ("bank", "smartphone", "internet", "insurance", "disability"):
        return ["No", "Yes"][code]
    return str(code)


def main():
    global M
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=popdata.DEFAULT_DIR)
    ap.add_argument("--by", nargs="*", default=[], help="fields to group by")
    ap.add_argument("--where", default="", help="row filter, e.g. \"age >= 18 and sex == 'Female'\"")
    ap.add_argument("--states", nargs="*", help="only scan these states (2-letter codes)")
    ap.add_argument("--mean", help="also report the mean of this numeric field (e.g. earnings, age)")
    ap.add_argument("--show", type=int, default=0, help="print N matching people instead of aggregating")
    ap.add_argument("--csv", help="write matching people to CSV (use with --limit)")
    ap.add_argument("--limit", type=int, default=100_000)
    ap.add_argument("--top", type=int, default=60, help="max groups to print")
    ap.add_argument("--workers", type=int, default=os.cpu_count())
    args = ap.parse_args()
    if args.show:
        args.limit = args.show
    M = popdata.manifest(args.data)
    if not M.get("written", True):
        raise SystemExit("The full population was not written (generated with --no-write).")
    compile_where(args.where)  # validate early
    tasks = popdata.chunk_tasks(M, args.states, data_dir=args.data)
    rows_scanned = sum(t[2] for t in tasks)
    t0 = time.time()
    with Pool(args.workers, initializer=_init, initargs=(M, args)) as pool:
        if args.show or args.csv:
            got, n = [], 0
            for r in pool.imap(_work, tasks):
                got.append(r[1]); n += len(r[1])
                if n >= args.limit:
                    pool.terminate()
                    break
            raw = np.concatenate(got)[: args.limit] if got else np.zeros(0, dtype=np.uint64)
            df = popdata.to_frame({k: popdata.decode(raw, k, M) for k in M["fields"]}, M)
            if args.csv:
                df.to_csv(args.csv, index=False)
                print(f"Wrote {len(df):,} people to {args.csv}")
            else:
                import pandas as pd
                with pd.option_context("display.max_columns", None, "display.width", 250):
                    print(df.to_string(index=False))
            return
        cnt = sm = None
        for r in pool.imap_unordered(_work, tasks):
            cnt = r[1] if cnt is None else cnt + r[1]
            if r[2] is not None:
                sm = r[2] if sm is None else sm + r[2]
    dt = time.time() - t0
    total = cnt.sum()
    print(f"Scanned {rows_scanned:,} people in {dt:.1f}s ({rows_scanned / dt / 1e6:.0f}M/s); {total:,} match.\n")
    if not args.by:
        if sm is not None:
            print(f"mean {args.mean}: {sm.sum() / max(total, 1):,.2f}")
        return
    sizes = [_card(f) for f in args.by]
    order = np.argsort(-cnt)
    hdr = " | ".join(f"{f:<22}" for f in args.by) + " |        people |  share" + (f" | mean {args.mean}" if sm is not None else "")
    print(hdr)
    print("-" * len(hdr))
    shown = 0
    for k in order:
        if cnt[k] == 0 or shown >= args.top:
            break
        codes, r = [], int(k)
        for n in reversed(sizes):
            codes.append(r % n); r //= n
        codes.reverse()
        line = " | ".join(f"{_label(f, c)[:22]:<22}" for f, c in zip(args.by, codes))
        line += f" | {cnt[k]:>13,} | {cnt[k] / total:6.2%}"
        if sm is not None:
            line += f" | {sm[k] / cnt[k]:,.1f}"
        print(line)
        shown += 1
    if (cnt > 0).sum() > shown:
        print(f"... {(cnt > 0).sum() - shown} more groups (use --top)")


if __name__ == "__main__":
    sys.exit(main())
