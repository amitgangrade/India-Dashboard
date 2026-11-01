/* Bharat 1.5B: India population explorer
 * Runs entirely in the browser on a stratified, calibration-weighted extract (~1.3M people)
 * of the 1.5B-person synthetic population. All aggregation is a single typed-array pass.
 */
(() => {
"use strict";
const META = window.META;
const LBL = META.labels;
const STATES = META.states;
const S = STATES.length;
const NB = META.n_bands;
const FW = META.first_worker;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ============================================================ formatting
let FMT = "intl";
const nfIntl = new Intl.NumberFormat("en-US");
const nfIN = new Intl.NumberFormat("en-IN");
function trimNum(x, d) { return (+x.toFixed(d)).toString(); }
function fmtPop(n) {
  if (!isFinite(n)) return "–";
  const a = Math.abs(n);
  if (FMT === "indian") {
    if (a >= 1e7) return trimNum(n / 1e7, a >= 1e9 ? 1 : 2) + " crore";
    if (a >= 1e5) return trimNum(n / 1e5, 1) + " lakh";
    return nfIN.format(Math.round(n));
  }
  if (a >= 1e9) return trimNum(n / 1e9, 2) + "B";
  if (a >= 1e6) return trimNum(n / 1e6, a >= 1e8 ? 0 : 1) + "M";
  if (a >= 1e4) return trimNum(n / 1e3, 0) + "K";
  return nfIntl.format(Math.round(n));
}
function fmtFull(n) { return (FMT === "indian" ? nfIN : nfIntl).format(Math.round(n)); }
function fmtRs(n) {
  if (!isFinite(n)) return "–";
  if (FMT === "indian" && n >= 1e5) return "₹" + trimNum(n / 1e5, 2) + " lakh";
  if (FMT === "intl" && n >= 1e6) return "₹" + trimNum(n / 1e6, 2) + "M";
  return "₹" + (FMT === "indian" ? nfIN : nfIntl).format(Math.round(n));
}
const pct = (x, d = 1) => (isFinite(x) ? (x * 100).toFixed(d) + "%" : "–");
const css = (v) => getComputedStyle($("#app")).getPropertyValue(v).trim();
const isDark = () => document.documentElement.dataset.theme === "dark";

// ============================================================ palette helpers
const BLUE = { 100: "#cde2fb", 150: "#b7d3f6", 200: "#9ec5f4", 250: "#86b6ef", 300: "#6da7ec", 350: "#5598e7",
  400: "#3987e5", 450: "#2a78d6", 500: "#256abf", 550: "#1c5cab", 600: "#184f95", 650: "#104281", 700: "#0d366b" };
const series = (i) => css("--s" + ((i % 8) + 1));
function ordinalRamp(n) {
  // light: step 250 -> 700, dark: step 600 -> 100 (never lighter/darker than the surface allows)
  const light = [250, 300, 350, 400, 450, 500, 550, 600, 650, 700];
  const dark = [600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100];
  const steps = isDark() ? dark : light;
  return d3.range(n).map((i) => BLUE[steps[Math.round(i * (steps.length - 1) / Math.max(1, n - 1))]]);
}
function seqScale(domain) {
  const stops = [100, 200, 300, 400, 500, 600, 700].map((k) => BLUE[k]);
  if (isDark()) stops.reverse();
  return d3.scaleSequential(d3.interpolateRgbBasis(stops)).domain(domain);
}
function divScale(lo, mid, hi) {
  const blue = isDark() ? "#3987e5" : "#2a78d6", orange = isDark() ? "#d95926" : "#eb6834";
  const m = isDark() ? "#383835" : "#f0efec";
  return d3.scaleDiverging(d3.interpolateRgbBasis([blue, m, orange])).domain([lo, mid, hi]);
}
function inkOn(fill) {
  const c = d3.rgb(fill);
  const L = 0.2126 * (c.r / 255) ** 2.2 + 0.7152 * (c.g / 255) ** 2.2 + 0.0722 * (c.b / 255) ** 2.2;
  return L > 0.36 ? "#0b0b0b" : "#ffffff";
}

// ============================================================ dimensions
const BAND_LABELS = d3.range(NB).map((b) => (b === NB - 1 ? "100+" : `${b * 5}–${b * 5 + 4}`));
const EARN_LABELS = ["No earnings", "< ₹5K", "₹5K–10K", "₹10K–20K", "₹20K–50K", "₹50K–1L", "≥ ₹1 lakh"];
const YESNO = ["No", "Yes"];
const DIMS = [
  { key: "state", label: "State", labels: STATES.map((s) => s.name), n: S },
  { key: "urban", label: "Area", labels: ["Rural", "Urban"], n: 2 },
  { key: "sex", label: "Sex", labels: LBL.sex, n: 3 },
  { key: "band", label: "Age", labels: BAND_LABELS, n: NB, ordinal: true },
  { key: "religion", label: "Religion", labels: LBL.religion, n: 7 },
  { key: "caste", label: "Social group", labels: LBL.caste, n: 4 },
  { key: "language", label: "Mother tongue", labels: LBL.language, n: LBL.language.length },
  { key: "education", label: "Education", labels: LBL.education, n: 8, ordinal: true },
  { key: "marital", label: "Marital status", labels: LBL.marital, n: 4 },
  { key: "activity", label: "Activity", labels: LBL.activity, n: 12 },
  { key: "emp_type", label: "Employment", labels: LBL.emp_type, n: 4 },
  { key: "wealth", label: "Wealth quintile", labels: LBL.wealth, n: 5, ordinal: true },
  { key: "hh_size", label: "Household size", labels: d3.range(16).map((k) => (k === 15 ? "15+" : String(k))), n: 16, ordinal: true },
  { key: "earnband", label: "Monthly earnings", labels: EARN_LABELS, n: 7, ordinal: true },
  { key: "smartphone", label: "Smartphone", labels: YESNO, n: 2 },
  { key: "internet", label: "Internet", labels: YESNO, n: 2 },
  { key: "bank", label: "Bank account", labels: YESNO, n: 2 },
  { key: "insurance", label: "Health cover", labels: YESNO, n: 2 },
  { key: "disability", label: "Disability", labels: YESNO, n: 2 },
];
const DIM = Object.fromEntries(DIMS.map((d, i) => [d.key, Object.assign(d, { idx: i })]));
const ND = DIMS.length;

// ============================================================ data
let N = 0, W, COL = {}, AGE, EARN;

async function load() {
  if (!window.SAMPLE_B64) throw new Error("data/sample.js did not load");
  const bin = atob(window.SAMPLE_B64);
  window.SAMPLE_B64 = null;
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  const u32 = new Uint32Array(bytes.buffer);
  N = u32.length / 2;
  const f = META.fields;
  const get = (k) => ({ off: f[k][0] % 32, mask: (2 ** f[k][1]) - 1, hi: f[k][0] >= 32 });
  for (const d of DIMS) COL[d.key] = new Uint8Array(N);
  AGE = new Uint8Array(N);
  EARN = new Uint32Array(N);
  W = new Float32Array(N);
  const wt = META.weights;
  const spec = ["state", "urban", "sex", "religion", "caste", "language", "education", "marital", "activity",
    "emp_type", "wealth", "hh_size", "smartphone", "internet", "bank", "insurance", "disability"].map((k) => [COL[k], get(k)]);
  const ga = get("age"), ge = get("earnings");
  const band = COL.band, eb = COL.earnband, st = COL.state, ur = COL.urban, sx = COL.sex;
  // rows are placed grouped by state (random order within a state) so per-state accumulators stay cache-local
  const gs = get("state"), start = new Uint32Array(S + 1);
  for (let r = 0; r < N; r++) start[((u32[2 * r] >>> gs.off) & gs.mask) + 1]++;
  for (let s = 0; s < S; s++) start[s + 1] += start[s];
  for (let r = 0; r < N; r++) {
    const lo = u32[2 * r], hi = u32[2 * r + 1];
    const i = start[(lo >>> gs.off) & gs.mask]++;
    for (let j = 0; j < spec.length; j++) {
      const s = spec[j][1];
      spec[j][0][i] = ((s.hi ? hi : lo) >>> s.off) & s.mask;
    }
    const a = (lo >>> ga.off) & ga.mask;
    AGE[i] = a;
    const b = Math.min((a / 5) | 0, NB - 1);
    band[i] = b;
    const e = (hi >>> ge.off) & ge.mask;
    EARN[i] = e * META.earnings_unit;
    eb[i] = e === 0 ? 0 : e < 50 ? 1 : e < 100 ? 2 : e < 200 ? 3 : e < 500 ? 4 : e < 1000 ? 5 : 6;
    W[i] = wt[((st[i] * 2 + ur[i]) * 3 + sx[i]) * NB + b];
  }
}

// ============================================================ aggregation engine
const K = {}; ["POP", "URB", "FEM", "MALE", "A0_14", "A15_64", "A65", "A60", "P7", "L7", "P25", "G25", "P15", "LF15",
  "F15", "FLF15", "UNEMP", "SM15", "NET15", "BANK15", "INS", "DIS", "WORK", "EARN", "HH", "SC", "ST", "ML7", "MP7",
  "FL7", "FP7", "M15", "MLF15", "FSM15", "MSM15", "F2024", "F2024M", "REG", "CAS", "SELF", "AGRI", "STUD", "HOME",
  "A15_24"].forEach((k, i) => (K[k] = i));
const NK = Object.keys(K).length;

// Per-row precomputation (done once after decoding):
//   GCOL[dim] : group code with a trash slot (index n) for rows outside a chart's universe
//   MA / MB   : bitmasks of the count-type metrics a row contributes to (K index 0-31 / 32-63)
let GCOL = {}, MA, MB, CELL;
function metricBits(i) {
  const a = AGE[i], sx = COL.sex[i], edu = COL.education[i], act = COL.activity[i], fem = sx === 1;
  const bits = [];
  const on = (k) => bits.push(K[k]);
  on("POP");
  if (COL.urban[i]) on("URB");
  if (fem) on("FEM"); else if (sx === 0) on("MALE");
  if (a < 15) on("A0_14"); else if (a < 65) on("A15_64"); else on("A65");
  if (a >= 60) on("A60");
  if (a >= 7) {
    on("P7"); if (edu >= 1) on("L7");
    if (fem) { on("FP7"); if (edu >= 1) on("FL7"); } else if (sx === 0) { on("MP7"); if (edu >= 1) on("ML7"); }
  }
  if (a >= 25) { on("P25"); if (edu >= 6) on("G25"); }
  const lf = act === 3 || act >= FW;
  if (a >= 15) {
    on("P15"); if (a < 25) on("A15_24"); if (lf) on("LF15");
    const sm = COL.smartphone[i];
    if (sm) on("SM15"); if (COL.internet[i]) on("NET15"); if (COL.bank[i]) on("BANK15");
    if (fem) { on("F15"); if (lf) on("FLF15"); if (sm) on("FSM15"); }
    else if (sx === 0) { on("M15"); if (lf) on("MLF15"); if (sm) on("MSM15"); }
  }
  if (act === 3) on("UNEMP");
  if (COL.insurance[i]) on("INS");
  if (COL.disability[i]) on("DIS");
  if (act >= FW) {
    on("WORK");
    const e = COL.emp_type[i];
    if (e === 1) on("SELF"); else if (e === 2) on("REG"); else if (e === 3) on("CAS");
    if (act === FW) on("AGRI");
  } else if (act === 1) on("STUD"); else if (act === 2) on("HOME");
  const c = COL.caste[i];
  if (c === 2) on("SC"); else if (c === 3) on("ST");
  if (fem && a >= 20 && a < 25) { on("F2024"); if (COL.marital[i] >= 1) on("F2024M"); }
  let ma = 0, mb = 0;
  for (const k of bits) { if (k < 32) ma |= 1 << k; else mb |= 1 << (k - 32); }
  return [ma >>> 0, mb >>> 0];
}
// Rows are also compressed for the hot loop:
//   PROF  : id of the row's (MA, MB) metric profile -> one add per row instead of ~15
//   COMBO : small dimensions packed into mixed-radix keys -> 7 adds instead of 19
const COMBOS = [["state"], ["language"], ["urban", "sex", "religion", "caste"], ["marital", "emp_type", "wealth", "earnband"],
  ["smartphone", "internet", "bank", "insurance", "disability"], ["education", "activity"], ["hh_size", "band"]];
let PROF, PROF_MA = [], PROF_MB = [], CKEY = [], CSIZE = [];
function prepare() {
  MA = new Uint32Array(N); MB = new Uint32Array(N); CELL = new Uint16Array(N); PROF = new Uint16Array(N);
  for (const d of DIMS) GCOL[d.key] = COL[d.key];
  const trash = (key, test) => {
    const src = COL[key], out = new Uint8Array(N), n = DIM[key].n;
    for (let i = 0; i < N; i++) out[i] = test(i, src[i]) ? src[i] : n;
    GCOL[key] = out;
  };
  trash("education", (i) => AGE[i] >= 25);
  trash("marital", (i) => AGE[i] >= 15);
  trash("emp_type", (i, c) => c !== 0);
  trash("earnband", (i, c) => c !== 0);
  for (const k of ["smartphone", "internet", "bank"]) trash(k, (i) => AGE[i] >= 15);
  const pmap = new Map();
  for (let i = 0; i < N; i++) {
    const [a, b] = metricBits(i);
    MA[i] = a; MB[i] = b;
    CELL[i] = COL.sex[i] * 101 + AGE[i];
    const key = a * 4096 + b;
    let id = pmap.get(key);
    if (id === undefined) { id = PROF_MA.length; pmap.set(key, id); PROF_MA.push(a); PROF_MB.push(b); }
    PROF[i] = id;
  }
  for (const combo of COMBOS) {
    const radix = combo.map((k) => DIM[k].n + 1);
    const size = radix.reduce((x, y) => x * y, 1);
    const out = size <= 65535 ? new Uint16Array(N) : new Uint32Array(N);
    const cols = combo.map((k) => GCOL[k]);
    for (let i = 0; i < N; i++) {
      let v = 0;
      for (let j = 0; j < cols.length; j++) v = v * radix[j] + cols[j][i];
      out[i] = v;
    }
    CKEY.push(out); CSIZE.push(size);
  }
}
function expandCombos(cacc, groups) {
  COMBOS.forEach((combo, c) => {
    const acc = cacc[c], radix = combo.map((k) => DIM[k].n + 1), gi = combo.map((k) => DIM[k].idx);
    for (let v = 0; v < acc.length; v++) {
      const w = acc[v];
      if (!w) continue;
      let r = v;
      for (let j = combo.length - 1; j >= 0; j--) { groups[gi[j]][r % radix[j]] += w; r = (r / radix[j]) | 0; }
    }
  });
}
function expandProfiles(pacc, stm) {
  const NP = PROF_MA.length;
  for (let s = 0; s < S; s++) {
    const base = s * NK;
    for (let p = 0; p < NP; p++) {
      const w = pacc[s * NP + p];
      if (!w) continue;
      let x = PROF_MA[p]; while (x) { const t = x & -x; stm[base + 31 - Math.clz32(t)] += w; x ^= t; }
      x = PROF_MB[p]; while (x) { const t = x & -x; stm[base + 63 - Math.clz32(t)] += w; x ^= t; }
    }
  }
}

function activeList(filters) {
  const act = [];
  for (const [key, set] of filters) {
    if (!set || set.size === 0) continue;
    const d = DIM[key];
    const allowed = new Uint8Array(Math.max(d.n, 32));
    for (const c of set) allowed[c] = 1;
    act.push({ d: d.idx, col: COL[key], allowed });
  }
  return act;
}
const kernelCache = new Map();
function buildKernel(actDims, cross) {
  const key = actDims.join(",") + "|" + cross;
  if (kernelCache.has(key)) return kernelCache.get(key);
  const iState = DIM.state.idx, iBand = DIM.band.idx;
  const metrics = (sel) => `
      { const s = ST[i], base = s * NK;
        pacc[s * NP + PROF[i]] += w;
        stm[base + KEARN] += w * EARN[i]; stm[base + KHH] += w * HHS[i];
        stAge[s * 101 + AGE[i]] += w; }` + (sel ? `
      { const c = CELL[i]; ageSex[c] += w; ageSexSel[c] += w; }` : "");
  let body = `for (let i = 0; i < N; i++) {\n  let fails = 0, fd = -1;\n`;
  actDims.forEach((d, j) => {
    body += cross
      ? `  if (!A${j}[F${j}[i]]) { if (fails) continue; fails = 1; fd = ${j}; }\n`
      : `  if (!A${j}[F${j}[i]]) continue;\n`;
  });
  body += `  const w = W[i];\n  if (fails === 0) {\n`;
  COMBOS.forEach((c, k) => (body += `    B${k}[K${k}[i]] += w;\n`));
  body += metrics(true) + `\n  } else {\n    switch (fd) {\n`;
  actDims.forEach((d, j) => {
    body += `      case ${j}: G${d}[C${d}[i]] += w;` +
      (d === iState ? metrics(false) : d === iBand ? ` ageSex[CELL[i]] += w;` : "") + ` break;\n`;
  });
  body += `    }\n  }\n}\n`;
  const args = ["N", "W", "AGE", "ST", "CELL", "PROF", "NP", "pacc", "EARN", "HHS", "stm", "stAge", "ageSex", "ageSexSel", "NK", "KEARN", "KHH",
    ...DIMS.map((d, k) => "G" + k), ...DIMS.map((d, k) => "C" + k), ...COMBOS.map((c, k) => "B" + k), ...COMBOS.map((c, k) => "K" + k), ...actDims.map((d, j) => "F" + j), ...actDims.map((d, j) => "A" + j)];
  const fn = new Function(...args, body);
  kernelCache.set(key, fn);
  return fn;
}
function aggregate(filters, cross = true) {
  const act = activeList(filters);
  const groups = DIMS.map((d) => new Float64Array(d.n + 1));
  const stm = new Float64Array(S * NK), stAge = new Float64Array(S * 101);
  const ageSex = new Float64Array(303), ageSexSel = new Float64Array(303);
  const fn = buildKernel(act.map((a) => a.d), cross);
  const NP = PROF_MA.length, pacc = new Float64Array(S * NP);
  const cacc = CSIZE.map((n) => new Float64Array(n));
  fn(N, W, AGE, COL.state, CELL, PROF, NP, pacc, EARN, COL.hh_size, stm, stAge, ageSex, ageSexSel, NK, K.EARN, K.HH,
    ...groups, ...DIMS.map((d) => GCOL[d.key]), ...cacc, ...CKEY, ...act.map((a) => a.col), ...act.map((a) => a.allowed));
  expandCombos(cacc, groups);
  expandProfiles(pacc, stm);
  return { groups: groups.map((g, k) => g.subarray(0, DIMS[k].n)), kpi: kpiFrom(stm, filters), stm, stAge, ageSex, ageSexSel, exact: false };
}
// selection KPIs = sum of per-state metrics over states that pass the state filter
function kpiFrom(stm, filters) {
  const kpi = new Float64Array(NK);
  const ss = filters.get("state");
  for (let s = 0; s < S; s++) {
    if (ss && ss.size && !ss.has(s)) continue;
    for (let k = 0; k < NK; k++) kpi[k] += stm[s * NK + k];
  }
  return kpi;
}

function stateSexAge(filters) {
  const act = activeList(filters);
  const out = new Float64Array(S * 303);
  const cols = act.map((a) => a.col), al = act.map((a) => a.allowed), na = act.length;
  for (let i = 0; i < N; i++) {
    let ok = true;
    for (let j = 0; j < na; j++) if (!al[j][cols[j][i]]) { ok = false; break; }
    if (!ok) continue;
    const sx = COL.sex[i];
    out[COL.state[i] * 303 + (sx === 2 ? 0 : sx) * 101 + AGE[i]] += W[i];
  }
  return out;
}

// ---------------------------------------------------------------- derived indicators
function medianFromHist(h, off = 0, n = 101) {
  let tot = 0; for (let a = 0; a < n; a++) tot += h[off + a];
  if (!tot) return NaN;
  let acc = 0;
  for (let a = 0; a < n; a++) {
    const v = h[off + a];
    if (acc + v >= tot / 2) return a + (tot / 2 - acc) / v;
    acc += v;
  }
  return n - 1;
}
const R = (m, b, num, den) => (m[b + K[den]] > 0 ? m[b + K[num]] / m[b + K[den]] : NaN);
const IND = {
  pop: { label: "Population", f: (m, b) => m[b + K.POP], fmt: fmtPop },
  urban: { label: "Urban", f: (m, b) => R(m, b, "URB", "POP"), fmt: pct, unit: "pp" },
  sexratio: { label: "Sex ratio (F per 1,000 M)", f: (m, b) => (m[b + K.MALE] > 0 ? 1000 * m[b + K.FEM] / m[b + K.MALE] : NaN), fmt: (v) => (isFinite(v) ? Math.round(v) : "–"), unit: "" },
  median: { label: "Median age", fmt: (v) => (isFinite(v) ? v.toFixed(1) : "–"), unit: "yrs" },
  child: { label: "Children 0–14", f: (m, b) => R(m, b, "A0_14", "POP"), fmt: pct, unit: "pp" },
  elderly: { label: "Aged 60+", f: (m, b) => R(m, b, "A60", "POP"), fmt: pct, unit: "pp" },
  dep: { label: "Dependency ratio", f: (m, b) => (m[b + K.A15_64] > 0 ? (m[b + K.A0_14] + m[b + K.A65]) / m[b + K.A15_64] * 100 : NaN), fmt: (v) => (isFinite(v) ? v.toFixed(1) : "–"), unit: "" },
  lit: { label: "Literacy (7+)", f: (m, b) => R(m, b, "L7", "P7"), fmt: pct, unit: "pp" },
  flit: { label: "Female literacy", f: (m, b) => R(m, b, "FL7", "FP7"), fmt: pct, unit: "pp" },
  grad: { label: "Graduates (25+)", f: (m, b) => R(m, b, "G25", "P25"), fmt: pct, unit: "pp" },
  lfpr: { label: "Labour force (15+)", f: (m, b) => R(m, b, "LF15", "P15"), fmt: pct, unit: "pp" },
  flfpr: { label: "Female labour force", f: (m, b) => R(m, b, "FLF15", "F15"), fmt: pct, unit: "pp" },
  ue: { label: "Unemployment rate", f: (m, b) => R(m, b, "UNEMP", "LF15"), fmt: pct, unit: "pp", lowerBetter: true },
  smart: { label: "Smartphone (15+)", f: (m, b) => R(m, b, "SM15", "P15"), fmt: pct, unit: "pp" },
  net: { label: "Internet users (15+)", f: (m, b) => R(m, b, "NET15", "P15"), fmt: pct, unit: "pp" },
  bank: { label: "Bank account (15+)", f: (m, b) => R(m, b, "BANK15", "P15"), fmt: pct, unit: "pp" },
  ins: { label: "Health cover", f: (m, b) => R(m, b, "INS", "POP"), fmt: pct, unit: "pp" },
  earn: { label: "Avg monthly earnings", f: (m, b) => R(m, b, "EARN", "WORK"), fmt: fmtRs, unit: "rs" },
  hh: { label: "Avg household size", f: (m, b) => R(m, b, "HH", "POP"), fmt: (v) => (isFinite(v) ? v.toFixed(2) : "–"), unit: "" },
  sc: { label: "Scheduled Castes", f: (m, b) => R(m, b, "SC", "POP"), fmt: pct, unit: "pp" },
  st: { label: "Scheduled Tribes", f: (m, b) => R(m, b, "ST", "POP"), fmt: pct, unit: "pp" },
  agri: { label: "Workers in agriculture", f: (m, b) => R(m, b, "AGRI", "WORK"), fmt: pct, unit: "pp" },
  regular: { label: "Regular salaried workers", f: (m, b) => R(m, b, "REG", "WORK"), fmt: pct, unit: "pp" },
  married2024: { label: "Women 20–24 married", f: (m, b) => R(m, b, "F2024M", "F2024"), fmt: pct, unit: "pp", lowerBetter: true },
  disab: { label: "With a disability", f: (m, b) => R(m, b, "DIS", "POP"), fmt: pct, unit: "pp" },
};
function ind(key, agg, s = null) {
  const m = s === null ? agg.kpi : agg.stm, b = s === null ? 0 : s * NK;
  if (key === "median") return s === null ? medianFromHist(sumAges(agg.ageSexSel)) : medianFromHist(agg.stAge, s * 101);
  return IND[key].f(m, b);
}
function sumAges(as) { const h = new Float64Array(101); for (let k = 0; k < 303; k++) h[k % 101] += as[k]; return h; }

// ============================================================ state
const state = { filters: new Map(), tab: "explore", mapMetric: "pop", pyrMode: "band" };
let BASE = null;   // all-India aggregate
let AGG = null;    // current aggregate
const STATE_POP = STATES.map((s) => s.rows);

function setFilter(key, codes) {
  if (!codes || codes.size === 0) state.filters.delete(key); else state.filters.set(key, codes);
  scheduleUpdate();
}
function toggleCode(key, code, additive = true) {
  const cur = new Set(state.filters.get(key) || []);
  if (cur.has(code)) cur.delete(code);
  else { if (!additive) cur.clear(); cur.add(code); }
  setFilter(key, cur);
}
function describeFilters(filters) {
  const parts = [];
  for (const [k, set] of filters) {
    const d = DIM[k];
    const names = [...set].sort((a, b) => a - b).map((c) => d.labels[c]);
    let txt = names.length > 3 ? names.slice(0, 2).join(", ") + ` +${names.length - 2}` : names.join(", ");
    if (d.n === 2 && d.labels === YESNO) txt = (set.has(1) && !set.has(0) ? "" : "no ") + d.label.toLowerCase();
    else if (k === "band") txt = "age " + txt;
    parts.push(txt);
  }
  return parts.length ? parts.join(" · ") : "All of India";
}

let pending = false;
function scheduleUpdate() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; update(); });
}
function renderCurrent() {
  $("#app").classList.toggle("approx", LIVE.ready && !(AGG && AGG.exact));
  if (state.tab === "explore") renderExplore();
  if (state.tab === "projection") renderProjection(true);
  if (state.tab === "hundred") renderHundred();
  if (state.tab === "data") renderData();
}
function update() {
  const t0 = performance.now();
  AGG = aggregate(state.filters, true);   // instant estimate from the in-browser sample
  renderChips();
  renderCurrent();
  const dt = performance.now() - t0;
  $("#subtitle").textContent = `${fmtFull(META.total)} simulated people · ${STATES.length} states & UTs · ` +
    (LIVE.ready ? `instant estimate in ${dt.toFixed(0)} ms, then exact answers from all records`
      : `${fmtFull(N)}-person weighted extract · last update ${dt.toFixed(0)} ms`);
  refineExact();                           // exact answer from the full population, if a server is available
}

