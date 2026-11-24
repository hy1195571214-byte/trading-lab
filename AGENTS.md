# Trading Lab development

Read `outputs/PROJECT_CONSTRAINTS.md`, `outputs/UI_FUNCTIONAL_SPEC.md`, and `docs/IMPLEMENTATION_CONTRACT.md` before changes.

- Trading-style decision rule (user confirmed 2026-11-23): express a simulated trader's style only through the main trading LLM's system prompt. Keep analysts on a shared evidence protocol; do not also apply style-specific source/factor weights, weighted-score thresholds, or a second style controller before or after that decision. Programmatic cash, position, exposure, turnover and execution checks remain mandatory. Preserve historical weighted experiments and deterministic baselines as separate, explicitly labelled paths. See `outputs/PROJECT_CONSTRAINTS.md` §13; this rule supersedes earlier style/fusion design guidance. Documentation records the decision; runtime migration still requires implementation and verification.
- Final visual direction: near-black/graphite, lime accent, monochrome pixel employee badges. Palette explorations are reference only.
- Local-first delivery (user confirmed 2026-11-09): make changes, debug, and verify locally by default. Do not push to remote repositories, upload artifacts, or deploy/update public hosting unless the user explicitly requests uploading or deployment. Earlier deployment authorization does not carry forward to new changes. Keep changes local for review and batch publication when requested.
- User assigns all sub-agent work to GPT-6.1 Sol with extra-high reasoning (model `gpt-6.1-sol`, reasoning effort `xhigh`, latest confirmation 2026-11-10). This supersedes the earlier Luna and Terra assignments, including complex trading logic. The primary agent coordinates delegation, integration, and acceptance. Use built-in collaboration; do not install another orchestration system.
- No live brokerage orders. No fabricated LLM results. Clearly label synthetic demo data and deterministic demo strategies.
- Never expose secrets in logs, API responses, reports, or frontend bundles.
- Preserve point-in-time boundaries, next-session execution, review audit history, immutable configurations, and experiment isolation.
- Public web research: only callable GPT/OpenAI native search; no MCP/browser fallback without explicit user exception.
- When operating a supported desktop app, first read `/Users/wangyichen/.codex/skills/flue/SKILL.md`.
