"""
Source parameters for the synthetic India population (target: 1.5 billion people).

All figures are approximations anchored on public sources:
  * Census of India 2011 (religion, SC/ST, mother tongue, literacy, sex ratio, urbanisation)
  * Technical Group on Population Projections (2020) for the 2026 state population mix
  * NFHS-5 (2019-21) for TFR, age at marriage, insurance, digital access
  * SRS 2016-20 for life expectancy
  * PLFS 2023-24 for labour-force participation, sectors, employment type and earnings
They are scaled/extrapolated to a ~2026-2030 India of 1.5 billion people.
This is SIMULATED data: individual-level values are synthetic draws, not real people.
"""

TOTAL_POPULATION = 1_500_000_000
REFERENCE_YEAR = 2026
SEED = 20261101

# --------------------------------------------------------------------------------------
# Category labels (the integer code is the list index)
# --------------------------------------------------------------------------------------
SEXES = ["Male", "Female", "Third gender"]
RELIGIONS = ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Other / not stated"]
CASTES = ["General", "OBC", "SC", "ST"]
LANGUAGES = [
    "Hindi", "Bengali", "Marathi", "Telugu", "Tamil", "Gujarati", "Urdu", "Kannada", "Odia",
    "Malayalam", "Punjabi", "Assamese", "Maithili", "Santali", "Kashmiri", "Nepali", "Konkani",
    "Manipuri", "Dogri", "Bodo", "Sindhi", "Bhili", "Gondi", "Tulu", "Other",
]
EDUCATION = [
    "No schooling", "Literate, below primary", "Primary", "Middle", "Secondary (10th)",
    "Higher secondary (12th)", "Graduate", "Post-graduate+",
]
MARITAL = ["Never married", "Married", "Widowed", "Divorced / separated"]
ACTIVITY = [
    "Child (under 5)", "Student", "Homemaker", "Unemployed", "Retired / other non-worker",
    "Agriculture", "Manufacturing & mining", "Construction", "Trade, hotels & transport",
    "Other services", "Government / public sector", "Professional, IT & finance",
]
FIRST_WORKER_ACTIVITY = 5
EMP_TYPES = ["Not working", "Self-employed", "Regular salaried", "Casual labour"]
WEALTH = ["Poorest", "Poorer", "Middle", "Richer", "Richest"]

L = {name: i for i, name in enumerate(LANGUAGES)}

