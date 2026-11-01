"""
Exact query engine over the full bit-packed population (all records, no sampling).

The records stay in the OS page cache via read-only memory maps (12 GB for 1.5B people). Every dashboard
click is answered by ONE fused, parallel pass that produces everything the page draws:

  groups  : for each of 19 dimensions, counts of people passing every filter EXCEPT that dimension's own
            (crossfilter semantics, identical to the in-browser engine)
  stm     : per-state metric vectors (44 counters) for rows passing all filters except the state filter
  stAge   : per-state single-year age histograms (same rows as stm)
  ageSex  : sex x age for rows passing all filters except the age filter (pyramid)
  ageSexSel / ssa : sex x age (and per state) for the exact selection (KPIs, projection)

Data are partitioned by state x rural/urban (that is how the files are laid out), so the state and urban
filters are constant inside a partition. Partitions that cannot contribute are skipped, and partitions
whose only failing filters are state/urban are answered from per-partition totals computed once at startup,
so state/area-only selections never touch the records again.
"""
import json
import os
import threading
import time

import numpy as np
from numba import njit, prange, get_num_threads

DIMS = ["state", "urban", "sex", "band", "religion", "caste", "language", "education", "marital", "activity",
        "emp_type", "wealth", "hh_size", "earnband", "smartphone", "internet", "bank", "insurance", "disability"]
DIM_N = [36, 2, 3, 21, 7, 4, 25, 8, 4, 12, 4, 5, 16, 7, 2, 2, 2, 2, 2]
ND = len(DIMS)
MAXC = 40
METRICS = ["POP", "URB", "FEM", "MALE", "A0_14", "A15_64", "A65", "A60", "P7", "L7", "P25", "G25", "P15", "LF15",
           "F15", "FLF15", "UNEMP", "SM15", "NET15", "BANK15", "INS", "DIS", "WORK", "EARN", "HH", "SC", "ST", "ML7",
           "MP7", "FL7", "FP7", "M15", "MLF15", "FSM15", "MSM15", "F2024", "F2024M", "REG", "CAS", "SELF", "AGRI",
           "STUD", "HOME", "A15_24"]
NK = len(METRICS)
(POP, URB, FEM, MALE, A0_14, A15_64, A65, A60, P7, L7, P25, G25, P15, LF15, F15, FLF15, UNEMP, SM15, NET15, BANK15,
 INS, DIS, WORK, EARN, HH, SC, ST, ML7, MP7, FL7, FP7, M15, MLF15, FSM15, MSM15, F2024, F2024M, REG, CAS, SELF,
 AGRI, STUD, HOME, A15_24) = range(NK)
FW = 5               # first worker activity code
EDGE_BINS = 40       # earnings histogram bins (log scale) for "people like me"
U64 = np.uint64


