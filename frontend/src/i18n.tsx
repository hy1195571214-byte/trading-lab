import React, { createContext, useContext, useEffect, useState } from "react";
export type Locale = "en" | "zh-CN";
type Params = Record<string, string | number>;
const catalog: Record<string, [string, string]> = {
  "expert.researchStatus": ["For review only. Trading is not enabled yet.", "目前仅供查看和研究，暂不能加入交易。"],
  "expert.decisionPrinciples": ["How this style approaches a decision", "如何作出交易判断"],
  "expert.principlesIntro": ["These principles summarize the retained public material. Their trading performance has not been tested.", "以下原则根据已收集的公开资料整理，还没有验证交易效果。"],
  "expert.systemPrompt": ["View the proposed LLM system prompt", "查看拟用的 LLM 系统提示词"],
  "expert.promptStatus": ["This is a proposed prompt. It has not been connected to trading or sent to a model.", "这是整理后的提示词草稿，尚未接入交易，也未发送给模型。"],
  "expert.sourcesAndLimits": ["Sources, supporting evidence and limits", "查看来源、整理依据与资料缺口"],
  "expert.sourceSeparation": ["These records explain how the principles were derived. They are kept separately from the proposed prompt.", "这里保留原则的整理依据，供核对和引用，不混入给模型的指令。"],
  "expert.ruleProvenance": ["How the rules map to the evidence", "这些原则如何整理"],
  "expert.retainedPrinciples": ["Retained source findings", "从资料中提取的观点"],
  "expert.originalSources": ["Original sources", "原始来源"],
  "expert.remainingGaps": ["What is still missing", "还缺少哪些证据"],
  "expert.conditions": ["Conditions", "适用条件"],
  "expert.exceptions": ["Limits and exceptions", "限制与例外"],
  "expert.extractionStatus": ["Extraction review", "提取审查"],
  "expert.sourceCandidate": ["Eligible source material; use in this prompt is listed above", "可供归纳的候选材料；本版是否采用见上方整理依据"],
  "expert.sourceExcluded": ["Kept for research; excluded from the prompt", "仅保留研究记录，不编入提示词"],
  "expert.localLocator": ["See the local evidence archive for the location.", "具体位置见本地证据档案。"],
  "expert.dateUnknown": ["Publication date unverified", "发表时间待核"],
  "expert.rightsUnknown": ["Redistribution permission requires review", "再分发许可须另行审查"],
  "Reading workspace data…": ["Reading workspace data…", "正在读取工作区数据…"],
  "Unable to load the workspace. Check your connection and retry.": ["Unable to load the workspace. Check your connection and retry.", "暂时无法读取工作区，请检查网络后重试。"],
  "Data storage is temporarily unavailable. Please retry.": ["Data storage is temporarily unavailable. Please retry.", "数据服务暂时不可用，请稍后重试。"],
  "Saved experiment views are being prepared. Retry shortly.": ["Saved experiment views are being prepared. Retry shortly.", "实验结果正在准备，请稍后重试。"],
  "Saved experiment view is being prepared. Retry shortly.": ["Saved experiment view is being prepared. Retry shortly.", "实验结果正在准备，请稍后重试。"],
  "Benchmark calculation is pending; the portfolio history is current.": ["Benchmark calculation is pending; the portfolio history is current.", "基准曲线尚待计算，投资组合历史已更新。"],
  "activity.kind.replay_completed": ["Replay completed", "回放完成"],
  "activity.summary.replay_completed": ["Replay reached its last recorded time point.", "历史回放已到最后一个时间点。"],
  "activity.kind.final_session_order_pending": ["Unfilled order at end", "回放结束时仍有订单"],
  "activity.summary.final_session_order_pending": ["Some orders remain unfilled because the replay data has ended.", "数据范围已结束，仍有订单没有成交。"],
  "activity.kind.final_session_orders_pending": ["Unfilled orders at end", "回放结束时仍有订单"],
  "activity.summary.final_session_orders_pending": ["Some orders remain unfilled because the replay data has ended.", "数据范围已结束，仍有订单没有成交。"],
  "activity.kind.order_waiting_for_bars": ["Waiting for prices", "等待行情"],
  "activity.summary.order_waiting_for_bars": ["The order is waiting for available price data.", "这笔订单正在等待可用行情。"],
  "activity.kind.order_unfilled": ["Order unfilled", "订单未成交"],
  "activity.summary.order_unfilled": ["This simulated order has not been filled.", "这笔模拟订单没有完成成交。"],
  "activity.kind.missing_market_bars": ["Missing prices", "行情缺失"],
  "activity.summary.missing_market_bars": ["Price data is missing at this time point.", "这个时间点缺少可用行情。"],
  "activity.kind.team_activated": ["Team activated", "团队已启用"],
  "activity.summary.team_activated": ["The new team settings have taken effect.", "新的团队设置已开始生效。"],
  "activity.kind.team_change_scheduled": ["Team change scheduled", "已安排团队调整"],
  "activity.summary.team_change_scheduled": ["New team settings will apply at the next trading decision.", "新的团队设置将在下次作出交易决定时生效。"],
  "activity.kind.team_change_replaced": ["Team change updated", "团队调整已更新"],
  "activity.summary.team_change_replaced": ["A pending team adjustment was updated.", "更新了还未生效的团队调整。"],
  "activity.kind.decision_modified": ["Proposal changed", "已修改建议"],
  "activity.summary.decision_modified": ["The original trade proposal was changed.", "修改了原有交易建议。"],
  "activity.kind.order_remainder_cancelled": ["Remaining order cancelled", "取消剩余订单"],
  "activity.summary.order_remainder_cancelled": ["The unfilled part of the order was cancelled.", "取消了这笔订单尚未成交的部分。"],
  "activity.kind.position_limit_unenforceable_missing_bar": ["Position check blocked", "仓位检查受阻"],
  "activity.summary.position_limit_unenforceable_missing_bar": ["Missing prices prevent a complete check of the position limit.", "缺少股票价格，暂时无法完整检查仓位上限。"],
  "activity.kind.preserved_position_limit_exceeded": ["Position exceeds limit", "持仓超出上限"],
  "activity.summary.preserved_position_limit_exceeded": ["An existing holding exceeds its configured position limit. Open details to review it.", "已有持仓超过了设定的仓位上限，请查看详情。"],
  "data.unavailable": ["Dataset unavailable", "数据集不可用"],
  "data.synthetic": ["Generated demo prices", "虚拟价格"],
  "data.apple": ["Apple AAPL", "苹果 AAPL"],
  "data.stocks": ["{count} stocks", "{count} 只股票"],
  "data.daily": ["Daily", "日线"],
  "data.minute": ["1-minute bars", "1 分钟线"],
  "data.hourly": ["Hourly", "小时线"],
  "data.requirement.price": ["Market prices", "行情"],
  "data.requirement.news": ["News", "新闻"],
  "data.requirement.fundamentals": ["Financials", "财务"],
  "data.missing": ["This dataset does not provide: {data}.", "当前数据集缺少：{data}。"],
  "data.unconnected": ["Not integrated: {data}. This requirement cannot currently be met.", "尚未接入：{data}，当前无法满足这项需求。"],
  "data.unconnected.macro": ["macroeconomic indicators (such as rates and inflation)", "宏观指标（利率、通胀等）"],
  "data.disabled": ["Disabled", "已停用"],
  "data.inventory": ["{count} datasets · {imports} import records", "{count} 类数据 · {imports} 条导入记录"],
  "data.copies": ["{count} imports of the same data", "同一数据导入了 {count} 份"],
  "data.details": ["Import details", "导入详情"],
  "data.imported": ["Imported prices", "导入行情"],
  "data.type": ["Data type", "数据类型"],
  "copy.demoHelp": ["Runs preset rules without calling an AI model.", "按预设规则运行，不使用 AI。"],
  "copy.ruleMode": ["Rule-based run", "规则运行"],
  "copy.aiHelp": ["Uses the configured AI model to analyse data and propose trades.", "由已配置的 AI 分析数据并提出交易建议。"],
  "copy.virtualHelp": ["These prices were generated for trying the app. They are not real market prices.", "这些价格由程序生成，供体验功能使用，不是真实市场行情。"],
  "copy.comparingTitle": ["Before comparing", "比较前先检查"],
  "copy.comparing": ["Use the same stocks, dates, starting cash and trading fees when comparing strategies. All trades use simulated money.", "这里使用模拟资金。比较不同策略时，请让股票、日期、起始资金和手续费保持一致。"],
  "copy.comparisonDifference": ["These runs use different settings or end dates. Their returns cannot tell us the effect of human review alone.", "这些实验的设置或结束日期不同，不能只看收益就判断人工审核有没有帮助。"],
  "copy.comparisonReady": ["The main run settings match. Read the results together with the experiment settings.", "主要运行条件已核对一致，请结合实验设置查看结果。"],
  "metric.sharpe": ["Return / volatility", "收益与波动比"],
  "metric.sharpeHelp": ["Higher means more past return for the same amount of return fluctuation (Sharpe ratio).", "把收益和起伏放在一起看：数字越高，表示在同样波动下获得的历史收益越多。"],
  "metric.calculation": ["How this number is calculated", "这个数字怎么算"],
  "metric.calculationDetail": ["The return-to-volatility score is the Sharpe ratio. It uses daily portfolio returns, 252 trading sessions per year, sample standard deviation and a risk-free rate of zero. The score is unavailable when there are too few returns or no measurable volatility.", "这个比值的正式名称是夏普比率。用每天的账户收益计算，按一年 252 个交易日换算，使用样本标准差，并假设无风险收益为 0。记录不足或没有可计算的波动时，显示“—”。"],
  "metric.volatility": ["Return swings (annualized)", "收益起伏（年化）"],
  "metric.volatilityHelp": ["Larger percentages mean larger return swings. Longer bars show larger swings within this comparison.", "百分比越大，收益的起伏越大；同一张比较表里，色条越长表示起伏越大。"],
  "chart.30PerScreen": ["30 per screen", "每屏 30 根"],
  "chart.60PerScreen": ["60 per screen", "每屏 60 根"],
  "chart.scrollRegion": ["Price chart; scroll sideways for earlier or later candles", "价格图表，可左右移动查看历史 K 线"],
  "chart.earlier": ["Earlier candles", "查看更早的 K 线"],
  "chart.later": ["Later candles", "查看更晚的 K 线"],
  "chart.pan": ["Move along candle history", "左右移动 K 线"],
  "chart.latest": ["Latest", "回到最新"],
  "activity.title": ["Recent actions", "最近操作"],
  "activity.page": ["Page {current} / {pages} · {count} records", "第 {current} / {pages} 页 · 共 {count} 条记录"],
  "activity.previous": ["Previous page", "上一页"],
  "activity.next": ["Next page", "下一页"],
  "activity.time": ["Time (Beijing)", "时间（北京时间）"],
  "activity.action": ["Action", "操作"],
  "activity.description": ["What happened", "发生了什么"],
  "activity.unnamed": ["Unnamed experiment", "未命名实验"],
  "activity.workspace": ["Workspace", "工作区"],
  "activity.details": ["View details", "查看详情"],
  "activity.raw": ["Original record", "原始记录"],
  "activity.recorded": ["An action was recorded.", "记录了一项操作。"],
  "activity.replayDate": ["Replay date", "回放日期"],
  "activity.symbol": ["Stock", "股票"],
  "activity.quantity": ["Quantity", "数量"],
  "activity.price": ["Price", "价格"],
  "activity.reason": ["Explanation", "说明"],
  "activity.error": ["The run encountered a problem:", "运行遇到问题："],
  "activity.review.approve": ["The trade proposal was approved.", "已同意这条交易建议。"],
  "activity.review.modify": ["The trade proposal was changed before approval.", "已修改这条交易建议。"],
  "activity.review.reject": ["The trade proposal was rejected.", "已拒绝这条交易建议。"],
  "activity.ruleDecision": ["Preset rules generated a trade proposal.", "按预设规则生成了一条交易建议。"],
  "activity.aiDecision": ["AI generated a trade proposal.", "AI 生成了一条交易建议。"],
  "activity.decision": ["A trade proposal was generated.", "生成了一条交易建议。"],
  "activity.imported": ["Imported {count} price records.", "导入了 {count} 条行情。"],
  "activity.summary.paused": ["The experiment was paused.", "已暂停运行实验。"],
  "activity.summary.resumed": ["The experiment continued from where it stopped.", "已从上次停止的位置继续运行。"],
  "activity.summary.run_started": ["The experiment started running.", "已开始运行实验。"],
  "activity.summary.experiment_created": ["A new experiment was created.", "创建了一个新实验。"],
  "activity.summary.experiment_branched": ["A separate experiment was created from an existing run.", "从已有实验创建了一个独立的新实验。"],
  "activity.summary.team_scheduled": ["Team changes will apply at the next trading decision.", "已更新团队，将在下次作出交易决定时生效。"],
  "activity.summary.settings_updated": ["Application settings were updated.", "更新了应用设置。"],
  "activity.summary.expert_created": ["A new expert card was created.", "创建了一张新的专家卡片。"],
  "activity.summary.recovered_after_restart": ["The service restarted. This experiment is paused and can be continued.", "服务重启后，实验已暂停，可以继续运行。"],
  "activity.errorSummary": ["The run encountered a problem. Open details to see the cause.", "运行遇到问题，请打开详情查看原因。"],
  "activity.otherAction": ["Other action", "其他操作"],
  "activity.kind.market_session_advanced": ["Replay advanced", "回放推进"],
  "activity.kind.decision_auto_approved": ["Automatically approved", "自动通过"],
  "activity.kind.decision_created": ["Proposal created", "生成建议"],
  "activity.kind.live_decision_created": ["Proposal created", "生成建议"],
  "activity.kind.decision_reviewed": ["Manual review", "人工审核"],
  "activity.kind.decision_awaiting_review": ["Waiting for review", "等待审核"],
  "activity.kind.decision_approved": ["Review approved", "审核通过"],
  "activity.kind.decision_rejected": ["Proposal rejected", "建议未通过"],
  "activity.kind.order_queued": ["Order queued", "等待成交"],
  "activity.kind.order_filled": ["Order filled", "订单成交"],
  "activity.kind.order_partially_filled": ["Partially filled", "部分成交"],
  "activity.kind.experiment_created": ["Experiment created", "新建实验"],
  "activity.kind.experiment_branched": ["Experiment copied", "创建独立实验"],
  "activity.kind.dataset_imported": ["Prices imported", "导入行情"],
  "activity.kind.market_dataset_imported": ["Prices imported", "导入行情"],
  "activity.kind.expert_created": ["Expert created", "新建专家"],
  "activity.kind.settings_updated": ["Settings updated", "修改设置"],
  "activity.kind.error": ["Run error", "运行出错"],
  "activity.kind.run_started": ["Run started", "开始运行"],
  "activity.kind.paused": ["Paused", "暂停运行"],
  "activity.kind.resumed": ["Resumed", "继续运行"],
  "activity.kind.team_scheduled": ["Team updated", "调整团队"],
  "activity.kind.recovered_after_restart": ["Service restarted", "服务重启"],
  "activity.summary.market_session_advanced": ["Replay moved to the next recorded time point.", "回放推进到了下一个已记录的时间点。"],
  "activity.summary.decision_auto_approved": ["The proposal was automatically approved under this experiment's settings.", "按实验设置，自动通过了这条建议。"],
  "activity.summary.decision_awaiting_review": ["A trade proposal is waiting for your review.", "有一条交易建议正在等你审核。"],
  "activity.summary.decision_approved": ["The trade proposal passed review.", "这条交易建议已通过审核。"],
  "activity.summary.decision_rejected": ["This trade proposal will not be executed.", "没有执行这条交易建议。"],
  "activity.summary.order_queued": ["The order is waiting for the next eligible execution time.", "订单已保存，正在等待符合条件的成交时点。"],
  "activity.summary.order_filled": ["A simulated order was filled.", "一笔模拟订单已成交。"],
  "activity.summary.order_partially_filled": ["Part of the order has been filled in the simulation.", "订单已有一部分完成模拟成交。"],
  "desk.expandChart": ["Expand {symbol} chart", "展开 {symbol} 图表"],
  "desk.collapseChart": ["Collapse {symbol} chart", "收起 {symbol} 图表"],
  "desk.expand": ["Expand", "展开"],
  "desk.collapse": ["Collapse", "收起"],
  "desk.charts": ["Synchronized stock charts", "多股票同步图表"],
  "desk.multi": ["Multiple stocks", "多股票"],
  "desk.sharedClock": ["All charts share the replay clock. Changing stocks keeps playback running.", "所有图表共用回放时间，切换股票保持播放。"],
  "desk.showAll": ["Show all", "全部显示"],
  "desk.mainOnly": ["Main stock only", "只看主图"],
  "desk.mainSymbol": ["Main chart", "主图"],
  "desk.action": ["Action", "操作类型"],
  "desk.targetCount": ["Target stocks", "目标股票数"],
  "desk.targetCash": ["Target cash", "目标现金"],
  "desk.targetTiming": ["Target allocation · queued for the next eligible execution time. Check Fills for actual executions.", "建议目标仓位 · 等待下一有效成交时点，实际执行请查看「成交」。"],
  "desk.costFromFills": ["Cost reconstructed from fills available at this time", "按截至该时点的成交重建成本"],
  "desk.costFromSnapshot": ["Cost recorded in the historical account snapshot", "历史账户快照记录的成本"],
  "desk.costFromFillsNote": ["Average cost reconstructed from visible buys and sells, including fill-price slippage and excluding separately recorded fees. A complete quantity match is required.", "平均成本按当时已发生的买卖成交重建，包含成交价滑点，单列手续费另计。仅在重建股数与快照一致时显示。"],
  "desk.holdingsColorNote": ["Red = gain, green = loss, gray = flat or unknown. Mark price, market value and P&L compare with the historical average holding cost.", "红涨绿跌，持平或未知为灰色。标记价、市值与盈亏按历史平均持仓成本比较。"],
  "desk.allocation": ["Portfolio allocation", "持仓分布"],
  "desk.allocationBasis": ["Based on market value and cash at the selected replay time", "按所选回放时点的市值与现金计算"],
  "desk.assets": ["Total assets", "资产合计"],
  "desk.noAllocation": ["No valid allocation is available at this time.", "此时点暂无有效资产分布。"],
  "desk.ruleBased": ["Rule-based · no model calls", "规则驱动 · 无模型调用"],
  "desk.signalRule": ["Signal", "信号条件"],
  "desk.smaRule": ["Close above the mean of 50 valid closing observations", "收盘价高于最近 50 个有效收盘观察的均价"],
  "desk.buyHoldRule": ["Allocate once, then preserve the actual share quantities", "首次配置，之后保持实际持股数量"],
  "desk.sizingRule": ["Position sizing", "仓位分配"],
  "desk.equalWeights": ["Equal weights within configured exposure and position caps", "入选股票等权，受组合与单股上限约束"],
  "desk.executionRule": ["Execution", "成交时序"],
  "desk.nextOpen": ["Next eligible bar open", "下一有效行情开盘"],
  "desk.reproducibility": ["Source and reproducibility", "代码来源与复现信息"],
  "desk.project": ["Project", "开源项目"],
  "desk.license": ["License", "许可证"],
  "desk.ruleOriginal": ["Recorded rule text · original", "规则原文"],
  "four.preserve": ["Preserve current share quantities", "保持原持仓数量"],
  "four.independentModules": ["This template uses its configured independent analysis modules or quantitative baseline; expert cards do not alter this run.", "该模板使用配置的独立分析模块或量化基准，专家卡片不会改变本次实验。"],
  "enum.bt_sma50": ["SMA 50", "50 周期简单移动平均"],
  "enum.bt_buy_hold": ["Buy and hold", "买入并持有"],
  "four.syntheticFixture": ["Generated demo prices; no AI calls","虚拟价格演示，不使用 AI"],
  "four.newWeights": ["New weights", "新权重"],
  "four.previousWeights": ["Previous weights", "原权重"],
  "four.requestedAt": ["Requested at", "提出时间"],
  "four.simulatedRequest": ["Replay time", "模拟时点"],
  "four.effectiveAt": ["Effective at", "生效时点"],
  "enum.scored": ["scored", "已评分"],
  "enum.weight_change_requested": ["weight adjustment requested", "调权已提出"],
  "four.pendingExists": ["Effective adjustments; one request is pending", "已生效调权；另有一项待生效请求"],
  "four.completedChanges": ["Effective adjustments", "已生效调权"],
  "enum.started": ["in progress", "进行中"],
  "four.quantDetails": ["Quantitative baseline record", "量化基准记录"],
  "four.deterministicBaseline": ["Preset trading rules; no AI calls","按预设规则交易，不使用 AI"],
  "four.upstream": ["Recorded upstream", "记录的上游来源"],
  "four.commit": ["Commit", "版本提交"],
  "four.selectedSymbols": ["Selected symbols", "选中标的"],
  "four.holdShares": ["HOLD: preserve current shares", "HOLD：保持当前持仓数量"],
  "four.cashOnly": ["Cash only", "全部持有现金"],
  "four.noQuantDecision": ["No baseline decision is available at this point.", "此时点尚无可展示的基准决策。"],
  "four.openTrace": ["Open decision workflow", "打开决策流程"],
  "four.fullTargetsWarning": ["A modification replaces the original proposal with a complete target allocation. Include every asset you want to keep; omitted holdings target zero. Enter the allocation explicitly.", "修改会用完整目标仓位替换原建议。请包含所有希望保留的资产，未列出的持仓目标为零；请明确输入完整目标。"],
  "four.noAdditionalTargets": ["No additional targets", "无其他目标"],
  "four.otherTargets": ["Other targets:", "其他目标："],
  "four.weightRequests": ["Weight adjustment requests", "调权请求总数"],
  "four.pendingCount": ["Pending weight requests", "待生效调权请求数"],
  "A weight change is already pending": ["A weight change is already pending", "已有调权请求等待生效"],
  "A nonempty reason is required": ["A nonempty reason is required", "必须填写调权原因"],
  "New weights match the active weights": ["New weights match the active weights", "新权重与当前生效权重相同"],
  "Completed experiments have no future decision boundary": ["Completed experiments have no future decision boundary", "实验已完成，没有后续决策时点"],
  "Weight changes require human_supervised mode; branch the experiment first": ["Weight changes require human-supervised mode; branch the experiment first", "调权需要人机协同模式；请先创建人机实验"],
  "four.legacyTeam": ["Create an expert-team experiment", "创建专家团队实验"],
  "four.legacyDescription": ["Choose an expert team and the existing research workflow. The four templates use their own analysis roles.", "选择专家团队并使用原有研究工作流；四种模板使用各自的内置分析角色。"],
  "four.expertNotUsed": ["This template does not use expert cards. To use this card, select an expert-team experiment or create one in the experiment wizard.", "此模板不使用专家卡片。请先选择专家团队实验，或在创建向导中创建专家团队实验。"],
  "four.treatmentDifferences": ["Experimental treatment differences", "实验因素差异"],
  "four.controlDifferences": ["Run setting differences", "运行设置差异"],
  "four.notReady": ["This server does not yet support the four templates. Check the connection and refresh before creating an experiment.", "当前服务尚未支持四种模板。请检查连接并刷新后再创建实验。"],
  "four.template": ["Experiment template", "实验模板"],
  "four.quant_baseline": ["Quantitative baseline", "量化基准"],
  "four.market_agent": ["Market agent", "行情 Agent"],
  "four.multisource_agent": ["Multisource agent", "多源 Agent"],
  "four.human_supervised": ["Human-supervised agent", "人机协同 Agent"],
  "four.quant_baseline.description": ["Follow preset stock-selection rules and simulate trades automatically.","按预设的选股规则，自动进行模拟交易。"],
  "four.market_agent.description": ["Market analysis only, automatic simulated execution.", "仅使用行情分析，自动模拟执行。"],
  "four.multisource_agent.description": ["Market, news and financial analysis with frozen weights; automatic simulated execution.", "融合行情、新闻和财务分析，权重冻结，自动模拟执行。"],
  "four.human_supervised.description": ["Multisource analysis with weight adjustments and review of each proposed order.", "多源分析，可调权并逐笔审核交易建议。"],
  "four.quantStrategy": ["Baseline strategy", "基准策略"],
  "four.sma50": ["SMA 50", "50 周期简单移动平均"],
  "four.buyHold": ["Buy and hold", "买入并持有"],
  "four.smaWindow": ["SMA uses 50 valid closing observations.", "SMA 使用 50 个有效收盘观察值。"],
  "four.fixedWeights": ["Market weights are fixed at 100% / 0% / 0%.", "行情组权重固定为 100% / 0% / 0%。"],
  "four.weights": ["Fusion weights", "融合权重"],
  "four.market": ["Market", "行情"],
  "four.news": ["News", "新闻"],
  "four.fundamentals": ["Financials", "财务"],
  "four.slider": ["weight slider", "权重滑块"],
  "four.total": ["Total", "合计"],
  "four.totalRule": ["Each value must be 0–100 and the total must be 100%.", "每项须为 0–100，合计必须为 100%。"],
  "four.policy": ["Score policy", "评分规则"],
  "four.policyExplanation": ["Scores measure evidence direction and strength from −1 to 1, not probability. A score at or above entry becomes a candidate; a held asset at or below exit leaves. Horizon is measured in bars.", "评分为 −1 至 1 的证据方向与强度，不是概率。达到进入门槛的标的成为候选；已持有标的达到或低于退出门槛时退出。展望期限以 bar 为单位。"],
  "four.entry": ["Entry threshold", "进入门槛"],
  "four.exit": ["Exit threshold", "退出门槛"],
  "four.horizon": ["Horizon (bars)", "展望期限（bar）"],
  "four.invalidPolicy": ["Thresholds must be in [−1, 1] with exit below entry; horizon must be a positive integer.", "门槛须在 [−1, 1] 内且退出门槛低于进入门槛；期限须为正整数。"],
  "four.workflow": ["The template uses the research workflow and score-fusion-v1.", "模板使用 research-v1 和 score-fusion-v1 工作流。"],
  "four.reviewMode": ["Human review is required for each proposed order.", "每笔交易建议均需人工审核。"],
  "four.autoMode": ["The template uses automatic simulated execution.", "该模板自动进行模拟执行。"],
  "four.analysis": ["Independent analysis and fusion", "独立分析与融合"],
  "four.analysisHistory": ["Saved analysis history", "已保存分析历史"],
  "four.cutoff": ["Replay as of", "回放时点"],
  "four.onlyAvailable": ["Only analysis available by this point is shown.", "仅展示此时点已可获得的分析。"],
  "four.noAnalysis": ["No analysis is available at this point.", "此时点没有可展示的分析。"],
  "four.availableAt": ["Available at", "可得时间"],
  "four.weightVersion": ["Weight version", "权重版本"],
  "four.combined": ["Combined score", "综合分"],
  "four.score": ["Score", "评分"],
  "four.weight": ["Weight", "权重"],
  "four.contribution": ["Contribution", "加权贡献"],
  "four.unavailable": ["Unavailable", "不可用"],
  "four.original": ["Original:", "原文："],
  "four.risks": ["Risks · original", "风险 · 原文"],
  "four.citations": ["Citations", "引用"],
  "four.uncertainty": ["Uncertainty · original", "不确定性 · 原文"],
  "four.targets": ["Rule-calculated targets", "规则计算目标仓位"],
  "four.demo": ["Demo run; no AI calls","演示运行，不使用 AI"],
  "four.deterministic": ["Rule-based analysis","按规则分析"],
  "four.llm": ["Recorded LLM analysis", "已记录 LLM 分析"],
  "four.loading": ["Loading saved analysis…", "正在加载已保存分析…"],
  "four.currentSettings": ["Current settings, separate from historical analysis", "当前设置，与历史分析分开显示"],
  "four.active": ["Active weights", "当前生效权重"],
  "four.pending": ["Pending weights", "待生效权重"],
  "four.none": ["None", "无"],
  "four.nextDecision": ["Changes apply at the next new decision. A pending or in-flight proposal keeps its original weights.", "调权在下一次新决策开始时生效；正在生成或等待审核的建议继续使用原权重。"],
  "four.reason": ["Reason for adjustment", "调权原因"],
  "four.saveWeights": ["Request weight change", "提交调权请求"],
  "four.requestSaved": ["Weight change requested.", "调权请求已提交。"],
  "four.weightChanges": ["Effective weight adjustments", "已生效调权次数"],
  "four.weightHistory": ["Weight adjustment history", "调权历史"],
  "four.branchTitle": ["Create human-supervised experiment from this configuration", "以此配置新建人机实验"],
  "four.branchHuman": ["This creates a separate human-supervised experiment from the configured start, not the current account state.", "将从配置的起始状态新建独立人机实验，不继承当前账户状态。"],
  "four.branchUnavailable": ["This template cannot be converted here. Create a new experiment instead.", "此模板不能在这里转换，请新建实验。"],
  "enum.quant_baseline": ["Quantitative baseline", "量化基准"],
  "enum.market_agent": ["Market agent", "行情 Agent"],
  "enum.multisource_agent": ["Multisource agent", "多源 Agent"],
  "enum.human_supervised": ["Human-supervised agent", "人机协同 Agent"],
  "enum.weight_change_scheduled": ["weight change scheduled", "调权已排期"],
  "enum.weight_change_applied": ["weight change applied", "调权已生效"],
  "enum.available": ["available", "可用"],
  "enum.unavailable": ["unavailable", "不可用"],
  "Overview": [
    "Overview",
    "总览"
  ],
  "Experiments": [
    "Experiments",
    "实验"
  ],
  "Trading desk": [
    "Trading desk",
    "交易工作台"
  ],
  "Expert library": [
    "Expert library",
    "专家库"
  ],
  "Review queue": [
    "Review queue",
    "审核队列"
  ],
  "Portfolio": [
    "Portfolio",
    "持仓"
  ],
  "Reports": [
    "Reports",
    "报告"
  ],
  "Activity": [
    "Activity",
    "活动记录"
  ],
  "Data hub": [
    "Data hub",
    "数据中心"
  ],
  "Settings": [
    "Settings",
    "设置"
  ],
  "Trading workspace": [
    "Trading workspace",
    "交易工作台"
  ],
  "Decision workflow": [
    "Decision workflow",
    "决策流程"
  ],
  "Historical replay": [
    "Historical replay",
    "历史回放"
  ],
  "● Historical replay": [
    "● Historical replay",
    "● 历史回放"
  ],
  "Sign out": [
    "Sign out",
    "退出登录"
  ],
  "Synthetic dataset": [
    "Generated prices",
    "虚拟价格"
  ],
  "RESEARCH WORKSPACE": [
    "RESEARCH WORKSPACE",
    "研究工作区"
  ],
  "Simulated capital only": [
    "Simulated capital only",
    "仅使用模拟资金"
  ],
  "Loading saved workspace…": [
    "Loading saved workspace…",
    "正在加载已保存的工作区…"
  ],
  "＋ New experiment": [
    "＋ New experiment",
    "＋ 新建实验"
  ],
  "Retry": [
    "Retry",
    "重试"
  ],
  "Saving changes…": [
    "Saving changes…",
    "正在保存更改…"
  ],
  "Performance at a glance": [
    "Performance at a glance",
    "表现概览"
  ],
  "Continue your work": [
    "Continue your work",
    "继续当前工作"
  ],
  "Recent experiments": [
    "Recent experiments",
    "最近的实验"
  ],
  "Refresh": [
    "Refresh",
    "刷新"
  ],
  "Loading saved experiments…": [
    "Loading saved experiments…",
    "正在加载已保存的实验…"
  ],
  "No experiments found.": [
    "No experiments found.",
    "未找到实验。"
  ],
  "Create an experiment": [
    "Create an experiment",
    "创建实验"
  ],
  "Open trading desk": [
    "Open trading desk",
    "打开交易工作台"
  ],
  "Experiment": [
    "Experiment",
    "实验"
  ],
  "Mode": [
    "Mode",
    "模式"
  ],
  "Status": [
    "Status",
    "状态"
  ],
  "Return": [
    "Return",
    "收益率"
  ],
  "Dataset": [
    "Dataset",
    "数据集"
  ],
  "Open": [
    "Open",
    "打开"
  ],
  "No experiments have been created.": [
    "No experiments have been created.",
    "尚未创建实验。"
  ],
  "Experiment registry": [
    "Experiment registry",
    "实验列表"
  ],
  "Compare compatible experiment snapshots": [
    "Compare compatible experiment snapshots",
    "比较兼容的实验快照"
  ],
  "State": [
    "State",
    "状态"
  ],
  "Create a research run to start comparing strategies.": [
    "Create a research run to start comparing strategies.",
    "创建研究实验以开始比较策略。"
  ],
  "Research integrity": [
    "Research integrity",
    "研究完整性"
  ],
  "Results are simulated. Comparisons may be misleading when dates, assets, starting capital or execution costs differ.": [
    "Results are simulated. Comparisons may be misleading when dates, assets, starting capital or execution costs differ.",
    "结果均为模拟数据。日期、资产、初始资金或执行成本不一致时，比较可能产生误导。"
  ],
  "Search experts": [
    "Search experts",
    "搜索专家"
  ],
  "All strategies": [
    "All strategies",
    "全部策略"
  ],
  "Trend": [
    "Trend",
    "趋势"
  ],
  "Value": [
    "Value",
    "价值"
  ],
  "Risk": [
    "Risk",
    "风险"
  ],
  "Add as advisor": [
    "Add as advisor",
    "添加为顾问"
  ],
  "Add to team": [
    "Add to team",
    "加入团队"
  ],
  "Create expert": [
    "Create expert",
    "创建专家"
  ],
  "Create expert card": [
    "Create expert card",
    "创建专家卡片"
  ],
  "No expert cards match these filters.": [
    "No expert cards match these filters.",
    "没有符合筛选条件的专家卡片。"
  ],
  "Strategy details": [
    "Strategy details",
    "策略详情"
  ],
  "Strategy objective": [
    "Strategy objective",
    "策略目标"
  ],
  "Required data": [
    "Required data",
    "所需数据"
  ],
  "Risk notes": [
    "Risk notes",
    "风险说明"
  ],
  "Trader": [
    "Trader",
    "交易员"
  ],
  "Advisor": [
    "Advisor",
    "顾问"
  ],
  "Role": [
    "Role",
    "角色"
  ],
  "Enabled": [
    "Enabled",
    "已启用"
  ],
  "Enable for this run": [
    "Enable for this run",
    "在本实验中启用"
  ],
  "Remove": [
    "Remove",
    "移除"
  ],
  "Add an expert…": [
    "Add an expert…",
    "添加专家…"
  ],
  "Schedule team change": [
    "Schedule team change",
    "安排团队变更"
  ],
  "Schedule expert change": [
    "Schedule expert change",
    "安排专家变更"
  ],
  "Cancel": [
    "Cancel",
    "取消"
  ],
  "Close details": [
    "Close details",
    "关闭详情"
  ],
  "Pending decisions": [
    "Pending decisions",
    "待审核决策"
  ],
  "No pending review decisions.": [
    "No pending review decisions.",
    "没有待审核决策。"
  ],
  "Approve": [
    "Approve",
    "批准"
  ],
  "Modify": [
    "Modify",
    "修改"
  ],
  "Reject": [
    "Reject",
    "拒绝"
  ],
  "Reason": [
    "Reason",
    "原因"
  ],
  "Reason (required for modify/reject)": [
    "Reason (required for modify/reject)",
    "原因（修改或拒绝时必填）"
  ],
  "Explain your intervention": [
    "Explain your intervention",
    "说明您的干预原因"
  ],
  "Modified target weights (JSON; example target AAPL at 10%)": [
    "Modified target weights (JSON; example target AAPL at 10%)",
    "修改后的目标权重（JSON，例如 AAPL 目标为 10%）"
  ],
  "Original proposal remains in the audit record.": [
    "Original proposal remains in the audit record.",
    "原始建议会保留在审计记录中。"
  ],
  "Approving HOLD keeps the current portfolio and creates no new order.": [
    "Approving HOLD keeps the current portfolio and creates no new order.",
    "批准持有将维持当前组合，不会创建新订单。"
  ],
  "A review proposal is waiting. Choose what happens to it before changing the team.": [
    "A review proposal is waiting. Choose what happens to it before changing the team.",
    "有建议正在等待审核。更改团队前请选择如何处理。"
  ],
  "Keep proposal for review": [
    "Keep proposal for review",
    "保留建议继续审核"
  ],
  "Discard proposal; change next decision": [
    "Discard proposal; change next decision",
    "废弃建议；在下一次决策时更改"
  ],
  "Create branch": [
    "Create branch",
    "创建分支"
  ],
  "Start an oversight branch": [
    "Start an oversight branch",
    "创建监督分支"
  ],
  "This creates a separate experiment with its own audit trail. The current run remains unchanged.": [
    "This creates a separate experiment with its own audit trail. The current run remains unchanged.",
    "这会创建具有独立审计记录的新实验，当前实验保持不变。"
  ],
  "AI only": [
    "AI only",
    "仅 AI"
  ],
  "AI + Human Review": [
    "AI + Human Review",
    "AI + 人工审核"
  ],
  "Select a run with recorded holdings.": [
    "Select a run with recorded holdings.",
    "请选择有持仓记录的实验。"
  ],
  "Cash available": [
    "Cash available",
    "可用现金"
  ],
  "Market value": [
    "Market value",
    "市值"
  ],
  "Unrealized P&L": [
    "Unrealized P&L",
    "浮动盈亏"
  ],
  "Order ledger": [
    "Order ledger",
    "订单记录"
  ],
  "No orders in this run.": [
    "No orders in this run.",
    "本实验没有订单。"
  ],
  "Symbol": [
    "Symbol",
    "标的"
  ],
  "Quantity": [
    "Quantity",
    "数量"
  ],
  "Action": [
    "Action",
    "操作"
  ],
  "Order": [
    "Order",
    "订单"
  ],
  "Eligible date": [
    "Eligible date",
    "可执行日期"
  ],
  "Experiment comparison": [
    "Experiment comparison",
    "实验比较"
  ],
  "Compatibility checks include data version, date range, capital, costs and strategy.": [
    "Compatibility checks include data version, date range, capital, costs and strategy.",
    "兼容性检查涵盖数据版本、日期范围、资金、成本及策略。"
  ],
  "Review settings that differ": [
    "Review settings that differ",
    "查看不同的设置"
  ],
  "No saved experiments to compare yet.": [
    "No saved experiments to compare yet.",
    "尚无可比较的已保存实验。"
  ],
  "Experiment report details": [
    "Experiment report details",
    "实验报告详情"
  ],
  "Loading saved report details…": [
    "Loading saved report details…",
    "正在加载已保存的报告详情…"
  ],
  "No experiment report is available yet.": [
    "No experiment report is available yet.",
    "尚无可用实验报告。"
  ],
  "Report export": [
    "Report export",
    "报告导出"
  ],
  "Export report": [
    "Export report",
    "导出报告"
  ],
  "Exports contain saved run metrics, configuration and audit records. Check data and execution settings before attributing differences.": [
    "Exports contain saved run metrics, configuration and audit records. Check data and execution settings before attributing differences.",
    "导出包含已保存的指标、配置和审计记录。解释差异前请检查数据和执行设置。"
  ],
  "Total return": [
    "Total return",
    "总收益率"
  ],
  "Annual volatility": [
    "Annual volatility",
    "年化波动率"
  ],
  "Annualized volatility": [
    "Annualized volatility",
    "年化波动率"
  ],
  "Max drawdown": [
    "Max drawdown",
    "最大回撤"
  ],
  "Peak to trough": [
    "Peak to trough",
    "峰值至谷值"
  ],
  "Trading fees": [
    "Trading fees",
    "交易费用"
  ],
  "Human reviews": [
    "Human reviews",
    "人工审核"
  ],
  "Review actions": [
    "Review actions",
    "审核操作"
  ],
  "No human review actions recorded.": [
    "No human review actions recorded.",
    "没有记录人工审核操作。"
  ],
  "Review timestamps are shown where recorded. Review duration is unavailable.": [
    "Review timestamps are shown where recorded. Review duration is unavailable.",
    "存在记录时显示审核时间；审核耗时不可用。"
  ],
  "LLM usage": [
    "LLM usage",
    "大模型用量"
  ],
  "LLM calls / estimated cost": [
    "LLM calls / estimated cost",
    "大模型调用次数 / 预计费用"
  ],
  "Estimated cost": [
    "Estimated cost",
    "预计费用"
  ],
  "No recorded activity yet.": [
    "No recorded activity yet.",
    "尚无活动记录。"
  ],
  "Event": [
    "Event",
    "事件"
  ],
  "Time": [
    "Time",
    "时间"
  ],
  "Details": [
    "Details",
    "详情"
  ],
  "Audit trail": [
    "Audit trail",
    "审计记录"
  ],
  "Available datasets": [
    "Available datasets",
    "可用数据集"
  ],
  "No datasets yet. Import a CSV file or fetch historical bars.": [
    "No datasets yet. Import a CSV file or fetch historical bars.",
    "尚无数据集，请导入 CSV 文件或获取历史行情。"
  ],
  "Import CSV": [
    "Import CSV",
    "导入 CSV"
  ],
  "Choose CSV": [
    "Choose CSV",
    "选择 CSV"
  ],
  "Create synthetic demo dataset": [
    "Create synthetic demo dataset",
    "创建合成演示数据集"
  ],
  "Dataset ID": [
    "Dataset ID",
    "数据集 ID"
  ],
  "Coverage": [
    "Coverage",
    "覆盖范围"
  ],
  "Rows": [
    "Rows",
    "行数"
  ],
  "Source": [
    "Source",
    "来源"
  ],
  "Data age": [
    "Data age",
    "数据时效"
  ],
  "Latest bar": [
    "Latest bar",
    "最新行情"
  ],
  "Quote freshness": [
    "Quote freshness",
    "行情新鲜度"
  ],
  "Market collector": [
    "Market collector",
    "行情采集器"
  ],
  "Collector": [
    "Collector",
    "采集器"
  ],
  "Choose a running collector": [
    "Choose a running collector",
    "选择正在运行的采集器"
  ],
  "No collector sessions recorded.": [
    "No collector sessions recorded.",
    "尚无采集会话记录。"
  ],
  "Start 1m collector": [
    "Start 1m collector",
    "启动 1 分钟采集器"
  ],
  "Start forward simulation": [
    "Start forward simulation",
    "启动前向模拟"
  ],
  "Pause simulation": [
    "Pause simulation",
    "暂停模拟"
  ],
  "Synthetic demo": [
    "Demo prices",
    "虚拟价格"
  ],
  "Data mode": [
    "Data mode",
    "数据模式"
  ],
  "Forward simulation": [
    "Forward simulation",
    "前向模拟"
  ],
  "Bar interval": [
    "Bar interval",
    "行情周期"
  ],
  "1 minute": [
    "1 minute",
    "1 分钟"
  ],
  "1 hour": [
    "1 hour",
    "1 小时"
  ],
  "Symbols": [
    "Symbols",
    "标的代码"
  ],
  "Start time": [
    "Start time",
    "开始时间"
  ],
  "End time": [
    "End time",
    "结束时间"
  ],
  "Start time (UTC)": [
    "Start time (UTC)",
    "开始时间（UTC）"
  ],
  "End time (UTC)": [
    "End time (UTC)",
    "结束时间（UTC）"
  ],
  "Import Alpaca IEX bars": [
    "Import Alpaca IEX bars",
    "导入 Alpaca IEX 行情"
  ],
  "Historical minute data": [
    "Historical minute data",
    "历史分钟行情"
  ],
  "Model connection": [
    "Model connection",
    "模型连接"
  ],
  "Base URL": [
    "Base URL",
    "服务地址"
  ],
  "Model": [
    "Model",
    "模型"
  ],
  "Model name": [
    "Model name",
    "模型名称"
  ],
  "Max calls": [
    "Max calls",
    "最大调用次数"
  ],
  "Budget (USD)": [
    "Budget (USD)",
    "预算（美元）"
  ],
  "Input cost / million": [
    "Input cost / million",
    "每百万输入 token 成本"
  ],
  "Output cost / million": [
    "Output cost / million",
    "每百万输出 token 成本"
  ],
  "Stored by backend only": [
    "Stored by backend only",
    "仅存储在后端"
  ],
  "Save settings": [
    "Save settings",
    "保存设置"
  ],
  "Test connection": [
    "Test connection",
    "测试连接"
  ],
  "Market data provider · Alpaca": [
    "Market data provider · Alpaca",
    "行情数据提供商 · Alpaca"
  ],
  "Key ID": [
    "Key ID",
    "密钥 ID"
  ],
  "Secret key": [
    "Secret key",
    "密钥"
  ],
  "Save data credentials": [
    "Save data credentials",
    "保存数据凭证"
  ],
  "Experiment name": [
    "Experiment name",
    "实验名称"
  ],
  "Select dataset": [
    "Select dataset",
    "选择数据集"
  ],
  "Start date": [
    "Start date",
    "开始日期"
  ],
  "End date": [
    "End date",
    "结束日期"
  ],
  "Initial simulated capital ($)": [
    "Initial simulated capital ($)",
    "初始模拟资金（美元）"
  ],
  "Fee (basis points)": [
    "Fee (basis points)",
    "手续费（基点）"
  ],
  "Slippage (basis points)": [
    "Slippage (basis points)",
    "滑点（基点）"
  ],
  "Maximum position weight (%)": [
    "Maximum position weight (%)",
    "最大持仓权重（%）"
  ],
  "Maximum model calls": [
    "Maximum model calls",
    "最大模型调用次数"
  ],
  "Decision interval": [
    "Decision interval",
    "决策间隔"
  ],
  "Holding horizon": [
    "Holding horizon",
    "持有期限"
  ],
  "Every 15 minutes": [
    "Every 15 minutes",
    "每 15 分钟"
  ],
  "Every hour": [
    "Every hour",
    "每小时"
  ],
  "Every 1 elapsed day": [
    "Every 1 elapsed day",
    "每经过 1 天"
  ],
  "Every 7 elapsed days": [
    "Every 7 elapsed days",
    "每经过 7 天"
  ],
  "About 1 hour": [
    "About 1 hour",
    "约 1 小时"
  ],
  "About 4 hours": [
    "About 4 hours",
    "约 4 小时"
  ],
  "About 1 day": [
    "About 1 day",
    "约 1 天"
  ],
  "About 7 days": [
    "About 7 days",
    "约 7 天"
  ],
  "About 30 days": [
    "About 30 days",
    "约 30 天"
  ],
  "Replay strategy": [
    "Replay strategy",
    "回放策略"
  ],
  "Agent": [
    "Agent",
    "Agent"
  ],
  "Momentum baseline": [
    "Momentum baseline",
    "动量基准"
  ],
  "Buy and hold baseline": [
    "Buy and hold baseline",
    "买入并持有基准"
  ],
  "Provider mode": [
    "Provider mode",
    "提供方模式"
  ],
  "Deterministic demo strategy": [
    "Demo mode · no AI calls",
    "演示模式 · 不使用 AI"
  ],
  "Configured LLM": [
    "Configured LLM",
    "已配置的大模型"
  ],
  "Demo runs do not represent LLM results.": [
    "Demo runs do not represent LLM results.",
    "演示运行不代表大模型结果。"
  ],
  "Trading team": [
    "Trading team",
    "交易团队"
  ],
  "Human oversight": [
    "Human oversight",
    "人工监督"
  ],
  "Oversight": [
    "Oversight",
    "监督"
  ],
  "Oversight mode": [
    "Oversight mode",
    "监督模式"
  ],
  "Review every proposed order": [
    "Review every proposed order",
    "审核每笔建议订单"
  ],
  "Name": [
    "Name",
    "名称"
  ],
  "Default role": [
    "Default role",
    "默认角色"
  ],
  "Objective": [
    "Objective",
    "目标"
  ],
  "Horizon": [
    "Horizon",
    "周期"
  ],
  "Instructions": [
    "Instructions",
    "指令"
  ],
  "Analysis instructions": [
    "Analysis instructions",
    "分析指令"
  ],
  "Instructions and limits": [
    "Instructions and limits",
    "指令与限制"
  ],
  "Risk constraints": [
    "Risk constraints",
    "风险约束"
  ],
  "Save version 1": [
    "Save version 1",
    "保存版本 1"
  ],
  "Workspace password": [
    "Workspace password",
    "工作区密码"
  ],
  "Use the password provided by your workspace owner. It is never saved in this browser.": [
    "Use the password provided by your workspace owner. It is never saved in this browser.",
    "请输入工作区所有者提供的密码。密码不会保存在此浏览器中。"
  ],
  "Historical trading experiments, expert strategies and human oversight. Simulated capital only.": [
    "Historical trading experiments, expert strategies and human oversight. Simulated capital only.",
    "历史交易实验、专家策略与人工监督。仅使用模拟资金。"
  ],
  "TRADING LAB · SHARED RESEARCH WORKSPACE": [
    "TRADING LAB · SHARED RESEARCH WORKSPACE",
    "TRADING LAB · 共享研究工作区"
  ],
  "Connecting… The free cloud backend may need about a minute to wake up.": [
    "Connecting… The free cloud backend may need about a minute to wake up.",
    "连接中…免费云端后端可能需要约一分钟启动。"
  ],
  "Retry connection": [
    "Retry connection",
    "重试连接"
  ],
  "As of": [
    "As of",
    "截至"
  ],
  "Portfolio value": [
    "Portfolio value",
    "组合价值"
  ],
  "Simulated cash": [
    "Simulated cash",
    "模拟现金"
  ],
  "Since experiment start": [
    "Since experiment start",
    "自实验开始以来"
  ],
  "Fees": [
    "Fees",
    "手续费"
  ],
  "● Portfolio": [
    "● Portfolio",
    "● 投资组合"
  ],
  "● Buy &amp; hold benchmark": [
    "● Buy &amp; hold benchmark",
    "● 买入并持有基准"
  ],
  "VOL": [
    "VOL",
    "成交量"
  ],
  "历史回放控制": [
    "Replay controls",
    "历史回放控制"
  ],
  "历史回放：仅浏览已记录时间点，不调用模型。演示与基准策略为确定性规则。": [
    "Historical replay only browses recorded points and does not call a model. Demo and baseline strategies are deterministic.",
    "历史回放：仅浏览已记录时间点，不调用模型。演示与基准策略为确定性规则。"
  ],
  "选择回放标的": [
    "Select replay symbol",
    "选择回放标的"
  ],
  "标的": [
    "Symbol",
    "标的"
  ],
  "回放速度": [
    "Playback speed",
    "回放速度"
  ],
  "选择回放时间点": [
    "Select replay time",
    "选择回放时间点"
  ],
  "当前待人工审核提案": [
    "Current proposal awaiting review",
    "当前待人工审核提案"
  ],
  "选择行情采集器": [
    "Select market collector",
    "选择行情采集器"
  ],
  "图表周期": [
    "Chart period",
    "图表周期"
  ],
  "分时": [
    "Intraday",
    "分时"
  ],
  "日 K": [
    "Daily",
    "日 K"
  ],
  "周 K": [
    "Weekly",
    "周 K"
  ],
  "操作标记": [
    "Trade markers",
    "操作标记"
  ],
  "交易台信息": [
    "Trading desk information",
    "交易台信息"
  ],
  "所选时间点持仓": [
    "Holdings at selected time",
    "所选时间点持仓"
  ],
  "买入": [
    "Buy",
    "买入"
  ],
  "卖出": [
    "Sell",
    "卖出"
  ],
  "修改": [
    "Modify",
    "修改"
  ],
  "批准": [
    "Approve",
    "批准"
  ],
  "拒绝": [
    "Reject",
    "拒绝"
  ],
  "仓位": [
    "Position",
    "仓位"
  ],
  "价格": [
    "Price",
    "价格"
  ],
  "数量": [
    "Quantity",
    "数量"
  ],
  "市值": [
    "Market value",
    "市值"
  ],
  "平均成本": [
    "Average cost",
    "平均成本"
  ],
  "浮动盈亏": [
    "Unrealized P&L",
    "浮动盈亏"
  ],
  "盈亏率": [
    "P&L %",
    "盈亏率"
  ],
  "现金": [
    "Cash",
    "现金"
  ],
  "账户净值": [
    "Account equity",
    "账户净值"
  ],
  "资产净值": [
    "Net asset value",
    "资产净值"
  ],
  "持仓市值": [
    "Holdings value",
    "持仓市值"
  ],
  "所选时点标记价": [
    "Mark price at selected time",
    "所选时点标记价"
  ],
  "所选时间点没有模拟成交。历史 bar 回放仍按配置的成交时点推进。": [
    "No simulated fills at this point. Historical replay follows the configured execution timing.",
    "所选时间点没有模拟成交。历史 bar 回放仍按配置的成交时点推进。"
  ],
  "所选 bar 对应的模拟成交": [
    "Simulated fills for the selected bar",
    "所选 bar 对应的模拟成交"
  ],
  "该时间点没有持仓。": [
    "No holdings at this point.",
    "该时间点没有持仓。"
  ],
  "该时间点没有已保存的账户快照。": [
    "No account snapshot was saved at this point.",
    "该时间点没有已保存的账户快照。"
  ],
  "历史快照未记录成本": [
    "Cost was not recorded in the historical snapshot",
    "历史快照未记录成本"
  ],
  "当前待审核提案 · 当前操作": [
    "Current proposal awaiting review · current action",
    "当前待审核提案 · 当前操作"
  ],
  "待人工审核 · 暂停推进": [
    "Awaiting human review · advancement paused",
    "待人工审核 · 暂停推进"
  ],
  "原始目标仓位": [
    "Original target allocation",
    "原始目标仓位"
  ],
  "修改后目标仓位": [
    "Modified target allocation",
    "修改后目标仓位"
  ],
  "此时点建议对应的订单": [
    "Orders associated with this proposal",
    "此时点建议对应的订单"
  ],
  "此时间点没有已保存的决策。": [
    "No decision was saved at this time.",
    "此时间点没有已保存的决策。"
  ],
  "暂无所选行情读数": [
    "No market reading selected",
    "暂无所选行情读数"
  ],
  "正在读取所选时间点之前的行情…": [
    "Loading market data visible at the selected time…",
    "正在读取所选时间点之前的行情…"
  ],
  "资产曲线（截至所选时点）": [
    "Equity curve (through selected time)",
    "资产曲线（截至所选时点）"
  ],
  "打开专家库": [
    "Open expert library",
    "打开专家库"
  ],
  "编辑 / 选择专家": [
    "Edit / select experts",
    "编辑 / 选择专家"
  ],
  "实验当前团队": [
    "Current experiment team",
    "实验当前团队"
  ],
  "团队变更已排期至下一决策边界": [
    "Team change scheduled for the next decision boundary",
    "团队变更已排期至下一决策边界"
  ],
  "可观察的 Agent 输出": [
    "Observable Agent output",
    "可观察的 Agent 输出"
  ],
  "协调员汇总 · 可观察输出": [
    "Coordinator summary · observable output",
    "协调员汇总 · 可观察输出"
  ],
  "协调员依据原文": [
    "Coordinator rationale · original text",
    "协调员依据原文"
  ],
  "查看完整协调员输出": [
    "View full coordinator output",
    "查看完整协调员输出"
  ],
  "模型返回内容 / 工具调用": [
    "Model response / tool calls",
    "模型返回内容 / 工具调用"
  ],
  "查看来源建议": [
    "View source proposal",
    "查看来源建议"
  ],
  "未关联来源建议": [
    "No source proposal linked",
    "未关联来源建议"
  ],
  "系统持仓到期退出": [
    "System exit at holding expiry",
    "系统持仓到期退出"
  ],
  "模拟买入成交": [
    "Simulated buy fill",
    "模拟买入成交"
  ],
  "模拟卖出成交": [
    "Simulated sell fill",
    "模拟卖出成交"
  ],
  "前向模拟 · 实验控制": [
    "Forward simulation · experiment controls",
    "前向模拟 · 实验控制"
  ],
  "实验控制": [
    "Experiment controls",
    "实验控制"
  ],
  "创建监督分支": [
    "Create oversight branch",
    "创建监督分支"
  ],
  "完整持仓明细始终显示在交易台下方。": [
    "Full holdings details remain visible below the trading desk.",
    "完整持仓明细始终显示在交易台下方。"
  ],
  "合成演示行情 · 不代表真实市场数据": [
    "These prices are generated for trying the app, not real market prices.",
    "这些价格由程序生成，仅供体验功能，不是真实市场行情。"
  ],
  "包含形成中的行情 · 价格仅作观察": [
    "Includes forming bars · prices are for observation only",
    "包含形成中的行情 · 价格仅作观察"
  ],
  "收涨": [
    "Up",
    "收涨"
  ],
  "收跌": [
    "Down",
    "收跌"
  ],
  "持平": [
    "Unchanged",
    "持平"
  ],
  "量红：较前收涨": [
    "Red volume: close above previous close",
    "量红：较前收涨"
  ],
  "量绿：较前收跌": [
    "Green volume: close below previous close",
    "量绿：较前收跌"
  ],
  "量灰：持平": [
    "Gray volume: unchanged",
    "量灰：持平"
  ],
  "分时收盘": [
    "Intraday close",
    "分时收盘"
  ],
  "美股常规时段 09:30–16:00 ET · 盘前/盘后未显示 · 时间轴固定开盘至收盘": [
    "US regular session 09:30–16:00 ET · pre/post-market hidden · fixed open-to-close axis",
    "美股常规时段 09:30–16:00 ET · 盘前/盘后未显示 · 时间轴固定开盘至收盘"
  ],
  "harness.title": [
    "Decision workflow",
    "决策流程"
  ],
  "harness.description": [
    "Research-backed controls and actual experiment traces",
    "文献支持的控制与实验实际轨迹"
  ],
  "harness.experiment": ["Experiment", "实验"],
  "harness.load": [
    "Load trace",
    "加载轨迹"
  ],
  "harness.capabilities": [
    "Capabilities",
    "功能"
  ],
  "harness.trace": [
    "Experiment trace",
    "实验轨迹"
  ],
  "harness.empty": ["Choose an experiment, then load its saved decision records.", "请选择实验，再加载已保存的决策记录。"],
  "harness.error": [
    "Unable to load workflow data",
    "无法加载决策流程数据"
  ],
  "harness.loading": [
    "Loading…",
    "加载中…"
  ],
  "harness.version": [
    "Version",
    "版本"
  ],
  "harness.evidence": [
    "Evidence",
    "证据"
  ],
  "harness.risk": [
    "Risk checks",
    "风险检查"
  ],
  "harness.runs": [
    "Decision runs",
    "决策运行"
  ],
  "harness.noRuns": [
    "No recorded research workflow runs yet.",
    "尚无新版决策运行记录。"
  ],
  "harness.sources": [
    "Research sources",
    "研究来源"
  ],
  "Build a team. Run an experiment. Understand every decision.": [
    "Build a team. Run an experiment. Understand every decision.",
    "组建团队、运行实验并了解每一项决策。"
  ],
  "Versioned configurations and isolated simulated portfolios.": [
    "Create and browse trading experiments, then compare strategies.",
    "创建和查看交易实验，比较不同策略。"
  ],
  "Plug investment perspectives into your trading team.": [
    "Plug investment perspectives into your trading team.",
    "将投资观点加入交易团队。"
  ],
  "Inspect evidence, then record an auditable human decision.": [
    "Inspect evidence, then record an auditable human decision.",
    "查看证据并记录可审计的人工决策。"
  ],
  "Simulated holdings and queued orders.": [
    "Simulated holdings and queued orders.",
    "模拟持仓与待执行订单。"
  ],
  "Compare performance with compatible experiment settings.": [
    "Compare performance with compatible experiment settings.",
    "比较具有兼容设置的实验表现。"
  ],
  "A permanent trail of evidence, proposals, interventions and fills.": [
    "See experiment runs, trade proposals and manual actions.",
    "查看实验运行、交易建议和人工操作。"
  ],
  "Import and version historical market data.": [
    "Import prices and check their stocks and date coverage.",
    "导入行情，查看股票和时间范围。"
  ],
  "Configure a compatible model endpoint. Secrets are write-only.": [
    "Configure a compatible model endpoint. Secrets are write-only.",
    "配置兼容的模型服务地址。密钥仅可写入。"
  ],
  "No experiment selected": [
    "No experiment selected",
    "尚未选择实验"
  ],
  "Start an experiment": [
    "Start an experiment",
    "开始实验"
  ],
  "Create an experiment to see its real state here.": [
    "Create an experiment to see its real state here.",
    "创建实验后可在此查看实际状态。"
  ],
  "Current replay value": [
    "Current replay value",
    "当前回放价值"
  ],
  "Select an experiment": [
    "Select an experiment",
    "选择实验"
  ],
  "Awaiting history": [
    "Awaiting history",
    "等待历史记录"
  ],
  "No replay yet": [
    "No replay yet",
    "尚无回放"
  ],
  "Market & data": [
    "Market & data",
    "市场与数据"
  ],
  "Expert team": [
    "Expert team",
    "专家团队"
  ],
  "Risk & review": [
    "Risk & review",
    "风险与审核"
  ],
  "Choose your expert team": [
    "Choose your expert team",
    "选择专家团队"
  ],
  "Risk, execution & review": [
    "Risk, execution & review",
    "风险、执行与审核"
  ],
  "Next": [
    "Next",
    "下一步"
  ],
  "Back": [
    "Back",
    "上一步"
  ],
  "Create experiment": [
    "Create experiment",
    "创建实验"
  ],
  "Choose a dataset first.": [
    "Choose a dataset first.",
    "请先选择数据集。"
  ],
  "Choose exactly one enabled trading lead.": [
    "Choose exactly one enabled trading lead.",
    "请选择且仅选择一名已启用的交易负责人。"
  ],
  "Forward simulation requires a timestamped v2 dataset.": [
    "Forward simulation requires a timestamped v2 dataset.",
    "前向模拟需要带时间戳的 v2 数据集。"
  ],
  "Choose a timestamp range for the v2 market data.": [
    "Choose a timestamp range for the v2 market data.",
    "请选择 v2 行情数据的时间范围。"
  ],
  "Sign in to Trading Lab": [
    "Sign in to Trading Lab",
    "登录 Trading Lab"
  ],
  "Connecting to Trading Lab": [
    "Connecting to Trading Lab",
    "正在连接 Trading Lab"
  ],
  "Signing in…": [
    "Signing in…",
    "正在登录…"
  ],
  "Sign in": [
    "Sign in",
    "登录"
  ],
  "Please sign in to continue.": [
    "Please sign in to continue.",
    "请登录后继续。"
  ],
  "Sign out failed. Please retry.": [
    "Sign out failed. Please retry.",
    "退出登录失败，请重试。"
  ],
  "Unable to connect to the backend. A free cloud instance may take about a minute to wake up.": [
    "Unable to connect to the backend. A free cloud instance may take about a minute to wake up.",
    "无法连接后端。免费云端实例可能需要约一分钟启动。"
  ],
  "The cloud backend is not ready. Please retry shortly.": [
    "The cloud backend is not ready. Please retry shortly.",
    "云端后端尚未准备好，请稍后重试。"
  ],
  "Too many attempts. Please wait before trying again.": [
    "Too many attempts. Please wait before trying again.",
    "尝试次数过多，请稍后再试。"
  ],
  "Sign in failed. Check the workspace password.": [
    "Sign in failed. Check the workspace password.",
    "登录失败，请检查工作区密码。"
  ],
  "Sign in failed.": [
    "Sign in failed.",
    "登录失败。"
  ],
  "Saved": [
    "Saved",
    "已保存"
  ],
  "Session advanced": [
    "Session advanced",
    "已推进一个交易时段"
  ],
  "Run paused": [
    "Run paused",
    "运行已暂停"
  ],
  "Run started": [
    "Run started",
    "运行已启动"
  ],
  "Review recorded": [
    "Review recorded",
    "审核已记录"
  ],
  "Experiment created": [
    "Experiment created",
    "实验已创建"
  ],
  "Dataset imported": [
    "Dataset imported",
    "数据集已导入"
  ],
  "Settings saved": [
    "Settings saved",
    "设置已保存"
  ],
  "Connection test succeeded": [
    "Connection test succeeded",
    "连接测试成功"
  ],
  "Expert saved": [
    "Expert saved",
    "专家已保存"
  ],
  "Configuration branch created": [
    "Configuration branch created",
    "配置分支已创建"
  ],
  "Report download prepared": [
    "Report download prepared",
    "报告已准备下载"
  ],
  "Select at least two experiments to compare.": [
    "Select at least two experiments to compare.",
    "请至少选择两个实验进行比较。"
  ],
  "Select an experiment to export.": [
    "Select an experiment to export.",
    "请选择要导出的实验。"
  ],
  "Select or create an experiment first.": [
    "Select or create an experiment first.",
    "请先选择或创建实验。"
  ],
  "Expert cards do not run in a deterministic baseline experiment.": [
    "Expert cards do not run in a deterministic baseline experiment.",
    "确定性基准实验不会运行专家卡片。"
  ],
  "Team change scheduled for next decision boundary": [
    "Team change scheduled for next decision boundary",
    "团队变更已安排在下一决策边界生效"
  ],
  "上一时间点": [
    "Previous time point",
    "上一时间点"
  ],
  "上一交易日": [
    "Previous trading day",
    "上一交易日"
  ],
  "下一时间点": [
    "Next time point",
    "下一时间点"
  ],
  "下一交易日": [
    "Next trading day",
    "下一交易日"
  ],
  "暂停回放": [
    "Pause replay",
    "暂停回放"
  ],
  "从头播放": [
    "Replay from start",
    "从头播放"
  ],
  "播放回放": [
    "Play replay",
    "播放回放"
  ],
  "展开侧边栏": [
    "Expand sidebar",
    "展开侧边栏"
  ],
  "收起侧边栏": [
    "Collapse sidebar",
    "收起侧边栏"
  ],
  "展开": [
    "Expand",
    "展开"
  ],
  "收起": [
    "Collapse",
    "收起"
  ],
  "当前没有可显示的日内数据": [
    "No intraday data is available",
    "当前没有可显示的日内数据"
  ],
  "显示所选交易日已可见的分钟/小时收盘数据": [
    "Show minute/hour close data visible on the selected trading day",
    "显示所选交易日已可见的分钟/小时收盘数据"
  ],
  "Role rules": [
    "Role rules",
    "角色规则"
  ],
  "Decision": [
    "Decision",
    "决策"
  ],
  "Date": [
    "Date",
    "日期"
  ],
  "Proposal": ["Proposal", "建议"],
  "Browse experiments": [
    "Browse experiments",
    "浏览实验"
  ],
  "Loading the selected experiment…": [
    "Loading the selected experiment…",
    "正在加载所选实验…"
  ],
  "Select an experiment from the registry, or create one to start.": [
    "Select an experiment from the registry, or create one to start.",
    "请从实验列表选择实验，或创建新实验。"
  ],
  "Not provided": [
    "Not provided",
    "未提供"
  ],
  "Not specified": [
    "Not specified",
    "未指定"
  ],
  "Disabled · data unavailable": [
    "Disabled · data unavailable",
    "已禁用 · 数据不可用"
  ],
  "Active next decision": [
    "Active next decision",
    "下一次决策时启用"
  ],
  "Versioned · not assigned": [
    "Versioned · not assigned",
    "已版本化 · 未分配"
  ],
  "Baseline": [
    "Baseline",
    "基准"
  ],
  "LLM provider": [
    "AI analysis",
    "AI 分析"
  ],
  "Deterministic agent demo": [
    "Demo mode",
    "演示模式"
  ],
  "Trades": [
    "Trades",
    "交易笔数"
  ],
  "Exposure": [
    "Exposure",
    "仓位敞口"
  ],
  "Replay status: {status}. View server-recorded decisions and continue the replay.": [
    "Replay status: {status}. View server-recorded decisions and continue the replay.",
    "回放状态：{status}。查看服务器记录的决策并继续回放。"
  ],
  "决策": [
    "Decision",
    "决策"
  ],
  "账户": [
    "Account",
    "账户"
  ],
  "成交": [
    "Fills",
    "成交"
  ],
  "Agent过程": [
    "Agent activity",
    "Agent过程"
  ],
  "专家": [
    "Expert",
    "专家"
  ],
  "30 根": [
    "30 bars",
    "30 根"
  ],
  "60 根": [
    "60 bars",
    "60 根"
  ],
  "全部": [
    "All",
    "全部"
  ],
  "较开盘参考": [
    "vs. open",
    "较开盘参考"
  ],
  "较前周 K 收盘": [
    "vs. previous weekly close",
    "较前周 K 收盘"
  ],
  "较前日 K 收盘": [
    "vs. previous daily close",
    "较前日 K 收盘"
  ],
  "基准策略原始建议": [
    "Original baseline proposal",
    "基准策略原始建议"
  ],
  "演示策略原始建议": [
    "Original demo proposal",
    "演示策略原始建议"
  ],
  "AI 原始建议": [
    "Original AI proposal",
    "AI 原始建议"
  ],
  "策略依据": [
    "Strategy rationale",
    "策略依据"
  ],
  "原始依据（模型返回文本，不作翻译）": [
    "Original rationale (model text, untranslated)",
    "原始依据（模型返回文本，不作翻译）"
  ],
  "基准策略": [
    "Baseline",
    "基准策略"
  ],
  "演示策略": [
    "Demo strategy",
    "演示策略"
  ],
  "Agent 记录": [
    "Agent record",
    "Agent 记录"
  ],
  "暂无记录": [
    "No records",
    "暂无记录"
  ],
  "尚无逐时记录": [
    "No timestamped records",
    "尚无逐时记录"
  ],
  "确定性演示 · 无模型调用": [
    "Preset rules · no AI calls",
    "按规则运行 · 不使用 AI"
  ],
  "确定性基准 · 无模型调用": [
    "Rule-based strategy · no AI calls",
    "规则策略 · 不使用 AI"
  ],
  "推进实验会调用模型": [
    "Advancing the experiment calls the model",
    "推进实验会调用模型"
  ],
  "状态未知": [
    "Unknown status",
    "状态未知"
  ],
  "推进到下一时间点": [
    "Advance to next time point",
    "推进到下一时间点"
  ],
  "推进一天": [
    "Advance one day",
    "推进一天"
  ],
  "推进现有实验记录；此配置不会调用模型。": [
    "Advance the existing experiment; this configuration does not call a model.",
    "推进现有实验记录；此配置不会调用模型。"
  ],
  "推进实验将调用模型；历史回看只浏览已保存内容，不会调用模型。": [
    "Advancing calls a model; historical replay only views saved content and does not call a model.",
    "推进实验将调用模型；历史回看只浏览已保存内容，不会调用模型。"
  ],
  "暂停实验": [
    "Pause experiment",
    "暂停实验"
  ],
  "运行实验（无模型调用）": [
    "Run experiment (no model call)",
    "运行实验（无模型调用）"
  ],
  "运行实验（调用模型）": [
    "Run experiment (calls model)",
    "运行实验（调用模型）"
  ],
  "当前实验只有日线数据，分时不可用。": [
    "Only daily data is available for this experiment; intraday view is unavailable.",
    "当前实验只有日线数据，分时不可用。"
  ],
  "尚无可显示的日内数据。": [
    "No intraday data is available.",
    "尚无可显示的日内数据。"
  ],
  "时间点详情": [
    "Time point details",
    "时间点详情"
  ],
  "交易日详情": [
    "Trading day details",
    "交易日详情"
  ],
  "本 bar 收益": [
    "Bar return",
    "本 bar 收益"
  ],
  "当日收益": [
    "Daily return",
    "当日收益"
  ],
  "原始数据": [
    "Original data",
    "原始数据"
  ],
  "行情来源未记录": [
    "Market source not recorded",
    "行情来源未记录"
  ],
  "回放价": [
    "Replay price",
    "回放价"
  ],
  "形成中": [
    "Forming",
    "形成中"
  ],
  "开": [
    "Open",
    "开"
  ],
  "高": [
    "High",
    "高"
  ],
  "低": [
    "Low",
    "低"
  ],
  "收": [
    "Close",
    "收"
  ],
  "量": [
    "Volume",
    "量"
  ],
  "涨": [
    "Up",
    "涨"
  ],
  "跌": [
    "Down",
    "跌"
  ],
  "仅按历史账户快照展示": [
    "Based only on historical account snapshots",
    "仅按历史账户快照展示"
  ],
  "股": [
    "shares",
    "股"
  ],
  "原文 / Original": [
    "Original text",
    "原文"
  ],
  "harness.import": [
    "Import JSONL evidence",
    "导入 JSONL 证据包"
  ],
  "harness.imported": [
    "Imported evidence pack",
    "已导入证据包"
  ],
  "harness.packs": [
    "Available evidence packs",
    "可用证据包"
  ],
  "harness.raw": [
    "Recorded source details",
    "实际记录详情"
  ],
  "harness.coverage": [
    "Coverage",
    "覆盖情况"
  ],
  "harness.failed": [
    "Operation failed",
    "操作失败"
  ],
  "harness.noPacks": [
    "No evidence packs imported.",
    "尚未导入证据包。"
  ],
  "enum.ready": [
    "ready",
    "就绪"
  ],
  "enum.created": [
    "created",
    "待开始"
  ],
  "enum.running": [
    "running",
    "运行中"
  ],
  "enum.completed": [
    "completed",
    "已完成"
  ],
  "enum.paused": [
    "paused",
    "已暂停"
  ],
  "enum.failed": [
    "failed",
    "失败"
  ],
  "enum.pending": [
    "pending",
    "待处理"
  ],
  "enum.awaiting_review": [
    "awaiting review",
    "等待审核"
  ],
  "enum.ai_only": ["Automatic run","自动运行"],
  "enum.human_review": [
    "human review",
    "人工审核"
  ],
  "enum.trader": [
    "trader",
    "交易员"
  ],
  "enum.advisor": [
    "advisor",
    "顾问"
  ],
  "enum.demo": [
    "demo",
    "演示"
  ],
  "enum.llm": [
    "llm",
    "大模型"
  ],
  "enum.momentum": [
    "momentum",
    "动量"
  ],
  "enum.buy_hold": [
    "buy hold",
    "买入并持有"
  ],
  "enum.agent": [
    "agent",
    "Agent"
  ],
  "enum.active": [
    "active",
    "运行中"
  ],
  "Harness": [
    "Harness",
    "决策流程"
  ],
  "Research-backed controls and actual experiment traces": [
    "Research-backed controls and actual experiment traces",
    "文献支持的控制与实验实际轨迹"
  ],
  "Decisions use visible history only": [
    "Decisions use visible history only",
    "决策仅使用当时可见的历史数据"
  ],
  "Launch experiment": [
    "Launch experiment",
    "启动实验"
  ],
  "Continue →": [
    "Continue →",
    "继续 →"
  ],
  "Decision workflow version": [
    "Decision workflow version",
    "决策流程版本"
  ],
  "Research workflow (research-v1)": [
    "Research workflow (research-v1)",
    "研究流程（research-v1）"
  ],
  "Legacy workflow (legacy-v1)": [
    "Legacy workflow (legacy-v1)",
    "原有流程（legacy-v1）"
  ],
  "Evidence pack ID (optional)": [
    "Evidence pack ID (optional)",
    "证据包 ID（可选）"
  ],
  "Evidence packs are optional and must be imported from Decision workflow first.": [
    "Evidence packs are optional and must be imported from Decision workflow first.",
    "证据包为可选项，请先在决策流程页面导入。"
  ],
  "K 线结束后建议": [
    "Proposal after bar close",
    "K 线结束后建议"
  ],
  "此处是实验当前待处理建议；历史回放仅在所选快照的可用时间达到建议生成时间后显示它。": [
    "This is the experiment’s current pending proposal; historical replay shows it only after the selected snapshot reaches the proposal’s availability time.",
    "此处是实验当前待处理建议；历史回放仅在所选快照的可用时间达到建议生成时间后显示它。"
  ],
  "涨跌以颜色、正负号和文字共同标示。浮动盈亏按所选时点标记价与历史平均成本计算，不含单独列示的手续费；历史成本未记录时显示 —。": [
    "Direction is shown with color, signs, and text. Unrealized P&L uses the selected mark and historical average cost, excluding separately listed fees; — means historical cost was not recorded.",
    "涨跌以颜色、正负号和文字共同标示。浮动盈亏按所选时点标记价与历史平均成本计算，不含单独列示的手续费；历史成本未记录时显示 —。"
  ],
  "历史决策": [
    "Historical decision",
    "历史决策"
  ],
  "审核结果未记录": [
    "Review outcome not recorded",
    "审核结果未记录"
  ],
  "无需人工审核": [
    "No human review required",
    "无需人工审核"
  ],
  "保持现有持仓，不下单": [
    "Keep holdings; no order",
    "保持现有持仓，不下单"
  ],
  "清空持仓 · 目标现金 100%": [
    "Close holdings · target 100% cash",
    "清空持仓 · 目标现金 100%"
  ],
  "保持现有持仓，不下单。": [
    "Keep existing holdings; place no order.",
    "保持现有持仓，不下单。"
  ],
  "目标为现金 100%，需要清空现有持仓。": [
    "Target 100% cash; existing holdings must be closed.",
    "目标为现金 100%，需要清空现有持仓。"
  ],
  "买入建议": [
    "Buy proposal",
    "买入建议"
  ],
  "卖出建议": [
    "Sell proposal",
    "卖出建议"
  ],
  "持有建议": [
    "Hold proposal",
    "持有建议"
  ],
  "调整目标仓位": [
    "Rebalance target weights",
    "调整目标仓位"
  ],
  "降低目标仓位": [
    "Reduce target weights",
    "降低目标仓位"
  ],
  "清空持仓": [
    "Close holdings",
    "清空持仓"
  ],
  "记录的交易建议": [
    "Recorded trade proposal",
    "记录的交易建议"
  ],
  "目标仓位": [
    "Target weights",
    "目标仓位"
  ],
  "现金 100%": [
    "100% cash",
    "现金 100%"
  ],
  "回放": [
    "Replay",
    "回放"
  ],
  "历史回放 · {strategy} · 仅浏览已记录时间点，不调用模型": [
    "Historical replay · {strategy} · browsing recorded points only; no model call",
    "历史回放 · {strategy} · 仅浏览已记录时间点，不调用模型"
  ],
  "{current} / {total} 个时间点": [
    "{current} / {total} time points",
    "{current} / {total} 个时间点"
  ],
  "决策数据时点": [
    "Decision data time",
    "决策数据时点"
  ],
  "生成完成": [
    "Completed",
    "生成完成"
  ],
  "回放价截至": [
    "Replay price as of",
    "回放价截至"
  ],
  "{symbol} {chart}，截至 {date}": [
    "{symbol} {chart}, as of {date}",
    "{symbol} {chart}，截至 {date}"
  ],
  "分时价格折线": [
    "intraday price line",
    "分时价格折线"
  ],
  "OHLC 蜡烛图": [
    "OHLC candlestick chart",
    "OHLC 蜡烛图"
  ],
  "成交量：收涨": [
    "Volume: close up",
    "成交量：收涨"
  ],
  "成交量：收跌": [
    "Volume: close down",
    "成交量：收跌"
  ],
  "成交量：收平": [
    "Volume: unchanged",
    "成交量：收平"
  ],
  "harness": [
    "Decision workflow",
    "决策流程"
  ],
  "For intraday experiments, choose a timestamped v2 dataset with a matching bar interval.": [
    "For intraday experiments, choose a timestamped v2 dataset with a matching bar interval.",
    "日内实验请选择具有匹配行情周期的带时间戳 v2 数据集。"
  ],
  "Chart bar period": [
    "Chart bar period",
    "图表行情周期"
  ],
  "Inherited from this dataset. The chart does not resample bars.": [
    "Inherited from this dataset. The chart does not resample bars.",
    "继承自数据集；图表不会重新采样。"
  ],
  "Daily legacy dataset: its existing daily replay behavior is unchanged. Intraday decision intervals, holding horizons, and latency settings are unavailable for this dataset.": [
    "Daily legacy dataset: its existing daily replay behavior is unchanged. Intraday decision intervals, holding horizons, and latency settings are unavailable for this dataset.",
    "原有日线数据集保留日线回放方式；此数据集不支持日内决策间隔、持有期限与延迟设置。"
  ],
  "One trading lead creates the final order plan; advisors contribute opinions only.": [
    "One trading lead creates the final order plan; advisors contribute opinions only.",
    "一名交易负责人形成最终订单计划；顾问只提供意见。"
  ],
  "Required fundamentals are unavailable in this OHLCV dataset. This expert is disabled.": [
    "Required fundamentals are unavailable in this OHLCV dataset. This expert is disabled.",
    "此 OHLCV 数据集缺少所需基本面数据，该专家已禁用。"
  ],
  "Simulated portfolios only. Approved orders queue for eligible next-session execution. Run configuration is frozen at launch.": [
    "Simulated portfolios only. Approved orders queue for eligible next-session execution. Run configuration is frozen at launch.",
    "仅使用模拟投资组合。批准的订单将在符合条件的下一交易时段排队执行。实验配置在启动时冻结。"
  ],
  "Compare selected ({count})": [
    "Compare selected ({count})",
    "比较已选实验（{count}）"
  ],
  "Requires:": [
    "Requires:",
    "需要："
  ],
  "Changes become active at the next decision boundary. Disabled or removed experts will not participate in the next decision.": [
    "Changes become active at the next decision boundary. Disabled or removed experts will not participate in the next decision.",
    "变更将在下一次决策边界生效。停用或移除的专家不会参与下一次决策。"
  ],
  "Unavailable: this experiment supplies price history only.": [
    "Unavailable: this experiment supplies price history only.",
    "不可用：此实验仅提供历史价格数据。"
  ],
  "will take effect at the next decision boundary.": [
    "will take effect at the next decision boundary.",
    "将在下一次决策边界生效。"
  ],
  "Weight": [
    "Weight",
    "权重"
  ],
  "Target allocation": [
    "Target allocation",
    "目标仓位"
  ],
  "Recorded fills": [
    "Recorded fills",
    "已记录成交"
  ],
  "Recorded time": [
    "Recorded time",
    "记录时间"
  ],
  "Expert": ["Expert", "专家"],
  "Elapsed": [
    "Elapsed",
    "耗时"
  ],
  "Request timestamped historical bars from Alpaca using the IEX feed. Each import creates a separate immutable dataset. The secret stays in the local backend.": [
    "Request timestamped historical bars from Alpaca using the IEX feed. Each import creates a separate immutable dataset. The secret stays in the local backend.",
    "通过 IEX 从 Alpaca 请求带时间戳的历史行情。每次导入都会创建独立且不可变的数据集。密钥保留在本地后端。"
  ],
  "Alpaca credentials are not configured. Add them under Settings before requesting data.": [
    "Alpaca credentials are not configured. Add them under Settings before requesting data.",
    "尚未配置 Alpaca 凭证。请先在设置中添加凭证再请求数据。"
  ],
  "Computer local time, converted to UTC when requested.": [
    "Computer local time, converted to UTC when requested.",
    "使用电脑本地时间，请求时转换为 UTC。"
  ],
  "Feed: IEX · API usage depends on your account limits": [
    "Feed: IEX · API usage depends on your account limits",
    "数据源：IEX · API 用量取决于账户限额"
  ],
  "Deterministic fixture · clearly marked synthetic": ["Computer-generated prices for trying the app","程序生成的价格，仅供体验功能"],
  "Collectors fetch data separately from experiments. Starting or pausing a collector never submits brokerage orders or starts an Agent.": [
    "Collectors fetch data separately from experiments. Starting or pausing a collector never submits brokerage orders or starts an Agent.",
    "采集器与实验独立获取数据。启动或暂停采集器不会向券商下单，也不会启动 Agent。"
  ],
  "Source / feed": [
    "Source / feed",
    "来源 / 数据源"
  ],
  "Symbols · interval": [
    "Symbols · interval",
    "标的 · 周期"
  ],
  "Interval / source": [
    "Interval / source",
    "周期 / 来源"
  ],
  "“Live” describes incoming data. A forming bar is not a completed decision input. Check the saved bar timestamp and source before starting a live experiment.": [
    "“Live” describes incoming data. A forming bar is not a completed decision input. Check the saved bar timestamp and source before starting a live experiment.",
    "“实时”描述的是持续接收的数据。形成中的行情不属于已完成的决策输入；启动前请检查已保存行情的时间戳和来源。"
  ],
  "Data credentials are separate from the LLM key. They are write-only: this page never reads or displays the key or secret. Saving credentials does not connect to Alpaca.": [
    "Data credentials are separate from the LLM key. They are write-only: this page never reads or displays the key or secret. Saving credentials does not connect to Alpaca.",
    "行情凭证与大模型密钥分开管理，且仅可写入：此页不会读取或显示密钥。保存凭证不会连接 Alpaca。"
  ],
  "No connection test runs until you explicitly request data or start an Alpaca collector.": [
    "No connection test runs until you explicitly request data or start an Alpaca collector.",
    "只有明确请求数据或启动 Alpaca 采集器时才会连接。"
  ],
  "Forward simulation needs a 1-minute warmup dataset and a separate collector. It never places real orders.": [
    "Forward simulation needs a 1-minute warmup dataset and a separate collector. It never places real orders.",
    "前向模拟需要 1 分钟预热数据集及独立采集器，不会实际下单。"
  ],
  "How often the experiment may decide. Independent of chart bars.": [
    "How often the experiment may decide. Independent of chart bars.",
    "实验可作出决策的频率，与图表周期无关。"
  ],
  "Enforced elapsed UTC duration. Expiry submits a cash exit at the first eligible later bar; market closures can extend the actual time.": [
    "Enforced elapsed UTC duration. Expiry submits a cash exit at the first eligible later bar; market closures can extend the actual time.",
    "按经过的 UTC 时间执行。期限到达后，在后续首根符合条件的行情提交退出至现金；休市可能延长实际时间。"
  ],
  "Intervals are stored as received; no chart resampling is applied.": [
    "Intervals are stored as received; no chart resampling is applied.",
    "按收到的周期保存，不对图表重新采样。"
  ],
  "Import a local OHLCV CSV as a versioned dataset. Timestamp CSV files preserve intraday bars; date-only files remain daily data.": [
    "Import a local OHLCV CSV as a versioned dataset. Timestamp CSV files preserve intraday bars; date-only files remain daily data.",
    "将本地 OHLCV CSV 导入为版本化数据集。带时间戳的 CSV 保留日内行情；仅日期的文件保留为日线数据。"
  ],
  "Compatible chat completions endpoint. Connection tests make a real minimal request. API key is write-only and is never shown again.": [
    "Compatible chat completions endpoint. Connection tests make a real minimal request. API key is write-only and is never shown again.",
    "兼容的聊天补全服务地址。连接测试会发送一次真实的最小请求。API 密钥仅可写入，之后不会再次显示。"
  ],
  "Wait for the selected experiment to finish loading before advancing it.": [
    "Wait for the selected experiment to finish loading before advancing it.",
    "请等待所选实验加载完成后再推进。"
  ],
  "Wait for the selected experiment to finish loading before changing its run state.": [
    "Wait for the selected experiment to finish loading before changing its run state.",
    "请等待所选实验加载完成后再更改运行状态。"
  ],
  "Wait for the selected experiment to finish loading before editing its team.": [
    "Wait for the selected experiment to finish loading before editing its team.",
    "请等待所选实验加载完成后再编辑团队。"
  ],
  "Wait for the selected experiment to finish loading before creating a branch.": [
    "Wait for the selected experiment to finish loading before creating a branch.",
    "请等待所选实验加载完成后再创建分支。"
  ],
  "The selected experiment changed. Reopen its team editor before saving.": [
    "The selected experiment changed. Reopen its team editor before saving.",
    "所选实验已更改，请重新打开团队编辑器后再保存。"
  ],
  "The selected experiment changed while this review was open. Reopen the decision before submitting.": [
    "The selected experiment changed while this review was open. Reopen the decision before submitting.",
    "审核期间所选实验已更改，请重新打开决策后再提交。"
  ],
  "The displayed decision no longer matches its experiment. Reopen the correct experiment before reviewing.": [
    "The displayed decision no longer matches its experiment. Reopen the correct experiment before reviewing.",
    "显示的决策与实验不再匹配，请重新打开正确的实验后再审核。"
  ],
  "The selected experiment changed while loading review limits. Reopen the decision.": [
    "The selected experiment changed while loading review limits. Reopen the decision.",
    "加载审核限制时所选实验已更改，请重新打开决策。"
  ],
  "The replay paused. Inspect the audit event, then retry from this saved snapshot.": [
    "The replay paused. Inspect the audit event, then retry from this saved snapshot.",
    "回放已暂停。请检查审计事件，再从此已保存快照重试。"
  ],
  "The replay failed. Inspect the saved audit record before retrying.": [
    "The replay failed. Inspect the saved audit record before retrying.",
    "回放失败，请检查已保存的审计记录后再重试。"
  ],
  "Enter a JSON object mapping symbols to target weights.": [
    "Enter a JSON object mapping symbols to target weights.",
    "请输入将标的映射到目标权重的 JSON 对象。"
  ],
  "Experiment limits are still loading.": [
    "Experiment limits are still loading.",
    "实验限制仍在加载。"
  ],
  "Target weights cannot exceed 100% in total.": [
    "Target weights cannot exceed 100% in total.",
    "目标权重合计不能超过 100%。"
  ],
  "Targets must be valid JSON.": [
    "Targets must be valid JSON.",
    "目标权重必须是有效的 JSON。"
  ],
  "No rationale was returned with this proposal.": [
    "No rationale was returned with this proposal.",
    "此建议未返回依据。"
  ],
  "No rationale provided.": [
    "No rationale provided.",
    "未提供依据。"
  ],
  "No instructions provided.": [
    "No instructions provided.",
    "未提供指令。"
  ],
  "No risk notes provided.": [
    "No risk notes provided.",
    "未提供风险说明。"
  ],
  "Enable exactly one trader. Other enabled experts must be advisors.": [
    "Enable exactly one trader. Other enabled experts must be advisors.",
    "请启用且仅启用一名交易员，其他启用的专家必须是顾问。"
  ],
  "An enabled expert requires data that this experiment does not have.": [
    "An enabled expert requires data that this experiment does not have.",
    "已启用的专家需要本实验缺少的数据。"
  ],
  "Remove duplicate expert assignments.": [
    "Remove duplicate expert assignments.",
    "请移除重复的专家分配。"
  ],
  "Exactly one enabled trader is selected.": [
    "Exactly one enabled trader is selected.",
    "已选择一名启用的交易员。"
  ],
  "Cash / no targets": [
    "Cash / no targets",
    "现金 / 无目标仓位"
  ],
  "Fill date unavailable": [
    "Fill date unavailable",
    "成交日期不可用"
  ],
  "No fills recorded": [
    "No fills recorded",
    "没有已记录的成交"
  ],
  "Not yet eligible": [
    "Not yet eligible",
    "尚不可执行"
  ],
  "Compatible configurations": [
    "Compatible configurations",
    "配置兼容"
  ],
  "Configuration differences found": [
    "Configuration differences found",
    "发现配置差异"
  ],
  "Timestamp unavailable": [
    "Timestamp unavailable",
    "时间戳不可用"
  ],
  "Configured; enter to replace": [
    "Configured; enter to replace",
    "已配置；输入可替换"
  ],
  "Not configured": [
    "Not configured",
    "未配置"
  ],
  "credentials saved": [
    "credentials saved",
    "凭证已保存"
  ],
  "not configured": [
    "not configured",
    "未配置"
  ],
  "Enter to replace saved key": [
    "Enter to replace saved key",
    "输入以替换已保存的密钥"
  ],
  "Alpaca key ID": [
    "Alpaca key ID",
    "Alpaca 密钥 ID"
  ],
  "The current live collector supports 1-minute bars only. Choose a 1-minute warmup dataset.": ["The current live collector supports 1-minute bars only. Choose a 1-minute warmup dataset.", "当前前向采集器仅支持 1 分钟行情，请选择 1 分钟预热数据集。"],
  "Synthetic demo · accelerated virtual clock · 1m bars": [
    "Synthetic demo · accelerated virtual clock · 1m bars",
    "合成演示 · 加速虚拟时钟 · 1 分钟行情"
  ],
  "Alpaca IEX · 1m bars · freshness depends on account permissions.": [
    "Alpaca IEX · 1m bars · freshness depends on account permissions.",
    "Alpaca IEX · 1 分钟行情 · 时效取决于账户权限。"
  ],
  "Connecting": [
    "Connecting",
    "连接中"
  ],
  "Reconnecting": [
    "Reconnecting",
    "重新连接中"
  ],
  "Stale / no recent bar": [
    "Stale / no recent bar",
    "数据过期 / 无近期行情"
  ],
  "Waiting for first bar": [
    "Waiting for first bar",
    "等待首条行情"
  ],
  "Collecting": [
    "Collecting",
    "采集中"
  ],
  "Unknown": [
    "Unknown",
    "未知"
  ],
  "No bar received": [
    "No bar received",
    "尚未收到行情"
  ],
  "Daily": [
    "Daily",
    "日线"
  ],
  "Imported": [
    "Imported",
    "已导入"
  ],
  "Server response (original)": [
    "Server response (original)",
    "服务器返回（原文）"
  ],
  "实验和行情采集分别运行。开始会按此实验配置处理后续数据；不会调用真实券商下单。历史时间轴仍可用于检查已保存记录。": [
    "Experiment execution and market collection run separately. Starting processes later data under this configuration; no real brokerage order is placed. The historical timeline still shows saved records.",
    "实验和行情采集分别运行。开始会按此实验配置处理后续数据；不会调用真实券商下单。历史时间轴仍可用于检查已保存记录。"
  ],
  "旧实验未保存逐日专家过程；下方只展示真实保存的逐日决策。历史模型调用未标记日期，不能映射到某一天。": [
    "Older experiments did not save daily expert activity. Only saved daily decisions are shown. Undated model calls cannot be assigned to a day.",
    "旧实验未保存逐日专家过程；下方只展示真实保存的逐日决策。历史模型调用未标记日期，不能映射到某一天。"
  ],
  "当前实验失败审计（未记录可用完成时点）": [
    "Current experiment failure audit (completion availability time not recorded)",
    "当前实验失败审计（未记录可用完成时点）"
  ],
  "以下失败记录保留在实验审计中，不归属于所选历史回放时点。": [
    "The following failures are retained in the experiment audit and are not attributed to the selected historical point.",
    "以下失败记录保留在实验审计中，不归属于所选历史回放时点。"
  ],
  "历史模型调用（未标注日期，不归属到某一天）": [
    "Historical model calls (undated; not assigned to a day)",
    "历史模型调用（未标注日期，不归属到某一天）"
  ],
  "交易员提出交易候选 · 顾问提供独立意见 · 协调员形成唯一最终建议。这里展示实际保存的输出，不推断模型内部推理过程。": [
    "The trader proposes candidates, advisors provide independent views, and the coordinator forms one final proposal. These are saved outputs, not claims about internal model reasoning.",
    "交易员提出交易候选 · 顾问提供独立意见 · 协调员形成唯一最终建议。这里展示实际保存的输出，不推断模型内部推理过程。"
  ],
  "团队配置按实验当前状态显示，与上方所选历史日期无关。调整在下一决策边界生效。": [
    "The team configuration reflects current experiment state, independent of the selected historical date. Changes take effect at the next decision boundary.",
    "团队配置按实验当前状态显示，与上方所选历史日期无关。调整在下一决策边界生效。"
  ],
  "按下一条已观察到的 K 线收盘价模拟成交": [
    "Simulated fill at the next observed bar close",
    "按下一条已观察到的 K 线收盘价模拟成交"
  ],
  "按下一根符合条件的 K 线开盘价模拟成交": [
    "Simulated fill at the next eligible bar open",
    "按下一根符合条件的 K 线开盘价模拟成交"
  ],
  "模拟执行记录": [
    "Simulated execution record",
    "模拟执行记录"
  ],
  "次日开盘执行记录": [
    "Next-session open execution record",
    "次日开盘执行记录"
  ],
  "末端建议尚未成交 · 范围内没有后续可执行 bar": [
    "Final proposal is unfilled · no later eligible bar within the range",
    "末端建议尚未成交 · 范围内没有后续可执行 bar"
  ],
  "截至此时点已有模拟成交": [
    "Simulated fills recorded by this point",
    "截至此时点已有模拟成交"
  ],
  "等待后续观察到的 bar 模拟执行": [
    "Waiting for a later observed bar for simulated execution",
    "等待后续观察到的 bar 模拟执行"
  ],
  "等待下一根符合条件的 bar 开盘模拟执行": [
    "Waiting for the next eligible bar open for simulated execution",
    "等待下一根符合条件的 bar 开盘模拟执行"
  ],
  "未保存原始依据文本": [
    "Original rationale text was not saved",
    "未保存原始依据文本"
  ],
  "确定性策略未保存文字依据。": [
    "The deterministic strategy did not save a text rationale.",
    "确定性策略未保存文字依据。"
  ],
  "未保存可观察依据。": [
    "No observable rationale was saved.",
    "未保存可观察依据。"
  ],
  "合成演示 · 加速虚拟时钟": [
    "Synthetic demo · accelerated virtual clock",
    "合成演示 · 加速虚拟时钟"
  ],
  "已停用": [
    "Disabled",
    "已停用"
  ],
  "启用": [
    "Enabled",
    "启用"
  ],
  "未记录": [
    "Not recorded",
    "未记录"
  ],
  "ID 未记录": [
    "ID not recorded",
    "ID 未记录"
  ],
  "服务端没有保存可展示的原始响应内容。": [
    "The server did not save an original response to display.",
    "服务端没有保存可展示的原始响应内容。"
  ],
  "行情暂不可用：": [
    "Market data unavailable:",
    "行情暂不可用："
  ],
  "{symbol} is not in this experiment’s asset universe.": [
    "{symbol} is not in this experiment’s asset universe.",
    "{symbol} 不在本实验的资产范围内。"
  ],
  "{symbol} must have a finite, non-negative weight.": [
    "{symbol} must have a finite, non-negative weight.",
    "{symbol} 的权重必须是有限且非负的数值。"
  ],
  "{symbol} exceeds the {limit}% per-position limit.": [
    "{symbol} exceeds the {limit}% per-position limit.",
    "{symbol} 超过 {limit}% 的单一持仓上限。"
  ],
  "Could not load experiment limits for review: {error}": [
    "Could not load experiment limits for review: {error}",
    "无法加载审核所需的实验限制：{error}"
  ],
  "{expert} requires fundamental data that is not available in this dataset.": [
    "{expert} requires fundamental data that is not available in this dataset.",
    "{expert} 需要本数据集中不可用的基本面数据。"
  ],
  "Historical replay status": [
    "Historical replay status",
    "历史回放状态"
  ],
  "Unable to read market data status": [
    "Unable to read market data status",
    "无法读取行情数据状态"
  ],
  "Historical data import failed": [
    "Historical data import failed",
    "历史行情导入失败"
  ],
  "Collector could not start": [
    "Collector could not start",
    "无法启动采集器"
  ],
  "Could not create demo data": [
    "Could not create demo data",
    "无法创建演示数据"
  ],
  "Collector could not be paused": [
    "Collector could not be paused",
    "无法暂停采集器"
  ],
  "Unable to read Alpaca settings": [
    "Unable to read Alpaca settings",
    "无法读取 Alpaca 设置"
  ],
  "Could not save Alpaca settings": [
    "Could not save Alpaca settings",
    "无法保存 Alpaca 设置"
  ],
  "Collector paused. Its saved data remains available.": [
    "Collector paused. Its saved data remains available.",
    "采集器已暂停，已保存的数据仍可用。"
  ],
  "Alpaca credentials saved by the local backend. No provider connection was started.": [
    "Alpaca credentials saved by the local backend. No provider connection was started.",
    "Alpaca 凭证已由本地后端保存，未启动提供商连接。"
  ],
  "Unable to read live simulation status": [
    "Unable to read live simulation status",
    "无法读取前向模拟状态"
  ],
  "Live simulation could not start": [
    "Live simulation could not start",
    "无法启动前向模拟"
  ],
  "Live simulation could not stop": [
    "Live simulation could not stop",
    "无法停止前向模拟"
  ],
  "无法读取行情": [
    "Unable to read market data",
    "无法读取行情"
  ],
  "当日记录止于 {time} ET，剩余时段无数据": [
    "Today’s record ends at {time} ET; no data is available for the remaining session",
    "当日记录止于 {time} ET，剩余时段无数据"
  ],
  "当日记录止于 {time} ET，常规时段收盘": [
    "Today’s record ends at {time} ET, the regular-session close",
    "当日记录止于 {time} ET，常规时段收盘"
  ],
  "回放至 {time} ET": [
    "Replayed through {time} ET",
    "回放至 {time} ET"
  ],
  "读数锁定 {readout} ET（回放 {replay} ET）· 返回最新": [
    "Reading locked at {readout} ET (replay {replay} ET) · Return to latest",
    "读数锁定 {readout} ET（回放 {replay} ET）· 返回最新"
  ],
  "还没有时间戳行情。开始或推进实验后，将显示首个 K 线时间点与决策记录。": [
    "No timestamped market data yet. The first bar and decision record will appear when the experiment starts or advances.",
    "还没有时间戳行情。开始或推进实验后，将显示首个 K 线时间点与决策记录。"
  ],
  "该时间点没有可显示的 {symbol} OHLCV 行情。": [
    "No {symbol} OHLCV data is available at this time.",
    "该时间点没有可显示的 {symbol} OHLCV 行情。"
  ],
  "市场": [
    "market",
    "市场"
  ],
  " · 已锁定": [
    " · locked",
    " · 已锁定"
  ],
  " · 查看中": [
    " · inspecting",
    " · 查看中"
  ],
  "开盘参考": [
    "Open reference",
    "开盘参考"
  ],
  "{time} ET 收盘 {close}，成交量 {volume}": [
    "{time} ET close {close}, volume {volume}",
    "{time} ET 收盘 {close}，成交量 {volume}"
  ],
  "成交量：收盘较前一根收盘上涨": [
    "Volume: close above previous bar close",
    "成交量：收盘较前一根收盘上涨"
  ],
  "成交量：收盘较前一根收盘下跌": [
    "Volume: close below previous bar close",
    "成交量：收盘较前一根收盘下跌"
  ],
  "成交量：收盘较前一根收盘持平": [
    "Volume: close unchanged from previous bar",
    "成交量：收盘较前一根收盘持平"
  ],
  "（首根与开盘价比较）": [
    "(first bar compared with its open)",
    "（首根与开盘价比较）"
  ],
  "{date} {symbol}：开 {open}，高 {high}，低 {low}，收 {close}，成交量 {volume}。{forming}点击查看，不改变回放时间。": [
    "{date} {symbol}: open {open}, high {high}, low {low}, close {close}, volume {volume}. {forming}Click to inspect without changing replay time.",
    "{date} {symbol}：开 {open}，高 {high}，低 {low}，收 {close}，成交量 {volume}。{forming}点击查看，不改变回放时间。"
  ],
  "形成中的行情，不用于决策。": [
    "Forming bar, excluded from decisions.",
    "形成中的行情，不用于决策。"
  ],
  "点击回看来源时点": [
    "Click to inspect the source time",
    "点击回看来源时点"
  ],
  "未填充缺失数据": [
    "Missing data has not been filled",
    "未填充缺失数据"
  ],
  "行情时间以 UTC 存储 · 查看为 ET / 北京时间 · 来源": [
    "Market times are stored in UTC · displayed in ET / Beijing time · source",
    "行情时间以 UTC 存储 · 查看为 ET / 北京时间 · 来源"
  ],
  "人工审核": [
    "Human review",
    "人工审核"
  ],
  "人工审核结果": [
    "Human review outcome",
    "人工审核结果"
  ],
  "审核原因（原文）": [
    "Review reason (original)",
    "审核原因（原文）"
  ],
  "风险提示（原文）": [
    "Risk notes (original)",
    "风险提示（原文）"
  ],
  "模拟成交": [
    "Simulated fill",
    "模拟成交"
  ],
  "价格依据": [
    "Price source time",
    "价格依据"
  ],
  "成交价": [
    "Fill price",
    "成交价"
  ],
  "费用": [
    "Fee",
    "费用"
  ],
  "来源建议": [
    "Source proposal",
    "来源建议"
  ],
  "历史账户快照": [
    "Historical account snapshot",
    "历史账户快照"
  ],
  "只展示所选时点及之前已记录的资产数据。": [
    "Only asset data recorded at or before the selected time is shown.",
    "只展示所选时点及之前已记录的资产数据。"
  ],
  "累计手续费": [
    "Cumulative fees",
    "累计手续费"
  ],
  "失败尝试": [
    "Failed attempt",
    "失败尝试"
  ],
  "尝试": [
    "Attempt",
    "尝试"
  ],
  "已记录": [
    "Recorded",
    "已记录"
  ],
  "该日模型调用与重试": [
    "Model calls and retries for this day",
    "该日模型调用与重试"
  ],
  "秒": [
    "seconds",
    "秒"
  ],
  "可见输入（原文）": [
    "Visible input (original)",
    "可见输入（原文）"
  ],
  "最终建议": [
    "Final proposal",
    "最终建议"
  ],
  "记录的专家输入": [
    "Recorded expert inputs",
    "记录的专家输入"
  ],
  "未保存依据。": [
    "No rationale was saved.",
    "未保存依据。"
  ],
  "此确定性 {strategy} 基准不调用专家或 LLM。": [
    "This deterministic {strategy} baseline does not call experts or an LLM.",
    "此确定性 {strategy} 基准不调用专家或 LLM。"
  ],
  "Not started": [
    "Not started",
    "尚未开始"
  ],
  "Last market bar": [
    "Last market bar",
    "最新行情"
  ],
  "last decision started": [
    "last decision started",
    "最近决策开始"
  ],
  "completed": [
    "completed",
    "完成"
  ],
  "Error": ["Error", "错误提示"],
  "Request failed ({status})": ["Request failed ({status})", "请求失败（{status}）"],
  "Close dialog": ["Close dialog", "关闭弹窗"],
  "Unavailable for this OHLCV dataset. Required data · {data}.": ["Unavailable for this OHLCV dataset. Required data · {data}.", "此 OHLCV 数据集缺少所需数据 · {data}。"],
  "Advisors provide evidence and dissent. The execution engine accepts one final target plan. Missing required data must block or limit activation.": ["Traders propose buys and sells; advisors add analysis. Experts cannot be enabled until their required data is available.","交易员负责提出买卖建议，顾问负责补充分析。缺少所需数据的专家暂时不能启用。"],
  "Review decision": ["Review decision", "审核建议"],
  "Date unavailable": ["Date unavailable", "日期未记录"],
  "Pending review policy": ["Pending review policy", "待审核建议处理方式"],
  "Choose before saving": ["Choose before saving", "保存前选择"],
  "Expert profile unavailable": ["Expert profile unavailable", "专家资料暂不可用"],
  "Open holdings": ["Open holdings", "当前持仓"],
  "Stale": ["Stale", "已过期"],
  "Created": ["Created", "创建时间"],
  "Fee": ["Fee", "费用"],
  "Cost sums recorded estimates only": ["Cost sums recorded estimates only", "费用仅汇总已记录的估算值"],
  "Some costs are unknown": ["Some costs are unknown", "部分费用未知"],
  "Time unavailable": ["Time unavailable", "时间未记录"],
  "Details (original)": ["Details (original)", "详情（原文）"],
  "Pause": ["Pause", "暂停"],
  "API key": ["API key", "API 密钥"],
  "Simulated decision latency (ms)": ["Simulated decision latency (ms)", "模拟决策延迟（毫秒）"],
  "Deterministic timing assumption. No LLM call is made.": ["This sets a simulated wait time. No AI model is called.","这里设置的是模拟等待时间，不会调用 AI。"],
  "Saved expert profile text is shown in its original language.": ["Saved expert profile text is shown in its original language.", "已保存的专家资料按原文展示。"],
  "Model not recorded": ["Model not recorded", "未记录模型"],
  "Experiment status": ["Experiment status", "实验状态"],
  "Historical bars saved as dataset {id} · {count} rows · IEX feed.": ["Historical bars saved as dataset {id} · {count} rows · IEX feed.", "历史行情已保存为数据集 {id} · {count} 行 · IEX 数据源。"],
  "{source} collector started · {id}. This collects market data only.": ["{source} collector started · {id}. This collects market data only.", "{source} 采集器已启动 · {id}。仅采集行情数据。"],
  "Synthetic demo dataset created · {count} bars. Generated data only.": ["Synthetic demo dataset created · {count} bars. Generated data only.", "已创建合成演示数据集 · {count} 根行情，仅为生成数据。"],
  "Simulated fill {side} {symbol} · {quantity} shares · filled {time} · price {price} · price basis {basis}": ["Simulated fill {side} {symbol} · {quantity} shares · filled {time} · price {price} · price basis {basis}", "模拟成交 {side} {symbol} · {quantity} 股 · 成交 {time} · 价格 {price} · 价格依据 {basis}"],
  "Post-bar proposal {action} · {time} · completed {completed}": ["Post-bar proposal {action} · {time} · completed {completed}", "K 线结束后建议 {action} · {time} · 完成 {completed}"],
  "{step} (no model call)": ["{step} (no model call)", "{step}（无模型调用）"],
  "{step} (model call)": ["{step} (model call)", "{step}（调用模型）"],
  "Expert {number}": ["Expert {number}", "专家 {number}"],
  "Advisor {number}": ["Advisor {number}", "顾问 {number}"],
  "enum.buy": ["buy", "买入"],
  "enum.sell": ["sell", "卖出"],
  "enum.hold": ["hold", "持有"],
  "enum.rebalance": ["rebalance", "调整仓位"],
  "enum.reduce": ["reduce", "降低仓位"],
  "enum.sell_all": ["sell_all", "清空持仓"],
  "enum.approve": ["approve", "批准"],
  "enum.modify": ["modify", "修改"],
  "enum.reject": ["reject", "拒绝"],
  "enum.keep": ["keep", "保留"],
  "enum.discard": ["discard", "废弃"],
  "enum.queued": ["queued", "待执行"],
  "enum.filled": ["filled", "已成交"],
  "enum.pending_final_session": ["pending_final_session", "范围末端待执行"],
  "enum.cancelled": ["cancelled", "已取消"],
  "enum.recorded": ["recorded", "已记录"],
  "enum.success": ["success", "成功"],
  "enum.error": ["error", "错误"],
  "enum.connected": ["connected", "已连接"],
  "enum.stopped": ["stopped", "已停止"],
  "enum.starting": ["starting", "连接中"],
  "enum.reconnecting": ["reconnecting", "重新连接中"],
  "enum.Advisor": ["Advisor", "顾问"],
  "enum.Trader": ["Trader", "交易员"],
  "Evidence pack (optional)": ["Evidence pack (optional)", "证据包（可选）"],
  "Do not use an evidence pack": ["Do not use an evidence pack", "不使用证据包"],
  "Minimum cash weight (%)": ["Minimum cash weight (%)", "最低现金权重（%）"],
  "Maximum gross target exposure (%)": ["Maximum gross target exposure (%)", "最大目标总仓位（%）"],
  "Maximum L1 turnover (%)": ["Maximum L1 turnover (%)", "最大 L1 换手（%）"],
  "L1 turnover sums absolute asset-weight changes. Moving entirely between two assets can reach 200%.": ["L1 turnover sums absolute asset-weight changes. Moving entirely between two assets can reach 200%.", "L1 换手为各资产权重变动绝对值之和。两个资产间完全调仓可达到 200%。"],
  "Research workflow risk limits apply to this new experiment. Existing experiment configurations stay frozen.": ["Research workflow risk limits apply to this new experiment. Existing experiment configurations stay frozen.", "研究流程风控限制在本次新实验中生效。已有实验的配置继续冻结。"],
  "harness.selectExperiment": ["Choose an experiment", "请选择实验"],
  "harness.noExperiments": ["No saved experiments.", "尚无已保存实验。"],
  "harness.stage": ["Recorded stages", "已记录阶段"],
  "harness.stageEvidence": ["Point-in-time evidence", "当时可用证据"],
  "harness.stageProposal": ["Proposal and citation validation", "建议与引用校验"],
  "harness.stageRisk": ["Deterministic risk gate", "程序风险检查"],
  "harness.stageRevision": ["Bounded revision", "有预算的修订"],
  "harness.stageFailure": ["Workflow failure", "流程失败"],
  "harness.statusStarted": ["Started", "已开始"],
  "harness.statusSucceeded": ["Succeeded", "成功"],
  "harness.statusPassed": ["Passed", "通过"],
  "harness.statusRiskPassed": ["Risk passed", "风险检查通过"],
  "harness.statusRejected": ["Rejected", "未通过"],
  "harness.statusRequested": ["Requested", "已请求"],
  "harness.eligible": ["Eligible evidence", "当时可用证据"],
  "harness.included": ["In context", "进入上下文"],
  "harness.unknownExcluded": ["Unknown availability excluded", "可用时间未知已排除"],
  "harness.truncated": ["Context truncated", "上下文已截断"],
  "harness.symbolCoverage": ["Evidence by symbol", "分标的证据覆盖"],
  "harness.targets": ["Proposed target weights", "建议目标仓位"],
  "harness.noProposal": ["No recorded proposal for this attempt.", "此尝试未记录建议。"],
  "harness.preserveHoldings": ["Hold existing allocation", "保持原有仓位"],
  "harness.cashOnly": ["Cash-only allocation", "全现金配置"],
  "harness.cash": ["Cash weight", "现金权重"],
  "harness.gross": ["Gross target exposure", "目标总敞口"],
  "harness.turnover": ["L1 turnover", "L1 换手"],
  "harness.es": ["Historical 95% ES", "历史 95% ES"],
  "harness.volatility": ["Per-bar volatility", "每个行情周期的波动率"],
  "harness.observations": ["Aligned return observations", "对齐收益观察数"],
  "harness.riskDefinition": ["Visible history, at most 60 per-bar returns. ES averages exactly the worst 5% loss mass with a fractional boundary. Constant weights, excludes costs. Adjacent aligned prices can span gaps or overnight periods. Durations vary and returns are not annualized.", "按可见历史最多 60 个周期收益估算。ES 取最坏 5% 的损失均值，并对边界样本按比例计入。假设权重固定，未计成本。相邻对齐价格可能跨缺口或隔夜，时长不固定，未年化。"],
  "harness.insufficientHistory": ["Historical risk unavailable. At least 20 aligned returns and an invested allocation are required.", "历史风险不可用，需要至少 20 个对齐收益和非零投资仓位。"],
  "harness.reviewSummary": ["Human review", "人工审核"],
  "harness.noReview": ["No human action recorded.", "尚无人工审核记录。"],
  "harness.rawModel": ["Recorded model output · original", "已记录模型输出 · 原文"],
  "harness.failureOriginal": ["Recorded failure · original", "已记录失败 · 原文"],
  "harness.unknownField": ["Recorded code · original", "记录代码 · 原文"],
  "harness.coverageNote": ["Evidence is optional. Unknown availability is excluded. Availability assumptions and price adjustments require review.", "证据包可选。可用时间未知的记录会被排除，时间假设和价格复权需核对。"],
  "harness.execution": ["Eligible simulated execution", "符合条件的模拟执行"],
  "Filter by strategy": ["Filter by strategy", "按策略筛选"],
  "Select {name} for comparison": ["Select {name} for comparison", "选择 {name} 进行比较"],
  "Experiment to export": ["Experiment to export", "选择要导出的实验"],
  "Export format": ["Export format", "导出格式"],
  "enum.experiment_created": ["experiment created", "实验已创建"],
  "enum.market_session_advanced": ["market session advanced", "行情时点已推进"],
  "enum.decision_created": ["decision created", "建议已生成"],
  "enum.decision_awaiting_review": ["decision awaiting review", "建议等待审核"],
  "enum.decision_reviewed": ["decision reviewed", "人工审核已记录"],
  "enum.team_change_scheduled": ["team change scheduled", "团队变更已排期"],
  "enum.team_changed": ["team changed", "团队已变更"],
  "enum.expert_team_changed": ["expert team changed", "专家团队已变更"],
  "enum.experiment_branched": ["experiment branched", "实验分支已创建"],
  "enum.budget_exhausted": ["budget exhausted", "预算已耗尽"],
  "enum.run_started": ["run started", "实验已启动"],
  "enum.run_paused": ["run paused", "实验已暂停"],
  "harness.proposalOriginal": ["Recorded proposal rationale · original", "已记录建议依据 · 原文"],
  "Synthetic demo collector started · {id}. This collects market data only.": ["Synthetic demo collector started · {id}. This collects market data only.", "合成演示采集器已启动 · {id}。仅采集行情数据。"],
  "Alpaca IEX collector started · {id}. This collects market data only.": ["Alpaca IEX collector started · {id}. This collects market data only.", "Alpaca IEX 采集器已启动 · {id}。仅采集行情数据。"],
  "Failed to fetch": ["Failed to fetch", "网络请求失败"],
  "● Buy & hold benchmark": ["● Buy & hold benchmark", "● 买入并持有基准"],
  "enum.succeeded": ["succeeded", "成功"],
  "enum.support": ["support", "支持"],
  "enum.oppose": ["oppose", "反对"],
  "enum.neutral": ["neutral", "中立"],
  "enum.abstain": ["abstain", "弃权"]
};
const Context = createContext<{locale: Locale; setLocale: (value: Locale) => void; t: (key: string, params?: Params) => string} | null>(null);
export function LocaleProvider({children}: {children: React.ReactNode}) {
  const [locale, setLocale] = useState<Locale>(() => { try { return localStorage.getItem("trading-lab-locale") === "en" ? "en" : "zh-CN"; } catch { return "zh-CN"; } });
  useEffect(() => { document.documentElement.lang = locale; try { localStorage.setItem("trading-lab-locale", locale); } catch { /* session preference still works */ } }, [locale]);
  const t = (key: string, params?: Params) => { const value = catalog[key]?.[locale === "en" ? 0 : 1] ?? key; return value.replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] == null ? match : String(params[name])); };
  return <Context.Provider value={{locale, setLocale, t}}>{children}</Context.Provider>;
}
export function useLocale() { const value = useContext(Context); if (!value) throw new Error("LocaleProvider missing"); return value; }
export function LText({id}: {id: string}) { return <>{useLocale().t(id)}</>; }

export function LanguageSwitch() { const {locale, setLocale} = useLocale(); return <label className="language-switch"><span className="visually-hidden">Language / 语言</span><select aria-label="Language / 语言" value={locale} onChange={event => setLocale(event.target.value as Locale)}><option value="zh-CN">中文</option><option value="en">English</option></select></label>; }

export function enumLabel(t: (key: string) => string, value: unknown) { const key = `enum.${String(value ?? "").toLowerCase()}`; return catalog[key] ? t(key) : String(value ?? "—"); }
