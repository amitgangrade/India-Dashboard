#!/usr/bin/env python3
"""Check regenerated state files against data/SHA256SUMS (cross-platform replacement for `sha256sum -c`)."""
import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    full = os.path.join(ROOT, "data", "full")
    bad = 0
    with open(os.path.join(ROOT, "data", "SHA256SUMS"), encoding="utf-8") as f:
        for line in f:
            want, name = line.split()
            h = hashlib.sha256()
            with open(os.path.join(full, name), "rb") as g:
                for block in iter(lambda: g.read(1 << 24), b""):
                    h.update(block)
            ok = h.hexdigest() == want
            bad += not ok
            print(f"{name}: {'OK' if ok else 'MISMATCH'}", flush=True)
    print("all 36 files match" if not bad else f"{bad} file(s) differ")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
