import React, { useEffect, useMemo, useState } from "react";
import { req, Any } from "./api";
import { Btn, Chart, Empty, money, pct } from "./ui";

const dateOf = (x: Any) => x?.date || x?.as_of_date || x?.filled_date || "";
const price = (v: any) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const actionWord = (value: any) => String(value || "HOLD").toUpperCase();

export default function ReplayDesk({ detail, doStep, doRun, branch, decision, busy = false }: any) {
  const [day, setDay] = useState("");
  const [symbol, setSymbol] = useState("");
  const [market, setMarket] = useState<Any | null>(null);
  const [marketError, setMarketError] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hover, setHover] = useState<Any | null>(null);
  useEffect(() => { setHover(null); }, [day]);
  const chooseSymbol = (next: string) => { setPlaying(false); setHover(null); setSymbol(next); };

  const dates: string[] = useMemo<string[]>(() => [...new Set<string>((detail?.history || []).map(dateOf).filter(Boolean))].sort(), [detail?.id, detail?.history]);
  const latest = dates[dates.length - 1] || detail?.state?.current_date || detail?.config?.start_date || "";
  const marketThrough = detail?.state?.current_date || detail?.state?.date || latest;
  useEffect(() => {
    setPlaying(false);
    setDay(latest);
    setSymbol(detail?.config?.symbols?.[0] || detail?.holdings?.[0]?.symbol || "");
    setMarket(null);
    setHover(null);
  }, [detail?.id, latest]);
  useEffect(() => {
    if (!dates.length) return;
    const timer = window.setInterval(() => {
      if (!playing) return;
      setDay((current) => {
        const i = dates.indexOf(current);
        if (i < 0 || i >= dates.length - 1) { setPlaying(false); return dates[dates.length - 1]; }
        if (i === dates.length - 2) setPlaying(false);
        return dates[i + 1];
      });
    }, 1500 / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, dates]);
  useEffect(() => {
    if (!detail?.id || !marketThrough) { setMarket(null); return; }
    let cancelled = false;
    setMarketLoading(true); setMarketError(""); setMarket(null); setHover(null);
    const query = new URLSearchParams({ as_of: marketThrough });
    if (symbol) query.set("symbol", symbol);
    req(`/experiments/${detail.id}/market?${query}`)
      .then((data) => { if (!cancelled) setMarket(data); })
      .catch((e: any) => { if (!cancelled) setMarketError(e.message || "无法读取行情"); })
      .finally(() => { if (!cancelled) setMarketLoading(false); });
    return () => { cancelled = true; };
  }, [detail?.id, marketThrough, symbol]);

  if (!detail) return null;
  const dayIndex = Math.max(0, dates.indexOf(day));
  const selectedHistory = (detail.history || []).find((x: Any) => dateOf(x) === day) || null;
  const dayDecisions: Any[] = (detail.decisions || []).filter((x: Any) => dateOf(x) === day);
  const decisionForDay = dayDecisions[dayDecisions.length - 1] || null;
  const originalProposal = decisionForDay?.original_proposal || decisionForDay?.proposal || decisionForDay || {};
  const finalProposal = decisionForDay?.final_proposal || originalProposal;
  const reviewAction = decisionForDay?.review?.action || "";
  const orders = detail.orders || [];
  const arrivals = orders.filter((order: Any) => (order.fills || []).some((fill: Any) => dateOf(fill) === day) || order.filled_date === day);
  const decisionId = decisionForDay?.decision_id || decisionForDay?.id;
  const dayOrders = orders.filter((order: Any) => order.decision_id === decisionId && order.created_date && order.created_date <= day && !(order.cancelled_date && order.cancelled_date <= day));
  const dayTraces: Any[] = (detail.decision_traces || []).filter((x: Any) => x.as_of_date === day || x.decision_id === decisionId);
  const allDayTraces = dayTraces;
  const attemptIds = new Set(dayTraces.map((x: Any) => x.attempt_id).filter(Boolean));
  const datedUsage = (detail.llm_usage || []).filter((x: Any) => x.as_of_date === day || attemptIds.has(x.attempt_id) || attemptIds.has(x.step_attempt_id));
  const isLegacy = !detail.decision_traces?.length && (detail.llm_usage || []).length > 0;
  const bars = (market?.bars || []).filter((x: Any) => dateOf(x) <= day && (!symbol || x.symbol === symbol));
  const minPrice = bars.length ? Math.min(...bars.map((x: Any) => Number(x.low))) : 0;
  const maxPrice = bars.length ? Math.max(...bars.map((x: Any) => Number(x.high))) : 1;
  const range = maxPrice - minPrice || 1;
  const allVisibleFills = orders.flatMap((order: Any) => (order.fills || []).filter((fill: Any) => dateOf(fill) && dateOf(fill) <= day).map((fill: Any) => ({ ...fill, order })));
  const historicalDecisions = (detail.decisions || []).filter((x: Any) => dateOf(x) && dateOf(x) <= day);
  const markers = [
    ...allVisibleFills.flatMap((fill: Any) => { const index = bars.findIndex((bar: Any) => dateOf(bar) === dateOf(fill) && bar.symbol === fill.symbol); if (index < 0) return []; const b = bars[index]; return [{ x: 48 + (index * 824) / Math.max(1, bars.length - 1), y: 20 + ((maxPrice - Number(b.low)) / range) * 255 + 10, kind: fill.side === "sell" ? "sell" : "buy", label: fill.side === "sell" ? "S" : "B", title: `实际 ${fill.side.toUpperCase()} ${fill.symbol} · ${Number(fill.quantity).toFixed(3)} 股 · ${fill.date}`, date: dateOf(fill), symbol: fill.symbol }]; }),
    ...historicalDecisions.flatMap((d: Any, n: number) => { const index = bars.findIndex((bar: Any) => dateOf(bar) === dateOf(d)); if (index < 0) return []; const p = d.original_proposal || d.proposal || d; const b = bars[index]; return [{ x: 48 + (index * 824) / Math.max(1, bars.length - 1), y: Math.max(26, 20 + ((maxPrice - Number(b.close)) / range) * 255 - 13 - (n % 3) * 5), kind: "proposal", label: actionWord(p.action).slice(0, 1), title: `收盘建议 ${actionWord(p.action)} · ${dateOf(d)}`, date: dateOf(d), symbol: b.symbol }]; }),
  ];
  const volumeMax = Math.max(1, ...bars.map((x: Any) => Number(x.volume) || 0));
  const pending = day === latest ? (detail.decisions || []).find((x: Any) => dateOf(x) === day && ["pending", "awaiting_review"].includes(x.status)) : null;
  const currentPending = (detail.decisions || []).find((x: Any) => ["pending", "awaiting_review"].includes(x.status));

  return <>
    <section className="replay-console">
      <div className="replay-title">
        <div><span className="eyebrow">HISTORICAL PLAYBACK</span><h2>逐日回看</h2><p>回看记录 · 不调用模型 · 日期只覆盖实验已记录的交易日</p></div>
        <span className="tag lime">{detail.config?.provider_mode === "demo" ? "确定性演示策略" : detail.config?.strategy !== "agent" ? "确定性基准策略" : "已记录的 Agent 实验"}</span>
      </div>
      <div className="playback-controls">
        <label className="symbol-picker">标的<select value={symbol} onChange={(e) => chooseSymbol(e.target.value)}>{(market?.symbols || detail.config?.symbols || [...new Set<string>((detail.history || []).flatMap((h: Any) => Object.keys(h.positions || {}))) ]).map((x: string) => <option key={x} value={x}>{x}</option>)}</select></label>
        <div className="transport"><Btn disabled={dayIndex <= 0} onClick={() => { setPlaying(false); setDay(dates[dayIndex - 1]); }}>← 上一日</Btn><Btn kind="primary" disabled={!dates.length || (dayIndex >= dates.length - 1 && playing)} onClick={() => { if (playing) setPlaying(false); else { if (dayIndex >= dates.length - 1) setDay(dates[0]); setPlaying(true); } }}>{playing ? "暂停回放" : dayIndex >= dates.length - 1 ? "从头播放" : "播放回放"}</Btn><Btn disabled={dayIndex >= dates.length - 1} onClick={() => { setPlaying(false); setDay(dates[dayIndex + 1]); }}>下一日 →</Btn></div>
        <label className="speed-picker">速度<select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        <span className="playback-date">{day || "暂无记录"} <small>{dates.length ? `${dayIndex + 1} / ${dates.length} 个交易日` : "尚无逐日记录"}</small></span>
      </div>
      <input className="date-slider" aria-label="选择回看交易日" type="range" min="0" max={Math.max(0, dates.length - 1)} value={dayIndex} disabled={dates.length < 2} onChange={(e) => { setPlaying(false); setDay(dates[Number(e.target.value)]); }} />
      <div className="playback-boundary"><span>{dates[0] || "—"}</span><span>所选日期及之前的可见行情</span><span>{dates[dates.length - 1] || "—"}</span></div>
    </section>

    <div className="run-actions">
      <div><b>实验控制</b><small>{detail.config?.strategy !== "agent" || detail.config?.provider_mode === "demo" ? "推进现有实验记录；此配置不会调用模型" : "推进实验将调用模型；回看记录不会调用模型"}</small></div>
      <Btn disabled={busy || detail.status === "completed" || !!currentPending} onClick={() => doStep()}>{detail.config?.strategy !== "agent" || detail.config?.provider_mode === "demo" ? "推进一天（无模型调用）" : "推进一天（调用模型）"}</Btn>
      <Btn disabled={busy || detail.status === "completed" || !!currentPending} onClick={() => doRun(detail.status === "running" ? "pause" : "run")}>{detail.status === "running" ? "暂停实验" : detail.config?.strategy !== "agent" || detail.config?.provider_mode === "demo" ? "运行实验（无模型调用）" : "运行实验（调用模型）"}</Btn>
      <Btn onClick={branch}>创建监督分支</Btn>
      {currentPending && <span className="tag warn">待人工审核 · 暂停推进</span>}
      {!pending && <span className="tag">实验状态：{detail.status}</span>}
    </div>

    <div className="replay-layout">
      <Panel className="candle-panel" title={`${symbol || "标的"} · 日线 OHLC 与成交量`}>
        <div className="candle-legend"><span><i className="legend-up"/>收涨</span><span><i className="legend-down"/>收跌</span><span><i className="legend-buy"/>实际买入成交</span><span><i className="legend-sell"/>实际卖出成交</span><span><i className="legend-proposal"/>当日收盘建议</span></div>
        {marketLoading ? <Empty>正在读取所选日期之前的行情…</Empty> : marketError ? <div className="error">行情暂不可用：{marketError}</div> : !bars.length ? <Empty>该日期没有可显示的 {symbol || "市场"} OHLCV 行情。</Empty> : <>
          <div className="ohlc-strip">{hover ? <><b>{dateOf(hover)}</b><span>开 {price(hover.open)}</span><span>高 {price(hover.high)}</span><span>低 {price(hover.low)}</span><span>收 {price(hover.close)}</span><span>量 {Number(hover.volume || 0).toLocaleString()}</span></> : <><b>{dateOf(bars[bars.length - 1])}</b><span>开 {price(bars[bars.length - 1].open)}</span><span>高 {price(bars[bars.length - 1].high)}</span><span>低 {price(bars[bars.length - 1].low)}</span><span>收 {price(bars[bars.length - 1].close)}</span><span>量 {Number(bars[bars.length - 1].volume || 0).toLocaleString()}</span></>}</div>
          <div className="candle-wrap"><svg viewBox="0 0 900 370" role="img" aria-label={`${symbol} OHLC 蜡烛图，截至 ${day}`} onMouseLeave={() => setHover(null)}>
            {[0,1,2,3,4].map((i) => <g key={i}><line x1="48" x2="872" y1={20+i*63.75} y2={20+i*63.75} stroke="#30352f"/><text x="4" y={24+i*63.75} fill="#929b8d" fontSize="10">{price(maxPrice-i*range/4)}</text></g>)}
            {bars.map((bar: Any, i: number) => { const x=48+(i*824)/Math.max(1,bars.length-1), bw=Math.max(3,Math.min(13,700/bars.length)), o=20+((maxPrice-Number(bar.open))/range)*255, c=20+((maxPrice-Number(bar.close))/range)*255, hi=20+((maxPrice-Number(bar.high))/range)*255, lo=20+((maxPrice-Number(bar.low))/range)*255, up=Number(bar.close)>=Number(bar.open), vh=Math.max(2,(Number(bar.volume)||0)/volumeMax*45); return <g key={`${bar.date}-${bar.symbol}`} className="candle" role="button" tabIndex={0} aria-label={`${dateOf(bar)} ${bar.symbol}: open ${bar.open}, high ${bar.high}, low ${bar.low}, close ${bar.close}, volume ${bar.volume}. Click to select day.`} onMouseEnter={() => setHover(bar)} onClick={() => { setPlaying(false); setDay(dateOf(bar)); }} onKeyDown={(e) => {if(e.key==="Enter"||e.key===" "){setPlaying(false);setDay(dateOf(bar));}}}><line x1={x} x2={x} y1={hi} y2={lo} stroke={up?"#80d5a1":"#e27d76"} strokeWidth="1.5"/><rect x={x-bw/2} y={Math.min(o,c)} width={bw} height={Math.max(2,Math.abs(c-o))} fill={up?"#80d5a1":"#e27d76"}/><rect x={x-bw/2} y={345-vh} width={bw} height={vh} fill={up?"#47765d":"#794944"} opacity=".8"/><rect x={x-10} y="10" width="20" height="350" fill="transparent"/></g>; })}
            <line x1="48" x2="872" y1="297" y2="297" stroke="#444a40"/><text x="4" y="322" fill="#929b8d" fontSize="10">VOL</text>
            {markers.map((m: Any, i: number) => <g key={`marker-${i}`} className={`chart-marker marker-${m.kind}`} role="button" tabIndex={0} onClick={() => { setPlaying(false); if (symbol !== m.symbol) chooseSymbol(m.symbol); setDay(m.date); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setPlaying(false); if (symbol !== m.symbol) chooseSymbol(m.symbol); setDay(m.date); } }}><title>{m.title} · 点击回看该日</title>{m.kind === "proposal" ? <rect x={m.x-7} y={m.y-7} width="14" height="14" transform={`rotate(45 ${m.x} ${m.y})`} rx="2"/> : <circle cx={m.x} cy={m.y} r="9"/>}<text x={m.x} y={m.y+3.5} textAnchor="middle">{m.label}</text></g>)}
            <text x="48" y="365" fill="#929b8d" fontSize="10">{dateOf(bars[0])}</text><text x="872" y="365" textAnchor="end" fill="#929b8d" fontSize="10">{dateOf(bars[bars.length - 1])}</text>
          </svg></div>
          {market?.synthetic && <div className="tag warn">合成演示行情 · 不代表真实市场数据</div>}
        </>}
      </Panel>
      <div className="replay-side">
        <div className="snapshot-card"><span className="eyebrow">{day || "—"} · 账户快照</span><div className="snapshot-grid"><div><small>资产净值</small><b>{money(selectedHistory?.equity)}</b></div><div><small>现金</small><b>{money(selectedHistory?.cash)}</b></div><div><small>持仓市值</small><b>{money(selectedHistory?.market_value)}</b></div><div><small>当日收益</small><b className={(selectedHistory?.daily_return || 0)<0?"red":"green"}>{pct(selectedHistory?.daily_return)}</b></div></div><details><summary>当日持仓</summary>{Object.entries(selectedHistory?.positions || {}).map(([s,v]: any)=><div className="target-row" key={s}><span>{s}</span><b>{typeof v === "object" ? `${Number(v.quantity ?? v.shares ?? 0).toFixed(3)} 股` : String(v)}</b></div>)}</details></div>
        <div className="snapshot-card proposal-card">
          <span className="eyebrow">收盘决策 · {day || "—"}</span>
          {decisionForDay ? <>
            <div className="proposal-head"><strong className={`action-${actionWord(originalProposal.action).toLowerCase()}`}>{actionWord(originalProposal.action)}</strong><span className="tag">{reviewAction ? `人工审核：${String(reviewAction).toUpperCase()}` : detail.config?.mode === "ai_only" ? "无需人工审核" : "审核结果未记录"}</span></div>
            <div className="decision-summary"><b>AI 原始建议</b><p>{proposalSummary(originalProposal)}</p></div>
            {originalProposal.targets && <div className="target-list"><small>原始目标仓位</small>{Object.entries(originalProposal.targets).length ? Object.entries(originalProposal.targets).map(([s,v]: any)=><div className="target-row" key={s}><span>{s}</span><b>{pct(v)}</b></div>) : <div className="muted">{String(originalProposal.action).toLowerCase()==="hold" ? "保持现有持仓，不下单" : "清空持仓 · 目标现金 100%"}</div>}</div>}
            {reviewAction && <div className="review-outcome"><b>人工审核结果：{String(reviewAction).toUpperCase()}</b>{decisionForDay.review?.reason && <p>审核原因：{decisionForDay.review.reason}</p>}{reviewAction === "modify" && <><small>修改后目标仓位</small>{Object.entries(finalProposal.targets || {}).map(([s,v]: any)=><div className="target-row" key={s}><span>{s}</span><b>{pct(v)}</b></div>)}</>}</div>}
            {(originalProposal.risks || []).length > 0 && <details><summary>风险提示（{originalProposal.risks.length}）</summary><ul>{originalProposal.risks.map((r: string,i: number)=><li key={i}>{r}</li>)}</ul></details>}
            <details><summary>原始依据（模型返回文本，不作翻译）</summary><pre>{originalProposal.rationale || "未保存原始依据文本"}</pre></details>
            {pending && <div className="review-actions"><b>待人工审核</b><Btn disabled={busy} kind="primary" onClick={() => decision(pending,"approve")}>批准</Btn><Btn disabled={busy} onClick={() => decision(pending,"modify")}>修改</Btn><Btn disabled={busy} kind="danger" onClick={() => decision(pending,"reject")}>拒绝</Btn></div>}
          </> : <p className="muted">这一天没有已保存的日终决策。</p>}
        </div>
        <div className="snapshot-card"><span className="eyebrow">次日开盘执行记录</span>
          {dayOrders.length > 0 && <div className="execution-group"><b>本日建议已生成订单</b>{dayOrders.map((o: Any)=><div className="fill-row" key={o.id}><strong>{Object.keys(o.target_weights || {}).join(", ") || "目标仓位"}</strong><span>{o.status === "pending_final_session" ? "末日建议未成交 · 数据范围内没有后续开盘" : (o.fills || []).some((f: Any)=>dateOf(f)<=day) ? "本日以前已有成交" : "本日尚未成交 · 后续交易日开盘执行"}</span></div>)}</div>}
          {arrivals.length > 0 ? <div className="execution-group"><b>本日到达的实际成交</b>{arrivals.flatMap((order: Any)=>(order.fills||[]).filter((fill: Any)=>dateOf(fill)===day).map((f: Any,i: number)=>{const source=(detail.decisions||[]).find((d: Any)=>(d.id||d.decision_id)===order.decision_id);const sourceProposal=source?.original_proposal||source?.proposal||source||{};return <div className="fill-row" key={`${order.id}-${i}`}><strong className={f.side === "sell" ? "red" : "green"}>{f.side?.toUpperCase()} {f.symbol} · {Number(f.quantity).toFixed(3)} 股</strong><span>成交日 {f.date} · 开盘 {money(f.open_price,2)} · 成交价 {money(f.fill_price,2)} · 费用 {money(f.fees,2)}</span>{order.created_date && <div className="fill-source">来源建议：{order.created_date} 收盘 · {actionWord(sourceProposal.action)} <Btn onClick={() => {setPlaying(false);if(symbol!==f.symbol)chooseSymbol(f.symbol);setDay(order.created_date);}}>查看来源建议</Btn></div>}</div>}))}</div> : !dayOrders.length && <p className="muted">所选日期没有订单成交。收盘建议最早在下一交易日开盘执行。</p>}
        </div>
      </div>
    </div>



    <Panel title="可观察的 Agent 输出">
      {isLegacy && <div className="legacy-note">旧实验未保存逐日专家过程；下方只展示真实保存的逐日决策。历史模型调用未标记日期，不能映射到某一天。</div>}
      {allDayTraces.map((t: Any,i: number)=><div className="attempt-row" key={t.attempt_id || i}><div className="trace-summary"><span className={`tag ${t.status === "failed" ? "warn" : ""}`}>尝试 {i+1} · {t.status || "已记录"}</span><span className="tag">{t.attempt_id || "ID 未记录"}</span>{t.error && <span className="tag warn">{t.error}</span>}</div>{t.expert_opinions?.length > 0 && <div className="trace-grid">{t.expert_opinions.map((op: Any,j: number)=><div className="opinion" key={j}><b>{op.name || op.expert_name || op.expert_id || `专家 ${j+1}`}</b><span>{op.role || "advisor"} · {actionWord(op.action || op.stance)}</span><p>{op.rationale || "未保存可观察依据。"}</p></div>)}</div>}{t.coordination && <details><summary>协调员汇总 · 可观察输出</summary><CoordinatorSummary value={t.coordination}/></details>}</div>)}
      {datedUsage.length > 0 && <details><summary>该日模型调用与重试（{datedUsage.length}）</summary>{datedUsage.map((u: Any,i: number)=><div className="usage-row" key={u.attempt_id || i}><b>{u.expert_name || u.role || "Agent"}</b><span>{u.status || "—"} · {u.model || "model not recorded"} · {u.elapsed_seconds ?? "—"} 秒 · {money(u.estimated_cost_usd,4)}</span>{u.input_context && <small>可见输入：{formatValue(u.input_context,240)}</small>}<details><summary>模型返回内容 / 工具调用</summary><pre>{modelOutput(u)}</pre></details></div>)}</details>}
      {isLegacy && <details><summary>历史模型调用（未标注日期，不归属到某一天）</summary>{(detail.llm_usage || []).map((u: Any,i: number)=><div className="usage-row" key={i}><b>{u.expert_name || u.role || "Agent"}</b><span>{u.status || "—"} · {u.model || "—"} · {u.elapsed_seconds ?? "—"} 秒 · {money(u.estimated_cost_usd,4)}</span><details><summary>模型返回内容 / 工具调用</summary><pre>{modelOutput(u)}</pre></details></div>)}</details>}
      <div className="agent-role-key">交易员提出交易候选 · 顾问提供独立意见 · 协调员形成唯一最终建议。这里展示实际保存的输出，不推断模型内部推理过程。</div>
    </Panel>
    <Panel title="资产曲线（截至所选日）">
      <Chart history={(detail.history || []).filter((x: Any) => dateOf(x) <= day)} benchmark={(detail.benchmark_history || []).filter((x: Any) => dateOf(x) <= day)} />
      <div className="micro">只展示 {day || "所选日期"} 及之前已记录的资产数据。手续费累计 {money(selectedHistory?.fees_paid_total, 2)}</div>
    </Panel>
  </>;
}

