# Validation report

Exact statistics computed over **all 1,500,000,000 generated records** (from `data/full/aggregates.npz`), seed `20261101`, generated in 130.9s.
Benchmarks are the public figures the model was anchored to (projected to ~2026 where needed). This is simulated data, so close agreement is by construction rather than a finding.

## National

| Measure | Generated | Benchmark | Source |
|---|---|---|---|
| Population | 1,500,000,000 | 1,500,000,000 | target |
| Urban share | 35.0% | ~35% | 2011: 31.1%, rising ~0.3pp/yr |
| Sex ratio (F per 1,000 M) | 942 | 940-950 | Census 2011: 943 |
| Median age | 29 | ~29 | UN WPP 2024 (2026) |
| Aged 0-14 | 24.9% | ~24-25% | UN WPP 2024 |
| Aged 60+ | 12.2% | ~11-12% | UN WPP 2024 / LASI |
| Literacy 7+, male | 86.6% | ~87% | PLFS 2023-24 |
| Literacy 7+, female | 75.0% | ~75% | PLFS 2023-24 |
| Graduates+, age 25+ | 13.8% | ~13-15% | PLFS / AISHE trend |
| LFPR 15+, male | 77.9% | 78.8% | PLFS 2023-24 (usual status) |
| LFPR 15+, female | 40.2% | 41.7% | PLFS 2023-24 |
| Unemployment rate 15+ | 3.1% | 3.2% | PLFS 2023-24 |
| Smartphone, 15+ | 68.3% | ~68% | NFHS-5 trend, 2026 est. |
| Internet users, 15+ | 64.8% | ~65% | NFHS-5 / TRAI trend |
| Bank account, 15+ | 90.1% | ~90% | Global Findex 2021 + PMJDY |
| Health insurance / scheme | 45.8% | ~45-50% | NFHS-5 41% of households + PM-JAY |
| Disability | 2.21% | 2.2% | Census 2011 / NSS 76th round |
| Mean monthly earnings, workers | Rs 14,952 | ~Rs 15,000 | PLFS 2023-24 by employment type |
| Religion H/M/C/S/B/J/O | 80.0% / 14.1% / 2.2% / 1.7% / 0.7% / 0.4% / 0.9% | 79.8 / 14.2 / 2.3 / 1.7 / 0.7 / 0.4 / 0.9 | Census 2011 |
| Social group Gen/OBC/SC/ST | 32.4% / 42.3% / 16.6% / 8.7% | ~30 / ~44 / 16.6 / 8.6 | Census 2011 (SC/ST), NSSO (OBC) |
| Workers by sector (agri/mfg/constr/trade/svc/govt/prof) | 43.5% / 12.8% / 12.6% / 18.2% / 8.4% / 2.9% / 1.8% | 46.0% / 12.2% / 12.0% / 17.4% / 8.0% / 2.7% / 1.7% | PLFS 2023-24 (grouped) |
| Employment self/regular/casual | 55.8% / 23.1% / 21.1% | 58.4 / 21.7 / 19.8 | PLFS 2023-24 |
| Top mother tongues | Hindi 45.1%, Bengali 7.5%, Marathi 6.6%, Telugu 6.3%, Tamil 5.2%, Gujarati 4.7% | Hindi 43.6, Bengali 8.0, Marathi 6.9, Telugu 6.7, Tamil 5.7, Gujarati 4.6 | Census 2011 |

## States and union territories

Targets: literacy is 2011 literacy with 30% of the illiteracy gap closed; female LFPR from PLFS; graduate shares are 2026 estimates.

