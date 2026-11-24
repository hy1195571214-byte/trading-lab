# 中英文界面验收

验收时间 2026-11-10 05:56 CST

## 实现范围

语言选项为中文与 English，通过显式文案目录和 `useLocale` / `LText` 切换。偏好保存到 `trading-lab-locale`，页面 `html lang` 同步为 `zh-CN` 或 `en`。英文导航统一使用 Decision workflow，对应中文“决策流程”。功能、版本和研究来源默认折叠，来源链接使用黄绿强调色并保留下划线，证据长 ID 可换行。

翻译覆盖页面标题、导航、按钮、表单标签、普通状态、校验提示、回放控制、图表提示、aria 标签及决策流程摘要。实验和证据包 ID、标的、用户名称、专家资料、模型响应、审核理由与服务端详情按已保存原文显示，相关区域提供原文标识。已显示的本地提示随语言更新。

HTTP 错误通过 `ApiError` 保存来源和状态码。`ErrorMessage` 仅对服务端提供的详情显示“服务器返回（原文）”。前端比较校验与审核校验使用本地化文案。结构化和空详情响应已通过内存 fetch fixture 验证。

CSV 与 JSONL 的页面上传入口使用本地化 button 触发隐藏 file input，可接收键盘焦点并通过 Enter 打开选择器。系统文件选择窗口使用操作系统语言。

## 浏览器覆盖

本地浏览器为 1440 × 900，预览使用 `http://127.0.0.1:5176/`，后端通过 8004 代理。基础轨迹使用明确标记为合成演示的 `57e3115b-5733-48a9-8ed7-ecc6a84e8f63`。

| 页面或路径 | 已观察结果 |
| --- | --- |
| 总览、实验、交易工作台、专家库、审核队列、持仓、报告、活动记录、数据中心、设置、决策流程 | 11 个页面分别在中英文导航打开，标题和主要正文切换成功。英文主内容的汉字残留检查为空 |
| 交易台五个标签页 | 决策、账户、成交、Agent 过程和专家均在两种语言下打开 |
| 图表与回放 | 日 K / 周 K 切换正常，日频 fixture 的分时禁用说明已翻译。上一日、重播和下一日的 aria 与 tooltip 一致，建议 marker 提示已翻译 |
| 账户和 Agent 细节 | 中文“买入并持有基准”、尝试“成功”和专家“支持”已现场回归。原始策略依据保持原文 |
| 本地比较校验 | 零选择比较显示英文错误，切换中文后同一提示更新。该提示使用普通错误前缀 |
| 后端 404 | 合成的缺失实验 ID 返回 `Experiment not found`，中英文均保留该详情原文并显示服务端原文标识 |
| 审核表单 | 非法 JSON 显示中英文对应校验，空理由与非法目标时修改按钮禁用，空理由时拒绝按钮禁用。关闭弹窗可访问名称已翻译 |
| 语言持久化 | English 刷新后 select、localStorage 与 html lang 均为 en。最终中文状态三者均为 zh-CN |
| 登录与限流 | 使用浏览器内临时 auth status / 429 响应 fixture，登录标题与已有错误可切换中英文。测试后已移除两条临时 route |
| CSV / JSONL 上传入口 | 中英文按钮文本正确、可聚焦，四次 Enter 均触发文件选择器。页面可见原生 file input 数量为 0。测试未选择文件，CLI 模态状态通过关闭测试 tab 清理后重开 |
| 决策流程面板 | 实验名称下拉、已记录阶段、证据覆盖、现金/总敞口/L1 换手、人工审核摘要均可读。证据分标的内容和原始记录默认折叠 |

## 创建向导与实际提交

三步向导在两种语言下检查了市场与数据、专家团队、风险与审核。证据包使用创建时间和短 ID 展示，提交完整 ID。步骤三研究风控默认值为最低现金 0%、最大目标总仓位 100%、最大 L1 换手 200%。切换语言保留正在输入的 10 / 80 / 75。

研究流程通过正常 UI 创建了以下独立配置。

- 名称为 `SYNTHETIC locale acceptance · demo config`，ID 为 `78179af3-7116-417d-9ad7-fe6dfdc20c40`。
- 请求数据集为 `demo-synthetic-v1`，provider_mode 为 `demo`，harness_version 为 `research-v1`。
- 请求与保存的 min_cash_weight 为 0.1，max_gross_weight 为 0.8，max_turnover 为 0.75。
- 保存的证据包为 `ev-dc04adefbe4a9149d6439ba5c4889b77676a6ec4cb4b7c0ce435bfdcfd4ea031`。
- API 返回 ready，LLM calls、history 和 decisions 均为 0。