function proposalSummary(proposal: Any) {
  const action = String(proposal?.action || "hold").toLowerCase();
  const targets = proposal?.targets;
  if (action === "hold" && (!targets || !Object.keys(targets).length)) return "保持现有持仓，不下单。";
  if ((action === "rebalance" || action === "sell_all") && targets && !Object.keys(targets).length) return "目标为现金 100%，需要清空现有持仓。";
  const names: Record<string,string> = { buy: "买入建议", sell: "卖出建议", hold: "持有建议", rebalance: "调整目标仓位", reduce: "降低目标仓位", sell_all: "清空持仓" };
  return `${names[action] || "记录的交易建议"}${targets ? ` · 目标仓位 ${Object.entries(targets).map(([s,v]: any)=>`${s} ${pct(v)}`).join("、") || "现金 100%"}` : ""}。`;
}
function formatValue(value: any, limit?: number) { const text = typeof value === "string" ? value : JSON.stringify(value); return limit && text.length > limit ? `${text.slice(0,limit)}…` : text; }
function modelOutput(usage: Any) {
  const raw=usage?.raw_output||{};
  const calls=(raw.tool_calls||[]).map((call: Any)=>`${call.function?.name || "tool"}\n${formatValue(call.function?.arguments || "")}`);
  return [raw.content, ...calls].filter(Boolean).join("\n\n") || "服务端没有保存可展示的原始响应内容。";
}
function CoordinatorSummary({ value }: {value: any}) {
  const object=typeof value === "string" ? { summary:value } : value || {};
  const final=object.final_proposal || object;
  return <div className="coordinator-summary"><b>最终建议 · {actionWord(final.action)}</b><p>{proposalSummary(final)}</p>{final.rationale && <details><summary>协调员依据原文</summary><pre>{final.rationale}</pre></details>}{Array.isArray(object.adviser_opinions) && object.adviser_opinions.length>0 && <div><small>记录的专家输入：{object.adviser_opinions.length} 条（按角色查看）</small>{object.adviser_opinions.map((op: Any,i: number)=><p key={i}><b>{op.name || op.expert_name || op.role || `顾问 ${i+1}`} · {actionWord(op.action || op.stance)}</b><br/>{op.rationale || "未保存依据。"}</p>)}</div>}<details><summary>查看完整协调员输出</summary><pre>{formatValue(object)}</pre></details></div>;
}
function Panel({ title, children, className = "" }: any) { return <section className={`panel ${className}`}><h3>{title}</h3>{children}</section>; }
