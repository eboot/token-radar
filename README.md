# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/eboot/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/eboot/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that still record no token and are not a wrapped or staked product of one that trades, ranks them by what their launch would be worth, and shows a reader how to farm each one. A static dashboard, no network, no framework.

The model (radar-2) prices each category from the snapshot's own live-token protocols: the median market cap per dollar of TVL in that category, shrunk toward the whole live set when a category has few live protocols, with each protocol's ratio capped so one outlier cannot set a category. Implied value is then TVL times that multiple, times a seven-day growth factor, times a maturity factor for how long the protocol has run with no token, times a small bonus for running on more than one chain. No protocol name is ever special-cased. The board covers all 40 watchlist protocols and adds 186 pre-token protocols below the watchlist floor, each with an eight-step farm plan that names its cost and time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

`snapshot.json` is the sealed snapshot from the competition kit (`input/snapshot.json`). Node 22.18 or later, standard library only; the program writes `board.json`, `data.js`, `dashboard/` and `screenshots/` to the output directory, plus `dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