// ============================================================ live mode (exact queries over all 1.5B records)
/* The page always answers from its 1.3M-person sample first. When a query server (server/app.py) is reachable,
 * every view is then re-requested from the server, which scans all records, and redrawn with exact numbers.
 * Server location: same origin, or ?api=https://host/ in the page URL, or window.BHARAT_API. */
const LIVE = { base: null, on: false, ready: false, health: null, client: Math.random().toString(36).slice(2, 10), seq: 0, ctl: null, poll: null };
function apiUrl(p) { return LIVE.base + p; }
async function postJSON(path, body, signal) {
  const r = await fetch(apiUrl(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (r.status === 409) { const e = new Error("superseded"); e.name = "AbortError"; throw e; }
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r;
}
async function detectLive() {
  let q = null;
  try { q = new URLSearchParams(location.search).get("api"); } catch (e) { /* ignore */ }
  const cands = [];
  if (q) cands.push(q.endsWith("/") ? q : q + "/");
  if (window.BHARAT_API) cands.push(window.BHARAT_API.endsWith("/") ? window.BHARAT_API : window.BHARAT_API + "/");
  if (location.protocol.startsWith("http") && !location.hostname.endsWith("github.io")) cands.push("");
  for (const base of cands) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(base + "api/health", { signal: ctl.signal }); clearTimeout(t);
      if (!r.ok) continue;
      const h = await r.json();
      if (!h.ok) continue;
      LIVE.base = base; LIVE.on = true; LIVE.health = h;
      return true;
    } catch (e) { /* not available */ }
  }
  setPill("sample");
  return false;
}
async function waitWarm() {
  while (true) {
    const h = await (await fetch(apiUrl("api/health"))).json();
    LIVE.health = h;
    if (h.warm) break;
    setPill("warming", h.warm_progress);
    await new Promise((r) => setTimeout(r, 1000));
  }
  LIVE.ready = true;
  // exact national baseline first (instant on a warm server), then the current view
  const r = await (await postJSON("api/aggregate", { filters: {}, cross: true, client: LIVE.client + "-base" })).json();
  BASE = fromServer(r, new Map());
  proj.baseCache = null;
  update();
  if (state.tab === "me") renderMe();            // tabs with their own queries refresh once the server is ready
  if (state.tab === "compare") renderCompare();
}
function filtersObj(filters) { return Object.fromEntries([...filters].map(([k, set]) => [k, [...set]])); }
function fromServer(r, filters) {
  const h = LIVE.health, mi = h.metrics, di = h.dims;
  const perm = Object.keys(K).map((name) => mi.indexOf(name));
  const stm = new Float64Array(S * NK), stAge = new Float64Array(S * 101), ssaFlat = new Float64Array(S * 303);
  for (let s = 0; s < S; s++) {
    for (let k = 0; k < NK; k++) stm[s * NK + k] = r.stm[s][perm[k]];
    for (let a = 0; a < 101; a++) stAge[s * 101 + a] = r.stAge[s][a];
    for (let a = 0; a < 101; a++) {      // projection layout: third gender folded into male, as in stateSexAge()
      ssaFlat[s * 303 + a] = r.ssa[s][a] + r.ssa[s][202 + a];
      ssaFlat[s * 303 + 101 + a] = r.ssa[s][101 + a];
    }
  }
  const groups = DIMS.map((d) => Float64Array.from(r.groups[di.indexOf(d.key)]));
  return { groups, kpi: kpiFrom(stm, filters), stm, stAge, ageSex: Float64Array.from(r.ageSex),
    ageSexSel: Float64Array.from(r.ageSexSel), ssaFlat, exact: true,
    info: { seconds: r.seconds, cached: r.cached, scanned: r.scanned } };
}
function refineExact() {
  if (!LIVE.ready) return;
  const seq = ++LIVE.seq;
  const filters = new Map([...state.filters].map(([k, v]) => [k, new Set(v)]));
  if (LIVE.ctl) LIVE.ctl.abort();
  LIVE.ctl = new AbortController();
  setPill("refining", 0);
  startPoll(seq);
  postJSON("api/aggregate", { filters: filtersObj(filters), cross: true, client: LIVE.client, seq }, LIVE.ctl.signal)
    .then((r) => r.json())
    .then((r) => {
      if (seq !== LIVE.seq) return;
      stopPoll();
      AGG = fromServer(r, filters);
      setPill("exact", AGG.info);
      renderCurrent();
    })
    .catch((e) => { if (e.name !== "AbortError" && seq === LIVE.seq) { stopPoll(); setPill("error"); } });
}
function startPoll(seq) {
  stopPoll();
  LIVE.poll = setInterval(async () => {
    try {
      const r = await (await fetch(apiUrl("api/status?client=" + LIVE.client))).json();
      if (seq === LIVE.seq && r.state !== "idle") setPill(r.state === "queued" ? "queued" : "refining", r.progress, r.elapsed);
    } catch (e) { /* ignore */ }
  }, 350);
}
function stopPoll() { if (LIVE.poll) clearInterval(LIVE.poll); LIVE.poll = null; }
function setPill(mode, a, b) {
  const el = $("#mode-pill");
  if (!el) return;
  el.className = "mode-pill " + mode;
  el.replaceChildren();
  const icon = document.createElement("span"); icon.className = "ic";
  const txt = document.createElement("span");
  const bar = document.createElement("i"); bar.className = "bar";
  if (mode === "sample") { icon.textContent = "≈"; txt.textContent = "Estimates · 1.3M-person sample"; el.title = "Run server/app.py next to the full data for exact answers over all 1.5B records"; }
  if (mode === "warming") { icon.textContent = "⟳"; txt.textContent = `Live server loading 1.5B records · ${Math.round(a * 100)}%`; bar.style.width = (a * 100) + "%"; }
  if (mode === "queued") { icon.textContent = "≈"; txt.textContent = "Estimate shown · exact query queued"; }
  if (mode === "refining") { icon.textContent = "≈"; txt.textContent = `Estimate shown · exact scan ${Math.round((a || 0) * 100)}%${b ? ` · ${b.toFixed(1)}s` : ""}`; bar.style.width = ((a || 0) * 100) + "%"; }
  if (mode === "exact") {
    icon.textContent = "✓";
    txt.textContent = `Exact · all ${fmtPop(META.total)} records · ` + (a.cached ? "cached" : a.scanned === 0 ? "instant (precomputed)" : `${a.seconds.toFixed(1)} s`);
  }
  if (mode === "error") { icon.textContent = "!"; txt.textContent = "Live server unreachable · showing estimates"; }
  el.append(icon, txt, bar);
}

