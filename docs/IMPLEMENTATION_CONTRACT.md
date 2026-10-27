# Implementation contract / v1

## Scope and source

Implement the full functional scope in `outputs/PROJECT_CONSTRAINTS.md` and `outputs/UI_FUNCTIONAL_SPEC.md`. Figma file BsofDaCgRV8EEuRR5r2z0m, final main frame 4:1457. Approved native exports `outputs/figma-*.png` are visual targets; `work/figma-local/code.js` contains the editable design source and exact pixel portrait maps. Never render a full UI screenshot as an app asset. Official Figma access was exhausted during design; native source and verified exports remain available.

## Stack / ownership

- `frontend/`: React + TypeScript + Vite, maintained by frontend agent (Luna high).
- `backend/app/engine.py`, `backend/app/engine_tests/`: pure trading runtime, owned by logic agent (Luna max).
- Other `backend/` files: FastAPI, SQLite persistence, LLM adapter, data import, API, backend integration tests, owned by backend agent (Luna high).
- Parent owns root scripts, documentation, integration review and browser acceptance. Do not edit another owner's files without coordination.
- Local-first single-user research workspace. SQLite is a reversible startup choice; avoid external DB prerequisites. Persist business state and datasets. No real brokerage integration.

## JSON API / prefix /api

Use standard JSON responses. Errors: HTTP 4xx/5xx with `{detail: string}`. Frontend must display errors and loading states. IDs are strings. Collection GET endpoints return arrays. Coordinates and prices finite. Dates ISO YYYY-MM-DD.

- GET `/health`.
- GET `/datasets`; POST `/datasets/import` multipart file + optional name/adjustment_policy. Validate CSV OHLCV, date, symbol, price ranges, duplicates, coverage; immutable dataset ID + checksum. Support a clearly synthetic seeded dataset for offline demonstration. GET `/datasets/{id}` summary, never leak future bars via experiment snapshots.
- GET `/experts`; POST `/experts`; GET `/experts/{id}`. Expert fields: id, name, version, strategy, description, objective, horizon, required_data, instructions, risk_notes, role. Seed Momentum, Value, Risk; Value requires fundamentals and must be blocked for a price-only dataset, or explicit supported price-only variant with clear limitations. No invented financials.
- GET/PUT `/settings`: base_url, model, api_key (write only, returned as api_key_configured bool), max_calls, budget_usd, input_cost_per_million, output_cost_per_million. Secrets from env or local secret file with restricted permissions, never reports. POST `/settings/test` real minimal compatible-chat request. Use configurable provider-neutral OpenAI-compatible HTTP chat completions. Deterministic demo mode must be explicit and not billed as an LLM.
- GET/POST `/experiments`; POST body `{name,dataset_id,start_date,end_date,initial_capital,fee_bps,slippage_bps,max_position_weight,mode,strategy,team,provider_mode,max_calls,budget_usd}`. mode `ai_only|human_review`; strategy `agent|buy_hold|momentum`; provider_mode `llm|demo`. team array `{expert_id,role,enabled}`. Freeze config, dataset version, expert snapshots, model and prompt versions.
- GET `/experiments/{id}` returns `{id,name,status,config,state,metrics,history,decisions,orders,events,holdings,expert_opinions,llm_usage}`. GET collection returns summary objects including id,name,status,mode,current_date,total_return,dataset_id.
- POST `/experiments/{id}/step` advances one market session, fills prior approved/queued orders at eligible open, then makes current close decision using visible history only. Awaiting review blocks advancement. First day cannot fill today's close signal. Return experiment detail.
- POST `/experiments/{id}/run` starts bounded background replay; POST `/pause` pauses further decisions. Thread-safe persistence and task ownership; no concurrent step/run/review double fills. Return detail. Failure pauses with auditable error, no fallback fabricated proposal.
- POST `/experiments/{id}/review` `{decision_id,action:approve|modify|reject,reason,targets?}`; modify/reject require nonblank reason. Original proposal immutable, engine validates changed targets. Approved orders queue, not fill immediately.
- POST `/experiments/{id}/team` `{team,pending_policy:keep|discard}` schedules activation at next decision boundary and audits it. Explicitly discard pending unexecuted proposal if requested. POST `/experiments/{id}/branch` accepts changed configuration, creates new experiment, preserves original.
- GET `/reviews` pending decisions across runs; GET `/activity` audit events.
- GET `/experiments/{id}/export?format=json|csv` download safe audit/report records; GET `/compare?ids=id1,id2` metrics + compatibility differences. Do not attribute differences to oversight when expert/data/cost settings differ.

## Runtime contract (engine agent coordinates exact signatures with backend)

Pure standard-library module, dictionaries JSON-serializable, no FastAPI/persistence/network dependencies. Canonical dataset: list of bars `{date,symbol,open,high,low,close,volume}`. Full desired target weights mapping: omitted held assets target zero; empty mapping means cash-only allocation (explicitly documented). HOLD proposal must preserve current allocations or skip rebalance explicitly.

Functions: `create_state(config,bars)`, `advance_market(state,bars)`, `visible_snapshot(state,bars)`, `record_decision(state,proposal)`, `review_decision(state,decision_id,action,reason='',targets=None)`, `schedule_team(state,team,pending_policy='keep')`, `performance_metrics(state)`, `baseline_proposal(state,snapshot,strategy)`. Mutation model and exception class documented by engine agent immediately. Config includes `symbols`, date range, capital, costs, position limit, mode. States must include date/cursor, cash, positions, equity/history, decisions/orders/events/status. Backend orchestrates async LLM call after market advance; must commit failure/attempt records without corrupting state.

## Mandatory acceptance

Meaningful tests for future-data exclusion, next-open fills, fees/slippage, cash/position limits, missing bars, final-session orders, idempotent reviews, original-AI preservation, scheduled expert changes, experiment isolation, metrics, invalid LLM output and secret exclusion. Frontend production build + real browser workflows: import data, create experiment, run/step, review all three actions, experts, settings failure/success state, reports/export, navigation and scrolling. Do not claim live LLM validation without actual credentials and response evidence.
