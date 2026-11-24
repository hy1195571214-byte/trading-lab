# 四模式接入合同

**2026-11-23 状态更新：本合同保留已有四模式实现及历史实验的兼容语义。用户现已确认交易风格唯一通过主交易 LLM 的系统提示词生效，详见 `outputs/PROJECT_CONSTRAINTS.md` 第 13 节与 `docs/IMPLEMENTATION_CONTRACT.md` 的最新规则。下文的来源加权、阈值和调权机制不得叠加到该风格路径；代码迁移尚未实施。**

2026-11-10。本轮用户要求补齐四模式的全部接入，使用子 agent 实施，主 agent 整合验收。仅本地，使用合成行情和模拟模型响应验证。十股真实研究数据保持收集状态。

## 配置与兼容

新实验增加 `lab_mode`，值为 `quant_baseline`、`market_agent`、`multisource_agent`、`human_supervised`。旧实验省略或为 null 时沿用已有路径。新模式固定 `workflow_version=score-fusion-v1` 并使用 `research-v1` 证据和风险机制。量化模式沿用统一执行与审计。

- `quant_strategy` 为 `bt_sma50` 或 `bt_buy_hold`。默认 `bt_sma50`，SMA 窗口 50 个有效收盘观察。
- `fusion_weights` 使用小数，键为 `market`、`news`、`fundamentals`，有限且非负，每项不大于 1，总和为 1。行情组固定 1/0/0。多源与人机组默认 0.5/0.3/0.2。
- `score_policy` 包含 `entry_threshold=0.25`、`exit_threshold=-0.25`、`horizon_bars=5`，阈值在 [-1,1] 内且 exit 小于 entry，horizon 为正整数。规则版本为 `threshold-equal-weight-v1`。这些是本轮工程初始值，界面可配置，研究评估前须冻结。
- 第一组采用确定性开源策略。第二、三组自动执行，第四组逐笔审核。创建时由模板明确设置策略与监督规则，冲突输入拒绝或明确规范化后展示。
- 正式 AI-only 模式创建后权重冻结。交互调权入口属于第四组，原组可通过已有分支创建第四组实验。

## 独立分析与融合

行情、新闻、财务使用独立上下文。行情只得到可见价格和确定性指标，新闻只得到其可用新闻/事件，财务只得到其可用财务事实/申报。共享标的、as-of 与 horizon。各模块看不到其他模块的评分和结论。

每个标的保存模块、状态、方向评分、依据、风险、引用和不确定性。方向评分为 [-1,1] 的证据方向强度，缺失为 null 并有明确原因。普通来源的新闻和财务评分由真实 LLM 结构化调用产生。演示模式明确标识确定性模拟，新闻与财务的数值只能来自明确合成 fixture 的 demo_score 字段，普通证据无该字段时按不可用处理。

LLM 分析调用复用已有计费、预算、检查点和失败审计。每个模块只允许其已供给证据的引用，输出严格验证。失败保留已发生的调用和分析记录，暂停，不产生伪造订单。

每个标的的正权重模块均有有效评分才参与融合。缺失不静默重分权重，对该标的保留原持仓并披露覆盖不足。综合分为用户权重乘模块分数之和。

综合分达到 entry 的标的进入候选，低于或等于 exit 的已有持仓退出，中间区间和不可用标的保留原仓位。对入选标的在扣除保留仓位后的可用风险预算内等权，并受单股上限约束，余量留现金。风险校验失败时按既有暂停和审计机制处理。保存完整目标和具体规则版本。

## 调权接口与时序

`POST /api/experiments/{id}/weights` 接收 `{weights, reason}`，仅人机模式接受，reason 为非空说明。与 step/run/review 共用实验锁，单次只保留一个待生效请求，重复请求不能覆盖尚未生效的请求。

权重以独立版本历史保存，初始配置保持原值。新请求从下一次新决策开始时生效，在途或待审核建议沿用原权重。记录提出者、本机单用户身份、提出时刻、模拟请求时刻、生效时刻、前后权重和版本。逐笔审核与调权单独计数与导出。

`GET /api/experiments/{id}/analysis` 返回 `{lab_mode, workflow_version, active_weights, pending_weights, weight_history, analysis_runs, intervention_summary}`。analysis_runs 按尝试与决策关联，包含 as_of、模块输出、分标的融合、使用的权重版本、最终目标、失败及成本引用。具体稳定字段由后端 agent 尽早反馈并与前端对齐。

分析记录使用模拟时钟的 `as_of`、`started_at`、`completed_at`、`available_at`，另以 `wall_started_at` 和 `wall_completed_at` 保存实际运行时间。历史界面按 `available_at` 截断。各角色独立上下文采用顺序调用，共用预算和检查点。

`intervention_summary` 的 `weight_changes` 表示已接受请求总数，`weight_changes_effective` 为已生效次数，`weight_changes_pending` 为待生效数，`trade_reviews` 为已审核决定数。JSON 和 CSV 导出均保留这些口径。

中性或缺失来源标的以 `preserve_symbols` 保留实际股数。执行时按当时价格为保留仓位预留资金，再处理其他目标，风险检查计入全部保留持仓。人工修改提交完整目标，并解除该次建议的数量保留约束，原始 AI 建议继续保存在审计中。

新量化模块复用固定 bt 提交中的选股、等权和首轮组件，来源与 MIT 许可保存在 `backend/app/vendor/`。Lab 负责成交和账本。50 根有效完整观察的计数和上游共享行窗口在缺失数据下有差异，具体适配说明见 vendor README。

## 交付与所有权

- 后端 agent 拥有 main.py、score_fusion.py、必要后端 API/集成测试及对接口的实现说明。保持旧 API 和实验兼容，日线、日内历史与实时模拟均走真实新路径。
- 开源策略 agent 拥有 quant_baselines.py、必要上游保留文件和许可证、独立策略测试、依赖声明协调。不得直接改 main.py。提供纯目标接口给后端。
- 前端 agent 拥有前端源码，完成四模板创建、独立分析和贡献展示、调权及审核入口、双类干预统计，中英文与滚动布局。
- 主 agent 拥有本合同和根文档、协调、代码审阅、集成验收。测试后保留隔离本地预览。