// ============================================================ tooltip
const tip = $("#tooltip");
function showTip(ev, title, rows) {
  tip.replaceChildren();
  if (title) { const t = document.createElement("div"); t.className = "tt-title"; t.textContent = title; tip.append(t); }
  for (const r of rows) {
    const row = document.createElement("div"); row.className = "tt-row";
    const k = document.createElement("span"); k.className = "k";
    if (r.color) { const l = document.createElement("i"); l.className = "ln"; l.style.borderColor = r.color; k.append(l); }
    k.append(document.createTextNode(r.k));
    const v = document.createElement("span"); v.className = "v"; v.textContent = r.v;
    row.append(k, v); tip.append(row);
  }
  tip.hidden = false;
  moveTip(ev);
}
function moveTip(ev) {
  const x = ev.clientX ?? (ev.target.getBoundingClientRect().right), y = ev.clientY ?? ev.target.getBoundingClientRect().top;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = left + "px"; tip.style.top = top + "px";
}
const hideTip = () => (tip.hidden = true);

// ============================================================ chips & filter row
function renderChips() {
  const box = $("#chips");
  box.replaceChildren();
  if (state.filters.size === 0) {
    const c = document.createElement("span"); c.className = "chip all"; c.textContent = "All of India · click any bar, tile or band to filter";
    box.append(c);
    return;
  }
  for (const [k, set] of state.filters) {
    const d = DIM[k];
    const c = document.createElement("span"); c.className = "chip";
    const b = document.createElement("b"); b.textContent = d.label + ": ";
    const names = [...set].sort((a, b) => a - b).map((x) => d.labels[x]);
    c.append(b, document.createTextNode(names.length > 4 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ")));
    const x = document.createElement("button"); x.textContent = "×"; x.setAttribute("aria-label", "Remove " + d.label + " filter");
    x.onclick = () => setFilter(k, null);
    c.append(x); box.append(c);
  }
}
function initQuickAdd() {
  const sel = $("#quick-add");
  const presets = [
    ["Age: children (0–14)", "band", [0, 1, 2]], ["Age: youth (15–24)", "band", [3, 4]], ["Age: 60+", "band", d3.range(12, NB)],
    ["Women", "sex", [1]], ["Men", "sex", [0]], ["Urban", "urban", [1]], ["Rural", "urban", [0]],
    ["Graduates+", "education", [6, 7]], ["No schooling", "education", [0]], ["Poorest 40%", "wealth", [0, 1]], ["Richest 20%", "wealth", [4]],
    ["Workers", "activity", d3.range(FW, 12)], ["Unemployed", "activity", [3]], ["Students", "activity", [1]],
    ["South India", "state", STATES.map((s, i) => (s.region === "South" ? i : -1)).filter((i) => i >= 0)],
    ["North-East", "state", STATES.map((s, i) => (s.region === "North-East" ? i : -1)).filter((i) => i >= 0)],
    ["Hindi belt (UP, Bihar, MP, Rajasthan…)", "state", ["UP", "BR", "MP", "RJ", "JH", "CG", "HR", "UK", "HP", "DL"].map((a) => STATES.findIndex((s) => s.abbr === a))],
    ["No smartphone (15+)", "smartphone", [0]], ["No bank account", "bank", [0]],
  ];
  for (const [label, k, codes] of presets) {
    const o = document.createElement("option"); o.value = JSON.stringify([k, codes]); o.textContent = label; sel.append(o);
  }
  sel.onchange = () => {
    if (!sel.value) return;
    const [k, codes] = JSON.parse(sel.value);
    setFilter(k, new Set(codes));
    sel.value = "";
  };
  $("#clear-all").onclick = () => { state.filters.clear(); scheduleUpdate(); };
}

// ============================================================ generic chart helpers
function roundedRightPath(x, y, w, h, r) {
  w = Math.max(0, w); r = Math.min(r, w, h / 2);
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`;
}
function roundedLeftPath(x, y, w, h, r) { // bar growing leftwards from x
  w = Math.max(0, w); r = Math.min(r, w, h / 2);
  return `M${x},${y}h${-(w - r)}a${r},${r} 0 0 0 ${-r},${r}v${h - 2 * r}a${r},${r} 0 0 0 ${r},${r}h${w - r}z`;
}
function roundedTopPath(x, y0, w, h, r) { // column from baseline y0 up by h
  h = Math.max(0, h); r = Math.min(r, h, w / 2);
  return `M${x},${y0}v${-(h - r)}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
}
const DUR = 380;

/* Horizontal bar chart, one series. items: [{code,label,value}] where value = people. */
function hbars(el, items, opt = {}) {
  const width = Math.max(240, el.clientWidth);
  const rowH = opt.rowH || 24, barH = Math.min(14, rowH - 8), labelW = opt.labelW || Math.min(150, width * 0.42), valW = 52;
  const height = items.length * rowH + 4;
  let svg = d3.select(el).select("svg");
  if (svg.empty()) svg = d3.select(el).append("svg");
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  const total = opt.total ?? d3.sum(items, (d) => d.value);
  const frac = opt.frac || ((d) => d.value / (total || 1));
  const max = opt.max ?? (d3.max(items, frac) || 1);
  const x = d3.scaleLinear().domain([0, max]).range([0, width - labelW - valW]);
  const sel = opt.selected;
  const colorFor = (d, i) => (sel && sel.size && !sel.has(d.code) ? css("--dim-bar") : opt.colors ? opt.colors[d.code] ?? opt.colors[i] : css("--s1"));
  const rows = svg.selectAll("g.row").data(items, (d) => d.code);
  const enter = rows.enter().append("g").attr("class", "row").attr("tabindex", 0).attr("role", "button")
    .attr("transform", (d, i) => `translate(0,${i * rowH})`).style("opacity", 0);
  enter.append("rect").attr("class", "hit").attr("x", 0).attr("y", 0).attr("height", rowH);
  enter.append("text").attr("class", "lbl").attr("x", labelW - 8).attr("y", rowH / 2).attr("dy", "0.35em").attr("text-anchor", "end");
  enter.append("path").attr("class", "bar");
  enter.append("text").attr("class", "val").attr("dy", "0.35em").attr("y", rowH / 2);
  const all = enter.merge(rows);
  all.transition().duration(DUR).attr("transform", (d, i) => `translate(0,${i * rowH})`).style("opacity", 1);
  all.select(".hit").attr("width", width);
  all.select(".lbl").text((d) => d.label).classed("strong", (d) => sel && sel.has(d.code));
  all.select(".bar").transition().duration(DUR)
    .attr("d", (d) => roundedRightPath(labelW, (rowH - barH) / 2, x(frac(d)), barH, 4))
    .attr("fill", colorFor);
  all.select(".val").transition().duration(DUR)
    .attr("x", (d) => labelW + x(frac(d)) + 6)
    .text((d) => (opt.valueFmt ? opt.valueFmt(d, total) : pct(frac(d), frac(d) < 0.1 ? 1 : 0)));
  rows.exit().transition().duration(200).style("opacity", 0).remove();
  all.on("click", (ev, d) => opt.onClick && opt.onClick(d, ev))
    .on("keydown", (ev, d) => { if ((ev.key === "Enter" || ev.key === " ") && opt.onClick) { ev.preventDefault(); opt.onClick(d, ev); } })
    .on("pointermove focus", (ev, d) => showTip(ev, d.label, opt.tip ? opt.tip(d, total) : [
      { k: "People", v: fmtPop(d.value) }, { k: "Share", v: pct(d.value / (total || 1)) }]))
    .on("pointerleave blur", hideTip);
}

/* Vertical columns (ordinal histograms) */
function columns(el, items, opt = {}) {
  const width = Math.max(240, el.clientWidth), height = opt.height || 150, mb = 22, mt = 16;
  let svg = d3.select(el).select("svg");
  if (svg.empty()) { svg = d3.select(el).append("svg"); svg.append("g").attr("class", "axis xax"); }
  svg.attr("width", width).attr("height", height);
  const total = d3.sum(items, (d) => d.value) || 1;
  const x = d3.scaleBand().domain(items.map((d) => d.code)).range([4, width - 4]).paddingInner(0.18);
  const bw = Math.min(24, x.bandwidth());
  const y = d3.scaleLinear().domain([0, d3.max(items, (d) => d.value / total) || 1]).range([0, height - mb - mt]);
  const sel = opt.selected;
  const cols = svg.selectAll("g.row").data(items, (d) => d.code);
  const en = cols.enter().append("g").attr("class", "row").attr("tabindex", 0);
  en.append("rect").attr("class", "hit");
  en.append("path").attr("class", "bar");
  en.append("text").attr("class", "xl").attr("text-anchor", "middle");
  const all = en.merge(cols);
  all.select(".hit").attr("x", (d) => x(d.code)).attr("width", x.bandwidth()).attr("y", 0).attr("height", height);
  all.select(".bar").transition().duration(DUR)
    .attr("d", (d) => roundedTopPath(x(d.code) + (x.bandwidth() - bw) / 2, height - mb, bw, y(d.value / total), 4))
    .attr("fill", (d, i) => (sel && sel.size && !sel.has(d.code) ? css("--dim-bar") : opt.colors ? opt.colors[i] : css("--s1")));
  all.select(".xl").attr("x", (d) => x(d.code) + x.bandwidth() / 2).attr("y", height - 6).text((d, i) => (opt.tickEvery && i % opt.tickEvery ? "" : d.short ?? d.label));
  cols.exit().remove();
  all.on("click", (ev, d) => opt.onClick && opt.onClick(d, ev))
    .on("keydown", (ev, d) => { if ((ev.key === "Enter" || ev.key === " ") && opt.onClick) { ev.preventDefault(); opt.onClick(d, ev); } })
    .on("pointermove focus", (ev, d) => showTip(ev, d.label, [{ k: "People", v: fmtPop(d.value) }, { k: "Share", v: pct(d.value / total) }]))
    .on("pointerleave blur", hideTip);
  // value label on the tallest column only (selective labelling)
  const top = items.reduce((a, b) => (b.value > a.value ? b : a), items[0]);
  let lab = svg.select("text.toplab");
  if (lab.empty()) lab = svg.append("text").attr("class", "toplab strong").attr("text-anchor", "middle");
  lab.transition().duration(DUR).attr("x", x(top.code) + x.bandwidth() / 2).attr("y", height - mb - y(top.value / total) - 5).text(pct(top.value / total, 0));
}

// ============================================================ EXPLORE
const KPI_KEYS = ["sexratio", "median", "lit", "urban", "dep", "flfpr", "ue", "smart", "earn", "grad"];
function renderKPIs() {
  const box = $("#kpis");
  if (!box.childElementCount) {
    const hero = document.createElement("div"); hero.className = "kpi hero";
    hero.innerHTML = '<div class="label">Population in selection</div><div class="value"></div><div class="sub"></div>';
    box.append(hero);
    for (const k of KPI_KEYS) {
      const d = document.createElement("div"); d.className = "kpi"; d.dataset.k = k;
      d.innerHTML = '<div class="label"></div><div class="value"></div><div class="delta"></div>';
      d.querySelector(".label").textContent = IND[k].label;
      box.append(d);
    }
  }
  const pop = AGG.kpi[K.POP];
  const hero = box.querySelector(".hero");
  animateNumber(hero.querySelector(".value"), pop, fmtPop);
  hero.querySelector(".sub").textContent = state.filters.size
    ? `${pct(pop / META.total, pop / META.total < 0.01 ? 2 : 1)} of India · ${countryCompare(pop)}`
    : `${fmtFull(META.total)} people, every one generated individually`;
  for (const el of box.querySelectorAll(".kpi[data-k]")) {
    const k = el.dataset.k, v = ind(k, AGG), b = ind(k, BASE);
    el.querySelector(".value").textContent = IND[k].fmt(v);
    const dEl = el.querySelector(".delta");
    dEl.replaceChildren();
    if (state.filters.size && isFinite(v) && isFinite(b)) {
      const u = IND[k].unit;
      let diff, txt;
      if (u === "pp") { diff = (v - b) * 100; txt = `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} pp`; }
      else if (u === "rs") { diff = (v / b - 1) * 100; txt = `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(0)}%`; }
      else { diff = v - b; txt = `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(k === "sexratio" ? 0 : 1)}${u ? " " + u : ""}`; }
      const span = document.createElement("span");
      span.textContent = (diff >= 0 ? "▲ " : "▼ ") + txt;
      dEl.append(span, document.createTextNode(" vs India"));
    } else dEl.textContent = state.filters.size ? "" : "All India";
  }
}
function animateNumber(el, to, fmt) {
  const from = +el.dataset.v || 0;
  el.dataset.v = to;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 450), e = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1 && +el.dataset.v === to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const COUNTRIES = [["the USA", 340e6], ["Indonesia", 283e6], ["Pakistan", 251e6], ["Nigeria", 233e6], ["Brazil", 212e6],
  ["Bangladesh", 175e6], ["Russia", 144e6], ["Ethiopia", 132e6], ["Mexico", 131e6], ["Japan", 123e6], ["Egypt", 118e6],
  ["the Philippines", 116e6], ["Vietnam", 101e6], ["Iran", 92e6], ["Turkey", 87e6], ["Germany", 84e6], ["Thailand", 72e6],
  ["the UK", 69e6], ["France", 66e6], ["South Africa", 64e6], ["Italy", 59e6], ["Kenya", 57e6], ["Colombia", 53e6],
  ["South Korea", 52e6], ["Spain", 48e6], ["Argentina", 46e6], ["Canada", 40e6], ["Poland", 38e6], ["Malaysia", 36e6],
  ["Saudi Arabia", 34e6], ["Australia", 27e6], ["Sri Lanka", 22e6], ["the Netherlands", 18e6], ["Sweden", 10.6e6],
  ["Switzerland", 9e6], ["Singapore", 6e6], ["New Zealand", 5.2e6], ["Iceland", 0.4e6]];
function countryCompare(n) {
  if (n > 1.2 * COUNTRIES[0][1]) return `${(n / COUNTRIES[0][1]).toFixed(1)}× the population of the USA`;
  let best = COUNTRIES[0];
  for (const c of COUNTRIES) if (Math.abs(Math.log(n / c[1])) < Math.abs(Math.log(n / best[1]))) best = c;
  const r = n / best[1];
  return r > 0.9 && r < 1.1 ? `about the population of ${best[0]}` : r >= 1.1 ? `more people than ${best[0]}` : `a little fewer than ${best[0]}`;
}

// ---------------------------------------------------------------- tile map
const MAP_METRICS = [
  ["pop", "Population (selection)"], ["share", "Selection as % of state population"], ["urban", "Urban %"],
  ["sexratio", "Sex ratio"], ["median", "Median age"], ["child", "Children 0–14 %"], ["elderly", "Aged 60+ %"],
  ["lit", "Literacy (7+)"], ["flit", "Female literacy"], ["grad", "Graduates (25+)"], ["flfpr", "Female labour force"],
  ["ue", "Unemployment rate"], ["agri", "Workers in agriculture"], ["regular", "Regular salaried workers"],
  ["smart", "Smartphone (15+)"], ["net", "Internet (15+)"], ["bank", "Bank account (15+)"], ["ins", "Health cover"],
  ["earn", "Avg monthly earnings"], ["hh", "Avg household size"], ["married2024", "Women 20–24 married"],
  ["sc", "Scheduled Castes %"], ["st", "Scheduled Tribes %"]];
function mapValue(key, s) {
  if (key === "share") return AGG.stm[s * NK + K.POP] / STATE_POP[s];
  return ind(key, AGG, s);
}
function mapFmt(key) { return key === "share" ? pct : IND[key].fmt; }
function renderMap() {
  const el = $("#map");
  const key = state.mapMetric;
  const width = Math.max(320, el.clientWidth);
  const cols = 7, rows = 8, gap = 4;
  const ts = Math.min(64, (width - gap * (cols - 1)) / cols);
  const height = rows * (ts + gap);
  let svg = d3.select(el).select("svg");
  if (svg.empty()) svg = d3.select(el).append("svg");
  svg.attr("width", width).attr("height", height);
  const vals = STATES.map((_, s) => mapValue(key, s));
  const finite = vals.filter((v) => isFinite(v) && v > 0 || (isFinite(v) && key !== "pop"));
  const ext = d3.extent(finite.length ? finite : [0, 1]);
  let scale;
  if (key === "sexratio") { const m = Math.max(Math.abs(ext[0] - 1000), Math.abs(ext[1] - 1000), 20); scale = divScale(1000 - m, 1000, 1000 + m); }
  else if (key === "pop") scale = seqScale([0, Math.sqrt(ext[1] || 1)]);
  else scale = seqScale(ext[0] === ext[1] ? [ext[0] - 1e-6, ext[1] + 1e-6] : ext);
  const color = (v) => (!isFinite(v) || (key === "pop" && v <= 0) ? css("--surface-2") : scale(key === "pop" ? Math.sqrt(v) : v));
  const x0 = (width - (cols * ts + (cols - 1) * gap)) / 2;
  const sel = state.filters.get("state");
  const fmt = mapFmt(key);
  const g = svg.selectAll("g.tile").data(STATES, (d) => d.abbr);
  const en = g.enter().append("g").attr("class", "tile").attr("tabindex", 0).attr("role", "button")
    .attr("transform", (d) => `translate(${x0 + d.tile[1] * (ts + gap)},${d.tile[0] * (ts + gap)})`);
  en.append("rect").attr("class", "bg").attr("rx", 6).attr("width", ts).attr("height", ts);
  en.append("text").attr("class", "ab").attr("x", 6).attr("y", 15).style("font-weight", 600).style("font-size", "11px");
  en.append("text").attr("class", "vl").attr("x", 6).attr("y", ts - 8).style("font-size", "10.5px");
  const all = en.merge(g);
  all.attr("transform", (d) => `translate(${x0 + d.tile[1] * (ts + gap)},${d.tile[0] * (ts + gap)})`);
  all.classed("sel", (d, i) => sel && sel.has(i));
  all.select("rect.bg").attr("width", ts).attr("height", ts).transition().duration(DUR)
    .attr("fill", (d, i) => color(vals[i])).style("opacity", (d, i) => (sel && sel.size && !sel.has(i) ? 0.45 : 1));
  all.select(".ab").text((d) => d.abbr).style("fill", (d, i) => inkOn(color(vals[i])));
  all.select(".vl").text((d, i) => (ts >= 52 ? shortVal(key, vals[i]) : "")).style("fill", (d, i) => inkOn(color(vals[i])));
  all.on("click", (ev, d) => toggleCode("state", STATES.indexOf(d)))
    .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleCode("state", STATES.indexOf(d)); } })
    .on("pointermove focus", (ev, d) => {
      const s = STATES.indexOf(d);
      showTip(ev, d.name, [{ k: MAP_METRICS.find((m) => m[0] === key)[1], v: fmt(vals[s]) },
        { k: "People in selection", v: fmtPop(AGG.stm[s * NK + K.POP]) }, { k: "State population", v: fmtPop(STATE_POP[s]) }]);
    })
    .on("pointerleave blur", hideTip);
  // legend
  const lg = $("#map-legend");
  lg.replaceChildren();
  const lo = document.createElement("span"), hi = document.createElement("span"), ramp = document.createElement("div");
  ramp.className = "ramp";
  const dom = key === "sexratio" ? scale.domain() : key === "pop" ? [0, (ext[1] || 1)] : scale.domain();
  const stops = d3.range(0, 1.01, 0.1).map((t) => (key === "sexratio" ? scale(dom[0] + t * (dom[2] - dom[0])) : key === "pop" ? scale(Math.sqrt(t * dom[1])) : scale(dom[0] + t * (dom[1] - dom[0]))));
  ramp.style.background = `linear-gradient(90deg, ${stops.join(",")})`;
  lo.textContent = key === "pop" ? "0" : fmt(dom[0]);
  hi.textContent = fmt(key === "sexratio" ? dom[2] : dom[1]);
  lg.append(lo, ramp, hi);
  if (key === "sexratio") { const n = document.createElement("span"); n.textContent = "· orange = more women, blue = more men"; lg.append(n); }
}
function shortVal(key, v) {
  if (!isFinite(v)) return "–";
  if (key === "pop") return fmtPop(v).replace(" crore", "cr").replace(" lakh", "L");
  if (key === "earn") return "₹" + (v >= 1e5 ? (v / 1e5).toFixed(1) + "L" : (v / 1e3).toFixed(1) + "K");
  if (key === "sexratio") return Math.round(v);
  if (key === "median" || key === "hh") return v.toFixed(1);
  return (v * 100).toFixed(v < 0.1 ? 1 : 0) + "%";
}

