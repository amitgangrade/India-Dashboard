"""
Statistical model of the synthetic population.

* build_tables()  -> deterministic lookup tables derived from params.py
                     (age-sex pyramids per state x urban/rural, religion, caste, language ...)
* gen_block()     -> numba kernel that draws people row by row (parallel over chunks) and
                     writes them as bit-packed uint64 records, while accumulating exact
                     aggregates and a stratified sample for the dashboard.

Record layout (little-endian uint64, bit offsets)
  low 32 bits : state 0-5 | urban 6 | sex 7-8 | age 9-15 | religion 16-18 | caste 19-20 |
                language 21-25 | education 26-28 | marital 29-30 | disability 31
  high 32 bits: activity 32-35 | emp_type 36-37 | wealth 38-40 | hh_size 41-44 | bank 45 |
                smartphone 46 | internet 47 | insurance 48 | earnings (Rs 100 units) 49-63
No field straddles bit 32, so JavaScript can decode with two Uint32 words.
"""
import math

import numpy as np
from numba import njit, prange

import params as P

N_AGE = 101
N_SEXAGE = 3 * N_AGE
N_LANG = len(P.LANGUAGES)

# ----------------------------------------------------------------------------- field layout
FIELDS = {
    # name: (bit offset, bit width)
    "state": (0, 6), "urban": (6, 1), "sex": (7, 2), "age": (9, 7), "religion": (16, 3),
    "caste": (19, 2), "language": (21, 5), "education": (26, 3), "marital": (29, 2),
    "disability": (31, 1), "activity": (32, 4), "emp_type": (36, 2), "wealth": (38, 3),
    "hh_size": (41, 4), "bank": (45, 1), "smartphone": (46, 1), "internet": (47, 1),
    "insurance": (48, 1), "earnings": (49, 15),
}
EARNINGS_UNIT = 100  # rupees per stored unit

# ----------------------------------------------------------------------------- state params
SP_H, SP_LIT_M, SP_LIT_F, SP_MARF, SP_LF_M, SP_LF_F, SP_UE, SP_AGRI, SP_LOGINC, SP_HH, SP_INS, SP_HIGH = range(12)
N_SP = 12

# ----------------------------------------------------------------------------- global params
G_CUT = 0          # 6 cut-points for education levels 2..7
G_UE = 6           # 2: male, female
G_SECT = 8         # 7 sector intercepts (index 0 unused: agriculture is per state, 4 fixed at 0)
G_INC = 15         # 3 log-earnings bases for emp types 1..3
G_DIG = 18         # 2 smartphone intercepts
G_INT = 20         # 2 internet thresholds
G_BANK = 22        # 2 bank intercepts
G_DIS = 24         # disability intercept
G_WCUT = 25        # 4 wealth cut points
N_GP = 29

# ----------------------------------------------------------------------------- age tables
AT_LF_M, AT_LF_F, AT_ENROLL, AT_UE, AT_DIG, AT_MAXEDU, AT_DIS = range(7)

# ----------------------------------------------------------------------------- aggregates
M_COUNT, M_LIT, M_GRAD, M_STUDENT, M_LF, M_WORKER, M_UNEMP, M_SMART, M_INTERNET, M_BANK, \
    M_INS, M_DIS, M_MARRIED, M_WIDOW, M_EARN = range(15)
N_METRIC = 15
METRIC_NAMES = ["count", "literate", "graduate", "student", "labour_force", "worker", "unemployed",
                "smartphone", "internet", "bank", "insurance", "disability", "ever_married",
                "widowed", "earnings_sum_100"]
CAT_OFFSETS = {"religion": 0, "caste": 7, "language": 11, "education": 36, "marital": 44,
               "activity": 48, "emp_type": 60, "wealth": 64, "hh_size": 69}
N_CAT = 85

