# gta6-trophy-forecast

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/tqhieu1105/gta6-trophy-forecast/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/tqhieu1105/gta6-trophy-forecast/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

Forecasts all five earn-rate quantiles for each GTA VI PS5 trophy using only the case history. The entry runs offline with Node 22 and the standard library.

## Method

Repeated Exophase pages are collapsed into distinct snapshots. Each rate and tracked-player count gives an implied earner count; robust pairwise slopes in log-time are fit separately to players and earners, then projected and recombined as a rate. Sparse trends shrink toward persistence and modest growth priors, with a small progression prior for story milestones. Projection damping limits long-horizon extrapolation. When only one small-cohort snapshot exists and it remains stale into the target, the median allows modest dilution by new players. Logit quantiles widen at least at the house random-walk rate and widen further when the observed page has moved.

The local rolling-origin check used 22 cuts and 6,050 scored quantile items from the supplied house reads at 30, 60 and 90 minute horizons. Those reads are unchanged: model loss was 0.018627 and the house random-walk loss was 0.018623. This measures short-horizon stability but cannot validate a refresh forecast. A separate sensitivity check varied the achievement rate of hypothetical new-player cohorts; those scenarios are not observed answers. The kit omits the practice target labels and final history, so exact practice scoring and a true long-horizon backtest are unavailable locally.

The live [Exophase GTA VI page](https://www.exophase.com/game/grand-theft-auto-vi-psn/trophies/) was reachable through a text reader and confirmed the 55-trophy page shape. The accessible [GTA V Exophase page](https://www.exophase.com/game/grand-theft-auto-v-ps4/trophies/) was a 2022 snapshot, not a day-two-to-day-seven launch series; PSNProfiles and archived launch-week pages were unavailable. Consequently, no unsupported cross-game day-seven drift coefficient is claimed.

## Run it

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

The grader supplies one `<case-id>.in` file in `/input`; the program writes the matching forecast to `/output/<case-id>.out`.
