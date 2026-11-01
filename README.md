# Trade Gang

A live trading journal for **MT5 (Forex / Gold)** with a **Gemini** coach. It runs entirely on
your machine: Next.js + MongoDB. Only the items you analyze are sent to Gemini.

- **Live sync** from MetaTrader 5 through a read-only EA: deals, positions, equity, candles and the
  MT5 economic calendar.
- **Calculated, not guessed**: win rate, R, profit factor, drawdown (cash flows removed), streaks,
  hour × weekday heatmap, sessions, setups, mistakes and what they cost, and Edge Radar.
- **Market evidence** for each trade from candles: FVGs (and whether they held), liquidity sweeps,
  structure shifts, stop hunts, MAE/MFE, volatility and news nearby.
- **AI coach** (Thai with English trading terms, or English) that explains *why* each trade won or
  lost, citing that evidence, and writes daily and weekly reviews, a next-trade brief and a
  pre-trade check. Each result is generated once and saved; **Re-analyze** is always your click.
  A side chat lets you ask follow-up questions about any result.
- Light/dark × liquid glass (Most / Mid / None), a bento layout and spring motion that respects
  reduced motion.

## Requirements

- Node 22+ and pnpm
- Docker Desktop (for MongoDB)
- MetaTrader 5 (macOS app, or Windows/VM on your network)
- A Gemini API key from <https://aistudio.google.com/apikey> (optional: `AI_PROVIDER=mock` works without one)

## Start

```bash
pnpm install
cp .env.example .env.local      # add GEMINI_API_KEY, or set AI_PROVIDER=mock
pnpm db:up                      # MongoDB 8 on 127.0.0.1:27017
pnpm seed                       # optional: 3 months of demo trades, candles, news and AI reviews
pnpm dev                        # http://127.0.0.1:3685
```

Then **Settings → MT5 connection** and pick one of three ways. All of them are read-only:

| Way | Needs | Notes |
|---|---|---|
| **MT5 app + EA** | MetaTrader 5 open on this Mac (or a PC on your network) | Most private, free, includes the MT5 economic calendar. Steps: [mt5/README.md](mt5/README.md) |
| **Login (MetaApi)** | A free [MetaApi](https://app.metaapi.cloud/token) token + account number, server and **investor** password | No MT5 app needed. The password goes to MetaApi once and is not stored here; unlinking deletes it there. No calendar news; candles depend on your MetaApi plan |
| **Exness API key** | An Exness account type that supports the API (Thailand/Vietnam only) | Not wired yet: Exness's developer docs are only visible after signing in |

Remove the demo data any time from **Settings → Data**. Your first real MT5 account becomes the
one shown automatically.

## Pages

| Page | What it's for |
|---|---|
| Dashboard | Live account, session timeline with news, equity curve, today's AI brief, Edge Radar, KPIs, review queue |
| Calendar | Month grid with weekly totals; click a day for its trades, the daily review and your notes |
| Trades | Virtualized table with filters and bulk tagging (Undo). A trade opens over the list with its chart, evidence, AI analysis and journal |
| Insights | Strong/weak times and setups, behavior (after a loss, trade number of the day, emotions, mistakes), R distribution and drawdown. Every chart has a table view |
| Coach | Weekly review, the full AI history, pre-trade check, lessons → "Adopt as rule" |
| Settings | Connection, accounts (cent, server time, risk rules), symbols, tags and playbook, AI, appearance, data |

⌘K jumps anywhere; ⌘J opens the coach chat.

## How the AI runs

| Report | When (once, then saved) | Model |
|---|---|---|
| Trade analysis | 30 min after close, or right after you tag setup + emotion (trades closed after the EA connected; older ones on demand) | fast |
| Daily review | After the trading day closes (17:00 New York + 10 min); catches up 7 days on start | fast |
| Weekly review | After the Friday close; catches up 4 weeks | deep |
| Next-trade brief | Once per trading day | fast |
| Pre-trade check, chat | On demand | fast |

The defaults all run on Gemini's **free tier**: fast and deep = `gemini-3.8-flash`, then
`gemini-3.5-flash-lite` when a model hits its free limit, and `gemini-2.5-flash` for Google Search
grounding (the only free-tier model with search, 500/day). Check your limits at
<https://aistudio.google.com/rate-limit>.

Jobs are queued in MongoDB, one at a time, with back-off on rate limits. Models, language and
every automatic run can be changed in Settings. AI output is coaching from your own journal,
**not financial advice**.

## Scripts

| Command | |
|---|---|
| `pnpm dev` / `pnpm build && pnpm start` | Run on 127.0.0.1:3685 |
| `pnpm test` | Unit tests: deal grouping, server time / DST, sessions, metrics, detectors |
| `pnpm typecheck` / `pnpm lint` | |
| `pnpm seed` | Demo account with candles, news and AI reports |
| `pnpm ea:sim [--reset \| --clean]` | Plays the EA protocol against the running app (hello, backfill, a live trade, tasks); `--clean` removes everything it wrote |
| `pnpm backup` | `mongodump` archive into `./backups` (trades, journal, AI history and screenshots) |
| `pnpm db:up` / `pnpm db:down` | Start / stop MongoDB |

## Privacy

- MongoDB and the app listen on `127.0.0.1` only. The EA authenticates with a token you can rotate.
- With the MetaApi login, MetaApi (a third-party cloud) holds your investor password and sees your
  trades. Use the investor password, never the master one. The MetaApi token stays in local MongoDB.
- Sent to Gemini, only for the item being analyzed: prices, times, P&L, your tags and notes,
  detected evidence, nearby calendar events, your aggregated stats and rules, and screenshots if
  enabled. Never your MT5 credentials. On Gemini's free tier Google may use prompts for training.

## Layout

```
app/(app)/            pages (+ @modal for the trade sheet)
app/api/ea/*          EA endpoints (text replies)      app/api/events   live updates (SSE)
app/api/ai/chat       streaming chat                   app/api/files    screenshots (GridFS)
lib/mt5               protocol, deal → trade grouping, server time, symbols, data tasks
lib/connectors        MetaApi login sync (maps MetaApi data onto the EA payloads)
lib/analytics         metrics, curve/drawdown, edge radar, guardrails
lib/market            FVG / sweep / structure / excursion detectors
lib/ai                prompts, context, schemas, queue, scheduler, chat tools, mock
lib/queries           page data        lib/actions   server actions
components/           ui, shell, charts, dashboard, calendar, trades, insights, coach, settings, ai
mt5/TradeGangSync.mq5 the read-only EA
```
