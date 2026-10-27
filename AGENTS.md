# Trading Lab development

Read `outputs/PROJECT_CONSTRAINTS.md`, `outputs/UI_FUNCTIONAL_SPEC.md`, and `docs/IMPLEMENTATION_CONTRACT.md` before changes.

- Final visual direction: near-black/graphite, lime accent, monochrome pixel employee badges. Palette explorations are reference only.
- User assigns main implementation and testing to GPT-6 Luna high; complex trading logic to GPT-6 Luna max; primary agent reviews, integrates, and verifies. Use built-in collaboration; do not install another orchestration system.
- No live brokerage orders. No fabricated LLM results. Clearly label synthetic demo data and deterministic demo strategies.
- Never expose secrets in logs, API responses, reports, or frontend bundles.
- Preserve point-in-time boundaries, next-session execution, review audit history, immutable configurations, and experiment isolation.
- Public web research: only callable GPT/OpenAI native search; no MCP/browser fallback without explicit user exception.
- When operating a supported desktop app, first read `/Users/wangyichen/.codex/skills/flue/SKILL.md`.