# fixed effect vectors (numba treats module-level arrays as compile-time constants)
H_CASTE = np.array([0.30, -0.10, -0.45, -0.60])                 # Gen, OBC, SC, ST
H_REL = np.array([0.0, -0.25, 0.15, 0.30, -0.10, 1.00, -0.40])  # H M C S B J O
EDU_CASTE = np.array([0.25, 0.0, -0.20, -0.30])
EDU_REL = np.array([0.0, -0.30, 0.40, 0.10, 0.10, 0.80, -0.20])
LF_EDU_F = np.array([0.25, 0.10, 0.0, -0.20, -0.40, -0.45, 0.10, 0.65])
LF_EDU_M = np.array([0.0, 0.0, 0.0, 0.0, 0.0, -0.05, 0.05, 0.10])
UE_EDU = np.array([-1.2, -1.0, -0.8, -0.4, 0.0, 0.45, 0.95, 0.85])
EARN_EDU = np.array([0.0, 0.05, 0.10, 0.18, 0.30, 0.42, 0.75, 1.00])
SECTOR_EARN = np.array([-0.25, 0.0, 0.0, 0.0, -0.10, 0.35, 0.55])
EMP_P = np.array([  # self, regular, casual   by sector
    [0.78, 0.01, 0.21], [0.40, 0.42, 0.18], [0.17, 0.08, 0.75], [0.62, 0.30, 0.08],
    [0.35, 0.55, 0.10], [0.00, 1.00, 0.00], [0.22, 0.78, 0.00]])
INC_SIGMA = np.array([0.0, 0.85, 0.60, 0.35])
INC_FEMALE = np.array([0.0, -0.80, -0.22, -0.40])
REL_URBAN_MULT = np.array([0.97, 1.25, 1.0, 0.9, 1.1, 2.5, 0.5])
CASTE_REL_MULT = np.array([  # Gen, OBC, SC, ST multipliers by religion
    [1.0, 1.0, 1.0, 1.0], [1.0, 1.0, 0.0, 0.3], [1.0, 0.6, 0.3, 2.0], [1.0, 0.5, 1.0, 0.1],
    [0.5, 0.3, 4.0, 1.5], [3.0, 0.3, 0.0, 0.0], [0.4, 0.3, 0.3, 5.0]])


# ============================================================================= tables
def _interp(points):
    xs, ys = zip(*points)
    return np.interp(np.arange(N_AGE), xs, ys)


def _survival(e0, imr):
    """Gompertz-Makeham survivorship l(x) tuned to life expectancy e0."""
    ages = np.arange(N_AGE, dtype=float)
    a_mk, c = 0.0012, 0.088

    def lx(b):
        cum = a_mk * ages + b / c * (np.exp(c * ages) - 1.0)
        s = np.exp(-cum)
        s[1:] *= (1 - imr)
        return s

    lo, hi = 1e-7, 1e-2
    for _ in range(80):
        mid = math.sqrt(lo * hi)
        s = lx(mid)
        e = s[0] * 0.5 + s[1:].sum() + 0.15 * (s[0] - s[1])
        if e > e0:
            lo = mid
        else:
            hi = mid
    return lx(math.sqrt(lo * hi))


