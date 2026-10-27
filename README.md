# Trading Lab

AI-assisted quantitative trading research platform for **Can AI Trade Alone? An Empirical Evaluation of an AI-Assisted Quantitative Trading Platform and Human Oversight**.

The interface follows the approved Figma graphite/lime design with monochrome pixel expert badges. All execution is simulated. No real brokerage account or live order endpoint is included.

## Start locally

Requires Python 3.11+ and Node.js 22+. From this folder:

```sh
./scripts/setup.sh
./scripts/dev.sh
```

Open http://127.0.0.1:5173. API documentation: http://127.0.0.1:8000/docs. Ctrl+C stops both servers. The development launcher reads an optional `.env` and reloads backend source changes.

Dependencies are cached inside `work/`, without changing system settings. If installation cannot connect because an inherited proxy is stopped, restore that proxy or run the setup command with its proxy environment variables removed for that command only. Do not commit `.env`, SQLite files or private keys.

## First workflow

1. Use Data hub to import CSV history, or select the explicitly labelled synthetic demo dataset.
2. Create an experiment: dataset/date range → expert team → costs, position limits and oversight.
3. Start with a deterministic baseline or explicit demo mode to exercise the system without paid model access.
4. Advance the replay. Human-review mode pauses for approval, modification or rejection; approved orders wait until an eligible later open.
5. Inspect holdings, orders, activity and reports. Compare compatible experiments and export records.

## LLM connection

The provider/model are deliberately configurable. In Settings, supply a compatible chat-completions base URL, model, write-only API key and token prices, then test the connection. An API key may also be provided as `TRADING_LAB_API_KEY`. The endpoint is expected to support function/tool calls.

An Agent experiment obtains independent expert opinions and a final coordinated target portfolio. Only the execution engine changes the ledger. Failed/invalid model responses pause the run and retain the current snapshot for retry; the app never silently substitutes a demo result. Call and dollar budgets are configured explicitly. No live paid-provider validation has been claimed; controlled local compatible-endpoint tests verify the integration.

## Data & evaluation limits

- CSV columns: `date,symbol,open,high,low,close,volume`; ISO dates and positive finite prices. Imports create immutable records with checksums.
- Use consistently adjusted OHLC prices when testing split/dividend-adjusted returns. There is no separate corporate-action cash ledger; document the dataset's adjustment convention and avoid double-counting distributions.
- Execution permits fractional shares, uses adverse configured slippage and fees, and does not model market impact, volume limits, interest or borrowing. Missing quotes do not create fills; stale marks are dated and labelled.
- Metrics use close-to-close daily equity returns, 252 sessions/year and zero risk-free rate. Sharpe is unavailable when volatility cannot be estimated.
- An LLM may already know historical outcomes. A time-filtered input does not eliminate that prior-knowledge limitation. Historical comparisons do not prove future performance or a causal oversight benefit when configurations differ.

## Project references

- Product constraints: `outputs/PROJECT_CONSTRAINTS.md`
- UI and interaction contract: `outputs/UI_FUNCTIONAL_SPEC.md`
- Implementation/API contract: `docs/IMPLEMENTATION_CONTRACT.md`
- Verification ledger: `docs/ACCEPTANCE.md`
- Backend details and tests: `backend/README.md`

Run backend and engine checks with `.venv/bin/python -m pytest backend/tests backend/app/engine_tests -q`; build the frontend with `npm --prefix frontend run build`.
