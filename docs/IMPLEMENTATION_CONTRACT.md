# Implementation contract / v1

## Scope and source

Implement the full functional scope in `outputs/PROJECT_CONSTRAINTS.md` and `outputs/UI_FUNCTIONAL_SPEC.md`. Figma file BsofDaCgRV8EEuRR5r2z0m, final main frame 4:1457. Approved native exports `outputs/figma-*.png` are visual targets; `work/figma-local/code.js` contains the editable design source and exact pixel portrait maps. Never render a full UI screenshot as an app asset. Official Figma access was exhausted during design; native source and verified exports remain available.

## Authoritative trading-style rule (user confirmed 2026-11-23)

`outputs/PROJECT_CONSTRAINTS.md` §13 supersedes earlier style/fusion guidance in this contract. This is a confirmed requirement; runtime migration is not yet implemented or verified.

- Use one style-control point: shared analyst evidence → main trading LLM conditioned by the card in its actual **system message** → deterministic risk checks → optional human review → simulated execution.
- Compile card objectives, evidence preferences, action/wait/exit principles and uncertainty handling into that system message. Display-only metadata or a style card supplied only in a user message does not satisfy this requirement.
- Analysts retain the same evidence protocol across styles. Do not add style-specific source/factor weights, weighted-score trading thresholds, or another directional/style transformation before or after the main LLM decision. Target portfolio weights produced by the LLM remain valid outputs.
- The final proposal-producing LLM must be the sole style-conditioned decision point. If reusing the existing coordinator as that point, do not also inject style into an upstream trader; do not let a separate unconditioned coordinator freely rewrite a style-conditioned decision.
- Preserve programmatic cash, position, exposure, concentration, turnover, data-availability and execution checks. Use the same limits across style comparisons. Any budgeted risk-revision call retains the same trading role and system-prompt version. Human changes remain separately audited.
- Freeze and audit the effective card version, full effective system-prompt snapshot and version/hash, model, point-in-time inputs and raw output. Activate card changes only at the next new decision boundary.
- Retain immutable historical weighted experiments and explicitly separate deterministic baselines. Never silently fall back to either when an LLM call fails. Existing fusion APIs below describe the historical path, not the new style mechanism.
- Acceptance for a future implementation must inspect the dispatched system messages, verify analyst inputs/prompts stay independent of style, exclude stacked style weighting, and preserve hard-risk enforcement and experiment isolation. This documentation change alone does not satisfy runtime acceptance.

## Stack / ownership

- All sub-agents use GPT-6.1 Sol with extra-high reasoning (`gpt-6.1-sol`, `xhigh`), per the user's latest 2026-11-10 instruction; this supersedes prior Luna and Terra assignments.
- `frontend/`: React + TypeScript + Vite, maintained by the frontend agent.
- `backend/app/engine.py`, `backend/app/engine_tests/`: pure trading runtime, owned by the logic agent.
- Other `backend/` files: FastAPI, SQLite persistence, LLM adapter, data import, API, backend integration tests, owned by the backend agent.
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


## Research workflow and UI extension (2026-11-10)

- New experiment configuration accepts `harness_version`, `evidence_pack_id`, and `harness_risk`. API default remains `legacy-v1`; the website explicitly chooses `research-v1` for its new workflow. Existing experiment configurations and saved results are retained.
- `harness_risk` uses fractional weights: `min_cash_weight` (default 0), `max_gross_weight` (default 1), `max_turnover` (L1, default 2), `max_sector_weight` (default 1), and optional `sectors`. The wizard exposes the first three as percentages; sector mapping remains available through the API.
- Evidence packs are immutable. JSONL upload keeps the complete indexed history; model context is bounded and reports selected/eligible coverage. Fixed-precision UTC indexes are derived from source timestamps without changing original record hashes.
- The research workflow joins evidence, structured proposals/citations, deterministic risk checks, at most one budgeted revision, and the existing human review/execution path. Historical execution uses next eligible open; live simulation preserves its existing next observed close rule. No live brokerage orders.
- See `docs/research/harness/RESEARCH_AND_IMPLEMENTATION.md` for literature, statistical definitions, tests and limits. Historical ES is descriptive, not a calibrated risk forecast.
- UI language uses explicit catalogs and preserves user/model/source content. Long collections use actual-overflow-aware `ScrollRegion`; see `docs/I18N_ACCEPTANCE.md` and `docs/SCROLL_LISTS_ACCEPTANCE.md` for acceptance coverage.

## Four-mode integration (2026-11-10)

Historical implementation / compatibility contract. For the newly confirmed style-LLM path, the authoritative 2026-11-23 rule above takes precedence; do not combine this section's fusion mechanism with style prompting.

New experiment templates use `lab_mode`, `quant_strategy`, `fusion_weights` and `score_policy`. `GET /api/harness` declares available templates and defaults. Existing configurations with no lab_mode retain their original execution path. See `FOUR_MODE_CONTRACT.md` for stable fields, initial parameters, analyst isolation, allocation and execution rules.

`GET /api/experiments/{id}/analysis` exposes actual analysis records and intervention summaries. `POST /api/experiments/{id}/weights` accepts a reasoned change for the human-supervised template, applies it at the next new decision, and preserves the immutable initial configuration and historical suggestions. JSON and CSV exports include both intervention classes.

The new analyst protocol preserves structured outputs, input snapshots, time cutoffs, source-specific citations and prompt versions while using the existing budget and checkpoint mechanism. Programmatic fusion produces a single proposal. Preserved symbols retain quantities through execution, and human modifications supply complete desired targets.

Open-source quant components and their license are retained under `backend/app/vendor/`. The Lab executor handles orders and accounting. `FOUR_MODE_ACCEPTANCE.md` records synthetic and mocked-provider validation separately from real-provider and real-feed verification.