def _age_sex_weights(st):
    ages = np.arange(N_AGE, dtype=float)
    tfr = st["tfr"]
    peak = float(st.get("peak", np.clip(55 - 15 * tfr, 3, 42)))
    decline = 0.004 + 0.012 * float(np.clip(2.2 - tfr, 0, 1))
    births = np.where(ages >= peak, np.exp(-0.0205 * (ages - peak)), np.exp(-decline * (peak - ages)))
    imr = float(np.clip(0.028 + (70 - st["e0"]) * 0.004, 0.006, 0.05))
    srb_f = st["csr"] / (1000.0 + st["csr"]) + 0.004
    w_m = births * (1 - srb_f) * _survival(st["e0"] - 1.4, imr * 1.05)
    w_f = births * srb_f * _survival(st["e0"] + 1.4, imr * 0.95)
    # migration: scale working-age males so the overall sex ratio hits the target
    band = (ages >= 18) & (ages < 60)
    target = st["sr"] / 1000.0
    need_m = w_f.sum() / target
    other_m = w_m[~band].sum()
    k = np.clip((need_m - other_m) / w_m[band].sum(), 0.45, 1.8)
    w_m = w_m * np.where(band, k, 1.0)
    # age heaping (digit preference at multiples of 5/10), stronger in low-literacy states
    heap = float(np.clip((90 - st["lit"][0]) / 30, 0.05, 1.0))
    for w in (w_m, w_f):
        orig = w.copy()
        for a in range(25, 96, 5):
            boost = (0.22 if a % 10 == 0 else 0.10) * heap
            moved = 0.0
            for d in (-2, -1, 1, 2):
                take = orig[a + d] * boost * (0.5 if abs(d) == 2 else 1.0) / 3.0
                w[a + d] -= take
                moved += take
            w[a] += moved
    w_t = np.where(ages >= 10, 0.0004 * (w_m + w_f), 0.0)
    return np.stack([w_m, w_f, w_t])  # (3, 101)


def _split_urban(total_w, urb, urban_mult):
    """Split a weight vector (any shape, last axis categories) into urban and rural versions."""
    wu = total_w * urban_mult
    wu = wu / wu.sum()
    tot = total_w / total_w.sum()
    wr = (tot - urb * wu) / max(1 - urb, 1e-6)
    wr = np.maximum(wr, 0.02 * tot)
    return wu, wr / wr.sum()


