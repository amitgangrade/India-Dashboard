#!/usr/bin/env python3
"""
Live query server for the Bharat 1.5B dashboard.

    python server/app.py                      # serves the dashboard + API on http://localhost:8000
    python server/app.py --port 9000 --cors https://amitgangrade.github.io

Endpoints (JSON in, JSON out)
  GET  /api/health                 engine status, row count, warm-up progress
  GET  /api/status?client=ID       progress of that client's running query
  POST /api/aggregate              {filters:{dim:[codes]}, cross:bool, client, seq} -> exact crossfilter aggregates
  POST /api/me                     {age, sex, state, urban, education, earn} -> exact "people like me" ranks
  POST /api/rows                   {filters, limit} -> CSV of matching people (max 200,000)

Only this fixed query shape is accepted (no SQL), so the API is safe to expose behind a rate limiter.
"""
import argparse
import gzip
import io
import json
import os
import sys
import threading
import time
from collections import OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "generator"))
import engine as E  # noqa: E402

ENG: E.Engine = None
CACHE = OrderedDict()
CACHE_MAX = 2000
CACHE_LOCK = threading.Lock()
CLIENT_JOBS = {}          # client id -> running/queued Job (newer requests cancel older ones)
CLIENT_LOCK = threading.Lock()
WARM = {"job": None, "done": False, "seconds": None}
CORS = "*"
STATS = {"queries": 0, "cache_hits": 0, "scans": 0, "cancelled": 0}


def _cache_key(kind, payload):
    return kind + json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _canonical_filters(f):
    out = {}
    for k, v in (f or {}).items():
        codes = sorted({int(c) for c in v})
        if codes:
            out[k] = codes
    return out


def _run(kind, client, fn):
    """Run fn(job) under the engine lock. A newer request from the same client cancels this one."""
    job = E.Job(kind, ENG.total)
    if client:
        with CLIENT_LOCK:
            old = CLIENT_JOBS.get(client)
            if old is not None:
                old.cancel.set()
            CLIENT_JOBS[client] = job
    try:
        with ENG.lock:
            if job.cancel.is_set():
                raise E.Cancelled()
            job.started = time.time()
            job.running = True
            return fn(job), time.time() - job.started
    finally:
        job.running = False
        if client:
            with CLIENT_LOCK:
                if CLIENT_JOBS.get(client) is job:
                    del CLIENT_JOBS[client]