# ============================================================================ record decoding
@njit(inline="always")
def _decode(r, codes):
    """Fill codes[2:19] from a record (state and urban are constant per partition). Returns (age, earn_units)."""
    sex = (r >> U64(7)) & U64(3)
    age = (r >> U64(9)) & U64(127)
    codes[2] = sex
    codes[3] = min(age // U64(5), U64(20))
    codes[4] = (r >> U64(16)) & U64(7)
    codes[5] = (r >> U64(19)) & U64(3)
    codes[6] = (r >> U64(21)) & U64(31)
    codes[7] = (r >> U64(26)) & U64(7)
    codes[8] = (r >> U64(29)) & U64(3)
    codes[18] = (r >> U64(31)) & U64(1)
    codes[9] = (r >> U64(32)) & U64(15)
    codes[10] = (r >> U64(36)) & U64(3)
    codes[11] = (r >> U64(38)) & U64(7)
    codes[12] = (r >> U64(41)) & U64(15)
    codes[16] = (r >> U64(45)) & U64(1)
    codes[14] = (r >> U64(46)) & U64(1)
    codes[15] = (r >> U64(47)) & U64(1)
    codes[17] = (r >> U64(48)) & U64(1)
    e = r >> U64(49)
    codes[13] = 0 if e == 0 else (1 if e < 50 else (2 if e < 100 else (3 if e < 200 else (4 if e < 500 else (5 if e < 1000 else 6)))))
    return np.int64(age), np.int64(e)


@njit(inline="always")
def _code(d, r):
    """Decode a single dimension (used for the cheap filter test before full decoding)."""
    if d == 2:
        return np.int64((r >> U64(7)) & U64(3))
    if d == 3:
        return np.int64(min(((r >> U64(9)) & U64(127)) // U64(5), U64(20)))
    if d == 4:
        return np.int64((r >> U64(16)) & U64(7))
    if d == 5:
        return np.int64((r >> U64(19)) & U64(3))
    if d == 6:
        return np.int64((r >> U64(21)) & U64(31))
    if d == 7:
        return np.int64((r >> U64(26)) & U64(7))
    if d == 8:
        return np.int64((r >> U64(29)) & U64(3))
    if d == 9:
        return np.int64((r >> U64(32)) & U64(15))
    if d == 10:
        return np.int64((r >> U64(36)) & U64(3))
    if d == 11:
        return np.int64((r >> U64(38)) & U64(7))
    if d == 12:
        return np.int64((r >> U64(41)) & U64(15))
    if d == 13:
        e = r >> U64(49)
        return np.int64(0 if e == 0 else (1 if e < 50 else (2 if e < 100 else (3 if e < 200 else (4 if e < 500 else (5 if e < 1000 else 6))))))
    if d == 14:
        return np.int64((r >> U64(46)) & U64(1))
    if d == 15:
        return np.int64((r >> U64(47)) & U64(1))
    if d == 16:
        return np.int64((r >> U64(45)) & U64(1))
    if d == 17:
        return np.int64((r >> U64(48)) & U64(1))
    return np.int64((r >> U64(31)) & U64(1))


@njit(inline="always")
def _in_universe(d, codes, age):
    """Which rows a dimension's chart counts (matches the browser): education 25+, marital 15+, workers only
    for employment type / earnings, adults 15+ for phone, internet and bank."""
    if d == 7:
        return age >= 25
    if d == 8:
        return age >= 15
    if d == 10 or d == 13:
        return codes[d] != 0
    if d == 14 or d == 15 or d == 16:
        return age >= 15
    return True


@njit(inline="always")
def _metrics(m, codes, age, e, urban):
    sx = codes[2]
    edu = codes[7]
    act = codes[9]
    fem = sx == 1
    m[POP] += 1
    if urban == 1:
        m[URB] += 1
    if fem:
        m[FEM] += 1
    elif sx == 0:
        m[MALE] += 1
    if age < 15:
        m[A0_14] += 1
    elif age < 65:
        m[A15_64] += 1
    else:
        m[A65] += 1
    if age >= 60:
        m[A60] += 1
    if age >= 7:
        m[P7] += 1
        if edu >= 1:
            m[L7] += 1
        if fem:
            m[FP7] += 1
            if edu >= 1:
                m[FL7] += 1
        elif sx == 0:
            m[MP7] += 1
            if edu >= 1:
                m[ML7] += 1
    if age >= 25:
        m[P25] += 1
        if edu >= 6:
            m[G25] += 1
    lf = act == 3 or act >= FW
    if age >= 15:
        m[P15] += 1
        if age < 25:
            m[A15_24] += 1
        if lf:
            m[LF15] += 1
        sm = codes[14]
        if sm == 1:
            m[SM15] += 1
        if codes[15] == 1:
            m[NET15] += 1
        if codes[16] == 1:
            m[BANK15] += 1
        if fem:
            m[F15] += 1
            if lf:
                m[FLF15] += 1
            if sm == 1:
                m[FSM15] += 1
        elif sx == 0:
            m[M15] += 1
            if lf:
                m[MLF15] += 1
            if sm == 1:
                m[MSM15] += 1
    if act == 3:
        m[UNEMP] += 1
    if codes[17] == 1:
        m[INS] += 1
    if codes[18] == 1:
        m[DIS] += 1
    if act >= FW:
        m[WORK] += 1
        m[EARN] += e * 100
        et = codes[10]
        if et == 1:
            m[SELF] += 1
        elif et == 2:
            m[REG] += 1
        elif et == 3:
            m[CAS] += 1
        if act == FW:
            m[AGRI] += 1
    elif act == 1:
        m[STUD] += 1
    elif act == 2:
        m[HOME] += 1
    m[HH] += codes[12]
    c = codes[5]
    if c == 2:
        m[SC] += 1
    elif c == 3:
        m[ST] += 1
    if fem and age >= 20 and age < 25:
        m[F2024] += 1
        if codes[8] >= 1:
            m[F2024M] += 1


# ============================================================================ aggregation kernel
@njit(parallel=True, nogil=True, cache=True)
def _aggregate(rec, state, urban, allowed, act_dims, base_fails, base_fd, cross, nslices):
    """One partition (single state, single area). base_fails/base_fd describe the constant state/urban filters."""
    n = rec.size
    G = np.zeros((nslices, ND, MAXC), np.int64)
    MT = np.zeros((nslices, NK), np.int64)
    SA = np.zeros((nslices, 101), np.int64)
    AS = np.zeros((nslices, 303), np.int64)
    ASS = np.zeros((nslices, 303), np.int64)
    na = act_dims.size
    step = (n + nslices - 1) // nslices
    for t in prange(nslices):
        codes = np.zeros(ND, np.int64)
        codes[0] = state
        codes[1] = urban
        g = G[t]
        mt = MT[t]
        for i in range(t * step, min(n, (t + 1) * step)):
            r = rec[i]
            fails = base_fails
            fd = base_fd
            for j in range(na):          # cheap test on the filtered fields only
                d = act_dims[j]
                if allowed[d, _code(d, r)] == 0:
                    fails += 1
                    fd = d
                    if fails > 1:
                        break
            if fails > 1 or (fails == 1 and not cross):
                continue
            age, e = _decode(r, codes)
            cell = codes[2] * 101 + age
            if fails == 0:
                for d in range(ND):
                    if _in_universe(d, codes, age):
                        g[d, codes[d]] += 1
                _metrics(mt, codes, age, e, urban)
                SA[t, age] += 1
                AS[t, cell] += 1
                ASS[t, cell] += 1
            else:
                if _in_universe(fd, codes, age):
                    g[fd, codes[fd]] += 1
                if fd == 0:
                    _metrics(mt, codes, age, e, urban)
                    SA[t, age] += 1
                elif fd == 3:
                    AS[t, cell] += 1
    return G.sum(0), MT.sum(0), SA.sum(0), AS.sum(0), ASS.sum(0)


# ============================================================================ "people like me" kernel
@njit(parallel=True, nogil=True, cache=True)
def _me(rec, state, urban, q, nslices):
    """q = [age, sex, state, urban, education, earnings_rupees]. Accumulates exact rank statistics."""
    n = rec.size
    S = np.zeros((nslices, 32), np.int64)        # scalar counters, see MeStats
    ACT = np.zeros((nslices, 12), np.int64)
    WLT = np.zeros((nslices, 5), np.int64)
    H = np.zeros((nslices, EDGE_BINS), np.int64)
    qa, qs, qst, qu, qe, qearn = q[0], q[1], q[2], q[3], q[4], q[5]
    qband = min(qa // 5, 20)
    in_state = state == qst
    step = (n + nslices - 1) // nslices
    for t in prange(nslices):
        codes = np.zeros(ND, np.int64)
        for i in range(t * step, min(n, (t + 1) * step)):
            age, e = _decode(rec[i], codes)
            s = S[t]
            s[0] += 1
            if age < qa:
                s[1] += 1
            elif age == qa:
                s[2] += 1
            if in_state:
                s[3] += 1
                if age < qa:
                    s[4] += 1
                elif age == qa:
                    s[5] += 1
            edu = codes[7]
            if codes[3] == qband and age >= 7:
                s[6] += 1
                if edu < qe:
                    s[7] += 1
                elif edu == qe:
                    s[8] += 1
            a = codes[9]
            if a >= FW:
                er = e * 100
                s[9] += 1
                if er < qearn:
                    s[10] += 1
                elif er == qearn:
                    s[11] += 1
                if in_state:
                    s[12] += 1
                    if er < qearn:
                        s[13] += 1
                if edu == qe:
                    s[14] += 1
                    if er < qearn:
                        s[15] += 1
                lg = np.log10(max(er, 500.0))
                b = int((lg - 2.7) / (3.6 / EDGE_BINS))
                H[t, max(0, min(EDGE_BINS - 1, b))] += 1
            if codes[2] == qs and edu == qe and abs(age - qa) <= 2:
                if in_state and urban == qu:
                    s[16] += 1
                ACT[t, a] += 1
                WLT[t, codes[11]] += 1
                if age >= 15:
                    s[17] += 1
                    s[18] += codes[14]
                s[19] += codes[12]
                s[20] += 1
    return S.sum(0), ACT.sum(0), WLT.sum(0), H.sum(0)


# ============================================================================ row sampling kernel
@njit(nogil=True, cache=True)
def _match_rows(rec, start, allowed, act_dims, limit, out, nout):
    codes = np.zeros(ND, np.int64)
    n = rec.size
    for k in range(n):
        i = (start + k * 7919) % n          # scattered walk so a capped export spans the partition
        _decode(rec[i], codes)
        ok = True
        for j in range(act_dims.size):
            d = act_dims[j]
            if allowed[d, codes[d]] == 0:
                ok = False
                break
        if ok:
            out[nout] = rec[i]
            nout += 1
            if nout >= limit:
                break
    return nout


# ============================================================================ engine
class Cancelled(Exception):
    pass


class Job:
    def __init__(self, kind, total_rows):
        self.kind = kind
        self.total = total_rows
        self.done = 0
        self.cancel = threading.Event()
        self.started = time.time()


class Engine:
    def __init__(self, data_dir, piece_rows=48 * 2**20):
        self.data_dir = data_dir
        with open(os.path.join(data_dir, "manifest.json")) as f:
            self.manifest = json.load(f)
        self.parts = []   # (state, urban, memmap slice)
        for fi in self.manifest["files"]:
            path = os.path.join(data_dir, fi["file"])
            if not os.path.exists(path):
                raise SystemExit(f"Missing {path}. Generate the population first: python generator/generate.py")
            mm = np.memmap(path, dtype="<u8", mode="r")
            if mm.size != fi["rows"]:
                raise SystemExit(f"{path} has {mm.size} rows, manifest says {fi['rows']}")
            for u, (a, b) in enumerate([(0, fi["urban_offset"]), (fi["urban_offset"], fi["rows"])]):
                for s0 in range(a, b, piece_rows):
                    self.parts.append((fi["state"], u, mm[s0:min(b, s0 + piece_rows)]))
        self.total = sum(p[2].size for p in self.parts)
        self.nslices = max(4, get_num_threads() * 4)
        self.lock = threading.Lock()      # one scan at a time: a scan already uses every core
        self.base = None                  # per-partition unfiltered results

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _filters(filters):
        allowed = np.zeros((ND, MAXC), np.uint8)
        active = []
        for k, codes in (filters or {}).items():
            if k not in DIMS:
                raise ValueError(f"unknown dimension {k!r}")
            d = DIMS.index(k)
            codes = [int(c) for c in codes]
            if not codes:
                continue
            if any(c < 0 or c >= DIM_N[d] for c in codes):
                raise ValueError(f"bad code for {k}")
            allowed[d, codes] = 1
            active.append(d)
        return allowed, sorted(set(active))

    def _empty(self):
        return dict(groups=np.zeros((ND, MAXC), np.int64), stm=np.zeros((36, NK), np.int64),
                    stAge=np.zeros((36, 101), np.int64), ageSex=np.zeros(303, np.int64),
                    ageSexSel=np.zeros(303, np.int64), ssa=np.zeros((36, 303), np.int64))

    def warm(self, job=None):
        """One unfiltered pass: loads every page into memory and stores per-partition totals."""
        allowed = np.ones((ND, MAXC), np.uint8)
        base = []
        for (s, u, rec) in self.parts:
            g, mt, sa, a_s, ass = _aggregate(rec, s, u, allowed, np.zeros(0, np.int64), 0, -1, True, self.nslices)
            base.append((g, mt, sa, a_s, ass))
            if job:
                job.done += rec.size
        self.base = base

    # ------------------------------------------------------------------ queries
    def aggregate(self, filters, cross=True, job=None):
        allowed, active = self._filters(filters)
        f_state = 0 in active
        f_urban = 1 in active
        other = np.array([d for d in active if d > 1], np.int64)
        out = self._empty()
        scanned = 0
        for pi, (s, u, rec) in enumerate(self.parts):
            if job and job.cancel.is_set():
                raise Cancelled()
            bf, bfd = 0, -1
            if f_state and not allowed[0, s]:
                bf += 1; bfd = 0
            if f_urban and not allowed[1, u]:
                bf += 1; bfd = 1
            if bf > 1 or (bf == 1 and not cross):
                if job: job.done += rec.size
                continue
            if other.size == 0 and self.base is not None:
                g, mt, sa, a_s, ass = self.base[pi]          # exact totals, no scan needed
                if bf == 0:
                    out["groups"] += g; out["stm"][s] += mt; out["stAge"][s] += sa
                    out["ageSex"] += a_s; out["ageSexSel"] += ass; out["ssa"][s] += ass
                elif bfd == 0:   # fails only the state filter: credits the state chart and the map
                    out["groups"][0, s] += mt[POP]; out["stm"][s] += mt; out["stAge"][s] += sa
                else:            # fails only the urban filter: credits the area chart
                    out["groups"][1, u] += mt[POP]
            else:
                g, mt, sa, a_s, ass = _aggregate(rec, s, u, allowed, other, bf, bfd, cross, self.nslices)
                scanned += rec.size
                out["groups"] += g; out["stm"][s] += mt; out["stAge"][s] += sa; out["ageSex"] += a_s
                out["ageSexSel"] += ass; out["ssa"][s] += ass
            if job:
                job.done += rec.size
        res = {k: v.tolist() for k, v in out.items()}
        res["groups"] = [out["groups"][d, :DIM_N[d]].tolist() for d in range(ND)]
        res["scanned"] = int(scanned)
        return res

    def me(self, q, job=None):
        S = np.zeros(32, np.int64); ACT = np.zeros(12, np.int64); WLT = np.zeros(5, np.int64)
        H = np.zeros(EDGE_BINS, np.int64)
        qa = np.array([q["age"], q["sex"], q["state"], q["urban"], q["education"], q["earn"]], np.int64)
        for (s, u, rec) in self.parts:
            if job and job.cancel.is_set():
                raise Cancelled()
            a, b, c, d = _me(rec, s, u, qa, self.nslices)
            S += a; ACT += b; WLT += c; H += d
            if job:
                job.done += rec.size
        keys = ["tot", "younger", "same", "stTot", "stYoung", "stSame", "eduTot", "eduLow", "eduSame", "wTot",
                "wLow", "wSame", "wsTot", "wsLow", "weTot", "weLow", "like", "smDen", "smYes", "hhSum", "hhN"]
        out = {k: int(S[i]) for i, k in enumerate(keys)}
        out.update(actLike=ACT.tolist(), wealthLike=WLT.tolist(), hist=H.tolist())
        return out

    def rows(self, filters, limit=100_000, seed=0):
        allowed, active = self._filters(filters)
        act = np.array(active, np.int64)
        out = np.empty(limit, np.uint64)
        n = 0
        rng = np.random.default_rng(seed)
        order = rng.permutation(len(self.parts))
        # take a share from every partition (proportional to size) so the export spans the country
        per = [max(1, int(limit * self.parts[i][2].size / self.total) + 1) for i in range(len(self.parts))]
        for i in order:
            s, u, rec = self.parts[i]
            if 0 in active and not allowed[0, s] or 1 in active and not allowed[1, u]:
                continue
            take = min(per[i], limit - n)
            if take <= 0:
                break
            tmp = np.empty(take, np.uint64)
            got = _match_rows(rec, int(rng.integers(0, max(rec.size, 1))), allowed, act[act > 1], take, tmp, 0)
            out[n:n + got] = tmp[:got]
            n += got
        return out[:n]