旧流程也通过正常 UI 创建了 `SYNTHETIC legacy locale acceptance · demo config`，ID 为 `ef3fc970-7c2e-42be-b264-ef462494aebe`。第三步研究风控输入数量为 0，POST payload 中省略 harness_risk。API 返回 ready / demo，LLM calls、history 和 decisions 均为 0。

两条记录均保留为预览数据库中的合成配置验收 fixture。浏览器验收范围限定为配置创建、历史记录浏览和界面校验。V2 分钟/前向采集、真实提供者连接和真实认证流程在本次仅覆盖相关静态界面文案。

## 构建与源文件一致性

最终镜像 `npm run build` 成功，Vite 构建耗时 116ms。`npm test` 在最后一轮仅展示层微调前通过 8 / 8，包含时点可见性、审核与成交可见性、延迟 live fill 归属和过期响应隔离。该微调后再次完成生产构建。

显式文案目录共 827 个唯一键，重复键为 0。包含单/双引号及 HTML entity 解码的 TSX 字面 `t` / `LText` 检查缺失键为 0。

工作区与 `/private/tmp/trading-replay-frontend` 的 15 个 src/test 文件 SHA-256 全部一致。镜像 Vite 8004 代理配置单独保留。以下排序清单聚合 SHA-256 为 `36c7c4e764f7b2b0e633bfffe9b491df9c2aba31b5a1ed217724c67f125c1c9c`。

| 文件 | SHA-256 |
| --- | --- |
| `src/AuthGate.tsx` | `9b0be40166ffe82ccecbc964b95981aa40c339c4d6ab2d3463564968d6b4e151` |
| `src/ReplayDesk.tsx` | `02e2082e2960fff354c3e25426263bf1ade14c53f7487f77769d6cb207d74ddc` |
| `src/ScrollRegion.tsx` | `0255b38ce87113431cab528b90fc2453239269b1cc1b6d18f7715b1a024a92a2` |
| `src/api.ts` | `911be47ba90c89bfaaa86d4f8a6f009d7f0bd92664bc84bad5a54c592caebb73` |
| `src/chartData.ts` | `8c2aaf6acbbc70c28637f54574b299450e01d129c4bea4648caca6ad8ea2d71c` |
| `src/frontendHarnessPanel.tsx` | `e174c9e9d0f39cec1db86a2acc3db78c9dd4a71d4b4b050763bdb7410270b497` |
| `src/i18n.tsx` | `9acd151388d8c5d3f0219875bf90e54c9d23b93631d6a82d2d58aaea7467cc07` |
| `src/main.tsx` | `9538dc9ea5c8bd724951fb447d12376179b1ea8e0f71587e13094fd0b5f069a5` |
| `src/portfolio.ts` | `24035e2262dedd3b83f5af6b67c326eeb32bb8e130a8a19e66b50ca0e2c640b5` |
| `src/replayData.ts` | `45dee55c35ff541bf2e7964e2ba55be0e2138bac9c66159e30a1fd3b1c857f24` |
| `src/scroll-region.css` | `bc3f68d4af9745a9a42e0d3661bd01f80762bf8b089763c1ee95a70721a03390` |
| `src/style.css` | `b2026d9893b526c833d873053b05e3a8fa86c3746baea3f23ff0ffacae7825a2` |
| `src/ui.tsx` | `f4011e3a6a80c990a1925c18d7f29ecb5f24a4a2aee4bb2f8d57d009e79a0a00` |
| `src/vite-env.d.ts` | `65996936fbb042915f7b74a200fcdde7e410f32a669b1ab9597cfaa4b0faddb5` |
| `tests/replay-data.test.mjs` | `7d734bd8edcb554b39fe7f12999cbec71cda91993e244579425fa36eac8171fb` |

## 截图

- `output/playwright/i18n-workflow-zh.png` 为最终中文决策流程顶部视口。
- `output/playwright/i18n-workflow-en.png` 为英文决策流程顶部视口，使用修复后的上传按钮。
- `output/playwright/i18n-risk-zh.png` 为中文研究风险输入。
- `output/playwright/i18n-risk-en.png` 为英文研究风险输入。

- `output/playwright/i18n-workflow-trace-zh.png` 为已加载中文合成轨迹的阶段与证据覆盖摘要视口。

- `output/playwright/i18n-workflow-risk-zh.png` 为同一合成轨迹向下滚动后的风险与人工审核摘要视口。