class Handler(SimpleHTTPRequestHandler):
    server_version = "Bharat1.5B/1.0"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.join(ROOT, "dashboard"), **kw)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") and not self.path.startswith("/api/status"):
            sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # ------------------------------------------------------------------ plumbing
    def end_headers(self):
        if self.path.startswith("/api/"):
            self.send_header("Access-Control-Allow-Origin", CORS)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")   # public page -> localhost server
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, separators=(",", ":")).encode()
        elif isinstance(body, str):
            body = body.encode()
        gz = "gzip" in (self.headers.get("Accept-Encoding") or "") and len(body) > 1024
        if gz:
            body = gzip.compress(body, compresslevel=5)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if gz:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 100_000:
            raise ValueError("request too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # ------------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/health":
            wj = WARM["job"]
            return self._send(200, dict(
                ok=True, rows=ENG.total, partitions=len(ENG.parts), cores=os.cpu_count(),
                threads=E.get_num_threads(), warm=WARM["done"],
                warm_progress=(wj.done / wj.total) if wj else 0.0, warm_seconds=WARM["seconds"],
                metrics=E.METRICS, dims=E.DIMS, stats=STATS, cache_entries=len(CACHE)))
        if u.path == "/api/status":
            client = parse_qs(u.query).get("client", [""])[0]
            job = CLIENT_JOBS.get(client)
            if job is None:
                return self._send(200, dict(state="idle"))
            return self._send(200, dict(state="running" if getattr(job, "running", False) else "queued",
                                        progress=job.done / job.total, elapsed=time.time() - job.started))
        if u.path.startswith("/api/"):
            return self._send(404, dict(error="not found"))
        return super().do_GET()

    # ------------------------------------------------------------------ POST
    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._json_body()
            if path == "/api/aggregate":
                return self._aggregate(body)
            if path == "/api/me":
                return self._me(body)
            if path == "/api/rows":
                return self._rows(body)
            return self._send(404, dict(error="not found"))
        except E.Cancelled:
            STATS["cancelled"] += 1
            return self._send(409, dict(error="superseded by a newer request"))
        except (ValueError, KeyError, TypeError) as e:
            return self._send(400, dict(error=str(e)))
        except (BrokenPipeError, ConnectionResetError):
            return None

    def _aggregate(self, body):
        filters = _canonical_filters(body.get("filters"))
        cross = bool(body.get("cross", True))
        STATS["queries"] += 1
        key = _cache_key("agg", dict(f=filters, c=cross))
        with CACHE_LOCK:
            hit = CACHE.get(key)
            if hit is not None:
                CACHE.move_to_end(key)
        if hit is not None:
            STATS["cache_hits"] += 1
            res = dict(hit, cached=True)
            return self._send(200, res)
        res, secs = _run("aggregate", body.get("client"), lambda job: ENG.aggregate(filters, cross, job))
        if res["scanned"]:
            STATS["scans"] += 1
        res.update(seconds=round(secs, 3), cached=False, rows=ENG.total)
        with CACHE_LOCK:
            CACHE[key] = res
            while len(CACHE) > CACHE_MAX:
                CACHE.popitem(last=False)
        return self._send(200, res)

    def _me(self, body):
        q = {k: int(body[k]) for k in ("age", "sex", "state", "urban", "education", "earn")}
        key = _cache_key("me", q)
        with CACHE_LOCK:
            hit = CACHE.get(key)
        if hit is not None:
            return self._send(200, dict(hit, cached=True))
        res, secs = _run("me", body.get("client"), lambda job: ENG.me(q, job))
        res.update(seconds=round(secs, 3), cached=False)
        with CACHE_LOCK:
            CACHE[key] = res
        return self._send(200, res)

    def _rows(self, body):
        filters = _canonical_filters(body.get("filters"))
        limit = max(1, min(int(body.get("limit", 100_000)), 200_000))
        recs, secs = _run("rows", None, lambda job: ENG.rows(filters, limit))
        m = ENG.manifest
        L = m["labels"]
        cols = ["state", "urban", "sex", "age", "religion", "caste", "language", "education", "marital", "activity",
                "emp_type", "wealth", "hh_size", "smartphone", "internet", "bank", "insurance", "disability"]
        dec = {}
        for c in cols + ["earnings"]:
            spec = m["fields"][c]
            dec[c] = ((recs >> np.uint64(spec["offset"])) & np.uint64((1 << spec["bits"]) - 1)).astype(np.int64)
        out = io.StringIO()
        out.write(f"# {len(recs)} people from the full 1.5B population (exact records, weight 1). Simulated data.\n")
        out.write(",".join(cols + ["monthly_earnings_rs"]) + "\n")
        yn = ["No", "Yes"]
        for i in range(len(recs)):
            row = []
            for c in cols:
                v = int(dec[c][i])
                if c in L:
                    row.append(L[c][v])
                elif c == "urban":
                    row.append("Urban" if v else "Rural")
                elif c in ("smartphone", "internet", "bank", "insurance", "disability"):
                    row.append(yn[v])
                else:
                    row.append(str(v))
            row.append(str(int(dec["earnings"][i]) * m["earnings_unit_rupees"]))
            out.write(",".join(f'"{x}"' if "," in x else x for x in row) + "\n")
        return self._send(200, out.getvalue(), "text/csv; charset=utf-8")


def _warm():
    job = E.Job("warm", ENG.total)
    WARM["job"] = job
    t = time.time()
    with ENG.lock:
        ENG.warm(job)
    WARM["seconds"] = round(time.time() - t, 1)
    WARM["done"] = True
    print(f"Warm-up done in {WARM['seconds']}s: all {ENG.total:,} records in memory; "
          f"state/area-only queries are now instant.", flush=True)


def main():
    global ENG, CORS
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=os.path.join(ROOT, "data", "full"))
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to accept connections from other machines")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--cors", default="*", help="allowed origin for the API, e.g. https://amitgangrade.github.io")
    args = ap.parse_args()
    CORS = args.cors
    ENG = E.Engine(args.data)
    print(f"Opened {ENG.total:,} records in {len(ENG.parts)} partitions; compiling kernels "
          f"(first run only, cached afterwards)...", flush=True)
    t = time.time()
    ENG.aggregate({"state": [31], "sex": [1]})      # JIT compile on a tiny partition set
    E._me(ENG.parts[0][2][:1000], 0, 0, np.array([30, 0, 0, 1, 6, 1000], np.int64), 4)
    E._match_rows(ENG.parts[0][2][:1000], 0, np.ones((E.ND, E.MAXC), np.uint8), np.zeros(0, np.int64), 1,
                  np.empty(1, np.uint64), 0)
    print(f"Kernels ready in {time.time() - t:.1f}s. Warming up in the background...", flush=True)
    threading.Thread(target=_warm, daemon=True).start()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    print(f"Serving dashboard + live API on http://{args.host}:{args.port}/", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
