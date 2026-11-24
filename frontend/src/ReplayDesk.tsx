import { LText, useLocale, enumLabel } from "./i18n";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { req, Any } from "./api";
import { Btn, Chart, Empty, money, pct, ErrorMessage } from "./ui";
import { ScrollRegion } from "./ScrollRegion";
import { AnalysisPanel, QuantDetails } from "./FourMode";

import ReplayChart from "./ReplayChart";
import { ProposalAllocation } from "./ProposalAllocation";
import HoldingsPanel from "./HoldingsPanel";
import { historicalMarketValue, holdingsAtSnapshot } from "./portfolio";
import { atOrBeforeAsOf, currentPendingDecision, decisionAvailableAt, decisionVisibleAt, fillVisibleAt, historyKeyAtOrAfter, historyVisibleAt, orderVisibleAt, replayDateOf as dateOf, replayDecisionTime as decisionTime, replayFillSourceTime as fillBarTime, replayFillTime as fillAt, reviewVisibleAt, traceVisibleAt } from "./replayData";
const marketTimeFor = (value: string, locale: "en" | "zh-CN") => {
  if (!value || !value.includes("T")) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const fmt = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  return `${new Intl.DateTimeFormat(locale, { ...fmt, timeZone: "America/New_York" }).format(date)} ET / ${new Intl.DateTimeFormat(locale, { ...fmt, timeZone: "Asia/Shanghai" }).format(date)} ${locale === "en" ? "Beijing" : "北京时间"}`;
};
const actionWord = (value: any) => String(value || "HOLD").toUpperCase();

