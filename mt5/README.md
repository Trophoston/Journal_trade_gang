# TradeGangSync — the MT5 side

`TradeGangSync.mq5` is a **read-only** Expert Advisor. It sends your account's deals,
open positions, balance/equity, candles and the MT5 economic calendar to Trade Gang
running on your computer. It never places, modifies or closes an order.

## Install (once)

1. In Trade Gang open **Settings → MT5 connection** and click **Download TradeGangSync.mq5**
   (or use this file directly). Copy the **token** shown there.
2. In MetaTrader 5: **File → Open Data Folder → MQL5 → Experts**, put the file there.
3. Open it in **MetaEditor** (F4) and press **Compile** (F7). It should report 0 errors.
4. **Tools → Options → Expert Advisors** → tick **Allow WebRequest for listed URL** and add
   `http://127.0.0.1` (use your Mac's LAN address instead if MT5 runs on another computer).
   MT5 applies this list to socket connections too; without it you'll see error 4014.
5. Drag **TradeGangSync** onto **any one chart**. In *Inputs* paste the token, leave Host
   `127.0.0.1` and Port `3685`, press OK.

The chart shows a status block. Within a few seconds Trade Gang → Settings shows **Live**
and your full history starts filling in.

## What it does

| When | Request | Purpose |
|---|---|---|
| Start | `POST /api/ea/hello` | Account info + server clock. Reply `since=<server time>` = where to backfill from. |
| Start | `POST /api/ea/deals` × n | Full history in batches of 200, with symbol specs (digits, tick value…). |
| Every deal | `POST /api/ea/deals` | Sent on the next 1-second tick after `OnTradeTransaction` (DEAL_ADD). |
| SL/TP change | `POST /api/ea/position` | Records stop management (e.g. moving to break-even). |
| Every 2 s | `POST /api/ea/heartbeat` | Balance, equity, margin, open positions. The reply may carry tasks. |
| Task `CANDLES` | `POST /api/ea/candles` | Bars around a closed trade (M1/M5/M15/H1) for FVG / sweep detection. |
| Task `CALENDAR` | `POST /api/ea/calendar` | MT5 economic calendar values (importance, actual, forecast, previous). |
| Every 30 s | `POST /api/ea/deals` | Re-sends the last hour of deals in case an event was missed. The server ignores duplicates. |

* Requests carry the token in `X-TG-Token`. Replies are plain text lines (`OK…` or `ERR|reason`),
  so the EA never parses JSON.
* MQL5 `WebRequest` can only use ports 80/443, so the EA speaks HTTP/1.0 over `SocketConnect`.
* Times are sent in **broker server time**; the app converts to UTC using the offset from `hello`
  (Settings → Accounts → Server time if your broker is unusual).

## Troubleshooting

| Chart says | Fix |
|---|---|
| `Add http://127.0.0.1 to … Allow WebRequest` | Step 4 above. |
| `Can't reach Trade Gang at 127.0.0.1:3685` | Start the app (`pnpm dev`) and MongoDB (`pnpm db:up`). |
| "Waiting for MT5 to log in to the broker" | MT5 isn't logged in to your account. **File → Login to Trade Account**, pick your server (e.g. `Exness-MT5Real25`), enter the password. The bottom-right corner of MT5 must show a ping, not "No connection" or "Invalid account". History is sent automatically once it logs in. |
| `Wrong token` | Copy the token again from Settings. A new token disconnects the old one. |
| `Database is not reachable` | `pnpm db:up`, then wait for the container to be healthy. |
| Candles never arrive for an old trade | The terminal has no history that far back. Scroll that symbol's chart back once so MT5 downloads it. |

> This file has not been compiled on every MT5 build. If MetaEditor reports an error, the
> message and line number are enough to fix it — please keep the read-only design.