def build_tables():
    S = P.N_STATES
    agesex = np.zeros((S * 2, N_SEXAGE))
    relig = np.zeros((S * 2, 7))
    caste = np.zeros((S, 7, 4))
    lang_cdf = np.zeros((S, 2, N_LANG))
    SP = np.zeros((S, N_SP))
    targets = {k: np.zeros((S, 2)) for k in ("lit", "lfp")}
    targets["ins"] = np.zeros(S)
    targets["agri"] = np.zeros(S)
    targets["grad"] = np.zeros(S)

    ages = np.arange(N_AGE)
    urban_age_mult = np.where(ages < 15, 0.86, np.where((ages >= 20) & (ages < 40), 1.10, 1.0))
    for s, st in enumerate(P.STATES):
        urb = min(st["urb"], 99.0) / 100.0
        w = _age_sex_weights(st)
        wu, wr = _split_urban(w, urb, urban_age_mult[None, :])
        agesex[2 * s + 0] = np.cumsum(wr.ravel())
        agesex[2 * s + 1] = np.cumsum(wu.ravel())

        r = np.array(st["rel"], dtype=float) + 1e-4
        ru, rr = _split_urban(r, urb, REL_URBAN_MULT)
        relig[2 * s + 0], relig[2 * s + 1] = rr, ru
        rel_share = r / r.sum()

        # caste: iterative proportional fitting so that state totals hit the SC/ST/OBC targets
        tgt = np.array([0, st["obc"], st["sc"], st["st"]], dtype=float)
        tgt[0] = max(100 - tgt[1:].sum(), 0.5)
        tgt = tgt / tgt.sum() + 1e-6
        base = tgt.copy()
        for _ in range(200):
            cw = base[None, :] * CASTE_REL_MULT
            cw = cw / cw.sum(1, keepdims=True)
            got = (rel_share[:, None] * cw).sum(0)
            base = base * (tgt / np.maximum(got, 1e-9))
        caste[s] = cw

        # language, with Urdu concentrated among Muslims
        lp = np.zeros(N_LANG)
        for k, v in st["lang"].items():
            lp[P.L[k]] += v
        lp[P.L["Other"]] += max(100 - lp.sum(), 0.3)
        lp /= lp.sum()
        m = rel_share[1]
        urdu = lp[P.L["Urdu"]]
        p_mu = min(0.95, urdu / m) if m > 1e-4 else 0.0
        rest = lp.copy()
        rest[P.L["Urdu"]] = 0
        rest /= rest.sum()
        mus = rest * (1 - p_mu)
        mus[P.L["Urdu"]] = p_mu
        non = rest * (1 - max(0.0, urdu - m * p_mu) / max(1 - m, 1e-6))
        non[P.L["Urdu"]] = max(0.0, urdu - m * p_mu) / max(1 - m, 1e-6)
        lang_cdf[s, 0] = np.cumsum(non / non.sum())
        lang_cdf[s, 1] = np.cumsum(mus / mus.sum())

        lit, litf = st["lit"]
        sr = st["sr"] / 1000
        litm = (lit * (1 + sr) - litf * sr)
        close = P.LITERACY_GAP_CLOSURE
        targets["lit"][s] = [100 - (100 - litm) * (1 - close), 100 - (100 - litf) * (1 - close)]
        targets["lfp"][s] = [st["mlfp"], st["flfp"]]
        targets["ins"][s] = st["ins"]
        targets["agri"][s] = st["agri"]
        targets["grad"][s] = st["grad"]

        SP[s, SP_H] = 0.8 * math.log(st["inc"])
        SP[s, SP_MARF] = st["marf"]
        SP[s, SP_UE] = st["ue"]
        SP[s, SP_LOGINC] = math.log(st["inc"])
        SP[s, SP_HH] = st["hh"]
        # starting values for calibrated intercepts
        SP[s, SP_LIT_M] = 1.5
        SP[s, SP_LIT_F] = 1.0
        SP[s, SP_LF_M] = 0.0
        SP[s, SP_LF_F] = 0.0
        SP[s, SP_AGRI] = 0.0
        SP[s, SP_INS] = 0.0
        SP[s, SP_HIGH] = 0.0

    AT = np.zeros((7, N_AGE))
    AT[AT_LF_M] = _interp([(10, -4.0), (15, -1.6), (18, 0.0), (20, 1.0), (25, 2.8), (30, 3.5), (50, 3.5),
                          (55, 2.6), (60, 1.2), (65, 0.2), (70, -0.6), (80, -2.0), (100, -4.0)])
    AT[AT_LF_F] = _interp([(10, -4.5), (15, -2.2), (20, -0.6), (25, 0.0), (30, 0.4), (45, 0.4), (50, 0.2),
                          (55, -0.2), (60, -0.8), (65, -1.4), (70, -2.0), (80, -3.0), (100, -4.5)])
    AT[AT_ENROLL] = _interp([(4, -3.0), (5, 0.4), (6, 2.6), (14, 2.6), (15, 1.7), (16, 1.25), (17, 0.85),
                            (18, 0.2), (19, -0.2), (20, -0.5), (21, -0.75), (22, -1.1), (23, -1.6),
                            (24, -2.0), (27, -3.0), (30, -4.5), (40, -6.0), (100, -9.0)])
    AT[AT_UE] = _interp([(15, 1.6), (24, 1.6), (25, 0.9), (29, 0.9), (30, 0.2), (34, 0.2), (35, -0.5),
                        (59, -0.5), (60, -1.5), (100, -1.5)])
    AT[AT_DIG] = _interp([(10, -1.2), (14, -0.2), (15, 0.9), (29, 1.0), (30, 0.6), (44, 0.4), (45, -0.2),
                         (59, -0.5), (60, -1.2), (69, -1.6), (70, -2.3), (100, -3.5)])
    maxedu = np.zeros(N_AGE)
    for a in range(N_AGE):
        maxedu[a] = (0 if a < 7 else 1 if a < 11 else 2 if a < 14 else 3 if a < 16 else 4 if a < 18
                     else 5 if a < 21 else 6 if a < 23 else 7)
    AT[AT_MAXEDU] = maxedu
    AT[AT_DIS] = 0.045 * np.maximum(0, ages - 30) + np.where(ages < 5, -0.5, 0.0)

    GP = np.zeros(N_GP)
    GP[G_CUT:G_CUT + 6] = [1.0, 1.8, 2.6, 3.4, 4.3, 5.6]
    GP[G_UE:G_UE + 2] = [-3.6, -3.6]
    GP[G_SECT:G_SECT + 7] = [0.0, 0.3, 0.2, 0.6, 0.0, -2.0, -4.0]
    GP[G_INC:G_INC + 3] = [9.0, 9.4, 9.0]
    GP[G_DIG:G_DIG + 2] = [0.5, 0.0]
    GP[G_INT:G_INT + 2] = [0.2, 0.2]
    GP[G_BANK:G_BANK + 2] = [2.0, 1.6]
    GP[G_DIS] = -4.5
    GP[G_WCUT:G_WCUT + 4] = [-0.8, -0.3, 0.2, 0.8]

    NT, LT = rng_tables()
    return dict(agesex=agesex, relig=relig, caste=caste, lang_cdf=lang_cdf, SP=SP, GP=GP, AT=AT,
                NT=NT, LT=LT, targets=targets)


