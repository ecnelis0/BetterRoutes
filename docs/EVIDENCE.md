# Evidence: where every number in the BetterRoutes deck comes from

Measured on Oct 14, 2026 with routing model `gbt-baseline-2026-10-05`. Every app number below can be reproduced by typing the From and To addresses into BetterRoutes and picking the **first** suggestion. In the API, `balanced` is the app's **Safest** option and `safest` is **Safest + bike lanes**.

## Outside sources

| Number | Source |
|---|---|
| 1,103 cyclists killed and 52,887 injured on US roads in 2024 (injuries +6%); 81% of deaths in urban areas | [NHTSA Traffic Safety Facts, 2024 Data: Bicyclists](https://rosap.ntl.bts.gov/view/dot/92690) |
| 4% of SF surface street miles hold 55% of severe and fatal cyclist injuries | [SFMTA Vision Zero High Injury Network](https://sfmta.com/media/4894/download) (cyclist corridors) |
| About half of adults in the 50 largest US metros are "interested but concerned" about biking | [Dill & McNeil, Transportation Research Record 2587 (2016)](https://jenniferdill.net/types-of-cyclists/) |
| Transportation is 28% of US greenhouse gas emissions, the largest source (2022) | [EPA](https://www.epa.gov/system/files/documents/2024-05/420f24022.pdf) |

## Google Maps vs BetterRoutes: Grace Cathedral → Patricia's Green

Google Maps bicycling directions, captured Oct 14, 2026: **14 min, 1.9 mi**, via California St → Larkin St → Sacramento St → **Polk St (0.9 mi)** → **Grove St (0.4 mi)** → Octavia St → Hayes St.

- **39%** of that path lies inside areas BetterRoutes rates Severe: Civic Center about 870 m and the Tenderloin about 280 m, out of about 2.7 km (straight lines along each street, measured against the 17 flagged areas in `lib/data/sfDangerousNeighborhoods.ts`).
- **About 67%** has no protected bike lane, using SFMTA's bike-network data (`lib/data/sfBikeLanes.json`): California, Larkin, Sacramento, Grove and Octavia have no facility; Polk St is about 64% protected and 36% painted lane or none.
- BetterRoutes, same addresses, **Safest**: 2.1 mi, ~22 min, "Avoided every Severe area", "Avoided every crash hotspot", 25.1% less average danger than our Fastest (+5 min). It still passes through Western Addition and Fillmore (High, not Severe) and says so, because avoiding them would make the trip 246% longer.

## Results: 10 trips

| From → To (as typed) | Fastest: in flagged areas | Safest + lanes: in flagged areas | Danger | Protected lanes | Time |
|---|---|---|---|---|---|
| Ocean Beach → Ferry Building | 23.9% | 0.0% | 62.1 → 31.9 | 10.6% → 53.1% | 70 → 96 min |
| Pacific Heights → Mission Street & 17th Street | 53.7% | 54.0% | 74.6 → 56.8 | 1.5% → 27.2% | 25 → 42 min |
| Marina Green → Dolores Park | 27.2% | 17.1% | 56.6 → 45.3 | 0.9% → 18.3% | 37 → 43 min |
| Noe Valley → North Beach | 45.2% | 14.5% | 71 → 48.5 | 32.9% → 1.3% | 43 → 53 min |
| Grace Cathedral → Hayes Valley | 78.3% | 0.0% | 88.6 → 69.9 | 11.8% → 8.4% | 15 → 17 min |
| Chinatown → Dolores Park | 58.1% | 14.6% | 74.1 → 67 | 39.2% → 19.7% | 34 → 41 min |
| Union Square → Lower Haight | 57.2% | 13.5% | 74 → 68 | 30.2% → 1.7% | 21 → 30 min |
| Clement Street & 6th Avenue → Potrero Hill | 36.8% | 12.7% | 66.6 → 49.4 | 4.2% → 12.5% | 53 → 66 min |
| Marina Green → Potrero Hill | 47.3% | 12.7% | 63.6 → 34.7 | 33.7% → 65.0% | 55 → 72 min |
| Golden Gate Park → Ferry Building | 29.8% | 0.0% | 65.3 → 31.9 | 20.2% → 54.9% | 56 → 84 min |

Averages per trip, Fastest → Safest + bike lanes: in flagged areas 45.8% → 13.9% (**−70%**); danger 69.6 → 50.3 (**−28%**); protected lanes 18.5% → 26.2% (**1.4×**); total ride time **+33%**. Trips entering a Severe area: **7 of 10 → 1 of 10** (Union Square → Lower Haight, where "Union Square" lands on the Tenderloin's edge and the route clips SoMa for 0.12 mi).

Honest notes: on Pacific Heights → Mission Street & 17th Street the destination is inside a flagged area, so the safe routes can't avoid much. On some trips the safe route uses quiet streets with no bike lane, so its protected-lane share is lower (for example Noe Valley → North Beach).

## Feature numbers

| Number | Trip and setting |
|---|---|
| Danger 62 → 32, protected lanes 11% → 53%, +26 min | Ocean Beach → Ferry Building, Fastest vs Safest + bike lanes |
| Steepest climb 21.8% → 8.6%, climbing 1,027 → 518 ft, ~89 → ~82 min | Ocean Beach → Ferry Building, Safest, Avoid hills off → on |
| Traffic lights 35 → 17 → 12 (~89 → ~87 min) | Ocean Beach → Ferry Building: Fastest, Safest, Safest + Fewer traffic lights |
| "Flat ride please, with boba and a park on the way" → For you ride, 5.4 mi, 2 stops | Noe Valley → North Beach, route assistant (AI replies vary slightly) |

## Data counts

| Number | File |
|---|---|
| 3,558 bike-injury crashes (DataSF, 2019+) | `lib/data/sfBikeCrashes.json` |
| 5,455 SFMTA bike-lane segments | `lib/data/sfBikeLanes.json` |
| 5,566 highway and arterial segments | `lib/data/sfHighways.json` |
| 1,314 traffic signals | `lib/data/sfTrafficSignals.json` |
| 211,221 directed street segments; elevation at 112,492 points | `lib/data/sfBikeGraph.json, lib/data/sfNodeElevation.json` |
| 3,712 places | `lib/data/sfPois.json` |
| 177,023 LiDAR buildings | `DataSF building footprints, dataset ynuv-fyni` |
| 411 tests | `npm test` |

Raw measurements: [`evidence.json`](evidence.json).
