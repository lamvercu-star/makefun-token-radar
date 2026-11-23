# Token Radar — Build the best token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lamvercu/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lamvercu/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.
It reads a sealed snapshot of every protocol DefiLlama tracks, ranks the ones that record no token
by what their launch would be worth, and hands in a web dashboard with the board, a detail view for
each protocol, and the steps to farm it.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Node 22.18 or later (this machine: Node 24.22.1). Standard library only, no install. The program
writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`.
Run it twice: the two runs write the same bytes.

## Using the board

The dashboard is a static page with no network calls; everything it shows is
in `data.js` beside it. Search matches name, slug, category and chain — press
`/` anywhere on the page to jump to the search box. The verdict chips
(Farm / Thin / Skip, with the board total in each label) are the fast path to
the verdict filter; clicking the active chip again clears it, and the Verdict
dropdown does the same thing. **Export CSV** downloads exactly the rows the
current filters show, in the table's sort order, with the implied-value band
included, so the file and the page never disagree. **Clear filters** resets
search, category, chain and verdict to the full 178-row board.

## The model (radar-2)

The snapshot prices itself. The multiples are fitted at run time from the protocols in the same
snapshot whose token already trades — no protocol name is special-cased, and no multiple is
hardcoded:

- Comps: 119 traded protocols (market cap > 0, CoinGecko id and symbol set, TVL > 0, not a CEX).
- Log-log curve: `log(mcap) = 7.7881 + 0.4721 x log(TVL)`, R2 = 0.1434.
- Category multiple: the category median mcap / TVL among the comps, shrunk (k = 8) in log space
  toward the curve's multiple at the protocol's TVL.
- `implied = round(TVL x categoryMultiple x (1 + clamp(change_7d, -60, 120) / 100 x 0.20) x (0.85 + min(age_days, 1095) / 1095 x 0.30))`
- Backtest (leave-one-out over the 119 comps): median absolute log error 1.2122, a factor of
  x3.3609 either way. One flat multiple for every protocol scores 1.5855 on the same test, so the
  curve beats it. Each row carries its band: implied / 3.3609 to implied x 3.3609.
- Verdict: Farm at $40M or more (7 rows), Thin at $15M or more (20 rows), Skip below that.

The board covers all 40 watchlist protocols plus 138 pre-token protocols below the $50M floor:
178 rows. Wrapped, staked and bridged products of a token that already trades are never ranked.
Live-token protocols are set aside with their market caps shown — the market's own value, not a
model's. A protocol "records no token" in the snapshot; that is the snapshot saying so, never
proof it has none, and the board never predicts whether or when a token is issued.

## Results on this snapshot

- Rank 1: Steakhouse Financial — $68.6M implied (TVL $2.75B, Risk Curators)
- Rank 2: Bittensor dTAO — $56.9M · Rank 3: Gauntlet — $53.6M · Rank 4: Veda — $53.1M
- Snapshot: DefiLlama, 2026-11-14. Entry deadline: 2026-12-14 10:00 UTC.

## Files

- `main.ts` — the program (Node 22), `lib/model.ts` — the model and farm plans
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit
- `dashboard/` — the static page (no network): `index.html`, `app.css`, `app.js`
- `screenshots/` — the board, a protocol's detail view, and a filtered view (1440x900)
- `board.json`, `dossier.json` — the board and dossier this run wrote
- `input/snapshot.json` — the sealed snapshot, copied from the kit for local runs

---

<sub>Entered on [make.fun](https://make.fun/?ref=lamvercu&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
