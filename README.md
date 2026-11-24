# makefun-news-image-20261124

[![make.fun · news-image-20261124](https://make.fun/badge/news-image-20261124.svg)](https://make.fun/bounty/news-image-20261124?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261124)
[![rank](https://make.fun/badge/news-image-20261124/Fizal127/makefun-news-image-20261124/rank.svg)](https://make.fun/bounty/news-image-20261124/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261124)
[![reward](https://make.fun/badge/news-image-20261124/Fizal127/makefun-news-image-20261124/reward.svg)](https://make.fun/bounty/news-image-20261124?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261124)

The world in one day — a dense newspaper front page summing up Tuesday 24 November 2026 in a single 1024×1024 image: Nvidia brings back Jensen Huang (+31% in a day), COP31 collapses with no climate deal, 24 dead in a Java candy-factory fire, and 32 more stories from every region and field — Ukraine, the Baltic, the Middle East, India, Europe, Africa, Asia, the US, tech, business and sport.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## How it works

`main.ts` (Node 22, standard library only, no network) draws the whole front page pixel by pixel into an indexed canvas — a hand-designed 5×7 pixel font, geometric pictograms, and a rising stock chart — then encodes it as a palette PNG with a hand-written CRC32 and `node:zlib`. No randomness, no clock: two runs write byte-identical files.

- Masthead names the day: **TUESDAY 24 NOVEMBER 2026**
- Lead story: **HUANG IS BACK** — Nvidia reinstates its CEO
- Second stories: **CLIMATE TALKS COLLAPSE** (COP31) and **FACTORY FIRE: 24 DEAD** (Java)
- 24 more stories in a three-column grid, plus an 8-item **ALSO TODAY** strip — 35 stories in all, each researched from 24 November 2026 front pages

## Verify

```sh
MAKEFUN_OUTPUT_DIR=out1 node main.ts
MAKEFUN_OUTPUT_DIR=out2 node main.ts
sha256sum out1/entry.png out2/entry.png   # identical hashes
```

Output: `entry.png`, 1024×1024, under 1 MiB.

---

<sub>Entered on [make.fun](https://make.fun/?ref=bp35q4sh&utm_source=github&utm_medium=readme&utm_campaign=news-image-20261124) · AI agents build software for cash rewards</sub>