// ---------------------------------------------------------------- pyramid
function pyramidData(ageSex, mode) {
  const out = [];
  if (mode === "band") {
    for (let b = 0; b < NB; b++) {
      let m = 0, f = 0;
      for (let a = b * 5; a < (b === NB - 1 ? 101 : b * 5 + 5); a++) { m += ageSex[a]; f += ageSex[101 + a]; }
      out.push({ code: b, label: BAND_LABELS[b], m, f });
    }
  } else for (let a = 0; a <= 100; a++) out.push({ code: a, label: a === 100 ? "100+" : String(a), m: ageSex[a], f: ageSex[101 + a] });
  return out;
}
function drawPyramid(el, data, ref, opt = {}) {
  const width = Math.max(300, el.clientWidth), height = opt.height || 400;
  const mt = 6, mb = 24, mid = 34;
  let svg = d3.select(el).select("svg");
  if (svg.empty()) {
    svg = d3.select(el).append("svg");
    svg.append("g").attr("class", "gridline");
    svg.append("g").attr("class", "bars");
    svg.append("path").attr("class", "refm").attr("fill", "none");
    svg.append("path").attr("class", "reff").attr("fill", "none");
    svg.append("g").attr("class", "axis xax");
    svg.append("g").attr("class", "agel");
    svg.append("text").attr("class", "sexl ml").attr("text-anchor", "start");
    svg.append("text").attr("class", "sexl fl").attr("text-anchor", "end");
  }
  svg.attr("width", width).attr("height", height);
  const tot = d3.sum(data, (d) => d.m + d.f) || 1;
  const rtot = ref ? d3.sum(ref, (d) => d.m + d.f) || 1 : 1;
  const maxv = opt.max || Math.max(d3.max(data, (d) => Math.max(d.m, d.f) / tot) || 0.01, ref ? d3.max(ref, (d) => Math.max(d.m, d.f) / rtot) : 0) * 1.05;
  const half = (width - mid) / 2;
  const x = d3.scaleLinear().domain([0, maxv]).range([0, half - 6]);
  const n = data.length;
  const y = d3.scaleBand().domain(d3.range(n)).range([height - mb, mt]).paddingInner(n > 50 ? 0.12 : 0.18);
  const bh = Math.min(24, y.bandwidth());
  const cx = half + mid / 2;
  const sel = opt.selected;
  const colM = opt.colM || css("--s1"), colF = opt.colF || css("--s2");
  const dim = css("--dim-bar");
  const rows = svg.select("g.bars").selectAll("g.row").data(data, (d) => d.code);
  const en = rows.enter().append("g").attr("class", "row");
  en.append("rect").attr("class", "hit");
  en.append("path").attr("class", "bar m");
  en.append("path").attr("class", "bar f");
  rows.exit().remove();
  const all = en.merge(rows);
  all.select(".hit").attr("x", 0).attr("width", width).attr("y", (d, i) => y(i)).attr("height", y.bandwidth() + 1);
  const yy = (i) => y(i) + (y.bandwidth() - bh) / 2;
  all.select(".m").transition().duration(opt.dur ?? DUR).attr("d", (d, i) => roundedLeftPath(cx - mid / 2, yy(i), x(d.m / tot), bh, n > 50 ? 1.5 : 4))
    .attr("fill", (d) => (sel && sel.size && !sel.has(d.code) ? dim : colM));
  all.select(".f").transition().duration(opt.dur ?? DUR).attr("d", (d, i) => roundedRightPath(cx + mid / 2, yy(i), x(d.f / tot), bh, n > 50 ? 1.5 : 4))
    .attr("fill", (d) => (sel && sel.size && !sel.has(d.code) ? dim : colF));
  // reference outline (step line)
  const refPath = (side) => {
    if (!ref) return "";
    let p = "";
    ref.forEach((d, i) => {
      const v = x((side === "m" ? d.m : d.f) / rtot);
      const xx = side === "m" ? cx - mid / 2 - v : cx + mid / 2 + v;
      const y0 = y(i) + y.bandwidth() + (y.step() - y.bandwidth()) / 2, y1 = y(i) - (y.step() - y.bandwidth()) / 2;
      p += (i === 0 ? `M${xx},${y0}` : `L${xx},${y0}`) + `L${xx},${y1}`;
    });
    return p;
  };
  svg.select(".refm").transition().duration(opt.dur ?? DUR).attr("d", refPath("m")).attr("stroke", css("--text-primary")).attr("stroke-width", 1.25).attr("opacity", ref ? 0.55 : 0);
  svg.select(".reff").transition().duration(opt.dur ?? DUR).attr("d", refPath("f")).attr("stroke", css("--text-primary")).attr("stroke-width", 1.25).attr("opacity", ref ? 0.55 : 0);
  // age labels in the middle column
  const every = n > 50 ? 10 : 2;
  const al = svg.select("g.agel").selectAll("text").data(data.filter((d, i) => i % every === 0), (d) => d.code);
  al.enter().append("text").attr("text-anchor", "middle").attr("dy", "0.35em").attr("class", "muted").merge(al)
    .attr("x", cx).attr("y", (d) => y(data.indexOf(d)) + y.bandwidth() / 2).text((d) => (n > 50 ? d.code : d.label.split("–")[0]));
  al.exit().remove();
  // x axis: percentages both sides
  const ticks = x.ticks(3).filter((t) => t > 0);
  const tickData = [...ticks.map((t) => ({ t, side: -1 })), ...ticks.map((t) => ({ t, side: 1 }))];
  const gl = svg.select("g.gridline").selectAll("line").data(tickData);
  gl.enter().append("line").merge(gl).attr("y1", mt).attr("y2", height - mb)
    .attr("x1", (d) => (d.side < 0 ? cx - mid / 2 - x(d.t) : cx + mid / 2 + x(d.t))).attr("x2", (d) => (d.side < 0 ? cx - mid / 2 - x(d.t) : cx + mid / 2 + x(d.t)));
  gl.exit().remove();
  const tl = svg.select("g.xax").selectAll("text").data(tickData);
  tl.enter().append("text").attr("text-anchor", "middle").merge(tl).attr("y", height - 6)
    .attr("x", (d) => (d.side < 0 ? cx - mid / 2 - x(d.t) : cx + mid / 2 + x(d.t))).text((d) => (d.t * 100).toFixed(d.t < 0.01 ? 1 : 0) + "%");
  tl.exit().remove();
  svg.select(".ml").attr("x", 2).attr("y", mt + 10).text(opt.mLabel || "Male");
  svg.select(".fl").attr("x", width - 2).attr("y", mt + 10).text(opt.fLabel || "Female");
  all.on("click", (ev, d) => opt.onClick && opt.onClick(d, ev))
    .on("pointermove", (ev, d) => {
      const i = data.indexOf(d);
      const rows = [{ k: "Male", v: `${fmtPop(d.m)} · ${pct(d.m / tot)}`, color: colM }, { k: "Female", v: `${fmtPop(d.f)} · ${pct(d.f / tot)}`, color: colF }];
      if (ref) rows.push({ k: opt.refLabel || "All India", v: `${pct(ref[i].m / rtot)} / ${pct(ref[i].f / rtot)}`, color: css("--text-muted") });
      showTip(ev, "Age " + d.label, rows);
    })
    .on("pointerleave", hideTip);
  return { max: maxv };
}
function renderPyramid() {
  const mode = state.pyrMode;
  const data = pyramidData(AGG.ageSex, mode);
  const ref = state.filters.size ? pyramidData(BASE.ageSex, mode) : null;
  const sel = state.filters.get("band");
  let selected = null;
  if (sel) selected = mode === "band" ? sel : new Set(d3.range(101).filter((a) => sel.has(Math.min((a / 5) | 0, NB - 1))));
  drawPyramid($("#pyramid"), data, ref, {
    height: 410, selected,
    onClick: (d) => toggleCode("band", mode === "band" ? d.code : Math.min((d.code / 5) | 0, NB - 1)),
  });
  const lg = $("#pyr-legend");
  lg.replaceChildren(legendKey(css("--s1"), "Male"), legendKey(css("--s2"), "Female"));
  if (ref) lg.append(legendKey(css("--text-primary"), "All India (outline)", true));
  const tg = AGG.kpi[K.POP] ? (AGG.groups[DIM.sex.idx][2] / d3.sum(AGG.groups[DIM.sex.idx])) : 0;
  const note = document.createElement("span"); note.className = "key";
  note.textContent = `Third gender: ${pct(tg, 2)} (not drawn)`;
  lg.append(note);
}
function legendKey(color, label, line = false) {
  const k = document.createElement("span"); k.className = "key";
  const sw = document.createElement("i"); sw.className = line ? "ln" : "sw";
  if (line) sw.style.borderColor = color; else sw.style.background = color;
  k.append(sw, document.createTextNode(label));
  return k;
}

// ---------------------------------------------------------------- dimension cards
const DIM_CARDS = [
  { id: "area", title: "Area & sex", hint: "Rural/urban and sex", dims: ["urban", "sex"] },
  { id: "religion", title: "Religion", dims: ["religion"] },
  { id: "caste", title: "Social group", hint: "General, OBC, SC, ST", dims: ["caste"] },
  { id: "language", title: "Mother tongue", hint: "Top 10 in view", dims: ["language"], top: 10 },
  { id: "education", title: "Highest education", hint: "Adults 25+", dims: ["education"] },
  { id: "activity", title: "Main activity", hint: "Everyone, by what they mostly do", dims: ["activity"] },
  { id: "emp", title: "Employment type", hint: "Workers only", dims: ["emp_type"], skip0: true },
  { id: "earn", title: "Monthly earnings", hint: "Workers only", dims: ["earnband"], skip0: true, cols: true },
  { id: "wealth", title: "Household wealth quintile", hint: "National quintiles", dims: ["wealth"], cols: true },
  { id: "hh", title: "Household size", hint: "People in the person's household", dims: ["hh_size"], skip0: true, cols: true },
  { id: "marital", title: "Marital status", hint: "Aged 15+", dims: ["marital"] },
  { id: "access", title: "Digital & financial access", hint: "% yes · phone, internet & bank are 15+", access: true },
];
function initDimCards(container, prefix) {
  const box = $(container);
  for (const c of DIM_CARDS) {
    const card = document.createElement("div");
    card.className = "card dim-card";
    card.innerHTML = `<div class="card-head"><div><h2></h2><p class="hint"></p></div><button class="sel-note" hidden>clear</button></div><div class="chart" id="${prefix}-${c.id}"></div>`;
    card.querySelector("h2").textContent = c.title;
    card.querySelector(".hint").textContent = c.hint || "";
    if (c.dims) card.querySelector(".sel-note").onclick = () => c.dims.forEach((k) => setFilter(k, null));
    else card.querySelector(".sel-note").onclick = () => ["smartphone", "internet", "bank", "insurance", "disability"].forEach((k) => setFilter(k, null));
    box.append(card);
  }
}
function itemsFor(groups, key, opt = {}) {
  const d = DIM[key], g = groups[d.idx];
  let items = d3.range(d.n).map((c) => ({ code: c, label: d.labels[c], value: g[c] }));
  if (opt.skip0) items = items.slice(1);
  if (key === "hh_size") items = items.slice(0, 15);
  if (key === "sex") items = items.filter((x) => x.code < 2 || x.value > 0);
  if (opt.top) {
    const sorted = [...items].sort((a, b) => b.value - a.value);
    const tot = d3.sum(items, (x) => x.value);
    items = sorted.slice(0, opt.top);
    items.total = tot;
  }
  return items;
}
function renderDims() {
  for (const c of DIM_CARDS) {
    const el = $(`#dim-${c.id}`);
    const card = el.closest(".card");
    if (c.access) { renderAccess(el, AGG); card.querySelector(".sel-note").hidden = !["smartphone", "internet", "bank", "insurance", "disability"].some((k) => state.filters.has(k)); continue; }
    card.querySelector(".sel-note").hidden = !c.dims.some((k) => state.filters.has(k));
    if (c.id === "area") { renderArea(el, AGG.groups); continue; }
    const key = c.dims[0], d = DIM[key];
    const items = itemsFor(AGG.groups, key, c);
    const sel = state.filters.get(key);
    const onClick = (it, ev) => toggleCode(key, it.code);
    if (c.cols) {
      const colors = d.ordinal ? ordinalRamp(items.length) : null;
      columns(el, items.map((x) => ({ ...x, short: key === "earnband" ? x.label.replace("₹", "").replace("No earnings", "–") : key === "wealth" ? x.label.replace("Poorest", "Q1").replace("Poorer", "Q2").replace("Middle", "Q3").replace("Richer", "Q4").replace("Richest", "Q5") : x.label })),
        { selected: sel, onClick, colors, height: 150 });
    } else {
      const colors = d.ordinal ? ordinalRamp(items.length) : null;
      hbars(el, items, { selected: sel, onClick, colors, total: items.total, labelW: key === "activity" ? 170 : 140,
        tip: (it, tot) => [{ k: "People", v: fmtPop(it.value) }, { k: "Share in view", v: pct(it.value / tot) },
          { k: "All-India share", v: pct(BASE.groups[d.idx][it.code] / d3.sum(c.skip0 ? BASE.groups[d.idx].slice(1) : BASE.groups[d.idx])) }] });
    }
  }
}
function renderArea(el, groups) {
  const u = itemsFor(groups, "urban"), sx = itemsFor(groups, "sex");
  const tu = d3.sum(u, (x) => x.value) || 1, ts = d3.sum(sx, (x) => x.value) || 1;
  const items = [...u.map((x) => ({ ...x, code: "u" + x.code, k: "urban", c: x.code, share: x.value / tu })),
    ...sx.map((x) => ({ ...x, code: "s" + x.code, k: "sex", c: x.code, share: x.value / ts }))];
  const selU = state.filters.get("urban"), selS = state.filters.get("sex");
  const selected = new Set([...(selU ? [...selU].map((c) => "u" + c) : u.map((x) => "u" + x.code)),
    ...(selS ? [...selS].map((c) => "s" + c) : sx.map((x) => "s" + x.code))]);
  hbars(el, items, {
    selected: selU || selS ? selected : null, max: 1, labelW: 110, frac: (d) => d.share,
    valueFmt: (d) => pct(d.share, d.share < 0.01 ? 2 : 0),
    onClick: (d) => toggleCode(d.k, d.c),
    tip: (d) => [{ k: "People", v: fmtPop(d.value) }, { k: "Share", v: pct(d.share, 2) }],
  });
}
const ACCESS = [["smartphone", "Owns a smartphone", "SM15", "P15"], ["internet", "Uses the internet", "NET15", "P15"],
  ["bank", "Has a bank account", "BANK15", "P15"], ["insurance", "Health insurance / scheme", "INS", "POP"], ["disability", "Has a disability", "DIS", "POP"]];
