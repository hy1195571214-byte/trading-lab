# Trading Lab research-v1：证据、设计与限制

核对日期 2026-11-10。公开资料使用用户明确允许的 OpenAI 搜索连接器；下述作者、题名和出版状态以打开的论文、作者页面或出版方元数据为准。这里的映射是工程设计推论，不是论文作者对本项目的验证。论文报告的收益不构成本项目的收益证据。

| 来源与性质 | 文献能支持什么 | 在本项目的决定／反证 |
|---|---|---|
| Yijia Xiao, Edward Sun, Di Luo, Wei Wang, **TradingAgents: Multi-Agents LLM Financial Trading Framework**, 2024 arXiv preprint, [10.48550/arXiv.2412.20138](https://doi.org/10.48550/arXiv.2412.20138); [作者项目](https://tradingagents-ai.github.io/)。作者标注 AAAI 2025 Multi-Agent AI in the Real World workshop，非 AAAI 主会论文。 | 分析、研究、交易、风险角色的工作分解。 | 借鉴独立意见与单一协调输出；不声称已集成该仓库或复现它的收益。沿用现有专家和预算，不创建名人顾问。 |
| Wentao Zhang, Lingxuan Zhao, Haochong Xia 等, **A Multimodal Foundation Agent for Financial Trading: Tool-Augmented, Diversified, and Generalist**, KDD 2024, pp. 4314–4325, [10.1145/3637528.3671801](https://doi.org/10.1145/3637528.3671801), [作者论文 PDF](https://www3.ntu.edu.sg/home/boan/papers/KDD24_FinAgent.pdf)。同行评审会议。 | 金融任务整合多种信息与反思的架构参考。 | 采纳带时间条件的新闻、事件、申报、财务与价格摘要，分别披露缺失；当前没有图像模型或论文式记忆系统，不能称为 FinAgent。 |
| Yangyang Yu, Haohang Li, Zhi Chen, Yuechen Jiang 等, **FinMem: A Performance-Enhanced LLM Trading Agent with Layered Memory and Character Design**, [arXiv:2311.13743](https://arxiv.org/abs/2311.13743), 2023 preprint；[AAAI Spring Symposium 2024 摘要](https://ojs.aaai.org/index.php/AAAI-SS/article/view/31290)检索元数据可见，出版页直接打开受阻。 | 分层信息记忆值得研究。 | 拒绝当前引入自动经验长期记忆：无法充分排除事后信息、污染和过拟合；固定快照与审计先行。不能将研讨会版本当主会论文，亦不把其他年份版本视同本条。 |
| Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du, Izhak Shafran, Karthik Narasimhan, Yuan Cao, **ReAct: Synergizing Reasoning and Acting in Language Models**, ICLR 2023 camera-ready, [arXiv:2210.03629](https://arxiv.org/abs/2210.03629)。 | 外部信息与动作接口相结合。 | 采纳明确数据查询和固定输出工具；不开放模型任意联网或订单工具，也不宣称实现完整 ReAct 循环。 |
| Noah Shinn, Federico Cassano, Edward Berman, Ashwin Gopinath, Karthik Narasimhan, Shunyu Yao, **Reflexion: Language Agents with Verbal Reinforcement Learning**, NeurIPS 2023, [arXiv:2303.11366](https://arxiv.org/abs/2303.11366)。arXiv 作者表与部分会议索引作者列表有差异，这里列出已打开版本的作者。 | 可以根据反馈修改方案，不需模型权重更新。 | 仅在模型建议触发硬风控时允许一次有预算的反馈修订；这不是论文的 episodic-memory 算法。无效结构直接失败，手动重试保留审计和预算。 |
| Victor DeMiguel, Lorenzo Garlappi, Raman Uppal, **Optimal Versus Naive Diversification: How Inefficient is the 1/N Portfolio Strategy?**, Review of Financial Studies 22(5), 2009, 1915–1953, [10.1093/rfs/hhm075](https://doi.org/10.1093/rfs/hhm075)。出版方检索元数据可见，全文打开受限。 | 估计误差可能使优化方案难以稳定胜过简单基准。 | 保留现有明确标识的等权买入并持有基准；不将复杂 Agent 视为必然胜出。 |
| Victor DeMiguel, Lorenzo Garlappi, Francisco J. Nogales, Raman Uppal, **A Generalized Approach to Portfolio Optimization: Improving Performance by Constraining Portfolio Norms**, Management Science 55(5), 2009, 798–812, [10.1287/mnsc.1080.0986](https://doi.org/10.1287/mnsc.1080.0986)。 | 组合约束可能缓解估计误差。 | 可配置单一资产、总敞口、现金、板块和 L1 换手硬门槛；这是启发，不是原论文优化器，默认阈值不表示最优。 |
| Carlo Acerbi, Dirk Tasche, **On the coherence of expected shortfall**, Journal of Banking & Finance 26(7), 2002, 1487–1503, [10.1016/S0378-4266(02)00283-2](https://doi.org/10.1016/S0378-4266(02)00283-2)。出版方检索摘要可见，正文打开 403。 | 明确定义的 ES 用于描述尾部损失。 | 用可见且对齐的过去收益估算经验 95% ES，对边界观察值分数加权，使尾部概率质量恰好为 5%。至少 20 个收益、最多 60 个；此短样本不年化、不含交易成本，预测能力需另行验证。 |
| David H. Bailey, Jonathan M. Borwein, Marcos López de Prado, Qiji Jim Zhu, **The Probability of Backtest Overfitting**, Journal of Computational Finance 20(4), 2017, 39–69, [10.21314/JCF.2016.322](https://doi.org/10.21314/JCF.2016.322), [出版方摘要](https://www.risk.net/journal-of-computational-finance/2471206/the-probability-of-backtest-overfitting)。 | 多次选择策略增加过拟合风险，提出 CSCV/PBO。 | 不把迭代跑出来的最佳收益作为未见样本；须另留最终检验和尝试清单。未实现 CSCV/PBO。 |
| NIST, **Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile**, NIST AI 600-1, 2024, [NIST 出版记录](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)。政府框架，不是交易表现研究。 | 生成式 AI 风险治理及可追踪性。 | 记录证据包版本、预算、原始模型调用、失败、决策和人工审核；不声称因此符合完整框架。 |
| OWASP, **LLM01:2025 Prompt Injection**, [官方项目](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)。安全实践指南，非同行评审盈利研究。 | 外部文档可携带间接指令，检索本身不能根除注入。 | 信息标为不可信、只允许预定义建议/意见工具、检查结构及证据 ID、硬约束由代码执行；这些降低攻击面，不能保证模型不受注入影响。 |

## 版本与运行约束

API 创建时默认 legacy-v1，以保护旧客户端；网站的新 Agent 创建向导应显式选择 research-v1。已有实验配置不迁移。research-v1 固定数据库内容哈希、证据版本、时间规则、硬风控和最多一次修改；没有证据包仍允许以可见行情运行，但明确标注新闻、申报及基本面不可用。提供 JSONL 流式上传，原始字节 SHA-256 标识包，逐行校验和索引；JSON 小包按规范化 JSON 哈希。无编辑或删除端点。每次只读取可用时间不晚于决策边界的数据，且每个资产／类别先选最新一个，最多 20 条（新闻、财务、申报、事件、指标的固定优先顺序；全市场条目使用余量）；记录每标的和类别可用数、入上下文数与截断，数量不等于内容质量或完整覆盖。模型只可引用进入当次上下文的 ID；不存在的引用导致失败。历史记录保存在索引，不以 20 条上限丢弃。

日线以美国纽约时间该 bar 日 16:00 为研究决策时点，包括提前收盘日；日线 close 被假设该时已知。日内按精确决策开始时刻。原有引擎负责人工审核及模拟执行。历史日线按下一交易日开盘，历史日内按下一有效 bar 开盘；实时模拟沿用 `next_observed_close`，在决策完成且审核通过后，按下一条符合条件的已观察 bar 收盘模拟成交。日线时间取决于输入数据的真实约定，不能把供应商日线标签当作精确可用证明。特定数据集的日期新闻采用日期后第二日 00:00 UTC 的假设规则；SEC 使用接收时间加一小时作为假设，均非已经证明的精确历史公开时刻。完整规则、修订与覆盖限制见 `docs/DATA_RESEARCH_3Y.md`。Yahoo 股价的复权与拆股处理必须核对，不应重复应用拆股；筛选后存活的股票池、历史内容修订、模型预训练知识仍有偏差或泄漏。

证据索引使用固定六位小数的 UTC 时间，使 SQL 字符串比较与真实时间顺序一致。启动时幂等迁移旧版整秒派生索引；证据原文、包 SHA-256 和记录内容校验值保持原记录。半秒截止边界会同时校验候选选择和覆盖数量。

经验 ES 的损失定义为固定目标权重组合收益的相反数。将 n 个损失从大到小排列，令 m=n/20、k=floor(m)，将最大的 k 个损失加上第 k+1 个损失的 m-k 倍，再除以 m。21 个观察值使用最大损失与第二大损失的 0.05 倍，除以 1.05；全为正收益时，损失与 ES 可以为负。收益取相邻共同可见价的变化，缺口和隔夜会跨不同实际时长，因此 per-bar 不能解释为固定时长。样本不足 20 个收益时不可用，只保留最近最多 60 个，不年化。

量化风控以目标权重核查，不是保证未来成交后的权重、现金或尾部损失；行情跳空、执行成本和滑点会改变结果。经验 ES 和波动是可见历史的描述性指标，并非条件风险预测或可靠置信区间。固定 -5%/-10% 同向冲击只是情景算术，不是概率预测。人工修改、批准会再次验证当前硬条件，但实际回放仍应在成交时检查现金和交易规则。没有合适板块映射且启用板块上限时阻止建议。持仓原样 hold 不强制清仓；先前持仓可因价格波动超过当前阈值。历史基准和评估需另行独立冻结；没有任何真实数据实盘、付费调用或盈利结论。

## 研究—实现—检验

- 点时证据：`research_harness.parse_pack`, `main._indexed_evidence`, `_research_decision`；`test_streamed_import_query_pit_and_atomic_duplicate`, `test_coverage_reports_symbol_and_kind_truncation`。
- 来源约束：`_expert_call` 限制工具、验证 citation ID；`test_research_mock_revision_and_tool_boundary`, `test_invalid_mock_citation_failure_is_audited`。
- ES/波动与情景：`portfolio_risk`, `risk_check`；`test_expected_shortfall_integrates_exact_five_percent_mass` 覆盖 20、21、39、40、60 个观察值、目标权重缩放、并列损失及负 ES，另由最短历史与硬门测试验证可用条件。
- 有预算修订：`_research_decision` 调用既有 `_expert_call` 预算，`test_research_mock_revision_and_tool_boundary` 模拟首次不达标、修订通过；生产模型是否遵守未知。
- 人工修改：`review` 再次进入 `risk_check`，`test_actual_decision_and_review_risk_audit`。
- 实际轨迹：`GET /api/experiments/{id}/harness` 返回真正执行的阶段、风险、覆盖和审核记录，不使用生成的假轨迹。隔离模拟验收不代表模型实际表现。

## 设计复核与变更记录

1. 初版只读全部证据、最多 50,000 条；对 118,318 条真实包不可扩展。改为 JSONL 流式校验导入与 SQL 点时索引，保存完整记录，仅模型上下文限长。
2. 初版以 UTC 日期零点为日线边界，虽保守却与当日收盘行情不一致。改为冻结纽约时间 16:00，提前收盘仍在 16:00 决策；日内维持精确时间。
3. 初版按类别截断会让十股组合的少数标的垄断上下文。改为按标的和类别选取，逐标的标明可用和进入上下文数量，以及总截断；仍是最近优先并有类型优先级，不声称语义相关性。
4. 初版将申报元数据算成基本面、仅要求模型写风险文字。现将财务事实与申报分开，增加可见历史的样本波动、经验 ES 与明确非预测性的冲击情景；样本不足报告不可用。
5. 初版只做风控拒绝。现允许模型针对独立、确定性失败反馈做一次修订，并对每次调用计入原有预算；结构错误、引用无效与预算不足直接终止并记录，不自动重试隐藏失败。
6. 最终复核修正经验 ES 原先向上取整扩大尾部的问题，按恰好 5% 的经验概率质量加权。独立 critique 由确定性风控代码产生，额外 LLM critique 尚未实现。新增索引半秒边界和旧索引迁移检查。每次建议阶段保存原建议副本，便于核查失败候选与修订。

## 分路径验收

| 路径 | 自动检查与证据 | 范围 |
|---|---|---|
| 历史日线 research-v1 | `test_research_daily_review_fills_next_session_open` 通过 API 创建、step、人工批准、再 step，检查成交日晚于决策日 | 合成价格与确定性模拟建议 |
| 历史日内 research-v1 | `test_research_intraday_review_preserves_next_eligible_open` 检查审核前无订单，批准后按下一有效开盘，源 bar 开始时间不早于决策和审核完成时间 | 合成分钟数据 |
| 实时模拟 research-v1 | `test_research_live_mock_enters_harness_with_only_eligible_price_history` 经真实 live/start 与 `_apply_live_bars` 入口，持久化合成事件；检查研究轨迹、风险仅接收可见 bar、审核前无订单、审核后下一观察收盘，以及未来持久化事件尚未被应用 | 模拟 collector 与确定性策略，没有连接交易服务 |
| 旧客户端 | `test_legacy_default_preserves_existing_path` 省略 harness 版本，确认 legacy-v1、原建议路径和空研究轨迹 | 现有 API 默认兼容 |
| 预算耗尽 | `test_revision_respects_budget_and_preserves_failed_trace` 检查修订请求后的调用上限、失败轨迹与零订单；`test_exhausted_dollar_budget_never_dispatches_or_creates_orders` 检查零余额禁止请求、零建议、零订单 | 模拟 LLM 响应与本地计费配置 |
| 点时输入 | `test_risk_uses_decision_visible_bars_only` 检查实际日线调用传入的历史；live 测试检查持久化未来事件未入风险；`test_inflight_intraday_cutoff_uses_original_start` 检查在途决策沿用开始时刻 | 时间边界回归 |
| 半秒索引 | `test_subsecond_evidence_cutoff_and_legacy_index_migration_preserve_source` 检查整秒、半秒前与半秒时的最新记录及可用数，确认原文和校验值不变 | 派生索引迁移回归 |

面板通过实验名显式选择后读取真实实验与研究轨迹，按 attempt_id 关联建议、模型调用和人工审核。显示已记录阶段、覆盖数、目标仓位及风险摘要，原始记录可展开。历史记录保留其当时保存的风险口径，旧记录不重算。模型内容与建议理由以原文标注。浏览器验收由主会话集成记录。

2026-11-10 本地回归结果为后端完整测试 116 passed，其中 harness 专项 23 passed。完整命令为 `PYTHONPATH=backend /private/tmp/deepseek-acceptance-venv/bin/python -m pytest backend/tests backend/app/engine_tests -q`。唯一警告来自现有 Starlette TestClient 与 httpx 的弃用提示。测试仅使用合成数据和模拟响应。文献表中的设计映射与这些本地验证分别记录，模型交易表现及人类监督价值仍需独立实验。