# ============================================================================= kernel
# ---- fast RNG: xoroshiro128+ with per-chunk state, plus 16-bit lookup tables for
#      normal / logistic quantiles (bias < 2e-5 in probability terms)
_U64 = np.uint64


@njit(inline="always")
def _next(rs):
    s0 = rs[0]
    s1 = rs[1]
    r = s0 + s1
    s1 ^= s0
    rs[0] = ((s0 << _U64(24)) | (s0 >> _U64(40))) ^ s1 ^ (s1 << _U64(16))
    rs[1] = (s1 << _U64(37)) | (s1 >> _U64(27))
    return r


@njit(inline="always")
def _seed(rs, seed):
    z = _U64(seed) * _U64(0x9E3779B97F4A7C15) + _U64(0x632BE59BD9B4E019)
    for k in range(2):
        z += _U64(0x9E3779B97F4A7C15)
        x = z
        x = (x ^ (x >> _U64(30))) * _U64(0xBF58476D1CE4E5B9)
        x = (x ^ (x >> _U64(27))) * _U64(0x94D049BB133111EB)
        rs[k] = x ^ (x >> _U64(31))


@njit(inline="always")
def _u(rs):
    return (_next(rs) >> _U64(11)) * (1.0 / 9007199254740992.0)


@njit(inline="always")
def _i16(rs):
    return int(_next(rs) >> _U64(48))


@njit(inline="always")
def _bern(rs, LT, x):
    """Bernoulli draw with probability sigmoid(x)."""
    return LT[_i16(rs)] < x


@njit(inline="always")
def _gauss(rs):
    """Exact standard normal (Box-Muller) for the heavy-tailed earnings draw."""
    u1 = _u(rs) + 1e-300
    u2 = _u(rs)
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(6.283185307179586 * u2)


@njit(inline="always")
def _poisson(rs, lam):
    u = _u(rs)
    k = 0
    pk = math.exp(-lam)
    F = pk
    while u > F and k < 40:
        k += 1
        pk *= lam / k
        F += pk
    return k


@njit(inline="always")
def _pick(rs, w, n):
    tot = 0.0
    for k in range(n):
        tot += w[k]
    r = _u(rs) * tot
    acc = 0.0
    for k in range(n):
        acc += w[k]
        if r < acc:
            return k
    return n - 1


@njit(inline="always")
def _pick_cdf(rs, cdf, n):
    r = _u(rs) * cdf[n - 1]
    lo, hi = 0, n - 1
    while lo < hi:
        mid = (lo + hi) >> 1
        if cdf[mid] > r:
            hi = mid
        else:
            lo = mid + 1
    return lo