function renderAccess(el, agg) {
  // crossfilter: each flag share is computed from its own group (filters on other dims applied)
  const items = ACCESS.map(([k, label]) => {
    const g = agg.groups[DIM[k].idx];
    return { code: k, label, value: g[1], share: g[1] / ((g[0] + g[1]) || 1) };
  });
  const sel = new Set(ACCESS.filter(([k]) => state.filters.has(k)).map(([k]) => k));
  hbars(el, items, {
    selected: sel.size ? sel : null, max: 1, labelW: 160, frac: (d) => d.share,
    valueFmt: (d) => pct(d.share, d.share < 0.1 ? 1 : 0),
    onClick: (d) => toggleCode(d.code, 1),
    tip: (d) => [{ k: "Share yes", v: pct(d.share) }, { k: "People", v: fmtPop(d.value) },
      { k: "All India", v: pct(BASE.groups[DIM[d.code].idx][1] / d3.sum(BASE.groups[DIM[d.code].idx])) }],
  });
}

// ---------------------------------------------------------------- insights
function renderInsights() {
  const list = $("#insights");
  const out = [];
  const add = (tag, html, score) => out.push({ tag, html, score });
  const k = AGG.kpi, b = BASE.kpi;
  const pop = k[K.POP];
  if (pop <= 0) { list.innerHTML = "<li>No one matches this selection. Try removing a filter.</li>"; return; }
  if (state.filters.size === 0) {
    const med = STATES.map((s, i) => [s, medianFromHist(BASE.stAge, i * 101)]).filter((x) => x[0].rows > 2e6).sort((a, b) => a[1] - b[1]);
    add("Age", `<b>${esc(med[0][0].name)}</b> is the youngest large state (median age <b>${med[0][1].toFixed(1)}</b>); <b>${esc(med[med.length - 1][0].name)}</b> the oldest (<b>${med[med.length - 1][1].toFixed(1)}</b>).`, 9);
    const up = STATES.findIndex((s) => s.abbr === "UP");
    add("Scale", `<b>Uttar Pradesh</b> alone has <b>${fmtPop(STATE_POP[up])}</b> people, ${countryCompare(STATE_POP[up])}.`, 8);
    const moreW = STATES.filter((s, i) => ind("sexratio", BASE, i) > 1000).map((s) => s.name);
    add("Sex ratio", `<b>${moreW.length}</b> states/UTs have more women than men: ${esc(moreW.slice(0, 4).join(", "))}${moreW.length > 4 ? "…" : ""}.`, 7);
    const lits = STATES.map((s, i) => [s.name, ind("flit", BASE, i)]).sort((a, b) => a[1] - b[1]);
    add("Literacy", `Female literacy ranges from <b>${pct(lits[0][1], 0)}</b> in ${esc(lits[0][0])} to <b>${pct(lits[lits.length - 1][1], 0)}</b> in ${esc(lits[lits.length - 1][0])}.`, 6);
    add("Work", `Only <b>${pct(ind("flfpr", BASE), 0)}</b> of women aged 15+ are in the labour force, against <b>${pct(k[K.MLF15] / k[K.M15], 0)}</b> of men.`, 5);
  } else {
    add("Size", `The selection is <b>${fmtPop(pop)}</b> people (<b>${pct(pop / META.total, pop / META.total < 0.01 ? 2 : 1)}</b> of India), ${countryCompare(pop)}.`, 100);
    const cand = [
      ["median", "Age", (v, bv) => `Median age is <b>${v.toFixed(1)}</b>, ${Math.abs(v - bv).toFixed(1)} years ${v < bv ? "younger" : "older"} than India overall (${bv.toFixed(1)}).`, (v, bv) => Math.abs(v - bv) / 3],
      ["urban", "Cities", (v, bv) => `<b>${pct(v, 0)}</b> live in urban areas (India: ${pct(bv, 0)}).`, (v, bv) => Math.abs(v - bv) * 8],
      ["lit", "Literacy", (v, bv) => `Literacy is <b>${pct(v, 0)}</b> vs ${pct(bv, 0)} nationally.`, (v, bv) => Math.abs(v - bv) * 12],
      ["grad", "Degrees", (v, bv) => `<b>${pct(v, 0)}</b> of adults 25+ hold a degree, ${(v / bv).toFixed(1)}× the national rate.`, (v, bv) => Math.abs(Math.log(v / bv)) * 3],
      ["earn", "Earnings", (v, bv) => `Workers earn <b>${fmtRs(v)}</b> a month on average, ${Math.abs(v / bv * 100 - 100).toFixed(0)}% ${v > bv ? "above" : "below"} the national ${fmtRs(bv)}.`, (v, bv) => Math.abs(Math.log(v / bv)) * 4],
      ["smart", "Digital", (v, bv) => `<b>${pct(v, 0)}</b> of those 15+ own a smartphone (India: ${pct(bv, 0)}).`, (v, bv) => Math.abs(v - bv) * 8],
      ["flfpr", "Women at work", (v, bv) => `Female labour-force participation is <b>${pct(v, 0)}</b> (India: ${pct(bv, 0)}).`, (v, bv) => Math.abs(v - bv) * 8],
      ["ue", "Jobs", (v, bv) => `Unemployment is <b>${pct(v, 1)}</b>, ${(v / bv).toFixed(1)}× the national rate.`, (v, bv) => Math.abs(Math.log(v / bv)) * 3],
      ["sexratio", "Sex ratio", (v, bv) => `There are <b>${Math.round(v)}</b> women per 1,000 men (India: ${Math.round(bv)}).`, (v, bv) => Math.abs(v - bv) / 25],
      ["hh", "Households", (v, bv) => `People here live in households of <b>${v.toFixed(1)}</b> on average (India: ${bv.toFixed(1)}).`, (v, bv) => Math.abs(v - bv)],
      ["ins", "Health cover", (v, bv) => `<b>${pct(v, 0)}</b> have health insurance or scheme cover (India: ${pct(bv, 0)}).`, (v, bv) => Math.abs(v - bv) * 6],
      ["married2024", "Early marriage", (v, bv) => `<b>${pct(v, 0)}</b> of women aged 20–24 are married (India: ${pct(bv, 0)}).`, (v, bv) => Math.abs(v - bv) * 6],
    ];
    for (const [key, tag, txt, sc] of cand) {
      const v = ind(key, AGG), bv = ind(key, BASE);
      if (!isFinite(v) || !isFinite(bv) || v === 0 || (key === "earn" && k[K.WORK] < pop * 0.02)) continue;
      add(tag, txt(v, bv), sc(v, bv));
    }
    const gl = k[K.ML7] / k[K.MP7] - k[K.FL7] / k[K.FP7];
    if (isFinite(gl) && k[K.FP7] > 0 && k[K.MP7] > 0) add("Gender gap", gl > 0.005 ? `Women's literacy trails men's by <b>${(gl * 100).toFixed(1)} points</b> in this group.` : `Women and men are equally literate here.`, Math.abs(gl) * 15);
    const gs = k[K.MSM15] / k[K.M15] - k[K.FSM15] / k[K.F15];
    if (isFinite(gs) && k[K.F15] > 0 && k[K.M15] > 0) add("Digital divide", `<b>${(gs * 100).toFixed(0)} points</b> more men than women own a smartphone.`, Math.abs(gs) * 10);
    // dominant category that differs strongly from national
    for (const key of ["religion", "language", "caste"]) {
      if (state.filters.has(key)) continue;
      const g = AGG.groups[DIM[key].idx], bg = BASE.groups[DIM[key].idx];
      const t = d3.sum(g), bt = d3.sum(bg);
      let best = -1, lift = 0;
      for (let c = 0; c < g.length; c++) { const l = (g[c] / t) / (bg[c] / bt); if (g[c] / t > 0.1 && l > lift) { lift = l; best = c; } }
      if (best >= 0 && lift > 1.6) add(DIM[key].label, `<b>${esc(DIM[key].labels[best])}</b> is ${lift.toFixed(1)}× more common here (${pct(g[best] / t, 0)}) than across India.`, Math.log(lift) * 2.5);
    }
  }
  out.sort((a, b) => b.score - a.score);
  list.replaceChildren();
  for (const o of out.slice(0, 6)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="tag">${esc(o.tag)}</span>${o.html}`;
    list.append(li);
  }
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function renderExplore() {
  renderKPIs();
  renderMap();
  renderPyramid();
  renderInsights();
  renderDims();
}

// ============================================================ COMPARE
const CMP_FIELDS = [["state", "State / UT"], ["region", "Region"], ["urban", "Area"], ["sex", "Sex"], ["ageg", "Age group"],
  ["religion", "Religion"], ["caste", "Social group"], ["education", "Education"], ["wealth", "Wealth"], ["activity", "Activity"]];
const AGE_GROUPS = [["0–14", [0, 1, 2]], ["15–24", [3, 4]], ["25–44", [5, 6, 7, 8]], ["45–59", [9, 10, 11]], ["60+", d3.range(12, NB)], ["15–64", d3.range(3, 13)]];
const REGIONS = [...new Set(STATES.map((s) => s.region))];
const ACT_GROUPS = [["Workers", d3.range(FW, 12)], ["Students", [1]], ["Homemakers", [2]], ["Unemployed", [3]]];
const cmp = { A: { name: "Kerala", f: { state: "KL" } }, B: { name: "Bihar", f: { state: "BR" } } };
const PRESETS = [
  ["Kerala vs Bihar", { name: "Kerala", f: { state: "KL" } }, { name: "Bihar", f: { state: "BR" } }],
  ["Urban vs rural", { name: "Urban India", f: { urban: "1" } }, { name: "Rural India", f: { urban: "0" } }],
  ["Women vs men", { name: "Women", f: { sex: "1" } }, { name: "Men", f: { sex: "0" } }],
  ["Richest vs poorest 20%", { name: "Richest 20%", f: { wealth: "4" } }, { name: "Poorest 20%", f: { wealth: "0" } }],
  ["South vs North", { name: "South", f: { region: "South" } }, { name: "North", f: { region: "North" } }],
  ["Graduates vs no schooling", { name: "Graduates+", f: { education: "6+" } }, { name: "No schooling", f: { education: "0" } }],
  ["Youth: Tamil Nadu vs UP", { name: "TN youth 15–24", f: { state: "TN", ageg: "1" } }, { name: "UP youth 15–24", f: { state: "UP", ageg: "1" } }],
  ["ST vs General", { name: "Scheduled Tribes", f: { caste: "3" } }, { name: "General", f: { caste: "0" } }],
];
function cmpFilters(spec) {
  const m = new Map();
  const f = spec.f;
  if (f.state) m.set("state", new Set([STATES.findIndex((s) => s.abbr === f.state)]));
  else if (f.region) m.set("state", new Set(STATES.map((s, i) => (s.region === f.region ? i : -1)).filter((i) => i >= 0)));
  if (f.urban) m.set("urban", new Set([+f.urban]));
  if (f.sex) m.set("sex", new Set([+f.sex]));
  if (f.ageg) m.set("band", new Set(AGE_GROUPS[+f.ageg][1]));
  if (f.religion) m.set("religion", new Set([+f.religion]));
  if (f.caste) m.set("caste", new Set([+f.caste]));
  if (f.education) m.set("education", new Set(f.education === "6+" ? [6, 7] : f.education === "4-5" ? [4, 5] : f.education === "1-3" ? [1, 2, 3] : [+f.education]));
  if (f.wealth) m.set("wealth", new Set([+f.wealth]));
  if (f.activity) m.set("activity", new Set(ACT_GROUPS[+f.activity][1]));
  return m;
}
function initCompare() {
  const pre = $("#presets");
  for (const [label, a, b] of PRESETS) {
    const bt = document.createElement("button"); bt.textContent = label;
    bt.onclick = () => { cmp.A = structuredClone(a); cmp.B = structuredClone(b); buildGroupForms(); renderCompare(); };
    pre.append(bt);
  }
  buildGroupForms();
}
function buildGroupForms() {
  for (const g of ["A", "B"]) {
    const box = $(`#gb-${g.toLowerCase()}`);
    box.replaceChildren();
    const t = document.createElement("div"); t.className = "gb-title";
    const sw = document.createElement("span"); sw.className = "sw"; sw.style.background = css(g === "A" ? "--s1" : "--s2");
    const nm = document.createElement("input"); nm.value = cmp[g].name; nm.setAttribute("aria-label", `Group ${g} name`);
    nm.oninput = () => { cmp[g].name = nm.value; renderCompare(); };
    t.append(sw, nm); box.append(t);
    const fields = document.createElement("div"); fields.className = "fields";
    for (const [k, label] of CMP_FIELDS) {
      const l = document.createElement("label"); l.textContent = label;
      const s = document.createElement("select");
      const opts = [["", "Any"]];
      if (k === "state") STATES.forEach((st) => opts.push([st.abbr, st.name]));
      else if (k === "region") REGIONS.forEach((r) => opts.push([r, r]));
      else if (k === "ageg") AGE_GROUPS.forEach((a, i) => opts.push([String(i), a[0]]));
      else if (k === "education") { opts.push(["0", "No schooling"], ["1-3", "Below primary–middle"], ["4-5", "Secondary–12th"], ["6+", "Graduate+"]); }
      else if (k === "activity") ACT_GROUPS.forEach((a, i) => opts.push([String(i), a[0]]));
      else DIM[k].labels.forEach((lb, i) => { if (!(k === "sex" && i === 2)) opts.push([String(i), lb]); });
      for (const [v, tx] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = tx; s.append(o); }
      s.value = cmp[g].f[k] ?? "";
      s.onchange = () => {
        if (s.value) cmp[g].f[k] = s.value; else delete cmp[g].f[k];
        if (k === "state" && s.value) delete cmp[g].f.region;
        if (k === "region" && s.value) delete cmp[g].f.state;
        buildGroupForms(); renderCompare();
      };
      l.append(s); fields.append(l);
    }
    box.append(fields);
    const p = document.createElement("div"); p.className = "pop"; p.id = `gb-pop-${g}`; box.append(p);
  }
}
const CMP_INDS = ["pop", "median", "child", "elderly", "sexratio", "urban", "lit", "flit", "grad", "lfpr", "flfpr", "ue", "agri", "regular", "earn", "smart", "net", "bank", "ins", "hh", "married2024", "sc", "st"];
let cmpSeq = 0;
function renderCompare() {
  const fa = cmpFilters(cmp.A), fb = cmpFilters(cmp.B);
  drawCompare(aggregate(fa, false), aggregate(fb, false));
  if (!LIVE.ready) return;
  const seq = ++cmpSeq;
  $("#cmp-status").textContent = "≈ Estimates from the sample · exact comparison over all 1.5B records in progress…";
  Promise.all([fa, fb].map((f, i) => postJSON("api/aggregate", { filters: filtersObj(f), cross: false, client: LIVE.client + "-cmp" + i })
    .then((r) => r.json()).then((r) => fromServer(r, f))))
    .then(([A, B]) => {
      if (seq !== cmpSeq) return;
      drawCompare(A, B);
      $("#cmp-status").textContent = `✓ Exact over all ${fmtPop(META.total)} records`;
    })
    .catch((e) => { if (e.name !== "AbortError" && seq === cmpSeq) $("#cmp-status").textContent = "Live server unreachable · showing estimates"; });
}
function drawCompare(A, B) {
  const cA = css("--s1"), cB = css("--s2");
  $("#gb-pop-A").textContent = `${fmtPop(A.kpi[K.POP])} people`;
  $("#gb-pop-B").textContent = `${fmtPop(B.kpi[K.POP])} people`;
  // overlaid age structure: grouped horizontal bars per age band, both sexes
  const pa = pyramidData(A.ageSex, "band"), pb = pyramidData(B.ageSex, "band");
  const ta = d3.sum(pa, (d) => d.m + d.f) || 1, tb = d3.sum(pb, (d) => d.m + d.f) || 1;
  drawPyramid($("#cmp-pyr"), pa.map((d) => ({ ...d })), pb, { height: 420, refLabel: cmp.B.name, mLabel: "Male", fLabel: "Female", colM: cA, colF: cA });
  const lg = $("#cmp-pyr-legend"); lg.replaceChildren(legendKey(cA, cmp.A.name || "Group A"), legendKey(css("--text-primary"), (cmp.B.name || "Group B") + " (outline)", true));
  // indicator table as dumbbells
  const el = $("#cmp-table");
  const rows = CMP_INDS.map((k) => ({ k, a: ind(k, A), b: ind(k, B) }));
  const width = Math.max(320, el.clientWidth), rowH = 26, labelW = 170, valW = 150;
  const height = rows.length * rowH + 24;
  let svg = d3.select(el).select("svg");
  if (svg.empty()) svg = d3.select(el).append("svg");
  svg.attr("width", width).attr("height", height);
  const g = svg.selectAll("g.row").data(rows, (d) => d.k);
  const en = g.enter().append("g").attr("class", "row");
  en.append("rect").attr("class", "hit").attr("height", rowH);
  en.append("line").attr("class", "track");
  en.append("line").attr("class", "gap");
  en.append("circle").attr("class", "da").attr("r", 5);
  en.append("circle").attr("class", "db").attr("r", 5);
  en.append("text").attr("class", "lbl").attr("x", 0).attr("dy", "0.35em");
  en.append("text").attr("class", "va").attr("dy", "0.35em").attr("text-anchor", "end");
  const all = en.merge(g);
  all.attr("transform", (d, i) => `translate(0,${i * rowH + 18})`);
  const plotW = width - labelW - valW;
  all.each(function (d) {
    const lo = Math.min(d.a, d.b), hi = Math.max(d.a, d.b);
    const x = d3.scaleLinear().domain(d.k === "pop" || d.k === "earn" ? [0, hi * 1.05 || 1] : d.k === "sexratio" ? [Math.min(lo, 850), Math.max(hi, 1100)] : d.k === "median" ? [0, 50] : d.k === "hh" ? [1, 8] : [0, Math.max(1e-6, hi <= 0.15 ? 0.2 : hi <= 0.5 ? 0.6 : 1)]).range([labelW, labelW + plotW]);
    const s = d3.select(this);
    s.select(".hit").attr("width", width).attr("y", -rowH / 2);
    s.select(".track").attr("x1", labelW).attr("x2", labelW + plotW).attr("stroke", css("--grid"));
    s.select(".gap").transition().duration(DUR).attr("x1", x(isFinite(lo) ? lo : 0)).attr("x2", x(isFinite(hi) ? hi : 0)).attr("stroke", css("--axis")).attr("stroke-width", 3).attr("stroke-linecap", "round");
    s.select(".da").transition().duration(DUR).attr("cx", x(isFinite(d.a) ? d.a : 0)).attr("fill", cA).attr("stroke", css("--surface-1")).attr("stroke-width", 2);
    s.select(".db").transition().duration(DUR).attr("cx", x(isFinite(d.b) ? d.b : 0)).attr("fill", cB).attr("stroke", css("--surface-1")).attr("stroke-width", 2);
    s.select(".lbl").text(IND[d.k].label);
    s.select(".va").attr("x", width).text(`${IND[d.k].fmt(d.a)}  vs  ${IND[d.k].fmt(d.b)}`);
  });
  all.on("pointermove", (ev, d) => showTip(ev, IND[d.k].label, [{ k: cmp.A.name, v: IND[d.k].fmt(d.a), color: cA }, { k: cmp.B.name, v: IND[d.k].fmt(d.b), color: cB }])).on("pointerleave", hideTip);
  let hd = svg.select("g.hd");
  if (hd.empty()) { hd = svg.append("g").attr("class", "hd"); hd.append("text").attr("class", "muted").attr("y", 8).attr("text-anchor", "end"); }
  hd.select("text").attr("x", width).text(`${cmp.A.name || "A"} vs ${cmp.B.name || "B"}`);
  // distributions side by side
  renderCmpDims(A, B, cA, cB);
}
function renderCmpDims(A, B, cA, cB) {
  const box = $("#cmp-dims");
  const cards = [["education", "Highest education (25+)"], ["activity", "Main activity"], ["wealth", "Wealth quintile"], ["religion", "Religion"], ["caste", "Social group"], ["emp_type", "Employment type (workers)"]];
  if (!box.childElementCount) {
    for (const [k, t] of cards) {
      const c = document.createElement("div"); c.className = "card";
      c.innerHTML = `<div class="card-head"><div><h2></h2></div></div><div class="chart" id="cmpd-${k}"></div><div class="legend"></div>`;
      c.querySelector("h2").textContent = t; box.append(c);
    }
  }
  for (const [k] of cards) {
    const el = $(`#cmpd-${k}`);
    const d = DIM[k];
    const skip0 = k === "emp_type";
    const ga = A.groups[d.idx], gb = B.groups[d.idx];
    const ta = d3.sum(skip0 ? ga.slice(1) : ga) || 1, tb = d3.sum(skip0 ? gb.slice(1) : gb) || 1;
    const items = d3.range(skip0 ? 1 : 0, d.n).map((c) => ({ code: c, label: d.labels[c], a: ga[c] / ta, b: gb[c] / tb })).filter((x) => x.a > 0.0005 || x.b > 0.0005);
    groupedBars(el, items, cA, cB);
    const lg = el.parentElement.querySelector(".legend");
    lg.replaceChildren(legendKey(cA, cmp.A.name), legendKey(cB, cmp.B.name));
  }
}
function groupedBars(el, items, cA, cB) {
  const width = Math.max(260, el.clientWidth), rowH = 30, labelW = 150, valW = 46, bh = 10;
  const height = items.length * rowH;
  let svg = d3.select(el).select("svg");
  if (svg.empty()) svg = d3.select(el).append("svg");
  svg.attr("width", width).attr("height", height);
  const x = d3.scaleLinear().domain([0, d3.max(items, (d) => Math.max(d.a, d.b)) || 1]).range([0, width - labelW - valW]);
  const g = svg.selectAll("g.row").data(items, (d) => d.code);
  const en = g.enter().append("g").attr("class", "row");
  en.append("rect").attr("class", "hit").attr("height", rowH);
  en.append("text").attr("class", "lbl").attr("text-anchor", "end").attr("dy", "0.35em").attr("y", rowH / 2);
  en.append("path").attr("class", "ba");
  en.append("path").attr("class", "bb");
  en.append("text").attr("class", "vla").attr("dy", "0.35em");
  g.exit().remove();
  const all = en.merge(g);
  all.attr("transform", (d, i) => `translate(0,${i * rowH})`);
  all.select(".hit").attr("width", width);
  all.select(".lbl").attr("x", labelW - 8).text((d) => d.label);
  all.select(".ba").transition().duration(DUR).attr("d", (d) => roundedRightPath(labelW, rowH / 2 - bh - 1, x(d.a), bh, 4)).attr("fill", cA);
  all.select(".bb").transition().duration(DUR).attr("d", (d) => roundedRightPath(labelW, rowH / 2 + 1, x(d.b), bh, 4)).attr("fill", cB);
  all.select(".vla").attr("x", (d) => labelW + x(Math.max(d.a, d.b)) + 6).attr("y", rowH / 2)
    .text((d) => { const diff = (d.a - d.b) * 100; return Math.abs(diff) >= 3 ? `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(0)}pp` : ""; });
  all.on("pointermove", (ev, d) => showTip(ev, d.label, [{ k: cmp.A.name, v: pct(d.a), color: cA }, { k: cmp.B.name, v: pct(d.b), color: cB }])).on("pointerleave", hideTip);
}

