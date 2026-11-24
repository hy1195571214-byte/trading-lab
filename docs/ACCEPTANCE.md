# Platform acceptance ledger

Verified 2026-10-27. Original objective: implement the platform from the approved Figma design and project constraints. This records observed results, not investment performance.

| Gate | Evidence | Status |
| --- | --- | --- |
| Approved visual language | Browser renders graphite/lime panels, flat navigation, monochrome pixel badges; `outputs/app-agent-desk.png`, `app-reports.png` | Passed desktop review |
| Historical data | Browser imported `work/acceptance-prices.csv`; immutable dataset ID/checksum; synthetic demo explicitly labelled; API validation tests | Passed |
| Trading engine | Automated future-data, next-open, fees/slippage, cash/position caps, missing quotes, final pending orders, idempotent review, benchmark tests | Passed |
| Configurable LLM Agent | Local controlled compatible endpoint: settings failure/success and six expert/coordinator calls over two snapshots, retained usage; invalid-output/budget tests | Passed adapter acceptance; real provider not selected |
| Expert cards | Browser created/searches/details custom card; unavailable fundamentals shown; role editor blocks zero traders; scheduled swap activates at next decision, original config unchanged | Passed |
| Oversight | Browser approve/modify/reject, original HOLD retained after modified rebalance; oversized target disabled; approval precedes next-day fills | Passed |
| Experimental integrity | Branch created through browser and AI-only replay completed; initial experiment preserved; comparison flags different replay cutoffs | Passed |
| Reports | Real volatility/fees/review counts/timestamps, LLM estimates with fractional-dollar precision; JSON browser export parsed and secrets absent | Passed; JSON and CSV browser downloads verified |
| Persistence/concurrency | Server restarted, same experiment IDs/history reloaded; run/step/review concurrency regression tests; pending/completed run guards | Passed |
| User journeys | Browser import/create/run/review/team/expert/settings/comparison/JSON export/navigation/scrolling exercised | Passed desktop journeys including CSV and 1100px layout |
| Runnable handoff | `scripts/setup.sh`, `scripts/dev.sh`; launcher starts both services and stops children; final frontend build passed | Passed local launch |

## Evidence and exercised data

- `work/browser-acceptance-records.json` contains IDs and API assertions for browser-created records.
- Oversight run `f484fc9c-4f7f-436f-a942-b226c67f8080`: approved, modified, rejected; first close 2023-01-03; actual fills 2023-01-04. Position caps correctly produced a settled partial fill with disclosed unfilled remainder.
- Separate AI-only branch `a9755848-6d05-48da-9d8d-58449e7cbbf5` reached 2023-01-10 and completed.
- `CONTROLLED MOCK adapter acceptance` (`f1e70597-0566-4593-bf6a-614c5e3ddc8d`) uses a deliberately local mock, not a real model. Stored rationale explicitly identifies it. Role swap took effect on 2023-01-04. Six calls succeeded (two expert calls plus one coordinator for each snapshot).
- `work/browser-export.json` was downloaded through the browser and parsed; all three original decisions remain. Test credential is absent.
- Backend + engine verification: 41 passed in 1.87s after final CSV regression. One upstream Starlette/httpx deprecation warning.
- `npm --prefix frontend run build`: TypeScript and production bundle passed. Fresh runs recovered after macOS cloud placeholders delayed dependency loading; no global proxy settings changed.

## Agreed model boundary and limits

Provider/model remain unselected. No paid-provider response or profitable AI trading result is claimed. Test endpoint and dummy key are removed/reset after acceptance. Settings are configurable for a later chosen service.

Review timestamps are recorded; active human review duration is not measured. LLM costs are estimates from supplied token prices and returned usage; missing costs are labelled unknown. Fractional shares and deterministic bps costs are used. Market impact, volume-limited fills, separate corporate actions, dividends, interest and borrowing are not modelled. Fundamentals/news data are unavailable and cards requiring them cannot activate. Time-filtered inputs do not remove a pretrained model's prior historical knowledge.

No live brokerage, live-market paper feed, independently trained model or mobile trading is included in this v1. Desktop browser verification is not certification of every browser/device or a financial research conclusion.

## Final closing checks

- Final backend/engine run: **41 passed**, one upstream deprecation warning, 1.87s; captured in `work/final-test-results.txt`.
- Final TypeScript/production build passed (`index-Cmb5OQ7l.js`).
- CSV rejected/null-proposal defect fixed and regression tested. Browser downloaded both JSON and CSV. Parsed CSV retains all three review decisions, actual dates, statuses and reasons; test key absent.
- Oversized review target (80% against 25% limit) disables Modify; changing to 10% enables it; review-queue rejection succeeds and clears the queue.
- Created a second experiment from the imported fixture using the actual wizard; launch routes to Trading workspace; run reaches completed. No configured provider/key was required for the explicit demo.
- Portfolio browser check confirms `target_weights`, actual buy fill prices, fees and eligible dates render correctly.
- 1100px layout screenshot `outputs/app-final-1100.png`: no document-level horizontal overflow; chart/review stack. 1440px full-page outputs: `app-final-desktop.png`, `app-final-portfolio.png`.
- Latest browser page console: zero errors, zero warnings. Earlier development/test errors were addressed or expected configuration-failure responses, not hidden.
- Service restart retained experiments/datasets/cards; runtime now uses polling for cloud-folder file changes. Local service remains at http://127.0.0.1:5173.
- Mock endpoint stopped; dummy key removed and settings reset to empty provider/model. Controlled-mock records remain explicitly named and labelled for traceability.