def rng_tables():
    from statistics import NormalDist
    q = (np.arange(65536) + 0.5) / 65536
    nd = NormalDist()
    NT = np.array([nd.inv_cdf(x) for x in q])
    LT = np.log(q / (1 - q))
    return NT, LT


@njit(parallel=True, nogil=True, cache=True)
def gen_block(s, urban, n, seed, chunk, agesex_cdf, relig_w, caste_w, lang_cdf, SP, GP, AT, NT, LT,
              sample_rate, out, smask, cube, cats):
    nchunks = (n + chunk - 1) // chunk
    for c in prange(nchunks):
        rs = np.empty(2, dtype=np.uint64)
        _seed(rs, seed * 1000003 + c * 7919 + 1)
        start = c * chunk
        end = min(n, start + chunk)
        w7 = np.empty(7)
        util = np.empty(7)
        for i in range(start, end):
            # ---------------- sex & age
            idx = _pick_cdf(rs, agesex_cdf, N_SEXAGE)
            sex = idx // N_AGE
            age = idx - sex * N_AGE
            fem = sex == 1
            sx = 1 if fem else 0
            # ---------------- religion (Muslim population is younger)
            for k in range(7):
                w7[k] = relig_w[k]
            tilt = 1.0 + 0.008 * (30 - min(age, 70))
            w7[1] *= tilt
            rel = _pick(rs, w7, 7)
            # ---------------- caste & language
            cst = _pick(rs, caste_w[s, rel], 4)
            lang = _pick_cdf(rs, lang_cdf[s, 1 if rel == 1 else 0], N_LANG)
            # ---------------- household economic status (latent)
            h = SP[s, SP_H] + 0.6 * urban + H_CASTE[cst] + H_REL[rel] + NT[_i16(rs)]
            # ---------------- education (ordered logit, capped by age)
            edu = 0
            if age >= 7:
                a = max(min(age, 85), 18)
                ce = (40.0 - a) / 25.0 * (1.5 if fem else 0.9)
                common = ce + 0.6 * h + EDU_CASTE[cst] + EDU_REL[rel] + 0.3 * urban
                if SP[s, SP_LIT_M + sx] + common + LT[_i16(rs)] > 0.0:
                    # attainment among the literate has its own state level (graduate share target)
                    z = SP[s, SP_HIGH] + common + LT[_i16(rs)]
                    edu = 1
                    for k in range(6):
                        if z > GP[G_CUT + k]:
                            edu = k + 2
                mx = int(AT[AT_MAXEDU, age])
                if edu > mx:
                    edu = mx
            # ---------------- marital status
            mar = 0
            if age >= 13:
                coh = 0.07 * max(0, 45 - age)
                if fem:
                    m50 = SP[s, SP_MARF] + coh + 0.35 * max(0, edu - 3) + 0.8 * urban
                    kk = 0.55
                else:
                    m50 = SP[s, SP_MARF] + 4.8 + coh + 0.25 * max(0, edu - 3) + 0.5 * urban
                    kk = 0.45
                if sex == 2:
                    m50 += 15.0
                if _u(rs) < 0.985 / (1.0 + math.exp(-kk * (age - m50))):
                    if fem:
                        pw = 0.80 / (1.0 + math.exp(-(age - 69.0) / 7.5))
                        pd = 0.008
                    else:
                        pw = 0.60 / (1.0 + math.exp(-(age - 82.0) / 8.0))
                        pd = 0.004
                    if urban == 1:
                        pd *= 1.5
                    r = _u(rs)
                    mar = 2 if r < pw else (3 if r < pw + pd else 1)
            # ---------------- disability
            dis = 1 if _bern(rs, LT, GP[G_DIS] + AT[AT_DIS, age] + (0.0 if fem else 0.15) - 0.1 * h) else 0
            # ---------------- activity, sector, employment type, earnings
            act = 0
            emp = 0
            earn = 0
            if age >= 5:
                ps = AT[AT_ENROLL, age] + 0.45 * h + 0.25 * urban
                if fem and age >= 15:
                    ps -= 0.2
                if age <= 14 and age >= 7 and edu == 0:
                    ps -= 4.0
                if age >= 15 and edu < 3:
                    ps -= 2.5
                if age >= 18 and edu < 5:
                    ps -= 2.0
                if fem and mar == 1:
                    ps -= 1.5
                if dis == 1:
                    ps -= 1.0
                if _bern(rs, LT, ps):
                    act = 1
                elif age < 10:
                    act = 4
                else:
                    lf = SP[s, SP_LF_M + sx] + AT[AT_LF_M + sx, age]
                    if fem:
                        lf += -0.7 * urban + LF_EDU_F[edu] - 0.25 * h
                        if mar == 1 and urban == 1:
                            lf -= 0.3
                    else:
                        lf += -0.1 * urban + LF_EDU_M[edu] - 0.05 * h
                    if sex == 2:
                        lf -= 0.5
                    if dis == 1:
                        lf -= 1.2
                    if _bern(rs, LT, lf):
                        ue = (GP[G_UE + sx] + AT[AT_UE, age] + UE_EDU[edu] + 0.5 * urban + SP[s, SP_UE]
                              + (0.3 if (fem and urban == 1) else 0.0))
                        if _bern(rs, LT, ue):
                            act = 3
                        else:
                            e2 = max(0, edu - 2)
                            nf = 0.0 if fem else 1.0
                            util[0] = (SP[s, SP_AGRI] + 2.5 * (1 - urban) - 0.35 * e2
                                       + (0.6 if (fem and urban == 0) else 0.0) - 0.1 * h)
                            util[1] = GP[G_SECT + 1] + 0.3 * urban + 0.1 * min(edu, 5)
                            util[2] = GP[G_SECT + 2] + 0.9 * nf - 0.25 * max(0, edu - 3) + 0.3 * (1 - urban)
                            util[3] = GP[G_SECT + 3] + 0.6 * urban + 0.5 * nf + 0.05 * edu
                            util[4] = 0.3 * (1.0 - nf) + 0.1 * edu
                            util[5] = (GP[G_SECT + 5] + 0.6 * max(0, edu - 3) + 0.15 * h + 0.3 * urban
                                       + (0.3 if age >= 25 else 0.0))
                            util[6] = (GP[G_SECT + 6] + 1.2 * urban + 1.2 * max(0, edu - 4) + 0.4 * h
                                       - 0.3 * (1.0 - nf) + (0.3 if age < 45 else 0.0))
                            for k in range(7):
                                util[k] = math.exp(util[k])
                            sec = _pick(rs, util, 7)
                            act = P_FIRST_WORKER + sec
                            for k in range(3):
                                w7[k] = EMP_P[sec, k]
                            if edu >= 6 and sec != 5:
                                w7[1] *= 2.0
                                w7[2] *= 0.2
                            if fem and sec == 0:
                                w7[0] *= 1.15
                            emp = _pick(rs, w7, 3) + 1
                            x = min(age - 15, 40)
                            mu = (GP[G_INC + emp - 1] + 0.35 * SP[s, SP_LOGINC] + 0.22 * urban
                                  + EARN_EDU[edu] + 0.15 * h + SECTOR_EARN[sec]
                                  + 0.035 * x - 0.0006 * x * x + (INC_FEMALE[emp] if fem else 0.0))
                            v = math.exp(mu + INC_SIGMA[emp] * _gauss(rs)) / 100.0
                            earn = int(v + 0.5)
                            if earn < 1:
                                earn = 1
                            if earn > 32767:
                                earn = 32767
                    else:
                        if fem:
                            act = 2 if (age < 60 or _u(rs) < 0.5) else 4
                        else:
                            act = 4
            # ---------------- wealth quintile
            hw = h + 0.3 * NT[_i16(rs)]
            wq = 0
            for k in range(4):
                if hw > GP[G_WCUT + k]:
                    wq = k + 1
            # ---------------- household size
            if age >= 65 and _u(rs) < 0.05:
                hs = 1
            else:
                lam = SP[s, SP_HH] * 1.15 - 1.0 - 0.45 * urban + (0.7 if rel == 1 else 0.0) - 0.2 * h
                if lam < 0.5:
                    lam = 0.5
                hs = 1 + _poisson(rs, lam)
                if hs > 15:
                    hs = 15
            # ---------------- digital access, bank account, insurance
            smart = 0
            net = 0
            if age >= 10:
                d = (GP[G_DIG + sx] + AT[AT_DIG, age] + 0.6 * h + 0.25 * edu + 0.5 * urban
                     - 0.5 * dis + LT[_i16(rs)])
                smart = 1 if d > 0.0 else 0
                net = 1 if d + 0.8 * LT[_i16(rs)] > GP[G_INT + sx] else 0
            if age >= 18:
                b = GP[G_BANK + sx] + 0.5 * h + 0.15 * edu + 0.2 * urban
            elif age >= 10:
                b = GP[G_BANK + sx] - 2.5 + 0.5 * h
            else:
                b = -4.0 + 0.5 * h
            bank = 1 if _bern(rs, LT, b) else 0
            ins = 1 if _bern(rs, LT, SP[s, SP_INS] + 0.15 * abs(h - 0.3) + 0.15 * urban
                                 + (0.4 if act == P_FIRST_WORKER + 5 else 0.0)) else 0
            # ---------------- pack
            lo = (s | (urban << 6) | (sex << 7) | (age << 9) | (rel << 16) | (cst << 19) | (lang << 21)
                  | (edu << 26) | (mar << 29) | (dis << 31))
            hi = (act | (emp << 4) | (wq << 6) | (hs << 9) | (bank << 13) | (smart << 14) | (net << 15)
                  | (ins << 16) | (earn << 17))
            out[i] = np.uint64(lo) | (np.uint64(hi) << np.uint64(32))
            smask[i] = 1 if _u(rs) < sample_rate else 0
            # ---------------- aggregates
            cell = idx
            cube[c, cell, M_COUNT] += 1
            if edu >= 1:
                cube[c, cell, M_LIT] += 1
            if edu >= 6:
                cube[c, cell, M_GRAD] += 1
            if act == 1:
                cube[c, cell, M_STUDENT] += 1
            if act == 3 or act >= P_FIRST_WORKER:
                cube[c, cell, M_LF] += 1
            if act >= P_FIRST_WORKER:
                cube[c, cell, M_WORKER] += 1
            if act == 3:
                cube[c, cell, M_UNEMP] += 1
            cube[c, cell, M_SMART] += smart
            cube[c, cell, M_INTERNET] += net
            cube[c, cell, M_BANK] += bank
            cube[c, cell, M_INS] += ins
            cube[c, cell, M_DIS] += dis
            if mar >= 1:
                cube[c, cell, M_MARRIED] += 1
            if mar == 2:
                cube[c, cell, M_WIDOW] += 1
            cube[c, cell, M_EARN] += earn
            cats[c, rel] += 1
            cats[c, 7 + cst] += 1
            cats[c, 11 + lang] += 1
            cats[c, 36 + edu] += 1
            cats[c, 44 + mar] += 1
            cats[c, 48 + act] += 1
            cats[c, 60 + emp] += 1
            cats[c, 64 + wq] += 1
            cats[c, 69 + hs] += 1


P_FIRST_WORKER = P.FIRST_WORKER_ACTIVITY


# ============================================================================= decoding
def decode(arr, name):
    off, width = FIELDS[name]
    return ((arr >> np.uint64(off)) & np.uint64((1 << width) - 1)).astype(np.int64 if name == "earnings"
                                                                          else np.int16)


def decode_all(arr):
    return {k: decode(arr, k) for k in FIELDS}