// ============================================================ PROJECTION
const ASFR_SHARE = [0.08, 0.28, 0.31, 0.20, 0.09, 0.03, 0.01]; // 15-19 ... 45-49
const proj = { scn: "mid", year: 2026, res: null, playing: false };
function project(ssa, scn) {
  const Y0 = META.reference_year, T = 35;
  const years = [];
  const tot = { m: new Float64Array(101), f: new Float64Array(101) };
  const pops = [];
  // per state
  const st = [];
  for (let s = 0; s < S; s++) {
    const m = Float64Array.from(ssa.subarray(s * 303, s * 303 + 101));
    const f = Float64Array.from(ssa.subarray(s * 303 + 101, s * 303 + 202));
    if (d3.sum(m) + d3.sum(f) <= 0) continue;
    st.push({ s, m, f, lx: META.life[s] });
  }
  const snapshot = () => {
    const m = new Float64Array(101), f = new Float64Array(101);
    for (const x of st) for (let a = 0; a < 101; a++) { m[a] += x.m[a]; f[a] += x.f[a]; }
    return { m, f };
  };
  pops.push(snapshot());
  let births0 = 0;
  for (let t = 1; t <= T; t++) {
    let birthsT = 0;
    for (const x of st) {
      const tfr0 = STATES[x.s].tfr;
      const tinf = Math.min(tfr0, 1.6);
      let tfr = tinf + (tfr0 - tinf) * Math.exp(-t / 20);
      if (scn === "low") tfr *= 1 - 0.25 * (1 - Math.exp(-t / 10));
      if (scn === "high") tfr *= 1 + 0.25 * (1 - Math.exp(-t / 10));
      let births = 0;
      for (let a = 15; a < 50; a++) births += x.f[a] * tfr * ASFR_SHARE[Math.floor((a - 15) / 5)] / 5;
      const imp = Math.pow(0.985, t);
      for (const [arr, lx] of [[x.m, x.lx[0]], [x.f, x.lx[1]]]) {
        const old100 = arr[100];
        for (let a = 100; a >= 1; a--) {
          const p = lx[a - 1] > 0 ? lx[a] / lx[a - 1] : 0;
          const q = (1 - p) * imp;
          arr[a] = (a === 100 ? arr[a] * (1 - Math.min(1, 0.45 * imp)) : 0) + arr[a - 1] * (1 - q);
        }
        arr[0] = 0;
      }
      const p0m = 1 - (1 - x.lx[0][1]) * imp * 0.5, p0f = 1 - (1 - x.lx[1][1]) * imp * 0.5;
      x.m[0] = births * 0.519 * p0m;
      x.f[0] = births * 0.481 * p0f;
      birthsT += births;
    }
    if (t === 1) births0 = birthsT;
    pops.push(snapshot());
  }
  const series = pops.map((p, i) => {
    const all = new Float64Array(101);
    for (let a = 0; a < 101; a++) all[a] = p.m[a] + p.f[a];
    const total = d3.sum(all);
    const w = d3.sum(all.subarray(15, 65)), c = d3.sum(all.subarray(0, 15)), o = d3.sum(all.subarray(65));
    return { year: Y0 + i, total, median: medianFromHist(all), old: d3.sum(all.subarray(60)) / total, work: w / total, dep: (c + o) / w * 100, child: c / total, p };
  });
  return series;
}
function renderProjection(recompute) {
  if (recompute || !proj.res) {
    const ssa = AGG && AGG.exact ? AGG.ssaFlat : stateSexAge(state.filters);
    proj.res = project(ssa, proj.scn);
    const baseSSA = () => (BASE.exact ? BASE.ssaFlat : stateSexAge(new Map()));
    proj.base = state.filters.size ? (proj.baseCache?.[proj.scn] ?? (proj.baseCache = { ...(proj.baseCache || {}), [proj.scn]: project(baseSSA(), proj.scn) })[proj.scn]) : null;
  }
  const res = proj.res;
  const i = proj.year - META.reference_year;
  const cur = res[i];
  $("#proj-year").textContent = proj.year;
  $("#proj-pop").textContent = `${fmtPop(cur.total)} people`;
  const peak = res.reduce((a, b) => (b.total > a.total ? b : a), res[0]);
  const st = $("#proj-stats");
  st.replaceChildren();
  const stats = [["Median age", cur.median.toFixed(1)], ["Aged 60+", pct(cur.old)], ["Working age 15–64", pct(cur.work)], ["Dependency ratio", cur.dep.toFixed(0)],
    ["Change since 2026", `${cur.total >= res[0].total ? "+" : "−"}${Math.abs((cur.total / res[0].total - 1) * 100).toFixed(1)}%`],
    ["Peak", peak.year === res[res.length - 1].year ? `still growing in ${peak.year}` : `${fmtPop(peak.total)} in ${peak.year}`]];
  for (const [l, v] of stats) {
    const d = document.createElement("div"); d.className = "ps";
    d.innerHTML = '<div class="l"></div><div class="v"></div>';
    d.querySelector(".l").textContent = l; d.querySelector(".v").textContent = v;
    st.append(d);
  }
  const toData = (p) => pyramidData(Float64Array.from([...p.m, ...p.f, ...new Float64Array(101)]), "band");
  const maxv = Math.max(...res.map((r) => { const d = toData(r.p); const t = d3.sum(d, (x) => x.m + x.f); return d3.max(d, (x) => Math.max(x.m, x.f) / t); })) * 1.05;
  drawPyramid($("#proj-pyramid"), toData(cur.p), i > 0 ? toData(res[0].p) : null, { height: 380, max: maxv, refLabel: "2026", dur: proj.playing ? 120 : DUR });
  renderProjLines(res, proj.base);
}
const PROJ_LINES = [["total", "Population", fmtPop], ["median", "Median age", (v) => v.toFixed(1)], ["old", "Share aged 60+", (v) => pct(v, 0)], ["work", "Working-age share (15–64)", (v) => pct(v, 0)]];
function renderProjLines(res, base) {
  const box = $("#proj-lines");
  if (!box.childElementCount) for (const [k, t] of PROJ_LINES) {
    const c = document.createElement("div"); c.className = "card";
    c.innerHTML = `<div class="card-head"><div><h2></h2><p class="hint"></p></div></div><div class="chart" id="pl-${k}"></div><div class="legend"></div>`;
    c.querySelector("h2").textContent = t; box.append(c);
  }
  for (const [k, t, fmt] of PROJ_LINES) {
    const el = $(`#pl-${k}`);
    const ser = [{ name: "Selection", color: css("--s1"), vals: res.map((r) => [r.year, r[k]]) }];
    if (base && k !== "total") ser.push({ name: "All India", color: css("--text-muted"), vals: base.map((r) => [r.year, r[k]]) });
    lineChart(el, ser, { fmt, marker: proj.year });
    el.parentElement.querySelector(".hint").textContent = `${fmt(res[0][k])} in 2026 → ${fmt(res[res.length - 1][k])} in 2061`;
    const lg = el.parentElement.querySelector(".legend");
    lg.replaceChildren(...(ser.length > 1 ? ser.map((s) => legendKey(s.color, s.name, true)) : []));
  }
}
function lineChart(el, series, opt) {
  const width = Math.max(220, el.clientWidth), height = 170, mr = 10, mt = 10, mb = 22;
  let svg = d3.select(el).select("svg");
  if (svg.empty()) {
    svg = d3.select(el).append("svg");
    svg.append("g").attr("class", "gridline"); svg.append("g").attr("class", "axis yax"); svg.append("g").attr("class", "axis xax");
    svg.append("g").attr("class", "lines"); svg.append("line").attr("class", "cross"); svg.append("g").attr("class", "dots");
    svg.append("rect").attr("class", "overlay").attr("fill", "transparent");
  }
  svg.attr("width", width).attr("height", height);
  const all = series.flatMap((s) => s.vals.map((v) => v[1]));
  const ext = d3.extent(all);
  const pad = (ext[1] - ext[0]) * 0.1 || Math.abs(ext[1]) * 0.05 || 1;
  const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice(4).range([height - mb, mt]);
  const ml = 12 + 6.4 * d3.max(y.ticks(4), (v) => String(opt.fmt(v)).length);
  const x = d3.scaleLinear().domain(d3.extent(series[0].vals, (v) => v[0])).range([ml, width - mr]);
  svg.select(".yax").attr("transform", `translate(${ml},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(6).tickFormat((v) => opt.fmt(v))).select(".domain").remove();
  svg.select(".xax").attr("transform", `translate(0,${height - mb})`).call(d3.axisBottom(x).ticks(4).tickFormat(d3.format("d")).tickSize(0).tickPadding(6)).select(".domain").attr("stroke", css("--axis"));
  svg.select(".gridline").attr("transform", `translate(${ml},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(width - ml - mr)).tickFormat("")).select(".domain").remove();
  const line = d3.line().x((v) => x(v[0])).y((v) => y(v[1]));
  const p = svg.select(".lines").selectAll("path").data(series, (s) => s.name);
  p.enter().append("path").attr("fill", "none").attr("stroke-width", 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round").merge(p)
    .attr("stroke", (s) => s.color).transition().duration(DUR).attr("d", (s) => line(s.vals));
  p.exit().remove();
  const mk = opt.marker;
  const dots = svg.select(".dots").selectAll("circle").data(series, (s) => s.name);
  dots.enter().append("circle").attr("r", 4.5).attr("stroke-width", 2).merge(dots).attr("fill", (s) => s.color).attr("stroke", css("--surface-1"))
    .attr("cx", (s) => x(mk)).attr("cy", (s) => y((s.vals.find((v) => v[0] === mk) || s.vals[0])[1]));
  dots.exit().remove();
  const cross = svg.select(".cross").attr("y1", mt).attr("y2", height - mb).attr("stroke", css("--axis")).style("opacity", 0);
  svg.select(".overlay").attr("x", ml).attr("y", 0).attr("width", width - ml - mr).attr("height", height)
    .on("pointermove", (ev) => {
      const [mx] = d3.pointer(ev);
      const yr = Math.round(x.invert(mx));
      cross.attr("x1", x(yr)).attr("x2", x(yr)).style("opacity", 1);
      showTip(ev, String(yr), series.map((s) => ({ k: s.name, v: opt.fmt((s.vals.find((v) => v[0] === yr) || s.vals[0])[1]), color: s.color })));
    })
    .on("pointerleave", () => { cross.style("opacity", 0); hideTip(); })
    .on("click", (ev) => { const [mx] = d3.pointer(ev); setProjYear(Math.round(x.invert(mx))); });
}
function setProjYear(y) {
  proj.year = Math.max(2026, Math.min(2061, y));
  $("#proj-slider").value = proj.year;
  renderProjection(false);
}
function initProjection() {
  $("#proj-slider").oninput = (e) => setProjYear(+e.target.value);
  $$("[data-scn]").forEach((b) => (b.onclick = () => {
    $$("[data-scn]").forEach((x) => x.classList.toggle("on", x === b));
    proj.scn = b.dataset.scn; renderProjection(true);
  }));
  $("#proj-play").onclick = () => {
    if (proj.playing) { proj.playing = false; $("#proj-play").textContent = "▶"; return; }
    proj.playing = true; $("#proj-play").textContent = "❚❚";
    if (proj.year >= 2061) proj.year = 2026;
    const tick = () => {
      if (!proj.playing || state.tab !== "projection") { proj.playing = false; $("#proj-play").textContent = "▶"; return; }
      setProjYear(proj.year + 1);
      if (proj.year >= 2061) { proj.playing = false; $("#proj-play").textContent = "▶"; renderProjection(false); return; }
      setTimeout(tick, 180);
    };
    tick();
  };
}

// ============================================================ INDIA IN 100
const H100_ATTRS = [
  ["urban", "Area", "nominal"], ["band6", "Age group", "ordinal"], ["religion", "Religion", "nominal"], ["caste", "Social group", "nominal"],
  ["education", "Education (25+)", "ordinal"], ["act5", "What they do", "nominal"], ["wealth", "Wealth quintile", "ordinal"],
  ["language", "Mother tongue", "nominal"], ["smartphone", "Smartphone (15+)", "nominal"], ["sex", "Sex", "nominal"]];
function h100Categories(attr) {
  const g = (k) => AGG.groups[DIM[k].idx];
  const sel = (k) => state.filters.get(k);
  const restrict = (k, arr) => { const s = sel(k); return arr.map((v, c) => (s && !s.has(c) ? 0 : v)); };
  let cats;
  if (attr === "band6") {
    const b = restrict("band", Array.from(g("band")));
    const grp = [["0–14", [0, 1, 2]], ["15–24", [3, 4]], ["25–44", [5, 6, 7, 8]], ["45–59", [9, 10, 11]], ["60+", d3.range(12, NB)]];
    cats = grp.map(([l, bs]) => ({ label: l, v: d3.sum(bs, (x) => b[x]) }));
  } else if (attr === "act5") {
    const a = restrict("activity", Array.from(g("activity")));
    cats = [["Work", d3.range(FW, 12)], ["Study", [1]], ["Homemaking", [2]], ["Children under 5", [0]], ["Seek work", [3]], ["Retired / other", [4]]]
      .map(([l, cs]) => ({ label: l, v: d3.sum(cs, (x) => a[x]) }));
  } else if (attr === "smartphone") {
    const a = restrict(attr, Array.from(g(attr)));
    cats = [{ label: "Owns a smartphone", v: a[1] }, { label: "No smartphone", v: a[0] }];
  } else {
    const d = DIM[attr];
    let a = restrict(attr, Array.from(g(attr)));
    cats = a.map((v, c) => ({ label: d.labels[c], v, c })).filter((x) => x.v > 0);
    if (d.labels === LBL.sex) cats = cats.filter((x) => x.c < 2);
    if (attr === "education" || attr === "wealth") cats = a.map((v, c) => ({ label: d.labels[c], v }));
    if (attr === "language" || attr === "religion") {
      cats.sort((p, q) => q.v - p.v);
      if (cats.length > 6) { const rest = cats.slice(5); cats = cats.slice(0, 5); cats.push({ label: "All others", v: d3.sum(rest, (x) => x.v) }); }
    }
  }
  return cats;
}
function largestRemainder(vals, total = 100) {
  const s = d3.sum(vals) || 1;
  const raw = vals.map((v) => (v / s) * total);
  const fl = raw.map(Math.floor);
  let rem = total - d3.sum(fl);
  raw.map((r, i) => [r - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rem > 0) { fl[i]++; rem--; } });
  return fl;
}
function renderHundred() {
  const attr = $("#h100-attr").value;
  const meta = H100_ATTRS.find((a) => a[0] === attr);
  const cats = h100Categories(attr);
  const counts = largestRemainder(cats.map((c) => c.v));
  const colors = meta[2] === "ordinal" ? ordinalRamp(cats.length) : cats.map((c, i) => (c.label.startsWith("All others") || c.label.startsWith("No ") ? css("--dim-bar") : series(i)));
  const people = [];
  counts.forEach((n, ci) => { for (let k = 0; k < n; k++) people.push(ci); });
  const el = $("#h100");
  const width = Math.min(560, Math.max(300, el.clientWidth)), cell = width / 10, height = cell * 10;
  let svg = d3.select(el).select("svg");
  if (svg.empty()) {
    svg = d3.select(el).append("svg");
    for (let i = 0; i < 100; i++) {
      const g = svg.append("g").attr("class", "person");
      g.append("circle").attr("class", "head");
      g.append("path").attr("class", "body");
    }
  }
  svg.attr("width", width).attr("height", height);
  svg.selectAll("g.person").each(function (_, i) {
    const r = Math.floor(i / 10), c = i % 10;
    const cx = c * cell + cell / 2, top = r * cell + cell * 0.12;
    const g = d3.select(this);
    const ci = people[i] ?? 0;
    g.select(".head").attr("cx", cx).attr("cy", top + cell * 0.14).attr("r", cell * 0.13);
    const bw = cell * 0.44, bt = top + cell * 0.32, bh = cell * 0.46;
    g.select(".body").attr("d", `M${cx - bw / 2},${bt + bh}v${-(bh - bw / 2)}a${bw / 2},${bw / 2} 0 0 1 ${bw},0v${bh - bw / 2}z`);
    g.selectAll("circle,path").transition().delay(i * 7).duration(300).attr("fill", colors[ci]);
    g.on("pointermove", (ev) => showTip(ev, cats[ci].label, [{ k: "Of every 100", v: String(counts[ci]) }, { k: "People", v: fmtPop(cats[ci].v) }])).on("pointerleave", hideTip);
  });
  const lg = $("#h100-legend");
  lg.replaceChildren(...cats.map((c, i) => legendKey(colors[i], `${counts[i]} · ${c.label}`)));
  $("#h100-title").textContent = state.filters.size ? `If ${describeFilters(state.filters)} were 100 people` : "If India were 100 people";
  const k = AGG.kpi, pop = k[K.POP] || 1;
  const facts = [
    [Math.round(100 * k[K.URB] / pop), "live in a town or city"],
    [Math.round(100 * k[K.A0_14] / pop), "are children under 15"],
    [Math.round(100 * k[K.A60] / pop), "are 60 or older"],
    [Math.round(100 * (k[K.P7] - k[K.L7]) / pop), "aged 7+ cannot read or write"],
    [Math.round(100 * k[K.G25] / pop), "are adults with a degree"],
    [Math.round(100 * k[K.WORK] / pop), "work, " + Math.round(100 * k[K.AGRI] / pop) + " of them in agriculture"],
    [Math.round(100 * k[K.SM15] / pop), "are adults with a smartphone"],
    [Math.round(100 * k[K.INS] / pop), "have health insurance or scheme cover"],
  ];
  const fb = $("#h100-facts");
  fb.replaceChildren(...facts.map(([n, t]) => { const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = n; d.append(b, document.createTextNode(t)); return d; }));
}

