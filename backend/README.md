# Trading Lab backend

Local FastAPI + SQLite API. No brokerage connection or live order route exists. Default data is clearly synthetic; baseline demo mode is deterministic and is not an LLM result.

## Run locally

From the repository root, install `backend/requirements.txt`, then run:

```sh
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

The API is at `http://127.0.0.1:8000/api`; interactive docs are at `/docs`. SQLite defaults to `backend/trading_lab.sqlite3`; set `TRADING_LAB_DB` to choose another path. The first launch seeds synthetic OHLCV and Momentum, Value, and Risk expert cards.

For daily development, use `./scripts/dev.sh` from the project root. It starts both services with the migrated database at `~/Library/Application Support/Trading Lab/trading_lab.sqlite3` and selects local secret files in the same directory. The launcher clears inherited cloud database and gateway configuration. The direct Uvicorn command above continues to use the backend's environment-driven paths.

## LLM configuration

Configure `base_url` and `model` using `PUT /api/settings`. Submit `api_key` to that endpoint to store it in the ignored project-local `backend/data/secrets.json` file with mode 0600, or set `TRADING_LAB_API_KEY` in the backend process environment. GET settings never returns the credential. `POST /api/settings/test` sends a real minimal chat completion. For an experiment, choose `provider_mode: "llm"`; it uses the OpenAI-compatible `/chat/completions` endpoint, requests structured tool calls for each expert and a coordinator, then validates one final proposal. Invalid output, endpoint failures, max-call exhaustion, and estimated-budget exhaustion pause the run and remain visible. It never switches to demo mode.

Per-experiment call/budget caps and provider settings are frozen at creation. Costs use the configured per-million-token rates and provider usage values when returned. If rates are left unknown, cost is recorded as unknown and the dollar cap cannot be estimated; the call cap remains active. Live provider access is not preconfigured or verified by this project.

## Data and safety

CSV import requires `date,symbol,open,high,low,close,volume`. Imports are immutable records with SHA-256 checksum and declared adjustment policy (`as_provided` by default). Historical bars are only presented through the current replay date. Data adjustment, survivorship bias, and the possibility of model prior knowledge of historical outcomes remain research limitations. APIs only support backtests and simulated fills.
