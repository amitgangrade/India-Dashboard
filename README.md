# Bharat 1.5B: synthetic population of India + interactive dashboard

**1,500,000,000 simulated people**, one record each, generated in **~2 minutes** on a 4-core machine, with
a fluid browser dashboard for exploring them.

> All data here is **simulated**. Individuals are synthetic draws from a statistical model calibrated to public
> aggregates (Census 2011, NFHS-5, PLFS 2023-24, SRS life tables, 2026 population projections). No real person is
> represented, and figures are illustrative rather than official statistics.

**Live dashboard: https://amitgangrade.github.io/India-Dashboard/**

## Data in this repository

| File | What it is |
|---|---|
| `data/india_1.3M_weighted_sample.csv.gz` (9.7 MB) | 1,303,858 people with readable labels and a `weight` column; weights sum to 1.5 billion and match the full population's state × area × sex × 5-year-age counts |
| `dashboard/data/sample.js`, `meta.js` | The same sample packed for the browser, plus weights, labels and exact full-population aggregates |
| `data/full/aggregates.npz`, `manifest.json` | Exact counts over all 1.5B records (state × area × sex × age × 15 metrics, plus category totals) and the file schema |
| `data/SHA256SUMS` | Checksums of the 36 full-population files (12 GB) |
| `VALIDATION.md` | Exact statistics of all 1.5B records against their benchmarks |

The **full 12 GB population is not stored on GitHub**: single files go up to ~2 GB and GitHub rejects files over
100 MB. Generation is deterministic (fixed seed, per-chunk RNG streams, deterministic calibration), so the
command below recreates the identical files. Check them with:

```bash
cd data/full && sha256sum -c ../SHA256SUMS
```

## Quick start

```bash
pip install -r requirements.txt
```

```bash
cd generator && python generate.py
```

Generating the full population takes ~2.5 minutes and writes 12 GB to `data/full/` (git-ignored).
`python generate.py --no-write` skips writing the full files and only produces the dashboard extract, and
`--total 15000000` generates a smaller population.

Then open `dashboard/index.html` in a browser. A pre-generated extract is committed, so this works without running
the generator, and no server is needed. To serve it instead:

```bash
cd dashboard && python -m http.server 8000
```

## What gets generated

Each person has 19 attributes, chosen in sequence so each depends on the ones before it:

| Attribute | Values | Depends on |
|---|---|---|
| State / UT | 36 | exact 2026 population shares |
| Urban / rural | 2 | exact state urbanisation |
| Sex | male, female, third gender | state child sex ratio at birth, sex-specific survival, migration (working-age sex ratio) |
| Age | 0-100 | per-state birth history (TFR, timing of fertility decline) × Gompertz-Makeham life tables; mild age-heaping at multiples of 5 in low-literacy states, as in real census data |
| Religion | 7 | state × urban/rural; Muslim population skews younger |
| Social group | General / OBC / SC / ST | state × religion (iterative proportional fitting to state SC/ST/OBC shares) |
| Mother tongue | 25 | state; Urdu concentrated among Muslims |
| Household economic status | latent | state income, area, caste, religion |
| Education | 8 levels | two-part ordered logit: literacy (calibrated per state × sex), then attainment (calibrated to state graduate shares); birth cohort, gender gap that narrows for younger cohorts; capped by age |
| Marital status | 4 | age, sex, state median marriage age, education, cohort trend, widowhood hazard |
| Disability | yes/no | age, sex |
| Main activity | child, student, homemaker, unemployed, retired/other, 7 work sectors | school enrolment by age; labour-force participation calibrated per state × sex; unemployment by age × education × area; sector by area, education, sex, state agriculture share |
| Employment type | self-employed, regular, casual | sector, education |
| Monthly earnings | ₹ (log-normal) | employment type, education, sector, state income, area, sex gap, experience |
| Wealth quintile | 5 | latent household status (exact national quintiles) |
| Household size | 1-15 | state, area, religion, wealth |
| Bank account, smartphone, internet, health cover | yes/no | age, sex, education, wealth, area, state schemes |

A short **calibration** step (a ~2.5M-person pilot run through the same kernel, iterated) tunes about 200 intercepts.
After it, the output hits its targets: state literacy by sex, state female LFPR, state graduate shares, state
agriculture shares and insurance coverage, plus national unemployment, sector mix, earnings by employment type,
digital access, and banking. See **[VALIDATION.md](VALIDATION.md)** for the exact statistics of the 1.5B records
against their benchmarks.

