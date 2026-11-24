# Basic market board · local acceptance

Date: 2026-11-09

## Scope

Basic terminal-style chart and holdings presentation, retaining the approved black/graphite and lime palette. No five-level quotes, order book, depth, tick feed, or new technical indicators. This uses common terminal layout conventions; the current official Tonghuashun interface was not inspected.

- Compact symbol / selected close / change versus previous bar summary.
- Superseded by the follow-up below: intraday price line, daily/weekly OHLCV candles, and volume. 30 / 60 / all windows apply to the selected candle period.
- Hover crosshair and OHLCV readout; existing fill and decision markers remain selectable.
- Full-width holdings below the chart, using only the selected historical account snapshot.
- Existing Agent, decision, execution, account and expert tabs retained.

## Browser acceptance

Local frontend: http://127.0.0.1:5175/ (backend on port 8001). Tests used the isolated local demonstration database, without new LLM calls or brokerage orders.

- Completed minute replay `02e080b4-db6a-4f73-ba49-4827cea8d295`: latest historical holding is 48.9086 shares, average cost $103.32, mark $104.00, market value $5,086.25, floating P/L +$33.15 (+0.66%), weight 50.17%. Values independently recomputed from the stored snapshot, before display rounding; fees remain separate.
- First recorded bar: empty holdings, $10,000 cash, no invented previous-close change.
- Fill marker opens its historical execution point; “查看来源建议” returns to the earlier decision and its then-empty holdings.
- 30 / all controls displayed 30 / 105 candles respectively.
- Hovering an earlier candle changes OHLCV and crosshair but retains the selected account timestamp and balances.
- Legacy daily experiment `03634dca-f7f9-4471-8015-055fcb4da57b`: missing historical cost and P/L display as `—`.
- Unstarted experiment `39ac02d7-a86a-4a0e-82c8-4103dd524d63`: no candles or account snapshot; all missing balances display as `—`.
- Desktop 1440×900 and 1100×900: no document-level horizontal overflow. Sidebar expansion/collapse and expert tab work.
- Browser console checked: no errors.

## Build and calculation checks

- Final `npm run build` (TypeScript + Vite) passed in `/private/tmp/trading-replay-frontend`. The changed `ReplayDesk.tsx`, `style.css`, and `portfolio.ts` were verified byte-identical to workspace sources before this build.
- Focused holding-calculation checks passed for known cost/mark/P&L, legacy missing cost, null values, and missing account snapshot.
- Screenshot: `output/playwright/basic-market-after.png`.

Only local files and preview changed. No repository push, upload, or public deployment. Synthetic demonstration data is explicitly labelled and is not evidence of real-market performance.

## Follow-up: user-provided Tonghuashun screenshots

The user supplied separate intraday line and daily-candlestick screenshots and corrected the chart semantics. The price main chart now distinguishes **分时 / 日 K / 周 K**; this does not change the Agent cadence or experiment configuration. Intraday view uses only the selected ET session's visible observations; daily/weekly views aggregate visible OHLCV using the first open, maximum high, minimum low, last close and summed volume. Aggregate coverage is conservatively unconfirmed; no missing sessions are synthesized.

Verified against the saved minute demonstration:

- Default intraday view: 35 observations from the selected day, one price line, no candle bodies.
- Daily view: 3 candles. Last daily O/H/L/C = 101.903 / 104.7423 / 101.5322 / 103.995; volume = 68,880.
- Weekly view: 1 candle. O/H/L/C = 99.7751 / 104.7423 / 99.1468 / 103.995; volume = 166,215.
- Switching chart period leaves selected holdings and balances unchanged.
- Legacy daily-only experiment defaults to daily candles and disables intraday view.
- Independent helper checks passed for ET date/week boundaries and truncating the first observation before aggregation.

## Follow-up: fixed intraday session axis

The user further specified a fixed open-to-close intraday axis with future time left blank. The current view explicitly covers US regular trading hours 09:30–16:00 ET; no exchange calendar or early-close inference is claimed. Pre/post-market observations are excluded from this view.