export default function ReplayDesk({ detail, selectedId, doStep, doRun, branch, decision, experts = [], editTeam, go, renderExpert, busy = false }: any) {
  const { t, locale } = useLocale();
  const marketTime = (value: string) => marketTimeFor(value, locale);
  const [day, setDay] = useState("");
  const [activeTab, setActiveTab] = useState("decision");
  const [symbol, setSymbol] = useState("");
  const [market, setMarket] = useState<Any | null>(null);
  const [marketError, setMarketError] = useState<Error | string>("");
  const [marketLoading, setMarketLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [liveStatus, setLiveStatus] = useState<Any | null>(null);
  const [collectors, setCollectors] = useState<Any[]>([]);
  const [collectorId, setCollectorId] = useState("");
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<Error | string>("");
  const lastLatest = useRef("");
  const isLiveExperiment = detail?.config?.market_mode === "live";
  useEffect(() => {
    if (!detail?.id || !isLiveExperiment) { setLiveStatus(null); setCollectors([]); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const [s, c] = await Promise.all([req(`/experiments/${detail.id}/live/status`), req("/market/collector")]);
        if (!cancelled) {
          setLiveStatus(s || null);
          const sessions = Array.isArray(c) ? c : c?.sessions || c?.collectors || [];
          setCollectors(sessions);
          if (!collectorId && s?.collector_id) setCollectorId(s.collector_id);
          else if (!collectorId) setCollectorId(sessions.find((x: Any) => ["running", "starting", "reconnecting"].includes(String(x.status).toLowerCase()))?.id || "");
          setLiveError("");
        }
      } catch (e: any) { if (!cancelled) setLiveError(e instanceof Error ? e : t("Unable to read live simulation status")); }
    };
    poll(); const timer = window.setInterval(poll, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [detail?.id, isLiveExperiment, collectorId]);
  const startLive = async () => {
    if (!detail?.id || !collectorId) return;
    setLiveBusy(true); setLiveError("");
    try { await req(`/experiments/${detail.id}/live/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collector_id: collectorId }) }); }
    catch (e: any) { setLiveError(e instanceof Error ? e : t("Live simulation could not start")); }
    finally { setLiveBusy(false); }
  };
  const stopLive = async () => {
    if (!detail?.id) return;
    setLiveBusy(true); setLiveError("");
    try { await req(`/experiments/${detail.id}/live/stop`, { method: "POST" }); }
    catch (e: any) { setLiveError(e instanceof Error ? e : t("Live simulation could not stop")); }
    finally { setLiveBusy(false); }
  };
  const chooseSymbol = (next: string) => setSymbol(next);
  const [pinnedSymbols, setPinnedSymbols] = useState<string[]>([]);

  const dates: string[] = useMemo<string[]>(() => [...new Set<string>((detail?.history || []).map(dateOf).filter(Boolean))].sort(), [detail?.id, detail?.history]);
  const latest = dates[dates.length - 1] || detail?.state?.current_date || detail?.config?.start_date || "";
  const timestampMode = Math.max(Number(detail?.config?.schema_version || 1), Number(market?.schema_version || 1)) >= 2;
  const marketCandidate = detail?.state?.current_time || detail?.state?.as_of_time || detail?.state?.as_of_at || detail?.state?.current_timestamp || detail?.state?.current_date || detail?.state?.date;
  const marketThrough = timestampMode ? (typeof marketCandidate === "string" && marketCandidate.includes("T") ? marketCandidate : "") : marketCandidate || latest;
  useEffect(() => {
    setPlaying(false);
    setDay(latest);
    lastLatest.current = latest;
    setActiveTab("decision");
    setSymbol(detail?.config?.symbols?.[0] || detail?.holdings?.[0]?.symbol || "");
    setMarket(null);
    setPinnedSymbols([]);
  }, [detail?.id]);
  useEffect(() => {
    if (lastLatest.current === latest || !latest) { lastLatest.current = latest; return; }
    const previous = lastLatest.current;
    lastLatest.current = latest;
    setDay((current) => !current || current === previous ? latest : current);
  }, [latest]);
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
    if (!detail?.id || !marketThrough) { setMarket(null); setMarketError(""); setMarketLoading(false); return; }
    let cancelled = false;
    setMarketLoading(true); setMarketError(""); setMarket(null);
    const query = new URLSearchParams({ as_of: marketThrough });
    req(`/experiments/${detail.id}/market?${query}`)
      .then((data) => { if (!cancelled) setMarket(data); })
      .catch((e: any) => { if (!cancelled) setMarketError(e instanceof Error ? e : t("无法读取行情")); })
      .finally(() => { if (!cancelled) setMarketLoading(false); });
    return () => { cancelled = true; };
  }, [detail?.id, marketThrough]);

  if (!detail || (selectedId && detail.id !== selectedId)) return null;
  const waitingForFirstBar = timestampMode && !marketThrough;
  const dayIndex = Math.max(0, dates.indexOf(day));
  const selectedHistory = (detail.history || []).find((x: Any) => dateOf(x) === day) || null;
  const selectedAsOf = selectedHistory?.as_of_time || day;
  const dayDecisions: Any[] = (detail.decisions || []).filter((x: Any) => decisionVisibleAt(x, selectedAsOf) && (decisionTime(x) === selectedAsOf || decisionTime(x) === day || (!x.as_of_time && dateOf(x) === day)));
  const decisionForDay = dayDecisions[dayDecisions.length - 1] || null;
  const originalProposal = decisionForDay?.original_proposal || decisionForDay?.proposal || decisionForDay || {};
  const reviewAction = reviewVisibleAt(decisionForDay, detail.events || [], selectedAsOf) ? decisionForDay?.review?.action || "" : "";
  const finalProposal = reviewAction ? decisionForDay?.final_proposal || originalProposal : originalProposal;
  const executionHeading = timestampMode ? t("模拟执行记录") : t("次日开盘执行记录");
  const executionRule = detail.config?.market_mode === "live" ? t("按下一条已观察到的 K 线收盘价模拟成交") : t("按下一根符合条件的 K 线开盘价模拟成交");
  const orders = detail.orders || [];
  const arrivals = orders.filter((order: Any) => (order.fills || []).some((fill: Any) => fillVisibleAt(fill, selectedAsOf) && (fillBarTime(fill) === day || fillAt(fill) === day)) || (order.filled_date === day && atOrBeforeAsOf(order.filled_date, selectedAsOf)));
  const decisionId = decisionForDay?.decision_id || decisionForDay?.id;
  const dayOrders = orders.filter((order: Any) => order.decision_id === decisionId && orderVisibleAt(order, selectedAsOf));
  const dayTraces: Any[] = (detail.decision_traces || []).filter((x: Any) => (x.as_of_time === selectedAsOf || x.as_of_date === day || x.decision_id === decisionId) && traceVisibleAt(x, detail.decisions || [], selectedAsOf));
  const currentFailureTraces: Any[] = (detail.decision_traces || []).filter((x: Any) => x.status === "failed" && !x.decision_id);
  const allDayTraces = dayTraces;
  const attemptIds = new Set(dayTraces.map((x: Any) => x.attempt_id).filter(Boolean));
  const hasDecisionTraces = (detail.decision_traces || []).length > 0;
  const datedUsage = (detail.llm_usage || []).filter((x: Any) => hasDecisionTraces
    ? attemptIds.has(x.attempt_id) || attemptIds.has(x.step_attempt_id)
    : x.as_of_time === selectedAsOf || x.as_of_date === day);
  const isLegacy = !detail.decision_traces?.length && (detail.llm_usage || []).length > 0;
  const allVisibleFills = orders.flatMap((order: Any) => (order.fills || []).filter((fill: Any) => fillVisibleAt(fill, selectedAsOf)).map((fill: Any) => ({ ...fill, order })));
  const availableSymbols: string[] = market?.symbols || detail.config?.symbols || [];
  const holdingsValue = historicalMarketValue(selectedHistory, holdingsAtSnapshot(selectedHistory));
  const displayedSymbols = [symbol, ...pinnedSymbols].filter((value, index, values) => value && availableSymbols.includes(value) && values.indexOf(value) === index);
  const currentPending = currentPendingDecision(detail.decisions || []);

  const isQuant = detail.config?.lab_mode === "quant_baseline" || (!detail.config?.lab_mode && detail.config?.strategy !== "agent");
  const deterministic = isQuant || detail.config?.provider_mode === "demo";
  const proposalLabel = isQuant ? t("基准策略原始建议") : detail.config?.provider_mode === "demo" ? t("演示策略原始建议") : t("AI 原始建议");
  const rationaleLabel = deterministic ? t("策略依据") : t("原始依据（模型返回文本，不作翻译）");
  const strategyLabel = isQuant ? t("基准策略") : detail.config?.provider_mode === "demo" ? t("演示策略") : t("Agent 记录");
  const stepLabel = timestampMode ? t("推进到下一时间点") : t("推进一天");
  return <>
    <section className="replay-console" aria-label={t("历史回放控制")}>
      <div className="playback-controls">
        <span className="replay-provenance" tabIndex={0} title={t("历史回放：仅浏览已记录时间点，不调用模型。演示与基准策略为确定性规则。")} aria-label={t("历史回放 · {strategy} · 仅浏览已记录时间点，不调用模型", {strategy: strategyLabel})}><span className="replay-live-dot"/>{t("回放")} · {strategyLabel}</span>
        <label className="symbol-picker"><span className="visually-hidden"><LText id="标的"/></span><select aria-label={t("选择回放标的")} value={symbol} onChange={(e) => chooseSymbol(e.target.value)}>{(market?.symbols || detail.config?.symbols || [...new Set<string>((detail.history || []).flatMap((h: Any) => Object.keys(h.positions || {}))) ]).map((x: string) => <option key={x} value={x}>{x}</option>)}</select></label>
        <details className="compare-picker">
          <summary>{t("desk.multi")} <span>{displayedSymbols.length}</span></summary>
          <div className="compare-options">
            <p>{t("desk.sharedClock")}</p>
            <button type="button" onClick={() => setPinnedSymbols(availableSymbols.filter(value => value !== symbol))}>{t("desk.showAll")}</button>
            <button type="button" onClick={() => setPinnedSymbols([])}>{t("desk.mainOnly")}</button>
            {availableSymbols.map(value => <label key={value}>
              <input type="checkbox" checked={displayedSymbols.includes(value)} disabled={value === symbol}
                onChange={event => setPinnedSymbols(current => event.target.checked ? [...current, value] : current.filter(item => item !== value))} />
              {value}{value === symbol && <small>{t("desk.mainSymbol")}</small>}
            </label>)}
          </div>
        </details>
        <div className="transport">
          <Btn className="playback-icon" aria-label={timestampMode ? t("上一时间点") : t("上一交易日")} data-tooltip={timestampMode ? t("上一时间点") : t("上一交易日")} disabled={dayIndex <= 0} onClick={() => { setPlaying(false); setDay(dates[dayIndex - 1]); }}><ReplayIcon name="back"/></Btn>
          <Btn className="playback-icon primary" aria-label={playing ? t("暂停回放") : dayIndex >= dates.length - 1 ? t("从头播放") : t("播放回放")} data-tooltip={playing ? t("暂停回放") : dayIndex >= dates.length - 1 ? t("从头播放") : t("播放回放")} disabled={!dates.length || (dayIndex >= dates.length - 1 && playing)} onClick={() => { if (playing) setPlaying(false); else { if (dayIndex >= dates.length - 1) setDay(dates[0]); setPlaying(true); } }}><ReplayIcon name={playing ? "pause" : "play"}/></Btn>
          <Btn className="playback-icon" aria-label={timestampMode ? t("下一时间点") : t("下一交易日")} data-tooltip={timestampMode ? t("下一时间点") : t("下一交易日")} disabled={dayIndex >= dates.length - 1} onClick={() => { setPlaying(false); setDay(dates[dayIndex + 1]); }}><ReplayIcon name="forward"/></Btn>
        </div>
        <label className="speed-picker"><span className="visually-hidden"><LText id="回放速度"/></span><select aria-label={t("回放速度")} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        <span className="playback-date">{marketTime(day) || t("暂无记录")}<small>{dates.length ? t("{current} / {total} 个时间点", {current: dayIndex + 1, total: dates.length}) : t("尚无逐时记录")}</small></span>
      </div>
      <div className="playback-timeline"><span>{marketTime(dates[0] || "—")}</span><input className="date-slider" aria-label={t("选择回放时间点")} type="range" min="0" max={Math.max(0, dates.length - 1)} value={dayIndex} disabled={dates.length < 2} onChange={(e) => { setPlaying(false); setDay(dates[Number(e.target.value)]); }} /><span>{marketTime(dates[dates.length - 1] || "—")}</span></div>
      <details className="run-actions">
        <summary><span><LText id="实验控制"/></span><span className={deterministic ? "control-mode" : "control-mode warn-text"}>{isQuant ? t("确定性基准 · 无模型调用") : detail.config?.provider_mode === "demo" ? t("确定性演示 · 无模型调用") : t("推进实验会调用模型")}</span><span className="control-state">{detail.status ? enumLabel(t, detail.status) : t("状态未知")}</span></summary>
        <div className="run-actions-content">
          <div className="control-explanation"><b><LText id="实验控制"/></b><small>{deterministic ? t("推进现有实验记录；此配置不会调用模型。") : t("推进实验将调用模型；历史回看只浏览已保存内容，不会调用模型。")}</small></div>
          <Btn disabled={busy || detail.status === "completed" || !!currentPending} onClick={() => doStep()}>{t(deterministic ? "{step} (no model call)" : "{step} (model call)", {step:stepLabel})}</Btn>
          <Btn disabled={busy || detail.status === "completed" || !!currentPending} onClick={() => doRun(detail.status === "running" ? "pause" : "run")}>{detail.status === "running" ? t("暂停实验") : deterministic ? t("运行实验（无模型调用）") : t("运行实验（调用模型）")}</Btn>
          <Btn onClick={branch}><LText id="创建监督分支"/></Btn>
          {currentPending && <span className="tag warn"><LText id="待人工审核 · 暂停推进"/></span>}
          <span className="tag">{t("Experiment status")} · {enumLabel(t, detail.status)}</span>
        </div>
      </details>
    </section>

    {currentPending && <section className="current-pending-operation" aria-label={t("当前待人工审核提案")}>
      <div><b><LText id="当前待审核提案 · 当前操作"/></b><small>{t("决策数据时点")} {marketTime(decisionTime(currentPending)) || t("未记录")} · {t("生成完成")} {marketTime(decisionAvailableAt(currentPending)) || t("未记录")}</small></div>
      <p><LText id="此处是实验当前待处理建议；历史回放仅在所选快照的可用时间达到建议生成时间后显示它。"/></p>
      <div className="current-pending-actions"><Btn disabled={busy} kind="primary" onClick={() => decision(currentPending,"approve")}><LText id="批准"/></Btn><Btn disabled={busy} onClick={() => decision(currentPending,"modify")}><LText id="修改"/></Btn><Btn disabled={busy} kind="danger" onClick={() => decision(currentPending,"reject")}><LText id="拒绝"/></Btn></div>
    </section>}

    {isLiveExperiment && <Panel title={t("前向模拟 · 实验控制")}>
      <p><LText id="实验和行情采集分别运行。开始会按此实验配置处理后续数据；不会调用真实券商下单。历史时间轴仍可用于检查已保存记录。"/></p>
      <div className="toolbar"><label><LText id="Collector"/><select aria-label={t("选择行情采集器")} value={collectorId} onChange={(e) => setCollectorId(e.target.value)}><option value=""><LText id="Choose a running collector"/></option>{collectors.filter((c: Any) => ["running", "starting", "reconnecting"].includes(String(c.status || "").toLowerCase())).map((c: Any) => <option key={c.id || c.session_id} value={c.id || c.session_id}>{c.source === "demo" || c.synthetic ? t("合成演示 · 加速虚拟时钟") : "Alpaca · IEX"} · {(c.symbols || []).join(", ")} · {c.timeframe || "—"}</option>)}</select></label><Btn disabled={liveBusy || !collectorId || ["running", "active"].includes(String(liveStatus?.status || "").toLowerCase())} onClick={startLive}><LText id="Start forward simulation"/></Btn><Btn disabled={liveBusy || !["running", "active"].includes(String(liveStatus?.status || "").toLowerCase())} onClick={stopLive}><LText id="Pause simulation"/></Btn><span className="tag">{liveStatus?.status ? enumLabel(t, liveStatus.status) : t("Not started")}</span></div>
      {liveStatus?.last_bar_at && <small>{t("Last market bar")}: {marketTime(liveStatus.last_bar_at)} · {t("last decision started")} {liveStatus.last_decision_started_at ? marketTime(liveStatus.last_decision_started_at) : "—"} · {t("completed")} {liveStatus.last_decision_completed_at ? marketTime(liveStatus.last_decision_completed_at) : "—"}</small>}
      {liveError && <div className="error"><ErrorMessage error={liveError}/></div>}
    </Panel>}
    <div className="replay-layout">
      <div className="replay-charts" aria-label={t("desk.charts")}>
        {displayedSymbols.map((chartSymbol) => (
          <ReplayChart key={chartSymbol} detail={detail} market={market} marketLoading={marketLoading}
            marketError={marketError} symbol={chartSymbol} day={day} selectedAsOf={selectedAsOf}
            latest={latest} waitingForFirstBar={waitingForFirstBar} onPause={() => setPlaying(false)}
            onNavigate={(sourceSymbol, sourceDay) => { setPlaying(false); chooseSymbol(sourceSymbol); setDay(sourceDay); }} />
        ))}
      </div>
      <section className="replay-side desk-tabs-shell" aria-label={timestampMode ? t("时间点详情") : t("交易日详情")}>
        <div className="desk-tabs" role="tablist" aria-label={t("交易台信息")} onKeyDown={(e) => {
          const tabs = ["decision", "account", "fills", "agent", "experts"];
          const current = tabs.indexOf(activeTab);
          const next = e.key === "ArrowRight" ? (current + 1) % tabs.length : e.key === "ArrowLeft" ? (current + tabs.length - 1) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
          if (next >= 0) { e.preventDefault(); setActiveTab(tabs[next]); window.requestAnimationFrame(() => document.getElementById("desk-tab-" + tabs[next])?.focus()); }
        }}>
          {[ ["decision", "决策"], ["account", "账户"], ["fills", "成交"], ["agent", "Agent过程"], ["experts", "专家"] ].map(([id, label]) => <button key={id} id={"desk-tab-" + id} type="button" role="tab" aria-selected={activeTab === id} aria-controls="desk-panel" tabIndex={activeTab === id ? 0 : -1} onClick={() => setActiveTab(id)}>{t(label)}</button>)}
        </div>
        <ScrollRegion label={timestampMode ? t("时间点详情") : t("交易日详情")} bounded={false} className="desk-tab-content" id="desk-panel" role="tabpanel" aria-labelledby={"desk-tab-" + activeTab}>
          {activeTab === "decision" && <>{detail.config?.lab_mode === "quant_baseline" ? <QuantDetails config={detail.config} decision={decisionForDay} onTrace={()=>go?.("harness")} showAllocation={false}/> : detail.config?.lab_mode && <AnalysisPanel id={detail.id} config={detail.config} cutoff={selectedAsOf} revision={detail.state?.cursor ?? detail.history?.length} showControls/>}{        <div className="snapshot-card proposal-card">
          <span className="eyebrow">{t("历史决策")} · {marketTime(day) || "—"}</span>
          {decisionForDay ? <>
            <div className="proposal-head"><strong className={`action-${actionWord(originalProposal.action).toLowerCase()}`}>{enumLabel(t, originalProposal.action || "hold")}</strong><span className="tag">{reviewAction ? `${t("人工审核")}：${enumLabel(t, reviewAction)}` : detail.config?.mode === "ai_only" ? t("无需人工审核") : t("审核结果未记录")}</span></div>
            <ProposalAllocation proposal={originalProposal} label={proposalLabel} />
            {reviewAction && <div className="review-outcome"><b>{t("人工审核结果")}：{enumLabel(t, reviewAction)}</b>{decisionForDay.review?.reason && <p>{t("审核原因（原文）")}：{decisionForDay.review.reason}</p>}{reviewAction === "modify" && <><small><LText id="修改后目标仓位"/></small>{Object.entries(finalProposal.targets || {}).map(([s,v]: any)=><div className="target-row" key={s}><span>{s}</span><b>{pct(v)}</b></div>)}</>}</div>}
            {(originalProposal.risks || []).length > 0 && <details><summary>{t("风险提示（原文）")}（{originalProposal.risks.length}）</summary><ul>{originalProposal.risks.map((r: string,i: number)=><li key={i}>{r}</li>)}</ul></details>}
            <details><summary>{rationaleLabel}</summary><pre>{originalProposal.rationale || (deterministic ? t("确定性策略未保存文字依据。") : t("未保存原始依据文本"))}</pre></details>
          </> : <p className="muted"><LText id="此时间点没有已保存的决策。"/></p>}
        </div>}</>}
          {activeTab === "fills" && <>{        <div className="snapshot-card"><span className="eyebrow">{executionHeading}</span><p className="muted">{executionRule}</p>
          {dayOrders.length > 0 && <div className="execution-group"><b><LText id="此时点建议对应的订单"/></b>{dayOrders.map((o: Any)=><div className="fill-row" key={o.id}><strong>{Object.keys(o.target_weights || {}).join(", ") || t("目标仓位")}</strong><span>{o.status === "pending_final_session" ? t("末端建议尚未成交 · 范围内没有后续可执行 bar") : (o.fills || []).some((f: Any)=>fillVisibleAt(f, selectedAsOf)) ? t("截至此时点已有模拟成交") : detail.config?.market_mode === "live" ? t("等待后续观察到的 bar 模拟执行") : t("等待下一根符合条件的 bar 开盘模拟执行")}</span></div>)}</div>}
          {arrivals.length > 0 ? <div className="execution-group"><b><LText id="所选 bar 对应的模拟成交"/></b>{arrivals.flatMap((order: Any)=>(order.fills||[]).filter((fill: Any)=>fillVisibleAt(fill, selectedAsOf) && (fillBarTime(fill)===day || fillAt(fill)===day)).map((f: Any,i: number)=>{const source=(detail.decisions||[]).find((d: Any)=>(d.id||d.decision_id)===order.decision_id);const sourceProposal=source?.original_proposal||source?.proposal||source||{};const reason=String(order.system_reason||order.reason||order.order_type||order.type||f.reason||"").toLowerCase();const systemExpiry=order.source==="system_hold_expiry"||["system_hold_expiry","holding_horizon_expiry","holding_expiry","holding_horizon_expired"].includes(reason);const sourceTime=systemExpiry?"":decisionTime(source)||order.created_at||order.created_date;const sourceHistory=(detail.history||[]).find((h: Any)=>h.as_of_time===sourceTime||dateOf(h)===sourceTime);const targetTime=historyKeyAtOrAfter(detail.history||[],fillAt(f)) || (sourceHistory?dateOf(sourceHistory):sourceTime);return <div className="fill-row" key={`${order.id}-${i}`}><strong className={f.side === "sell" ? "red" : "green"}>{enumLabel(t, f.side)} {f.symbol} · {Number(f.quantity).toFixed(3)} {t("股")}</strong><span>{t("模拟成交")} {marketTime(fillAt(f))} · {t("价格依据")} {marketTime(f.price_time || f.source_bar_end || f.date || "")} · {t("成交价")} {money(f.price ?? f.fill_price,2)} · {t("费用")} {money(f.fees,2)}</span>{systemExpiry ? <div className="fill-source"><LText id="系统持仓到期退出"/></div> : sourceTime ? <div className="fill-source">{t("来源建议")}：{marketTime(sourceTime)} · {actionWord(sourceProposal.action)} <Btn onClick={() => {setPlaying(false);if(symbol!==f.symbol)chooseSymbol(f.symbol);setDay(targetTime);setActiveTab("decision");}}><LText id="查看来源建议"/></Btn></div> : <div className="fill-source"><LText id="未关联来源建议"/></div>}</div>}))}</div> : !dayOrders.length && <p className="muted"><LText id="所选时间点没有模拟成交。历史 bar 回放仍按配置的成交时点推进。"/></p>}
        </div>}</>}
          {activeTab === "account" && <>
            <div className="snapshot-card"><span className="eyebrow">{marketTime(day) || "—"} · {t("历史账户快照")}</span><div className="snapshot-grid"><div><small><LText id="资产净值"/></small><b>{money(selectedHistory?.equity)}</b></div><div><small><LText id="现金"/></small><b>{money(selectedHistory?.cash)}</b></div><div><small><LText id="持仓市值"/></small><b>{money(Number.isFinite(holdingsValue) ? holdingsValue : null)}</b></div><div><small>{timestampMode ? t("本 bar 收益") : t("当日收益")}</small><b className={((timestampMode ? selectedHistory?.interval_return : selectedHistory?.daily_return) || 0) < 0 ? "red" : "green"}>{pct(timestampMode ? selectedHistory?.interval_return : selectedHistory?.daily_return)}</b></div></div><small className="muted"><LText id="完整持仓明细始终显示在交易台下方。"/></small></div>
            
            {    <Panel title={t("资产曲线（截至所选时点）")}>
      <Chart history={(detail.history || []).filter((x: Any) => historyVisibleAt(x, selectedAsOf))} benchmark={(detail.benchmark_history || []).filter((x: Any) => historyVisibleAt(x, selectedAsOf))} />
      <div className="micro">{t("只展示所选时点及之前已记录的资产数据。")} {t("累计手续费")} {money(selectedHistory?.fees_paid_total, 2)}</div>
    </Panel>}
          </>}
          {activeTab === "agent" && <>{    <Panel title={t("可观察的 Agent 输出")}>
      {isLegacy && <div className="legacy-note"><LText id="旧实验未保存逐日专家过程；下方只展示真实保存的逐日决策。历史模型调用未标记日期，不能映射到某一天。"/></div>}
      {currentFailureTraces.length > 0 && <div className="legacy-note"><b><LText id="当前实验失败审计（未记录可用完成时点）"/></b><p><LText id="以下失败记录保留在实验审计中，不归属于所选历史回放时点。"/></p>{currentFailureTraces.map((trace: Any,i: number)=><div key={trace.attempt_id || i}><span className="tag warn"><LText id="失败尝试"/> {trace.attempt_id || i+1}</span>{trace.error && <p>{t("Server response (original)")} · {trace.error}</p>}</div>)}</div>}
      {allDayTraces.map((trace: Any,i: number)=><div className="attempt-row" key={trace.attempt_id || i}><div className="trace-summary"><span className={`tag ${trace.status === "failed" ? "warn" : ""}`}><LText id="尝试"/> {i+1} · {trace.status ? enumLabel(t, trace.status) : <LText id="已记录"/>}</span><span className="tag">{trace.attempt_id || <LText id="ID 未记录"/>}</span>{trace.error && <span className="tag warn">{t("Server response (original)")} · {trace.error}</span>}</div>{trace.expert_opinions?.length > 0 && <div className="trace-grid">{trace.expert_opinions.map((op: Any,j: number)=><div className="opinion" key={j}><b>{op.name || op.expert_name || op.expert_id || t("Expert {number}", {number:j+1})}</b><span>{enumLabel(t, op.role || "advisor")} · {enumLabel(t, op.action || op.stance || "hold")}</span><p>{op.rationale ? <>{t("原文 / Original")} · {op.rationale}</> : <LText id="未保存可观察依据。"/>}</p></div>)}</div>}{trace.coordination && <details><summary><LText id="协调员汇总 · 可观察输出"/></summary><CoordinatorSummary value={trace.coordination}/></details>}</div>)}
      {datedUsage.length > 0 && <details><summary>{t("该日模型调用与重试")}（{datedUsage.length}）</summary>{datedUsage.map((u: Any,i: number)=><div className="usage-row" key={u.attempt_id || i}><b>{u.expert_name || u.role || "Agent"}</b><span>{enumLabel(t, u.status)} · {u.model || t("Model not recorded")} · {u.elapsed_seconds ?? "—"} {t("秒")} · {money(u.estimated_cost_usd,4)}</span>{u.input_context && <small>{t("可见输入（原文）")}：{formatValue(u.input_context,240)}</small>}<details><summary><LText id="模型返回内容 / 工具调用"/></summary><pre>{modelOutput(u) || t("服务端没有保存可展示的原始响应内容。")}</pre></details></div>)}</details>}
      {isLegacy && <details><summary><LText id="历史模型调用（未标注日期，不归属到某一天）"/></summary>{(detail.llm_usage || []).map((u: Any,i: number)=><div className="usage-row" key={i}><b>{u.expert_name || u.role || "Agent"}</b><span>{enumLabel(t, u.status)} · {u.model || "—"} · {u.elapsed_seconds ?? "—"} {t("秒")} · {money(u.estimated_cost_usd,4)}</span><details><summary><LText id="模型返回内容 / 工具调用"/></summary><pre>{modelOutput(u) || t("服务端没有保存可展示的原始响应内容。")}</pre></details></div>)}</details>}
      <div className="agent-role-key"><LText id="交易员提出交易候选 · 顾问提供独立意见 · 协调员形成唯一最终建议。这里展示实际保存的输出，不推断模型内部推理过程。"/></div>
    </Panel>}</>}
          {activeTab === "experts" && <div className="snapshot-card"><span className="eyebrow"><LText id="实验当前团队"/></span><p className="muted"><LText id="团队配置按实验当前状态显示，与上方所选历史日期无关。调整在下一决策边界生效。"/></p>{detail.config?.lab_mode ? <p>{t("four.independentModules")}</p> : detail.config?.strategy !== "agent" ? <p>{t("此确定性 {strategy} 基准不调用专家或 LLM。", {strategy:detail.config?.strategy})}</p> : <><div className="badgegrid">{(detail.state?.active_team?.length ? detail.state.active_team : detail.config?.team || []).map((member: Any) => { const expert = experts.find((item: Any) => item.id === (member.expert_id || member.id)) || member; return renderExpert ? <React.Fragment key={member.expert_id || member.id}>{renderExpert(expert, member.role || "advisor", member.enabled !== false)}</React.Fragment> : <div className="snapshot-card" key={member.expert_id || member.id}><b>{expert.name || expert.expert_id || member.expert_id}</b><div className="muted">{enumLabel(t, member.role || "advisor")} · {member.enabled === false ? t("已停用") : t("启用")}</div><small>v{expert.version || "1"}</small></div>; })}</div>{detail.state?.pending_team && <><p className="tag"><LText id="团队变更已排期至下一决策边界"/></p><div className="badgegrid">{detail.state.pending_team.team.map((member: Any) => { const expert = experts.find((item: Any) => item.id === (member.expert_id || member.id)) || member; return renderExpert ? <React.Fragment key={member.expert_id || member.id}>{renderExpert(expert, member.role || "advisor", member.enabled !== false)}</React.Fragment> : <div className="snapshot-card" key={member.expert_id || member.id}><b>{expert.name || member.expert_id}</b><div className="muted">{enumLabel(t, member.role || "advisor")}</div></div>; })}</div></>}<div className="toolbar"><Btn onClick={() => editTeam?.()}><LText id="编辑 / 选择专家"/></Btn><Btn onClick={() => go?.("Expert library")}><LText id="打开专家库"/></Btn></div></>}</div>}
        </ScrollRegion>
      </section>
    </div>
    <HoldingsPanel snapshot={selectedHistory} fills={allVisibleFills} timeLabel={marketTime(day) || "—"} />
  </>;
}

function proposalSummary(proposal: Any, t: (key: string) => string) {
  const action = String(proposal?.action || "hold").toLowerCase();
  const targets = proposal?.targets;
  if (proposal?.preserve_symbols?.length && action !== "hold") return `${t("four.preserve")} · ${proposal.preserve_symbols.join(", ")}. ${t("four.otherTargets")} ${Object.entries(targets || {}).map(([s,v]:any)=>`${s} ${pct(v)}`).join(", ") || t("four.none")}.`;
  if (action === "hold" && (!targets || !Object.keys(targets).length)) return t("保持现有持仓，不下单。");
  if ((action === "rebalance" || action === "sell_all") && targets && !Object.keys(targets).length) return t("目标为现金 100%，需要清空现有持仓。");
  const names: Record<string,string> = { buy: "买入建议", sell: "卖出建议", hold: "持有建议", rebalance: "调整目标仓位", reduce: "降低目标仓位", sell_all: "清空持仓" };
  return `${t(names[action] || "记录的交易建议")}${targets ? ` · ${t("目标仓位")} ${Object.entries(targets).map(([s,v]: any)=>`${s} ${pct(v)}`).join(", ") || t("现金 100%")}` : ""}.`;
}
function ReplayIcon({ name }: { name: "back" | "play" | "pause" | "forward" }) {
  const { t } = useLocale();
  const paths: Record<string, React.ReactNode> = {
    back: <><path d="M6 5v14"/><path d="m18 6-9 6 9 6z"/></>,
    play: <path d="m8 5 11 7-11 7z"/>,
    pause: <><path d="M8 5h3v14H8z"/><path d="M15 5h3v14h-3z"/></>,
    forward: <><path d="M18 5v14"/><path d="m6 6 9 6-9 6z"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
function formatValue(value: any, limit?: number) { const text = typeof value === "string" ? value : JSON.stringify(value); return limit && text.length > limit ? `${text.slice(0,limit)}…` : text; }
function modelOutput(usage: Any) {
  const raw=usage?.raw_output||{};
  const calls=(raw.tool_calls||[]).map((call: Any)=>`${call.function?.name || "tool"}\n${formatValue(call.function?.arguments || "")}`);
  return [raw.content, ...calls].filter(Boolean).join("\n\n");
}
function CoordinatorSummary({ value }: {value: any}) {
  const { t } = useLocale();
  const object=typeof value === "string" ? { summary:value } : value || {};
  const final=object.final_proposal || object;
  return <div className="coordinator-summary"><b>{t("最终建议")} · {enumLabel(t, final.action || "hold")}</b><p>{proposalSummary(final, t)}</p>{final.rationale && <details><summary><LText id="协调员依据原文"/></summary><pre>{final.rationale}</pre></details>}{Array.isArray(object.adviser_opinions) && object.adviser_opinions.length>0 && <div><small>{t("记录的专家输入")}：{object.adviser_opinions.length}</small>{object.adviser_opinions.map((op: Any,i: number)=><p key={i}><b>{op.name || op.expert_name || op.role || t("Advisor {number}", {number:i+1})} · {enumLabel(t, op.action || op.stance || "hold")}</b><br/>{op.rationale || t("未保存依据。")}</p>)}</div>}<details><summary><LText id="查看完整协调员输出"/></summary><pre>{formatValue(object)}</pre></details></div>;
}
function Panel({ title, children, className = "" }: any) {
  const { t } = useLocale(); return <section className={`panel ${className}`}><h3>{title}</h3>{children}</section>; }