# --------------------------------------------------------------------------------------
# State / UT table
#   pop    : projected 2026 population (millions) -> only the relative mix is used
#   urb    : urban share % (2026 estimate)
#   sr     : sex ratio, females per 1000 males (Census 2011, nudged)
#   csr    : child sex ratio 0-6 (Census 2011)
#   tfr    : total fertility rate (NFHS-5)
#   e0     : life expectancy at birth (SRS 2016-20, approx.)
#   lit    : (overall, female) literacy % 2011
#   flfp   : female labour force participation % 15+ (PLFS 2023-24 approx.)
#   mlfp   : male LFPR % 15+
#   agri   : % of workers in agriculture
#   inc    : per-capita income index (India = 1.0)
#   hh     : mean household size
#   ins    : % persons with health insurance / scheme coverage (2026 estimate)
#   marf   : median age at first marriage, women (NFHS-5)
#   ue     : extra state unemployment propensity (logit units)
#   rel    : religion % (H, M, C, S, B, J, O)
#   sc, st, obc : % of population
#   lang   : mother-tongue % (remainder -> "Other")
#   grad   : % of adults 25+ with a degree (2026 target)
#   peak   : (optional) years since the state's annual births peaked; default derived from TFR
#   tile   : (row, col) position in the tile map
# --------------------------------------------------------------------------------------
STATES = [
    dict(abbr="JK", grad=16, peak=20, name="Jammu & Kashmir", region="North", pop=14.0, urb=31, sr=890, csr=862, tfr=1.41, e0=74.0,
         lit=(67.2, 56.4), flfp=47, mlfp=76, agri=38, inc=0.70, hh=5.2, ins=45, marf=23.5, ue=0.6,
         rel=(28.4, 68.8, 0.3, 1.9, 0.1, 0.0, 0.5), sc=7.4, st=10.0, obc=15,
         lang={"Kashmiri": 53, "Dogri": 20, "Hindi": 18, "Punjabi": 2, "Urdu": 1}, tile=(0, 1)),
    dict(abbr="LA", grad=14, peak=20, name="Ladakh", region="North", pop=0.31, urb=23, sr=853, csr=950, tfr=1.30, e0=72.0,
         lit=(74.0, 65.0), flfp=50, mlfp=78, agri=40, inc=1.00, hh=4.6, ins=50, marf=24.0, ue=0.3,
         rel=(12.1, 46.4, 0.5, 0.5, 39.7, 0.0, 0.8), sc=0.0, st=79.6, obc=2,
         lang={"Other": 85, "Hindi": 8, "Kashmiri": 2, "Urdu": 1}, tile=(0, 2)),
    dict(abbr="PB", grad=17, peak=30, name="Punjab", region="North", pop=31.4, urb=42, sr=905, csr=846, tfr=1.63, e0=72.7,
         lit=(75.8, 70.7), flfp=30, mlfp=78, agri=26, inc=1.00, hh=4.5, ins=40, marf=22.0, ue=0.3,
         rel=(38.5, 1.9, 1.3, 57.7, 0.1, 0.2, 0.3), sc=31.9, st=0.0, obc=22,
         lang={"Punjabi": 89.8, "Hindi": 9.4}, tile=(1, 0)),
    dict(abbr="HP", grad=18, peak=32, name="Himachal Pradesh", region="North", pop=7.6, urb=11, sr=972, csr=909, tfr=1.66, e0=72.9,
         lit=(82.8, 75.9), flfp=66, mlfp=79, agri=57, inc=1.20, hh=4.1, ins=45, marf=22.0, ue=0.2,
         rel=(95.2, 2.2, 0.2, 1.2, 1.2, 0.0, 0.2), sc=25.2, st=5.7, obc=14,
         lang={"Hindi": 89, "Punjabi": 4.4, "Nepali": 1.2}, tile=(1, 1)),
    dict(abbr="CH", grad=32, peak=28, name="Chandigarh", region="North", pop=1.25, urb=98, sr=818, csr=880, tfr=1.40, e0=74.0,
         lit=(86.0, 81.2), flfp=28, mlfp=78, agri=1, inc=2.10, hh=3.9, ins=40, marf=23.0, ue=0.2,
         rel=(80.8, 4.9, 0.8, 13.1, 0.1, 0.2, 0.1), sc=18.9, st=0.0, obc=20,
         lang={"Hindi": 73, "Punjabi": 22}, tile=(2, 0)),
    dict(abbr="HR", grad=17, peak=22, name="Haryana", region="North", pop=31.0, urb=41, sr=890, csr=834, tfr=1.91, e0=69.8,
         lit=(75.6, 65.9), flfp=26, mlfp=77, agri=27, inc=1.70, hh=4.7, ins=35, marf=20.8, ue=0.4,
         rel=(87.5, 7.0, 0.2, 4.9, 0.0, 0.2, 0.2), sc=20.2, st=0.0, obc=30,
         lang={"Hindi": 88, "Punjabi": 10.6, "Urdu": 1.2}, tile=(2, 1)),
    dict(abbr="UK", grad=17, peak=22, name="Uttarakhand", region="North", pop=11.9, urb=35, sr=963, csr=890, tfr=1.85, e0=70.6,
         lit=(78.8, 70.0), flfp=45, mlfp=77, agri=45, inc=1.30, hh=4.4, ins=50, marf=21.0, ue=0.3,
         rel=(83.0, 14.0, 0.4, 2.3, 0.1, 0.1, 0.1), sc=18.8, st=2.9, obc=18,
         lang={"Hindi": 89, "Urdu": 4.2, "Punjabi": 2.6, "Bengali": 1.5, "Nepali": 1.0}, tile=(2, 2)),
    dict(abbr="RJ", grad=11, name="Rajasthan", region="North", pop=82.6, urb=28, sr=928, csr=888, tfr=2.01, e0=69.4,
         lit=(66.1, 52.1), flfp=49, mlfp=78, agri=48, inc=0.80, hh=4.9, ins=85, marf=19.3, ue=0.3,
         rel=(88.5, 9.1, 0.1, 1.3, 0.0, 0.9, 0.1), sc=17.8, st=13.5, obc=46,
         lang={"Hindi": 89.7, "Bhili": 4.6, "Urdu": 1.2, "Punjabi": 1.3, "Sindhi": 0.6}, tile=(3, 0)),
    dict(abbr="DL", grad=30, peak=26, name="Delhi", region="North", pop=22.6, urb=98.5, sr=868, csr=871, tfr=1.62, e0=75.8,
         lit=(86.2, 80.8), flfp=17, mlfp=76, agri=0.8, inc=2.50, hh=4.3, ins=30, marf=22.0, ue=0.2,
         rel=(81.7, 12.9, 0.9, 3.4, 0.1, 1.0, 0.0), sc=16.8, st=0.0, obc=25,
         lang={"Hindi": 81, "Urdu": 6.3, "Punjabi": 5, "Bengali": 1.5}, tile=(3, 1)),
    dict(abbr="UP", grad=12, name="Uttar Pradesh", region="North", pop=241.1, urb=26, sr=912, csr=902, tfr=2.35, e0=66.0,
         lit=(67.7, 57.2), flfp=33, mlfp=78, agri=46, inc=0.50, hh=5.0, ins=28, marf=19.8, ue=0.0,
         rel=(79.7, 19.3, 0.2, 0.3, 0.1, 0.1, 0.3), sc=20.7, st=0.6, obc=45,
         lang={"Hindi": 94, "Urdu": 5.4, "Punjabi": 0.2}, tile=(3, 2)),
    dict(abbr="BR", grad=8, name="Bihar", region="East", pop=132.0, urb=14, sr=918, csr=935, tfr=2.98, e0=69.5,
         lit=(61.8, 51.5), flfp=23, mlfp=74, agri=52, inc=0.30, hh=5.3, ins=22, marf=19.2, ue=0.2,
         rel=(82.7, 16.9, 0.1, 0.0, 0.0, 0.0, 0.3), sc=15.9, st=1.3, obc=60,
         lang={"Hindi": 77.5, "Maithili": 12.8, "Urdu": 8.4, "Bengali": 0.3, "Santali": 0.3}, tile=(3, 3)),
    dict(abbr="SK", grad=15, peak=26, name="Sikkim", region="North-East", pop=0.70, urb=28, sr=890, csr=957, tfr=1.05, e0=72.0,
         lit=(81.4, 75.6), flfp=63, mlfp=79, agri=40, inc=2.90, hh=3.8, ins=55, marf=22.0, ue=0.3,
         rel=(57.8, 1.6, 9.9, 0.3, 27.4, 0.0, 3.0), sc=4.6, st=33.8, obc=40,
         lang={"Nepali": 63, "Hindi": 8, "Bengali": 1}, tile=(3, 4)),
    dict(abbr="AS", grad=10, name="Assam", region="North-East", pop=36.7, urb=17, sr=958, csr=962, tfr=1.87, e0=67.2,
         lit=(72.2, 66.3), flfp=29, mlfp=78, agri=48, inc=0.70, hh=4.4, ins=35, marf=20.5, ue=0.3,
         rel=(61.5, 34.2, 3.7, 0.1, 0.2, 0.1, 0.2), sc=7.2, st=12.4, obc=30,
         lang={"Assamese": 48.4, "Bengali": 28.9, "Bodo": 4.5, "Hindi": 6.7, "Nepali": 1.9, "Santali": 0.7},
         tile=(3, 5)),
    dict(abbr="AR", grad=10, name="Arunachal Pradesh", region="North-East", pop=1.60, urb=26, sr=938, csr=972, tfr=1.80, e0=70.0,
         lit=(65.4, 57.7), flfp=35, mlfp=74, agri=55, inc=1.10, hh=4.6, ins=55, marf=21.0, ue=0.4,
         rel=(29.0, 1.9, 30.3, 0.2, 11.8, 0.0, 26.8), sc=0.0, st=68.8, obc=2,
         lang={"Hindi": 7, "Nepali": 4.5, "Assamese": 4, "Bengali": 1}, tile=(2, 6)),
    dict(abbr="NL", grad=12, peak=16, name="Nagaland", region="North-East", pop=2.20, urb=32, sr=931, csr=943, tfr=1.73, e0=73.0,
         lit=(79.6, 76.1), flfp=40, mlfp=70, agri=55, inc=0.70, hh=4.5, ins=30, marf=22.0, ue=1.0,
         rel=(8.8, 2.5, 87.9, 0.1, 0.3, 0.1, 0.3), sc=0.0, st=86.5, obc=1,
         lang={"Hindi": 3, "Nepali": 1.6, "Bengali": 1.6, "Assamese": 1}, tile=(3, 6)),
    dict(abbr="GJ", grad=13, peak=26, name="Gujarat", region="West", pop=73.4, urb=48, sr=919, csr=890, tfr=1.86, e0=70.3,
         lit=(78.0, 69.7), flfp=45, mlfp=80, agri=43, inc=1.60, hh=4.4, ins=50, marf=20.5, ue=-0.6,
         rel=(88.6, 9.7, 0.5, 0.1, 0.0, 1.0, 0.1), sc=6.7, st=14.8, obc=40,
         lang={"Gujarati": 86, "Hindi": 7.1, "Sindhi": 1.6, "Marathi": 1.2, "Urdu": 1.0, "Bhili": 1.5}, tile=(4, 0)),
    dict(abbr="MP", grad=11, name="Madhya Pradesh", region="Central", pop=88.4, urb=31, sr=931, csr=918, tfr=1.99, e0=67.3,
         lit=(69.3, 59.2), flfp=47, mlfp=80, agri=58, inc=0.70, hh=4.6, ins=40, marf=19.6, ue=-0.6,
         rel=(90.9, 6.6, 0.3, 0.2, 0.3, 0.8, 0.9), sc=15.6, st=21.1, obc=48,
         lang={"Hindi": 88.6, "Bhili": 7.4, "Gondi": 1.7, "Marathi": 1.2, "Urdu": 0.9, "Sindhi": 0.4}, tile=(4, 1)),
    dict(abbr="CG", grad=10, name="Chhattisgarh", region="Central", pop=31.0, urb=26, sr=991, csr=969, tfr=1.82, e0=65.3,
         lit=(70.3, 60.2), flfp=60, mlfp=80, agri=63, inc=0.70, hh=4.3, ins=78, marf=20.0, ue=-0.5,
         rel=(93.3, 2.0, 1.9, 0.3, 0.3, 0.2, 2.0), sc=12.8, st=30.6, obc=42,
         lang={"Hindi": 87, "Gondi": 3.1, "Odia": 1.6, "Bengali": 0.4, "Marathi": 0.6}, tile=(4, 2)),
    dict(abbr="JH", grad=9, name="Jharkhand", region="East", pop=40.6, urb=27, sr=948, csr=948, tfr=2.26, e0=69.6,
         lit=(66.4, 55.4), flfp=42, mlfp=78, agri=45, inc=0.50, hh=4.8, ins=35, marf=19.3, ue=-0.4,
         rel=(67.8, 14.5, 4.3, 0.2, 0.0, 0.1, 13.1), sc=12.1, st=26.2, obc=40,
         lang={"Hindi": 61.9, "Santali": 10.7, "Bengali": 9.7, "Urdu": 5.9, "Odia": 1.6}, tile=(4, 3)),
    dict(abbr="WB", grad=12, peak=30, name="West Bengal", region="East", pop=101.0, urb=36, sr=950, csr=956, tfr=1.64, e0=72.0,
         lit=(76.3, 70.5), flfp=38, mlfp=79, agri=36, inc=0.75, hh=3.9, ins=55, marf=18.9, ue=0.0,
         rel=(70.5, 27.0, 0.7, 0.1, 0.3, 0.1, 1.3), sc=23.5, st=5.8, obc=18,
         lang={"Bengali": 86.2, "Hindi": 7, "Santali": 2.7, "Urdu": 1.8, "Nepali": 1.3}, tile=(4, 4)),
    dict(abbr="ML", grad=9, name="Meghalaya", region="North-East", pop=3.50, urb=22, sr=989, csr=970, tfr=2.91, e0=68.0,
         lit=(74.4, 72.9), flfp=55, mlfp=78, agri=52, inc=0.60, hh=5.0, ins=50, marf=20.5, ue=0.2,
         rel=(11.5, 4.4, 74.6, 0.1, 0.3, 0.0, 9.1), sc=0.6, st=86.1, obc=3,
         lang={"Bengali": 6.4, "Nepali": 1.6, "Hindi": 2.2, "Assamese": 1.6}, tile=(4, 5)),
    dict(abbr="MN", grad=18, peak=18, name="Manipur", region="North-East", pop=3.20, urb=32, sr=985, csr=930, tfr=2.17, e0=73.0,
         lit=(76.9, 70.3), flfp=39, mlfp=72, agri=40, inc=0.50, hh=4.6, ins=30, marf=22.0, ue=0.7,
         rel=(41.4, 8.4, 41.3, 0.1, 0.3, 0.1, 8.4), sc=3.8, st=35.1, obc=35,
         lang={"Manipuri": 53, "Nepali": 2, "Hindi": 1, "Bengali": 1}, tile=(4, 6)),
    dict(abbr="DD", grad=10, name="Dadra & Nagar Haveli and Daman & Diu", region="West", pop=1.35, urb=60, sr=720, csr=926,
         tfr=1.75, e0=71.0, lit=(81.0, 68.0), flfp=30, mlfp=82, agri=10, inc=1.20, hh=4.2, ins=40, marf=21.0, ue=-0.3,
         rel=(93.0, 4.5, 1.5, 0.1, 0.2, 0.3, 0.4), sc=2.0, st=42.0, obc=20,
         lang={"Gujarati": 45, "Hindi": 22, "Bhili": 20, "Marathi": 6, "Konkani": 1}, tile=(5, 0)),
    dict(abbr="MH", grad=17, peak=30, name="Maharashtra", region="West", pop=128.4, urb=50, sr=929, csr=894, tfr=1.71, e0=72.7,
         lit=(82.3, 75.5), flfp=48, mlfp=78, agri=44, inc=1.40, hh=4.2, ins=35, marf=20.5, ue=0.0,
         rel=(79.8, 11.5, 1.0, 0.2, 5.8, 1.2, 0.5), sc=11.8, st=9.4, obc=35,
         lang={"Marathi": 68.9, "Hindi": 12.9, "Urdu": 7.0, "Gujarati": 2.0, "Bhili": 1.8, "Telugu": 1.2,
               "Kannada": 1.0, "Gondi": 0.6, "Sindhi": 0.6, "Bengali": 0.4, "Konkani": 0.4}, tile=(5, 1)),
    dict(abbr="TG", grad=18, peak=30, name="Telangana", region="South", pop=38.6, urb=46, sr=988, csr=932, tfr=1.75, e0=69.6,
         lit=(66.5, 57.9), flfp=50, mlfp=78, agri=46, inc=1.70, hh=3.6, ins=74, marf=19.5, ue=0.2,
         rel=(85.1, 12.7, 1.3, 0.1, 0.0, 0.1, 0.7), sc=15.4, st=9.3, obc=52,
         lang={"Telugu": 77, "Urdu": 12, "Hindi": 3.5, "Marathi": 1.6}, tile=(5, 2)),
    dict(abbr="OD", grad=11, peak=26, name="Odisha", region="East", pop=46.6, urb=19, sr=979, csr=941, tfr=1.82, e0=69.5,
         lit=(72.9, 64.0), flfp=44, mlfp=79, agri=48, inc=0.80, hh=4.0, ins=60, marf=20.0, ue=0.2,
         rel=(93.6, 2.2, 2.8, 0.1, 0.0, 0.0, 1.3), sc=17.1, st=22.8, obc=38,
         lang={"Odia": 82.7, "Hindi": 2.9, "Santali": 2.1, "Telugu": 1.4, "Bengali": 1.3, "Urdu": 1.5}, tile=(5, 3)),
    dict(abbr="TR", grad=10, peak=28, name="Tripura", region="North-East", pop=4.20, urb=29, sr=960, csr=957, tfr=1.69, e0=71.0,
         lit=(87.2, 82.7), flfp=37, mlfp=79, agri=30, inc=0.80, hh=3.8, ins=45, marf=19.0, ue=0.4,
         rel=(83.4, 8.6, 4.4, 0.0, 3.4, 0.0, 0.2), sc=17.8, st=31.8, obc=15,
         lang={"Bengali": 65.7, "Hindi": 2, "Manipuri": 0.6}, tile=(5, 5)),
    dict(abbr="MZ", grad=14, peak=22, name="Mizoram", region="North-East", pop=1.30, urb=57, sr=976, csr=970, tfr=1.87, e0=73.0,
         lit=(91.3, 89.3), flfp=42, mlfp=76, agri=45, inc=1.20, hh=4.3, ins=64, marf=22.0, ue=0.5,
         rel=(2.8, 1.4, 87.2, 0.0, 8.5, 0.0, 0.1), sc=0.1, st=94.4, obc=1,
         lang={"Bengali": 1.5, "Hindi": 1, "Nepali": 1}, tile=(5, 6)),
    dict(abbr="GA", grad=22, peak=40, name="Goa", region="West", pop=1.60, urb=68, sr=973, csr=942, tfr=1.33, e0=74.0,
         lit=(88.7, 84.7), flfp=31, mlfp=72, agri=10, inc=2.60, hh=3.9, ins=45, marf=24.0, ue=0.9,
         rel=(66.1, 8.3, 25.1, 0.1, 0.1, 0.1, 0.2), sc=1.7, st=10.2, obc=25,
         lang={"Konkani": 66, "Marathi": 10.9, "Hindi": 10.4, "Kannada": 4.6, "Urdu": 3.7}, tile=(6, 1)),
    dict(abbr="KA", grad=17, peak=32, name="Karnataka", region="South", pop=69.6, urb=44, sr=973, csr=948, tfr=1.68, e0=69.8,
         lit=(75.4, 68.1), flfp=43, mlfp=79, agri=43, inc=1.80, hh=4.1, ins=48, marf=20.5, ue=0.0,
         rel=(84.0, 12.9, 1.9, 0.0, 0.2, 0.7, 0.3), sc=17.1, st=7.0, obc=45,
         lang={"Kannada": 66.5, "Urdu": 10.8, "Telugu": 5.8, "Tamil": 3.5, "Marathi": 3.4, "Tulu": 2.6,
               "Hindi": 2.4, "Konkani": 1.3, "Malayalam": 1.4}, tile=(6, 2)),
    dict(abbr="AP", grad=14, peak=32, name="Andhra Pradesh", region="South", pop=54.0, urb=34, sr=996, csr=939, tfr=1.68, e0=70.0,
         lit=(67.4, 59.1), flfp=50, mlfp=79, agri=47, inc=1.20, hh=3.5, ins=80, marf=19.0, ue=0.1,
         rel=(90.9, 7.3, 1.4, 0.0, 0.0, 0.0, 0.4), sc=17.1, st=5.3, obc=48,
         lang={"Telugu": 89.2, "Urdu": 6.0, "Tamil": 1.0, "Kannada": 0.5, "Hindi": 1.0, "Odia": 0.5}, tile=(6, 3)),
    dict(abbr="LD", grad=15, name="Lakshadweep", region="South", pop=0.07, urb=80, sr=947, csr=911, tfr=1.40, e0=73.0,
         lit=(91.8, 87.9), flfp=14, mlfp=70, agri=8, inc=1.00, hh=5.2, ins=40, marf=22.0, ue=1.2,
         rel=(2.8, 96.6, 0.5, 0.0, 0.0, 0.0, 0.1), sc=0.0, st=94.8, obc=0,
         lang={"Malayalam": 84}, tile=(7, 0)),
    dict(abbr="KL", grad=20, peak=42, name="Kerala", region="South", pop=36.0, urb=55, sr=1084, csr=964, tfr=1.79, e0=75.2,
         lit=(94.0, 92.0), flfp=40, mlfp=72, agri=22, inc=1.40, hh=3.8, ins=55, marf=22.3, ue=0.8,
         rel=(54.7, 26.6, 18.4, 0.0, 0.0, 0.0, 0.3), sc=9.1, st=1.5, obc=55,
         lang={"Malayalam": 97, "Tamil": 1.5, "Tulu": 0.4, "Kannada": 0.25}, tile=(7, 1)),
    dict(abbr="TN", grad=20, peak=40, name="Tamil Nadu", region="South", pop=77.6, urb=54, sr=996, csr=943, tfr=1.80, e0=72.6,
         lit=(80.1, 73.4), flfp=47, mlfp=78, agri=28, inc=1.60, hh=3.6, ins=65, marf=21.0, ue=0.1,
         rel=(87.6, 5.9, 6.1, 0.0, 0.0, 0.1, 0.3), sc=20.0, st=1.1, obc=70,
         lang={"Tamil": 88.4, "Telugu": 5.9, "Kannada": 1.7, "Urdu": 1.7, "Malayalam": 1.0, "Hindi": 1.0},
         tile=(7, 2)),
    dict(abbr="PY", grad=22, peak=38, name="Puducherry", region="South", pop=1.70, urb=71, sr=1037, csr=967, tfr=1.50, e0=74.0,
         lit=(85.8, 80.7), flfp=33, mlfp=76, agri=13, inc=1.30, hh=3.7, ins=55, marf=21.5, ue=0.4,
         rel=(87.3, 6.1, 6.3, 0.0, 0.0, 0.0, 0.3), sc=15.7, st=0.0, obc=70,
         lang={"Tamil": 88.2, "Malayalam": 4.7, "Telugu": 5.5}, tile=(7, 3)),
    dict(abbr="AN", grad=15, peak=32, name="Andaman & Nicobar Islands", region="South", pop=0.41, urb=40, sr=876, csr=968, tfr=1.30,
         e0=72.0, lit=(86.6, 81.8), flfp=34, mlfp=78, agri=20, inc=1.30, hh=3.7, ins=45, marf=22.0, ue=0.9,
         rel=(69.5, 8.5, 21.3, 0.3, 0.1, 0.0, 0.3), sc=0.0, st=7.5, obc=20,
         lang={"Bengali": 28.5, "Hindi": 19, "Tamil": 15.2, "Telugu": 13.2, "Malayalam": 7.2}, tile=(7, 5)),
]

N_STATES = len(STATES)

# --------------------------------------------------------------------------------------
# National calibration targets (approximately PLFS 2023-24 / NFHS-5, projected to 2026)
# --------------------------------------------------------------------------------------
# share of people aged 25+ at education level >= k (k = 2..7)
EDU_25PLUS_AT_LEAST = [0.68, 0.56, 0.41, 0.27, None, 0.04]   # graduate share comes from the state 'grad' targets
UNEMPLOYMENT_TARGET = (0.032, 0.029)          # male, female (share of labour force 15+)
SECTOR_TARGET = [0.460, 0.122, 0.120, 0.174, 0.080, 0.027, 0.017]  # agri..professional (workers)
EARNINGS_TARGET = {1: 13900.0, 2: 21000.0, 3: 11000.0}  # mean monthly earnings by employment type (Rs)
SMARTPHONE_TARGET = (0.78, 0.58)              # 15+, male / female
INTERNET_TARGET = (0.74, 0.55)                # 15+, male / female
BANK_TARGET = (0.92, 0.88)                    # 15+, male / female
DISABILITY_TARGET = 0.022
LITERACY_GAP_CLOSURE = 0.30                   # share of the 2011 illiteracy gap closed by 2026
