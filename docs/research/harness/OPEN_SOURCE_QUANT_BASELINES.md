# 第一组：开源量化基准候选的源码核查

日期：2026-11-10｜状态：讨论建议；只阅读源码，未安装、运行或回测这些项目。

## 建议

首选 **bt 的 50 日均线趋势选股**：每个收盘日，选择收盘价高于自身 50 日简单均线的股票，对选中股票等权，未选中股票目标为零。它是已有的具体开源策略，天然只做多、可覆盖多只股票，无需模型训练或 LLM。建议直接采用其策略源码或组件并增加 Lab 的输入/输出适配，让 Lab 统一执行订单。补充基准使用 **bt 的一次性等权买入并持有**，用来观察主动趋势筛选相对同股票池静态持有的差异。这是适配便利性的判断，不是收益或风险表现保证。

横截面动量 top-k 是有价值的备选：bt 提供实际的 `SelectMomentum`、等权和再平衡组件，但下文的完整组合及具体参数是**本报告建议拼装**，不是声称官方已发布同样参数的完整策略。均线交叉示例原样会做空，需改规则才符合本项目范围。

| 候选 | 具体源码及版本 | 入场/退出与目标仓位 | 是否做空 / 训练 |
| --- | --- | --- | --- |
| **首选：50 日价格趋势** | bt [`examples-nb.md` L1–7、L27–30、L100–115](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/docs/source/examples-nb.md#L1-L7) | 价格 > 50 日 SMA 者被选中，选中者各 1/n；不再符合者目标 0；无人符合则现金。示例每天评估及再平衡。 | 不做空；不训练。 |
| **补充：一次性等权买入持有** | bt [`long_only_ew` L230–238](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/docs/source/examples-nb.md#L230-L238) | 第一次选可用标的，按 1/n 配置；后续不再平衡，股数不因价格涨跌改变，权重自然漂移。 | 不做空；不训练。 |
| 横截面动量 top-k | bt [`SelectMomentum` L693–742](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L693-L742)、[`StatTotalReturn` L974–1007](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L974-L1007)、[`WeighEqually` L1081–1109](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L1081-L1109) | 选过去窗口总收益最高 k 只，各 1/k；不在榜者目标 0，候选不足与并列需事先定义。 | 正向等权组合不做空；不训练。 |
| 对照阅读：10/20 SMA 交叉 | backtesting.py [Quick Start L94–116](https://github.com/kernc/backtesting.py/blob/ca2e2611621e472542ba90f7243a1fa06a7d7108/doc/examples/Quick%20Start%20User%20Guide.py#L94-L116) | 10 日上穿 20 日：平空并买入；下穿：平多并卖出开空。例子单资产，默认尽可能大仓位。 | **原样做空**；不训练。 |

## 逐项适配与限制

### 1. bt 价格高于 50 日 SMA：优先采用

源码计算 `data.rolling(50).mean()`，以当期 `data > sma` 选股，再调用 `WeighEqually` 和 `Rebalance`。这是一种**价格相对均线的状态规则**，不是两条均线的交叉事件。源码选股读取当前日期的信号，`Rebalance` 对未列在目标中的已有持仓执行退出；见 [示例选股 L58–96](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/docs/source/examples-nb.md#L58-L96) 和 [Rebalance L2000–2019](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L2000-L2019)。整个序列预先计算不必然构成前视：这个滚动平均只使用截至当日的 50 个观察值，且选股按当前日期读取；Lab 仍应严格限制输入和执行时间。

预热要求每只股票有 50 个有效收盘观察；原例缺少均线时比较为 False，因此不选入。对于中途缺 bar、停牌或不能卖出的持仓，适配时须遵循统一的数据缺失及订单处理规则，不能以假成交平仓。建议每个决策日结束输出完整目标权重；若单只仓位上限使 1/n 不可行，按事先冻结的约束裁剪并保留剩余现金，记录该限制使实际结果与原策略不同。适配器调用保留的 bt 选股/等权实现后只输出目标，不调用 bt 自身的交易账本；Lab 用下一有效开盘执行、核算费用。要证明是真正复用，实施时固定 commit、保留来源及许可证，并用固定小样本核对源码输出、缺失值、预热与空仓边界。

### 2. bt 一次性等权持有：补充对照

官方 `RunOnce → SelectAll → WeighEqually → Rebalance` 是完整策略，其 [`RunOnce`](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L110-L134) 仅首轮触发；[`SelectAll`](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L506-L539) 默认排除当前缺价及非正价格。它不要求长期预热。Lab 应在预先确定的首次决策收盘选股，下一有效开盘买入，后续保留股数而非每日重设等权。未能买入的标的是否重试、截止时间与缺失处理要在实验前冻结；仓位上限和费用造成的残余资金留作现金。

不要误读另一个名为 `buy_and_hold.py` 的示例：该文件实际每月恢复固定的 60%/40% 目标，[官方说明明确区分月度再平衡与固定股数持有](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/docs/source/Buy_and_hold.md#L1-L5)。

### 3. bt 横截面动量：有源码组件，但完整组合待选定

可构造 `RunMonthly → SelectAll → SelectMomentum(n=3, lookback=3个月, lag=0) → WeighEqually → Rebalance`。这是一份**建议配置**；`SelectMomentum` 源码确实将 `StatTotalReturn` 与 `SelectN` 组合，默认回看三个月、零滞后、收益降序，默认不足 n 不要求全部满足；非正收益也可能入选。它使用自然日日期偏移，不能不经说明改称 63 个交易日。`SelectN` 删除缺失统计值，默认可少于 k；等分实际选中数量，空列表为空权重。见 [默认值 L15–16](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L15-L16)、[选择 L637–690](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L637-L690)。

原 `StatTotalReturn` 取窗口内数据计算收益，但没有保证每只股票拥有完整三个月历史；适配时需要显式定义足够历史、端点缺失、并列排序、少于 k、以及无人合格时的行为并记录与原组件的差异。建议首次足够完整历史前持现金；每月决策时点及是否第一天执行应固定，[RunMonthly 默认首日触发且通常在月初](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L137-L175)。参数 k=3 仅作讨论示例，不应通过最终测试集反复调参后称为未见数据。适配器保留并调用 bt 组件可称源码复用；如果在 Lab 中自行重写计算，则应称借鉴规则，另做等价性验证。

### 4. 均线交叉：不能原样用于只做多

backtesting.py 教程使用收盘价 10/20 日 SMA，严格上穿买入、下穿平多后 `sell()` 开空；[教程明确说明最大可用仓位及反向持仓](https://github.com/kernc/backtesting.py/blob/ca2e2611621e472542ba90f7243a1fa06a7d7108/doc/examples/Quick%20Start%20User%20Guide.py#L123-L145)。20 日均线准备好后仍须有前后两个有效均线点判定交叉；按源码严格比较，相等不构成交叉。原例市场单默认下一根 bar 开盘，允许配置当前收盘；教程示例佣金 `.002`，不是 Lab 的成本配置，见 [L81–86、L159–164](https://github.com/kernc/backtesting.py/blob/ca2e2611621e472542ba90f7243a1fa06a7d7108/doc/examples/Quick%20Start%20User%20Guide.py#L81-L86)。Lab 若仅在下穿时平多、绝不开空，且按组合约束分配仓位，就是经过修改的 long-only 变体，不是原策略原样。该框架示例主要是单资产；多股统一账户还需额外适配。

bt 也有另一 50/200 SMA 示例，[快线高于慢线目标 +1、否则 -1](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/docs/source/examples-nb.md#L332-L336)，预热不足时为零；它同样做空，且是均线状态目标而非严格交叉事件。

## 共同执行与比较口径

- 四组使用同一冻结股票池与数据版本、起止时间、初始现金、手续费/滑点、下一有效开盘成交、单股和总仓位限制，并披露任何配置差异。第一组是确定性量化策略，**不调用 LLM**；策略实际持仓和换手可以不同，这是比较结果的一部分。
- bt 示例直接以提供的价格序列做 `Backtest`：在每个日期先更新价格，再运行策略及再平衡；它并不自动实现“收盘产生信号、下一有效开盘成交”，见 [回测循环 L524–532](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/backtest.py#L524-L532) 和 [按当前价格分配 L1637–1645](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/core.py#L1637-L1645)。需使用目标权重适配，而不是直接把 bt 的同日结果作为 Lab 成交。原 bt 默认佣金函数为零，[源码 L1265–1267](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/core.py#L1265-L1267)；其整数股、成本和预热后统计起点也可能不同。原框架收益不可直接用于四组对比。
- 在实施前冻结：预热数据来源及何时开始评估、资产缺失及停牌处理、复权/分红拆股、持仓上限不满足等权时的现金、最后一天未成交订单和交易费用。相同日历、相同信息截断，并分别保存策略版本与完整订单审计。

## 版本、依赖与许可

- **bt**：核对的 commit [`0c8f521fa19704392ee182bf838b42607e236c5e`](https://github.com/pmorissette/bt/commit/0c8f521fa19704392ee182bf838b42607e236c5e)，其项目文件标记版本 1.4.1、Python ≥3.9 和 ffn 等依赖；源码还使用 pandas、NumPy 等，见 [项目配置](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/pyproject.toml#L5-L41) 和 [algos imports](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py#L5-L15)。这是 commit 内声明的版本，并非本报告断言已安装或发布包与该 commit 完全一致。[MIT 许可证](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/LICENSE#L1-L16)允许使用、修改、分发及商业使用，复制或实质部分须保留版权与许可声明；各依赖许可仍需单独核对。
- **backtesting.py**：核对 commit [`ca2e2611621e472542ba90f7243a1fa06a7d7108`](https://github.com/kernc/backtesting.py/commit/ca2e2611621e472542ba90f7243a1fa06a7d7108)，[仓库许可证为 AGPL-3.0](https://github.com/kernc/backtesting.py/blob/ca2e2611621e472542ba90f7243a1fa06a7d7108/LICENSE.md)。AGPL 不禁止商业使用；直接复用、修改、分发或提供网络交互时，应根据实际组合方式核对相应源码提供和许可义务，不能简单断言全部项目必然开源或没有义务。本次仅作阅读对照，未引入代码。

结论基于固定源码和许可证的静态阅读；未安装外部项目、未运行策略、未使用真实股票回测，也未验证 Lab 对这些组件的集成。正式采用前还需完成接口、许可证及可重复行为核验。