- Price line, volume, crosshair and event markers use the same ET timestamp-to-x mapping. Daily/weekly candles retain their period layout.
- Browser verified: at 09:46 the last point is x=81.8051; after stepping to 09:47 that same 09:46 point remains x=81.8051 and only the new point extends right to x=83.9179. Axis labels remain 09:30 / 12:45 / 16:00 ET.
- At 10:05, the last observed point is x=121.9487 on the fixed x=48..872 plot; the remainder is blank.
- Helper checks passed for winter and summer ET offsets, session endpoints, and out-of-session exclusion. Daily/weekly aggregation also passed cross-year, mixed-offset chronological-order and delayed-availability checks.
- Final TypeScript/Vite build passed in the temporary mirror; browser reload has no console errors. At 1100px viewport width no document horizontal overflow was observed.
- Screenshot: `output/playwright/fixed-session-intraday.png`.

## Follow-up: readout locking and end-of-session replay

- Clicking an intraday or candle bar locks its OHLCV readout without changing replay time. Replay movement remains on the time controls or explicit source-navigation actions.
- The final visible intraday observation keeps a visible price dot. The dot does not intercept pointer input, so the neighboring bar hit areas remain usable.
- Fill prices are included in the visible chart's price range when operation markers are enabled. “剩余时段无数据” appears only after a completed experiment reaches its final record for that day.
- Browser acceptance on 2026-11-10: full-day synthetic experiment `f0de777c-ad0b-467d-9a50-005fecf22629` contains 390 bars. The first minute now has a visible radius-3 dot, with pointer events disabled on the decorative dot.
- Local TypeScript and Vite production build passed in `/private/tmp/trading-replay-frontend` after the follow-up changes.


## Actual replay operation audit · 2026-11-10

Reproduced before repair: first-minute Y placement used the upper edge and an arbitrary one-dollar fallback; adding data repeatedly changed the scale; clicking an earlier price point rewound the selected account and removed later points. The 105-bar fixture contains only 35 minutes per day, so it cannot demonstrate a full trading session.

After repair, parent browser interaction verified:

- Home shows 09:31 at x=50.1128, y=148.4703 near the open-reference centre, radius 3. The initial axis is 99–101 around open 100. Visible OHLC extrema (and visible execution prices when enabled) expand the range in half-percentage-point steps; no future prices determine it.
- At 4×, play then pause advances to five observations and remains paused. The first point retains the same coordinates while those observations stay within the initial range.
- Clicking the middle of the replay slider selects 12:45: 195 visible points, last x=460. The entire future half remains blank. Hover/click 09:46 locks the readout but keeps slider 194, all 195 points, and account equity 10,033.43 unchanged. Returning to latest readout also leaves the replay at 12:45.
- End selects 16:00: 390 points, last x=872. Daily/weekly aggregation for this one-session fixture is O100 / H101.388 / L99.94612 / C101.27038, volume 6,459,391, independently recomputed from CSV.
- Original three-session fixture: 3 daily candles and 1 weekly candle. Clicking the earliest daily candle preserves slider 104 and current account. Its intraday view explicitly says records end at 10:05 and the remaining session has no data.
- Daily-only legacy experiment disables intraday and preserves missing cost/P&L as dashes.
- At 1100px, both expanded/collapsed sidebar states have document width 1100 with no horizontal overflow.
- Inspected screenshots: `output/playwright/chart-audit-midday.png` and `chart-audit-full-session.png`.
- Focused chart calculations passed: constant-price range, stepped expansion, execution price inclusion, ET/DST endpoints, future cutoff and OHLCV aggregation. Backend market-data checks: 9 passed.

The imported one-session fixture is explicitly synthetic (`dataset_synthetic=true`); its 26 decisions use the deterministic momentum baseline, with no model calls. It is UI/runtime evidence only. The earlier seven-session stress experiment is retained paused, and its import predates the synthetic-import flag; its name/provenance says synthetic but its pinned flag is false. Do not treat it as real data or amend its frozen config.

Known runtime limitation: large full-experiment responses (about 49.8 MB for the earlier long replay) still cause latency. The 10 ms runner yield improves scheduling opportunities but did not guarantee a 2-second health response during an active replay. Health after completion returned in 4 ms. Pagination/background-work optimization is not part of this chart repair.

Only local code and isolated local test records changed. No upload, deployment, brokerage orders or paid LLM calls.


Final operation-marker check: the first buy chip was originally blocked by an adjacent proposal hit target. After separating clickable chips from pointer-transparent price anchors/leader lines, both proposal and buy chip clicks succeeded without force. First buy navigates to source-bar index 16, displays 49.918 shares at 100.17 with fee 0.50; its source-suggestion button navigates back to index 15. Screenshot `output/playwright/chart-audit-markers.png` records the expanded markers. Final loaded browser console contains only the React development notice, no errors. Final frontend files match the preview mirror byte-for-byte (SHA-256).