### Why it is fast

* The kernel is **Numba**-compiled and parallel across cores. It uses an inline xoroshiro128+ generator with
  table-based normal and logistic draws, at ~11-14M people per second.
* Each person is **bit-packed into one uint64**, giving 12 GB instead of ~25-40 GB as columns or CSV. Writing
  happens on a background thread and overlaps with generation.
* Exact aggregates are accumulated during generation (no second pass). The dashboard extract is sampled at
  the same time.

### On-disk format

`data/full/state_XX_AB.bin` holds little-endian uint64 records: all rural rows, then all urban rows.
`data/full/manifest.json` has the schema, labels and row counts.

```
low 32 bits : state 0-5 | urban 6 | sex 7-8 | age 9-15 | religion 16-18 | caste 19-20 |
              language 21-25 | education 26-28 | marital 29-30 | disability 31
high 32 bits: activity 32-35 | emp_type 36-37 | wealth 38-40 | hh_size 41-44 | bank 45 |
              smartphone 46 | internet 47 | insurance 48 | earnings in ₹100 units 49-63
```

### Querying all 1.5 billion records

```bash
cd generator
```

```bash
python query.py --by religion
```

```bash
python query.py --by education --where "age >= 25 and sex == 'Female'" --states KL BR
```

```bash
python query.py --by sex --mean earnings --where "activity >= 5 and 25 <= age < 60"
```

```bash
python query.py --where "state == 'Kerala' and age >= 100" --show 10
```

```bash
python query.py --where "education == 'Post-graduate+'" --csv pg.csv --limit 100000
```

Each query is a parallel scan (~7 s for a simple group-by over everyone). From Python:

```python
import popdata
df = popdata.read_state("KL", n=1_000_000)       # pandas DataFrame with readable labels
for chunk in popdata.iter_chunks(["age", "sex", "earnings"], states=["UP"]):
    ...
```

## The dashboard

`dashboard/` is a static page (D3, plain JavaScript, no build step). It runs on a **1.3M-person stratified
extract** of the full population, re-weighted so that totals equal the exact full-population counts for every
state × area × sex × 5-year age group. Small UTs are oversampled so they stay readable. Every filter change
re-aggregates all 1.3M rows in **~30-50 ms**, using a code-generated, unrolled typed-array loop over rows
pre-compressed into metric profiles.

| Tab | What it does |
|---|---|
| **Explore** | Headline numbers with deltas vs India, a **tile map** of 23 switchable state metrics, an animated **population pyramid** (5-year or single-year, with an all-India outline), 12 linked charts, and **"What stands out"**, auto-generated insights. Click any tile, bar or age band to filter; every chart cross-filters the others. |
| **Compare** | Two groups side by side: presets (Kerala vs Bihar, urban vs rural, richest vs poorest, ...) or build your own. Shows overlaid age structures, a dumbbell chart of 23 indicators, and paired distributions. |
| **Projection 2026→2061** | Cohort-component projection of the current selection with state fertility and life tables, plus low/medium/high fertility scenarios. Play the animated pyramid and trend lines. |
| **India in 100 people** | The selection as 100 figures, coloured by area, age, religion, education, activity, wealth, language and more. |
| **People like me** | Enter age, sex, state, education and earnings to see how many Indians share your profile and your age, education and earnings percentiles. |
| **Data & export** | A sortable state table (the table view of every chart), CSV export of the table or of sampled rows with weights, and an exact-vs-extract reconciliation table. |

It also has a light/dark theme, international (1.5B) or Indian (150 crore) number formats, keyboard-focusable
marks, and a colour palette validated for colour-vision deficiency.

## Layout

```
generator/   params.py (source figures)  model.py (tables + Numba kernel)  calibrate.py
             generate.py  popdata.py (reader)  query.py (CLI)  validate.py (-> VALIDATION.md)
dashboard/   index.html  app.js  style.css  vendor/d3.min.js  data/{sample.js, meta.js}
data/        full/ (generated, git-ignored)
```

## Limitations

* Attributes are drawn per person. There are no household or family links between records; household size
  and wealth are attributes of the person.
* Conditional structure is deliberately simple. Interactions not modelled (e.g. caste × occupation beyond
  wealth and education) come out roughly independent.
* State figures are approximations of public sources, projected to ~2026 and scaled to 1.5B. Treat them as
  realistic-looking, not authoritative.
* The projection treats a selection as a closed population (no migration) and applies the selection's own
  fertility, even to groups such as "graduates".