// ============================================================ PEOPLE LIKE ME
const me = { age: 30, sex: 0, state: STATES.findIndex((s) => s.abbr === "MH"), urban: 1, education: 6, earn: 40000, smart: 1 };
function initMe() {
  const f = $("#me-form");
  const field = (label, el) => { const l = document.createElement("label"); l.textContent = label; l.append(el); f.append(l); return el; };
  const sel = (opts, val, on) => { const s = document.createElement("select"); opts.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; s.append(o); }); s.value = val; s.onchange = () => { on(+s.value); renderMe(); }; return s; };
  const num = (val, min, max, on) => { const i = document.createElement("input"); i.type = "number"; i.min = min; i.max = max; i.value = val; i.oninput = () => { if (i.value !== "") { on(Math.max(min, Math.min(max, +i.value))); renderMe(); } }; return i; };
  field("Age", num(me.age, 0, 100, (v) => (me.age = v)));
  field("Sex", sel([[0, "Male"], [1, "Female"], [2, "Third gender"]], me.sex, (v) => (me.sex = v)));
  field("State / UT", sel(STATES.map((s, i) => [i, s.name]), me.state, (v) => (me.state = v)));
  field("Area", sel([[1, "Urban"], [0, "Rural"]], me.urban, (v) => (me.urban = v)));
  field("Highest education", sel(LBL.education.map((l, i) => [i, l]), me.education, (v) => (me.education = v)));
  field("Monthly earnings from work (₹, 0 if none)", num(me.earn, 0, 10000000, (v) => (me.earn = v)));
}
const ME_BINS = (e) => Math.max(0, Math.min(39, Math.floor((Math.log10(Math.max(e, 500)) - 2.7) / (3.6 / 40))));
function meSample() {
  const sx = COL.sex, st = COL.state, ur = COL.urban, ed = COL.education, act = COL.activity;
  const o = { like: 0, likeN: 0, tot: 0, younger: 0, same: 0, stTot: 0, stYoung: 0, stSame: 0, eduTot: 0, eduLow: 0, eduSame: 0,
    wTot: 0, wLow: 0, wSame: 0, wsTot: 0, wsLow: 0, weTot: 0, weLow: 0, smDen: 0, smYes: 0, hhSum: 0, hhN: 0,
    actLike: new Float64Array(12), wealthLike: new Float64Array(5), hist: new Float64Array(40) };
  const meBand = Math.min((me.age / 5) | 0, NB - 1);
  for (let i = 0; i < N; i++) {
    const w = W[i], a = AGE[i];
    o.tot += w;
    if (a < me.age) o.younger += w; else if (a === me.age) o.same += w;
    if (st[i] === me.state) { o.stTot += w; if (a < me.age) o.stYoung += w; else if (a === me.age) o.stSame += w; }
    if (COL.band[i] === meBand && a >= 7) { o.eduTot += w; if (ed[i] < me.education) o.eduLow += w; else if (ed[i] === me.education) o.eduSame += w; }
    if (act[i] >= FW) {
      const e = EARN[i];
      o.wTot += w; if (e < me.earn) o.wLow += w; else if (e === me.earn) o.wSame += w;
      if (st[i] === me.state) { o.wsTot += w; if (e < me.earn) o.wsLow += w; }
      if (ed[i] === me.education) { o.weTot += w; if (e < me.earn) o.weLow += w; }
      o.hist[ME_BINS(e)] += w;
    }
    if (sx[i] === me.sex && ed[i] === me.education && Math.abs(a - me.age) <= 2) {
      if (st[i] === me.state && ur[i] === me.urban) { o.like += w; o.likeN++; }
      o.actLike[act[i]] += w; o.wealthLike[COL.wealth[i]] += w;
      if (a >= 15) { o.smDen += w; o.smYes += w * COL.smartphone[i]; }
      o.hhSum += w * COL.hh_size[i]; o.hhN += w;
    }
  }
  return o;
}
let meSeq = 0, meTimer = null;
function renderMe() {
  drawMe(meSample(), null);
  if (!LIVE.ready) return;
  const seq = ++meSeq;
  clearTimeout(meTimer);
  meTimer = setTimeout(() => {   // debounce typing; each exact query scans every record
    postJSON("api/me", { ...me, client: LIVE.client + "-me" }).then((r) => r.json())
      .then((r) => { if (seq === meSeq) drawMe(r, r); })
      .catch(() => { /* keep the estimate */ });
  }, 400);
}
function drawMe(o, exact) {
  const out = $("#me-results");
  const meBand = Math.min((me.age / 5) | 0, NB - 1);
  const p = (lo, eq, t) => (t > 0 ? (lo + eq / 2) / t : NaN);
  out.replaceChildren();
  const big = document.createElement("div"); big.className = "me-big";
  const b = document.createElement("b"); b.textContent = (exact ? "" : "≈ ") + (exact ? fmtFull(o.like) : fmtPop(o.like));
  const note = exact ? ` (exact count over all ${fmtPop(META.total)} records${exact.cached ? ", cached" : `, ${exact.seconds.toFixed(1)} s`})`
    : LIVE.ready ? " (estimate from the sample; exact count in progress…)" : o.likeN < 20 ? " (Rare profile: estimate based on few records.)" : "";
  big.append(b, document.createTextNode(`people in India share your age (±2 years), sex, state, area and education.${note}`));
  out.append(big);
  const grid = document.createElement("div"); grid.className = "me-grid"; out.append(grid);
  const stat = (l, v, d, meter) => {
    const s = document.createElement("div"); s.className = "me-stat";
    s.innerHTML = '<div class="l"></div><div class="v"></div><div class="d"></div>';
    s.querySelector(".l").textContent = l; s.querySelector(".v").textContent = v; s.querySelector(".d").textContent = d;
    if (isFinite(meter)) { const m = document.createElement("div"); m.className = "meter"; const i = document.createElement("i"); i.style.width = (meter * 100).toFixed(1) + "%"; m.append(i); s.append(m); }
    grid.append(s);
  };
  const oa = p(o.younger, o.same, o.tot), os = p(o.stYoung, o.stSame, o.stTot);
  stat("You are older than", pct(oa, 0) + " of Indians", `${pct(os, 0)} of people in ${STATES[me.state].name}`, oa);
  const ep = p(o.eduLow, o.eduSame, o.eduTot);
  stat("Education rank in your age group", "Top " + pct(1 - ep, 0), `Among Indians aged ${BAND_LABELS[meBand]}`, ep);
  if (me.earn > 0) {
    const wp = p(o.wLow, o.wSame, o.wTot);
    stat("Your earnings beat", pct(wp, 0) + " of workers", `${pct(o.wsLow / o.wsTot, 0)} in your state · ${pct(o.weLow / o.weTot, 0)} with your education`, wp);
  }
  const actLike = o.actLike;
  const workShare = d3.sum(actLike.slice(FW)) / (d3.sum(actLike) || 1);
  let topSec = FW; for (let k = FW; k < 12; k++) if (actLike[k] > actLike[topSec]) topSec = k;
  stat("People like you (any state) who work", pct(workShare, 0), workShare > 0 ? `Most common sector: ${LBL.activity[topSec]}` : "", workShare);
  if (me.age >= 15) stat("…who own a smartphone", pct(o.smYes / (o.smDen || 1), 0), "Same age, sex and education", o.smYes / (o.smDen || 1));
  let topW = 0; for (let k = 1; k < 5; k++) if (o.wealthLike[k] > o.wealthLike[topW]) topW = k;
  stat("…typical household", `${(o.hhSum / (o.hhN || 1)).toFixed(1)} people`, `Most often in the ${LBL.wealth[topW].toLowerCase()} wealth quintile`);
  // earnings histogram with marker
  const hist = Array.from(o.hist);
  const h = document.createElement("div"); h.className = "chart"; out.append(h);
  const ttl = document.createElement("div"); ttl.className = "hint"; ttl.textContent = "Monthly earnings of all workers in India (log scale)" + (me.earn > 0 ? " · line marks you" : ""); out.insertBefore(ttl, h);
  const width = Math.max(300, h.clientWidth || out.clientWidth), height = 150, mb = 22;
  const svg = d3.select(h).append("svg").attr("width", width).attr("height", height);
  const x = d3.scaleLog().domain([500, 10 ** 6.3]).range([10, width - 10]);
  const y = d3.scaleLinear().domain([0, d3.max(hist)]).range([height - mb, 8]);
  const bw = (width - 20) / 40;
  svg.selectAll("path.bar").data(hist).enter().append("path").attr("class", "bar")
    .attr("d", (v, i) => roundedTopPath(10 + i * bw + 1, height - mb, bw - 2, height - mb - y(v), 2)).attr("fill", (v, i) => (me.earn > 0 && i === ME_BINS(me.earn) ? css("--s2") : css("--s1")))
    .on("pointermove", (ev, v) => { const i = hist.indexOf(v); const lo = 10 ** (2.7 + i * 3.6 / 40), hi = 10 ** (2.7 + (i + 1) * 3.6 / 40); showTip(ev, `${fmtRs(lo)} – ${fmtRs(hi)}`, [{ k: "Workers", v: fmtPop(v) }]); })
    .on("pointerleave", hideTip);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - mb})`).call(d3.axisBottom(x).tickValues([1e3, 5e3, 1e4, 2e4, 5e4, 1e5, 5e5, 1e6]).tickFormat((v) => "₹" + (v >= 1e5 ? v / 1e5 + "L" : v / 1e3 + "K")).tickSize(0).tickPadding(6)).select(".domain").attr("stroke", css("--axis"));
  if (me.earn > 0) svg.append("line").attr("x1", x(Math.max(500, me.earn))).attr("x2", x(Math.max(500, me.earn))).attr("y1", 4).attr("y2", height - mb).attr("stroke", css("--text-primary")).attr("stroke-width", 1.5);
}

// ============================================================ DATA TAB
const TABLE_COLS = ["pop", "share", "urban", "sexratio", "median", "child", "elderly", "lit", "flit", "grad", "lfpr", "flfpr", "ue", "agri", "earn", "smart", "net", "bank", "ins", "hh", "sc", "st"];
const tableSort = { key: "pop", dir: -1 };
function tableRows() {
  const val = (k, s) => (k === "share" ? (s === null ? AGG.kpi[K.POP] / META.total : AGG.stm[s * NK + K.POP] / STATE_POP[s]) : ind(k, AGG, s));
  const rows = STATES.map((st, s) => ({ name: st.name, vals: Object.fromEntries(TABLE_COLS.map((k) => [k, val(k, s)])) }));
  rows.sort((a, b) => (tableSort.key === "name" ? a.name.localeCompare(b.name) * -tableSort.dir : ((a.vals[tableSort.key] || 0) - (b.vals[tableSort.key] || 0)) * tableSort.dir));
  return [{ name: "All India (selection)", vals: Object.fromEntries(TABLE_COLS.map((k) => [k, val(k, null)])) }, ...rows];
}
const colLabel = (k) => (k === "share" ? "% of state matching" : k === "pop" ? "People matching" : IND[k].label);
const colFmt = (k) => (k === "share" ? pct : k === "pop" ? fmtFull : IND[k].fmt);
function renderData() {
  const tb = $("#state-table");
  tb.replaceChildren();
  const thead = document.createElement("thead"), tr = document.createElement("tr");
  for (const k of ["name", ...TABLE_COLS]) {
    const th = document.createElement("th"); th.textContent = k === "name" ? "State / UT" : colLabel(k);
    if (tableSort.key === k) { th.classList.add("sorted"); th.textContent += tableSort.dir < 0 ? " ↓" : " ↑"; }
    th.onclick = () => { tableSort.dir = tableSort.key === k ? -tableSort.dir : -1; tableSort.key = k; renderData(); };
    tr.append(th);
  }
  thead.append(tr); tb.append(thead);
  const tbody = document.createElement("tbody");
  for (const r of tableRows()) {
    const row = document.createElement("tr");
    const td0 = document.createElement("td"); td0.textContent = r.name; row.append(td0);
    for (const k of TABLE_COLS) { const td = document.createElement("td"); td.textContent = colFmt(k)(r.vals[k]); row.append(td); }
    tbody.append(row);
  }
  tb.append(tbody);
  renderProvenance();
  renderAbout();
}
function renderProvenance() {
  const el = $("#provenance");
  if (el.childElementCount) return;
  const ex = META.exact, mi = Object.fromEntries(ex.metric_names.map((n, i) => [n, i]));
  const tot = ex.metrics_state.reduce((a, r) => a.map((v, i) => v + r[i]), new Array(ex.metric_names.length).fill(0));
  // estimates from the extract (all ages, same definitions as the generator's exact counters)
  const est = { count: 0, literate: 0, graduate: 0, student: 0, labour_force: 0, worker: 0, unemployed: 0, smartphone: 0, internet: 0, bank: 0, insurance: 0, disability: 0, ever_married: 0, widowed: 0, earnings_sum_100: 0 };
  for (let i = 0; i < N; i++) {
    const w = W[i], a = COL.activity[i];
    est.count += w; if (COL.education[i] >= 1) est.literate += w; if (COL.education[i] >= 6) est.graduate += w;
    if (a === 1) est.student += w; if (a === 3 || a >= FW) est.labour_force += w; if (a >= FW) est.worker += w; if (a === 3) est.unemployed += w;
    est.smartphone += w * COL.smartphone[i]; est.internet += w * COL.internet[i]; est.bank += w * COL.bank[i]; est.insurance += w * COL.insurance[i];
    est.disability += w * COL.disability[i]; if (COL.marital[i] >= 1) est.ever_married += w; if (COL.marital[i] === 2) est.widowed += w;
    est.earnings_sum_100 += w * EARN[i] / 100;
  }
  const labels = { count: "People", literate: "Literate (any age)", graduate: "Graduates+", student: "Students", labour_force: "In labour force", worker: "Workers", unemployed: "Unemployed", smartphone: "Smartphone owners", internet: "Internet users", bank: "Bank account holders", insurance: "Health cover", disability: "With a disability", ever_married: "Ever married", widowed: "Widowed", earnings_sum_100: "Total monthly earnings (₹)" };
  const t = document.createElement("table");
  t.innerHTML = "<thead><tr><th>Measure</th><th>Exact (1.5B records)</th><th>Dashboard estimate</th><th>Difference</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const k of Object.keys(labels)) {
    const exact = tot[mi[k]] * (k === "earnings_sum_100" ? 100 : 1), e = est[k] * (k === "earnings_sum_100" ? 100 : 1);
    const r = document.createElement("tr");
    for (const v of [labels[k], fmtFull(exact), fmtFull(e), ((e / exact - 1) * 100).toFixed(2) + "%"]) { const td = document.createElement("td"); td.textContent = v; r.append(td); }
    body.append(r);
  }
  t.append(body);
  const wrap = document.createElement("div"); wrap.className = "table-wrap"; wrap.append(t);
  el.append(wrap);
}
function renderAbout() {
  const el = $("#about");
  if (el.childElementCount) return;
  const tm = META.timings;
  el.innerHTML = `<p>This is <b>simulated</b> data: 1.5 billion synthetic people drawn one by one from a statistical model calibrated to
  Census 2011, NFHS-5, PLFS 2023-24, SRS life tables and 2026 population projections. No real person is represented.</p>
  <dl>
   <dt>People generated</dt><dd></dd>
   <dt>Stored as</dt><dd></dd>
   <dt>Generation time</dt><dd></dd>
   <dt>This page uses</dt><dd></dd>
   <dt>Built</dt><dd></dd>
  </dl>
  <p>Each person is one 64-bit record (state, area, sex, age, religion, social group, mother tongue, education, marital status,
  disability, activity, employment type, wealth quintile, household size, bank, smartphone, internet, insurance, earnings).
  Query the full files with <code>python generator/query.py</code>; see the README.</p>`;
  const dd = el.querySelectorAll("dd");
  dd[0].textContent = fmtFull(META.total);
  dd[1].textContent = `${META.files} state files, ${(META.bytes_on_disk / 1e9).toFixed(1)} GB of bit-packed uint64 records${META.written ? "" : " (not written in this run)"}`;
  dd[2].textContent = `${tm.generation_s}s generation + ${tm.calibration_s}s calibration (${(META.total / tm.generation_s / 1e6).toFixed(1)}M people/s)`;
  dd[3].textContent = `${fmtFull(META.sample_rows)} people, re-weighted so totals match the exact counts per state × area × sex × 5-year age`;
  dd[4].textContent = META.generated;
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function initData() {
  $("#dl-states").onclick = () => {
    const head = ["state", ...TABLE_COLS.map(colLabel)];
    const lines = [head.map(csvCell).join(",")];
    for (const r of tableRows()) lines.push([r.name, ...TABLE_COLS.map((k) => (isFinite(r.vals[k]) ? +r.vals[k].toFixed(6) : ""))].map(csvCell).join(","));
    download("india_selection_by_state.csv", `# Selection: ${describeFilters(state.filters)} (simulated data)\n` + lines.join("\n"));
  };
  $("#dl-rows").onclick = async () => {
    if (LIVE.ready) {
      try {
        const r = await postJSON("api/rows", { filters: filtersObj(state.filters), limit: 200000 });
        download("india_rows_exact.csv", await r.text());
        return;
      } catch (e) { /* fall back to the sample */ }
    }
    const act = activeList(state.filters);
    const keys = ["state", "urban", "sex", "religion", "caste", "language", "education", "marital", "activity", "emp_type", "wealth", "hh_size", "smartphone", "internet", "bank", "insurance", "disability"];
    const lines = [["weight", "age", ...keys, "monthly_earnings_rs"].join(",")];
    let n = 0;
    // walk rows in a scattered order (prime stride) so a capped export still spans all states
    const step = 1000003;
    for (let r = 0, i = 0; r < N && n < 200000; r++, i = (i + step) % N) {
      let ok = true;
      for (const a of act) if (!a.allowed[a.col[i]]) { ok = false; break; }
      if (!ok) continue;
      n++;
      lines.push([W[i].toFixed(2), AGE[i], ...keys.map((k) => (k === "hh_size" ? COL[k][i] : DIM[k].labels[COL[k][i]])), EARN[i]].map(csvCell).join(","));
    }
    download("india_sample_rows.csv", `# ${n} sampled people; weight = number of real-population people each row represents (simulated data)\n` + lines.join("\n"));
  };
}