| State/UT | Population | Urban | Sex ratio | Median age | Literacy F (target) | Female LFPR (target) | Graduates 25+ (target) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jammu & Kashmir | 14,794,046 | 31.0% | 890 | 28 | 69.7% (69.5%) | 46.1% (47%) | 16.2% (16%) |
| Ladakh | 327,582 | 23.0% | 852 | 28 | 75.9% (75.5%) | 51.5% (50%) | 14.5% (14%) |
| Punjab | 33,180,931 | 42.0% | 905 | 31 | 79.4% (79.5%) | 29.8% (30%) | 16.9% (17%) |
| Himachal Pradesh | 8,031,053 | 11.0% | 971 | 32 | 83.6% (83.1%) | 67.5% (66%) | 18.2% (18%) |
| Chandigarh | 1,320,897 | 98.0% | 814 | 32 | 85.7% (86.8%) | 26.3% (28%) | 31.6% (32%) |
| Haryana | 32,758,244 | 41.0% | 890 | 27 | 76.4% (76.1%) | 25.9% (26%) | 17.2% (17%) |
| Uttarakhand | 12,574,939 | 35.0% | 963 | 27 | 79.2% (79.0%) | 44.5% (45%) | 16.8% (17%) |
| Rajasthan | 87,284,870 | 28.0% | 928 | 28 | 66.6% (66.5%) | 49.0% (49%) | 11.1% (11%) |
| Delhi | 23,881,817 | 98.5% | 866 | 31 | 86.0% (86.6%) | 16.6% (17%) | 30.0% (30%) |
| Uttar Pradesh | 254,774,602 | 26.0% | 912 | 26 | 70.0% (70.0%) | 32.9% (33%) | 11.9% (12%) |
| Bihar | 139,486,717 | 14.0% | 918 | 24 | 66.0% (66.1%) | 23.2% (23%) | 8.0% (8%) |
| Sikkim | 739,702 | 28.0% | 890 | 31 | 82.7% (82.9%) | 63.8% (63%) | 14.6% (15%) |
| Assam | 38,781,534 | 17.0% | 958 | 29 | 76.3% (76.4%) | 28.9% (29%) | 10.1% (10%) |
| Arunachal Pradesh | 1,690,748 | 26.0% | 937 | 30 | 71.0% (70.4%) | 36.9% (35%) | 10.3% (10%) |
| Nagaland | 2,324,779 | 32.0% | 931 | 26 | 84.0% (83.3%) | 38.9% (40%) | 12.0% (12%) |
| Gujarat | 77,563,068 | 48.0% | 919 | 29 | 78.8% (78.8%) | 44.9% (45%) | 13.1% (13%) |
| Madhya Pradesh | 93,413,832 | 31.0% | 931 | 28 | 71.4% (71.4%) | 47.1% (47%) | 11.1% (11%) |
| Chhattisgarh | 32,758,244 | 26.0% | 991 | 29 | 72.0% (72.1%) | 59.9% (60%) | 9.5% (10%) |
| Jharkhand | 42,902,733 | 27.0% | 948 | 27 | 69.0% (68.8%) | 42.5% (42%) | 9.1% (9%) |
| West Bengal | 106,728,473 | 36.0% | 950 | 31 | 79.4% (79.3%) | 38.1% (38%) | 12.0% (12%) |
| Meghalaya | 3,698,511 | 22.0% | 987 | 24 | 82.1% (81.0%) | 54.9% (55%) | 8.9% (9%) |
| Manipur | 3,381,496 | 32.0% | 986 | 26 | 79.4% (79.2%) | 39.3% (39%) | 18.4% (18%) |
| Dadra & Nagar Haveli and Daman & Diu | 1,426,569 | 60.0% | 721 | 31 | 78.5% (77.6%) | 30.1% (30%) | 10.3% (10%) |
| Maharashtra | 135,682,534 | 50.0% | 929 | 31 | 82.7% (82.8%) | 47.8% (48%) | 16.9% (17%) |
| Telangana | 40,789,298 | 46.0% | 988 | 30 | 70.4% (70.5%) | 50.0% (50%) | 18.1% (18%) |
| Odisha | 49,243,038 | 19.0% | 979 | 29 | 74.9% (74.8%) | 43.9% (44%) | 11.0% (11%) |
| Tripura | 4,438,214 | 29.0% | 959 | 30 | 88.4% (87.9%) | 35.6% (37%) | 9.6% (10%) |
| Mizoram | 1,373,733 | 57.0% | 978 | 28 | 92.4% (92.5%) | 41.7% (42%) | 13.4% (14%) |
| Goa | 1,690,748 | 68.0% | 972 | 37 | 89.4% (89.3%) | 30.6% (31%) | 22.4% (22%) |
| Karnataka | 73,547,542 | 44.0% | 973 | 32 | 77.9% (77.7%) | 43.0% (43%) | 16.9% (17%) |
| Andhra Pradesh | 57,062,748 | 34.0% | 996 | 31 | 71.1% (71.4%) | 49.7% (50%) | 13.7% (14%) |
| Lakshadweep | 73,970 | 80.0% | 953 | 34 | 90.9% (91.5%) | 14.2% (14%) | 15.8% (15%) |
| Kerala | 38,041,832 | 55.0% | 1084 | 36 | 94.7% (94.4%) | 40.0% (40%) | 19.9% (20%) |
| Tamil Nadu | 82,001,282 | 54.0% | 996 | 35 | 81.6% (81.4%) | 46.9% (47%) | 19.9% (20%) |
| Puducherry | 1,796,420 | 71.0% | 1038 | 35 | 86.1% (86.5%) | 33.5% (33%) | 21.6% (22%) |
| Andaman & Nicobar Islands | 433,254 | 40.0% | 872 | 33 | 87.7% (87.3%) | 34.1% (34%) | 15.4% (15%) |