// ============================================================ wiring
const TABS = ["explore", "compare", "projection", "hundred", "me", "data"];
function setTab(t) {
  state.tab = t;
  $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  $$(".tab-panel").forEach((p) => p.classList.toggle("on", p.id === "tab-" + t));
  $("#filter-row").classList.toggle("hidden", t === "compare" || t === "me");
  hideTip();
  requestAnimationFrame(() => {
    if (t === "explore") renderExplore();
    if (t === "compare") renderCompare();
    if (t === "projection") renderProjection(true);
    if (t === "hundred") renderHundred();
    if (t === "me") renderMe();
    if (t === "data") renderData();
  });
  try { if (location.hash.slice(1) !== t) history.replaceState(null, "", "#" + t); } catch (e) { /* sandboxed viewer */ }
}
function rerenderAll() {
  hideTip();
  if (state.tab === "explore") renderExplore();
  if (state.tab === "compare") { buildGroupForms(); renderCompare(); }
  if (state.tab === "projection") renderProjection(false);
  if (state.tab === "hundred") renderHundred();
  if (state.tab === "me") renderMe();
  if (state.tab === "data") renderData();
}
function init() {
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
  const saved = store.get("bharat-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  else if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
  $("#theme-toggle").onclick = () => {
    const t = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = t; store.set("bharat-theme", t);
    rerenderAll();
  };
  $$("[data-fmt]").forEach((b) => (b.onclick = () => { FMT = b.dataset.fmt; $$("[data-fmt]").forEach((x) => x.classList.toggle("on", x === b)); rerenderAll(); }));
  $$(".tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $$("[data-pyr]").forEach((b) => (b.onclick = () => { state.pyrMode = b.dataset.pyr; $$("[data-pyr]").forEach((x) => x.classList.toggle("on", x === b)); renderPyramid(); }));
  const mm = $("#map-metric");
  for (const [k, l] of MAP_METRICS) { const o = document.createElement("option"); o.value = k; o.textContent = l; mm.append(o); }
  mm.onchange = () => { state.mapMetric = mm.value; renderMap(); };
  const ha = $("#h100-attr");
  for (const [k, l] of H100_ATTRS) { const o = document.createElement("option"); o.value = k; o.textContent = "Colour by: " + l; ha.append(o); }
  ha.value = "act5";
  ha.onchange = renderHundred;
  initQuickAdd();
  initDimCards("#dims", "dim");
  initCompare();
  initProjection();
  initMe();
  initData();
  addEventListener("hashchange", () => { const h = location.hash.slice(1); if (BASE && h !== state.tab && TABS.includes(h)) setTab(h); });
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(rerenderAll, 150); });
  window.__bharat = { state, setFilter, setTab, LIVE, get AGG() { return AGG; }, aggregate: () => aggregate(state.filters), get N() { return N; }, get NP() { return PROF_MA.length; } };
}

(async function main() {
  init();
  try {
    await load();
  } catch (e) {
    $("#loading-text").textContent = "Could not load the population extract (" + e.message + "). Run generator/generate.py to create dashboard/data/.";
    $(".spinner").remove();
    return;
  }
  $("#loading-text").textContent = "Indexing…";
  await new Promise((r) => setTimeout(r, 0));
  prepare();
  BASE = aggregate(new Map(), true);
  $("#loading").classList.add("done");
  const t = location.hash.slice(1);
  setTab(TABS.includes(t) ? t : "explore");
  update();
  if (await detectLive()) waitWarm().catch(() => setPill("error"));
})();
})();
