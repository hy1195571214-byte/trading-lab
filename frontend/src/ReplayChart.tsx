import React, { useEffect, useId, useState } from "react";
import { Any } from "./api";
import { LText, useLocale, enumLabel } from "./i18n";
import { Empty, ErrorMessage } from "./ui";
import {
  aggregateBars,
  chartBarIndexForSource,
  intradayPriceAxis,
  isRegularSessionBar,
  marketSessionDate,
  rawBarEnd,
  rawBarTime,
  regularSessionX,
  supportsIntraday,
  visibleBarsAt,
} from "./chartData";
import {
  fillVisibleAt,
  historyKeyAtOrAfter,
  replayDateOf as dateOf,
  replayFillSourceTime as fillBarTime,
  replayFillTime as fillAt,
} from "./replayData";
const marketTimeFor = (value: string, locale: "en" | "zh-CN") => {
  if (!value || !value.includes("T")) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const fmt = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  } as const;
  return `${new Intl.DateTimeFormat(locale, { ...fmt, timeZone: "America/New_York" }).format(date)} ET / ${new Intl.DateTimeFormat(locale, { ...fmt, timeZone: "Asia/Shanghai" }).format(date)} ${locale === "en" ? "Beijing" : "北京时间"}`;
};
const chartTimeLabel = (value: string) => {
  if (!value?.includes("T")) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date)
    : value;
};
const price = (v: any) =>
  Number(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const chartX = (index: number, bars: Any[], mode: string, bar = bars[index]) =>
  mode === "intraday"
    ? (regularSessionX(rawBarEnd(bar)) ?? 48)
    : 48 +
      ((bars.length <= 3 ? index + 1 : index) * 824) /
        (bars.length <= 3 ? bars.length + 1 : Math.max(1, bars.length - 1));

type ReplayChartProps = {
  detail: Any;
  market: Any | null;
  marketLoading: boolean;
  marketError: Error | string;
  symbol: string;
  day: string;
  selectedAsOf: string;
  latest: string;
  waitingForFirstBar: boolean;
  onPause: () => void;
  onNavigate: (symbol: string, day: string) => void;
};

export default function ReplayChart({
  detail,
  market,
  marketLoading,
  marketError,
  symbol,
  day,
  selectedAsOf,
  latest,
  waitingForFirstBar,
  onPause,
  onNavigate,
}: ReplayChartProps) {
  const { t, locale } = useLocale();
  const marketTime = (value: string) => marketTimeFor(value, locale);
  const orders = detail.orders || [];
  const [hover, setHover] = useState<Any | null>(null);
  const [lockedBar, setLockedBar] = useState<Any | null>(null);
  const [chartWindow, setChartWindow] = useState("60");
  const [selectedChartMode, setSelectedChartMode] = useState("");
  const [showOperations, setShowOperations] = useState(false);
  useEffect(() => {
    setHover(null);
    setLockedBar(null);
  }, [day, symbol]);
  const marketInterval =
    market?.bar_interval ||
    market?.timeframe ||
    detail.config?.bar_interval ||
    "";
  const marketSchema = Math.max(
    Number(detail?.config?.schema_version || 1),
    Number(market?.schema_version || 1),
  );
  const visibleMarketBars = visibleBarsAt(
    (market?.bars || []).filter((x: Any) => !symbol || x.symbol === symbol),
    selectedAsOf || day,
  );
  const intradayAvailable = supportsIntraday(
    visibleMarketBars,
    marketSchema,
    marketInterval,
  );
  const chartMode =
    selectedChartMode === "intraday" && intradayAvailable
      ? "intraday"
      : selectedChartMode === "week"
        ? "week"
        : selectedChartMode === "day"
          ? "day"
          : intradayAvailable
            ? "intraday"
            : "day";
  const selectedSessionDate = marketSessionDate(
    visibleMarketBars.length
      ? rawBarTime(visibleMarketBars[visibleMarketBars.length - 1])
      : selectedAsOf || day,
  );
  const eligibleMarketBars = visibleMarketBars;
  const intradayBars = eligibleMarketBars.filter(
    (bar: Any) =>
      marketSessionDate(rawBarTime(bar)) === selectedSessionDate &&
      isRegularSessionBar(bar),
  );
  const aggregatedBars =
    chartMode === "intraday"
      ? intradayBars
      : aggregateBars(eligibleMarketBars, chartMode, marketInterval);
  const bars =
    chartMode === "intraday" || chartWindow === "all"
      ? aggregatedBars
      : aggregatedBars.slice(-Number(chartWindow));
  const allVisibleFills = orders.flatMap((order: Any) =>
    (order.fills || [])
      .filter((fill: Any) => fillVisibleAt(fill, selectedAsOf))
      .map((fill: Any) => ({ ...fill, order })),
  );
  const visibleExecutionPrices = showOperations
    ? allVisibleFills
        .filter(
          (fill: Any) =>
            fill.symbol === symbol &&
            chartBarIndexForSource(bars, fill.symbol, fillBarTime(fill)) >= 0,
        )
        .map((fill: Any) => Number(fill.price ?? fill.fill_price))
        .filter(Number.isFinite)
    : [];
  const intradayAxis =
    chartMode === "intraday"
      ? intradayPriceAxis(bars, visibleExecutionPrices)
      : null;
  const sourceMin = bars.length
    ? Math.min(...bars.map((x: Any) => Number(x.low)))
    : 0;
  const sourceMax = bars.length
    ? Math.max(...bars.map((x: Any) => Number(x.high)))
    : 1;
  const minPrice =
    intradayAxis?.min ??
    Math.min(sourceMin, ...(showOperations ? visibleExecutionPrices : []));
  const maxPrice =
    intradayAxis?.max ??
    Math.max(sourceMax, ...(showOperations ? visibleExecutionPrices : []));
  const range = maxPrice - minPrice || Math.max(Math.abs(maxPrice) * 0.02, 1);
  const priceY = (value: number) => 20 + ((maxPrice - value) / range) * 255;
  const markers = showOperations
    ? [
        ...allVisibleFills.flatMap((fill: Any) => {
          const sourceTime = fillBarTime(fill);
          const index =
            chartBarIndexForSource(bars, fill.symbol, sourceTime) >= 0
              ? chartBarIndexForSource(bars, fill.symbol, sourceTime)
              : chartBarIndexForSource(
                  bars,
                  fill.symbol,
                  fill.source_bar_start || "",
                );
          if (index < 0) return [];
          const b = bars[index];
          const executionPrice = Number(fill.price ?? fill.fill_price);
          if (!Number.isFinite(executionPrice)) return [];
          const replayTime =
            historyKeyAtOrAfter(detail.history || [], fillAt(fill)) ||
            sourceTime;
          return [
            {
              x: chartX(index, bars, chartMode, b),
              y: priceY(executionPrice),
              kind: fill.side === "sell" ? "sell" : "buy",
              label: fill.side === "sell" ? "S" : "B",
              title: t(
                "Simulated fill {side} {symbol} · {quantity} shares · filled {time} · price {price} · price basis {basis}",
                {
                  side: enumLabel(t, fill.side),
                  symbol: fill.symbol,
                  quantity: Number(fill.quantity).toFixed(3),
                  time: marketTime(fillAt(fill)),
                  price: price(executionPrice),
                  basis: marketTime(
                    fill.price_time || fill.source_bar_end || fill.date || "",
                  ),
                },
              ),
              date: replayTime,
              symbol: fill.symbol,
            },
          ];
        }),
      ]
    : [];
  const displayMarkers = spreadAggregateMarkers(
    markers,
    chartMode,
    bars.length,
  );
  const volumeMax = Math.max(1, ...bars.map((x: Any) => Number(x.volume) || 0));
  const selectedBar = bars[bars.length - 1] || null;
  const previousBar = bars.length > 1 ? bars[bars.length - 2] : null;
  const viewedBar = lockedBar || hover || selectedBar;
  const referencePrice = chartMode === "intraday" ? intradayAxis?.open : null;
  const quotePrice = selectedBar ? Number(selectedBar.close) : NaN;
  const comparisonPrice =
    chartMode === "intraday"
      ? referencePrice
      : previousBar
        ? Number(previousBar.close)
        : null;
  const priceChange =
    comparisonPrice != null &&
    Number.isFinite(quotePrice) &&
    Number.isFinite(Number(comparisonPrice))
      ? quotePrice - Number(comparisonPrice)
      : null;
  const priceChangePct =
    priceChange != null && Number(comparisonPrice)
      ? priceChange / Number(comparisonPrice)
      : null;
  const priceChangeLabel =
    chartMode === "intraday"
      ? t("较开盘参考")
      : chartMode === "week"
        ? t("较前周 K 收盘")
        : t("较前日 K 收盘");
  const recordEndTime = intradayBars.length
    ? chartTimeLabel(rawBarEnd(intradayBars[intradayBars.length - 1]))
    : "";
  const currentDayComplete = day === latest;
  const sourceRangeComplete = detail.status === "completed";
  const isBeforeRthClose =
    chartMode === "intraday" && recordEndTime && recordEndTime < "16:00";
  const intradayRecordStatus =
    chartMode === "intraday" && recordEndTime
      ? currentDayComplete && sourceRangeComplete && isBeforeRthClose
        ? t("当日记录止于 {time} ET，剩余时段无数据", { time: recordEndTime })
        : currentDayComplete && sourceRangeComplete
          ? t("当日记录止于 {time} ET，常规时段收盘", { time: recordEndTime })
          : t("回放至 {time} ET", { time: chartTimeLabel(selectedAsOf || day) })
      : "";
  const readoutTime = viewedBar ? chartTimeLabel(rawBarEnd(viewedBar)) : "—";
  const replayQuoteTime = selectedBar
    ? chartTimeLabel(selectedBar.source_as_of || rawBarEnd(selectedBar))
    : "—";
  const coverageLabel =
    chartMode !== "intraday"
      ? bars.find((bar: Any) => bar.coverage_label)?.coverage_label
      : "";
  return (
    <Panel
      className="candle-panel"
      title={`${symbol || t("标的")} · ${chartMode === "intraday" ? `${t("分时")} · ${marketInterval}` : chartMode === "week" ? t("周 K") : t("日 K")}`}
      symbol={symbol}
      quote={selectedBar ? price(selectedBar.close) : "—"}
      change={priceChangePct}
    >
      <div className="quote-strip">
        <div className="quote-main">
          <span>
            {symbol || "—"} · {t("回放价")}{" "}
            {selectedBar?.is_complete === false
              ? t("形成中")
              : chartMode === "intraday"
                ? t("分时")
                : chartMode === "week"
                  ? t("周 K")
                  : t("日 K")}
          </span>
          <b>{selectedBar ? price(selectedBar.close) : "—"}</b>
          <small
            className={
              priceChange == null || priceChange === 0
                ? "price-flat"
                : priceChange > 0
                  ? "price-up"
                  : "price-down"
            }
          >
            {priceChange == null
              ? `${priceChangeLabel}：—`
              : `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)} · ${priceChangePct! >= 0 ? "+" : ""}${(priceChangePct! * 100).toFixed(2)}% ${priceChange > 0 ? t("涨") : priceChange < 0 ? t("跌") : t("持平")} · ${priceChangeLabel}`}
          </small>
        </div>
        <div className="quote-meta">
          <span>
            {selectedBar?.source_feed ||
              market?.source_feed ||
              market?.source ||
              market?.metadata?.feed ||
              t("行情来源未记录")}
          </span>
          <span>
            {marketInterval || "daily"} · {t("原始数据")}
          </span>
          <span>
            {t("回放价截至")} {replayQuoteTime} ET
          </span>
          {lockedBar && (
            <button
              type="button"
              className="readout-return"
              onClick={() => {
                setLockedBar(null);
                setHover(null);
              }}
            >
              {t("读数锁定 {readout} ET（回放 {replay} ET）· 返回最新", {
                readout: readoutTime,
                replay: replayQuoteTime,
              })}
            </button>
          )}
        </div>
        <div className="chart-range" role="group" aria-label={t("图表周期")}>
          <button
            type="button"
            aria-pressed={chartMode === "intraday"}
            disabled={!intradayAvailable}
            title={
              !intradayAvailable
                ? t("当前没有可显示的日内数据")
                : t("显示所选交易日已可见的分钟/小时收盘数据")
            }
            onClick={() => {
              setHover(null);
              setLockedBar(null);
              setSelectedChartMode("intraday");
            }}
          >
            <LText id="分时" />
          </button>
          <button
            type="button"
            aria-pressed={chartMode === "day"}
            onClick={() => {
              setHover(null);
              setLockedBar(null);
              setSelectedChartMode("day");
            }}
          >
            <LText id="日 K" />
          </button>
          <button
            type="button"
            aria-pressed={chartMode === "week"}
            onClick={() => {
              setHover(null);
              setLockedBar(null);
              setSelectedChartMode("week");
            }}
          >
            <LText id="周 K" />
          </button>
          {chartMode !== "intraday" &&
            [
              ["30", "30 根"],
              ["60", "60 根"],
              ["all", "全部"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={chartWindow === value}
                onClick={() => setChartWindow(value)}
              >
                {t(label)}
              </button>
            ))}
          <button
            type="button"
            aria-pressed={showOperations}
            onClick={() => setShowOperations((value) => !value)}
          >
            <LText id="操作标记" />
          </button>
        </div>
      </div>
      {!intradayAvailable && !marketLoading && (
        <div className="micro">
          {visibleMarketBars.length
            ? t("当前实验只有日线数据，分时不可用。")
            : t("尚无可显示的日内数据。")}
        </div>
      )}
      {intradayRecordStatus && (
        <div
          className={`micro ${currentDayComplete && isBeforeRthClose ? "warn-text" : ""}`}
        >
          {intradayRecordStatus}
        </div>
      )}
      <div className="candle-legend">
        {chartMode === "intraday" ? (
          <>
            <span>
              <i className="legend-line" />
              <LText id="分时收盘" />
            </span>
            <span>
              <i className="legend-up" />
              <LText id="量红：较前收涨" />
            </span>
            <span>
              <i className="legend-down" />
              <LText id="量绿：较前收跌" />
            </span>
            <span>
              <i className="legend-flat" />
              <LText id="量灰：持平" />
            </span>
            <span>
              <i className="legend-buy" />
              <LText id="买入" />
            </span>
            <span>
              <i className="legend-sell" />
              <LText id="卖出" />
            </span>
          </>
        ) : (
          <>
            <span>
              <i className="legend-up" />
              <LText id="收涨" />
            </span>
            <span>
              <i className="legend-down" />
              <LText id="收跌" />
            </span>
            <span>
              <i className="legend-flat" />
              <LText id="持平" />
            </span>
            <span>
              <i className="legend-buy" />
              <LText id="模拟买入成交" />
            </span>
            <span>
              <i className="legend-sell" />
              <LText id="模拟卖出成交" />
            </span>
          </>
        )}
      </div>
      {marketLoading ? (
        <Empty>
          <LText id="正在读取所选时间点之前的行情…" />
        </Empty>
      ) : marketError ? (
        <div className="error">
          {t("行情暂不可用：")} <ErrorMessage error={marketError} />
        </div>
      ) : !bars.length ? (
        <Empty>
          {waitingForFirstBar
            ? t(
                "还没有时间戳行情。开始或推进实验后，将显示首个 K 线时间点与决策记录。",
              )
            : t("该时间点没有可显示的 {symbol} OHLCV 行情。", {
                symbol: symbol || t("市场"),
              })}
        </Empty>
      ) : (
        <>
          <div className="ohlc-strip">
            {viewedBar ? (
              <>
                <b>
                  {marketTime(dateOf(viewedBar))}
                  {lockedBar ? t(" · 已锁定") : hover ? t(" · 查看中") : ""}
                </b>
                <span>
                  {t("开")} {price(viewedBar.open)}
                </span>
                <span>
                  {t("高")} {price(viewedBar.high)}
                </span>
                <span>
                  {t("低")} {price(viewedBar.low)}
                </span>
                <span>
                  {t("收")} {price(viewedBar.close)}
                </span>
                <span>
                  {t("量")} {Number(viewedBar.volume || 0).toLocaleString()}
                </span>
              </>
            ) : (
              <span>
                <LText id="暂无所选行情读数" />
              </span>
            )}
          </div>
          {chartMode === "intraday" && (
            <div className="micro">
              <LText id="美股常规时段 09:30–16:00 ET · 盘前/盘后未显示 · 时间轴固定开盘至收盘" />
            </div>
          )}
          <div className="candle-wrap">
            <svg
              viewBox="0 0 900 370"
              preserveAspectRatio="none"
              role="img"
              aria-label={t("{symbol} {chart}，截至 {date}", {
                symbol,
                chart: t(
                  chartMode === "intraday" ? "分时价格折线" : "OHLC 蜡烛图",
                ),
                date: day,
              })}
              onMouseLeave={() => setHover(null)}
            >
              <text x="4" y="12" fill="#929b8d" fontSize="9">
                <LText id="价格" />
              </text>
              <text x="896" y="12" textAnchor="end" fill="#929b8d" fontSize="9">
                {chartMode === "intraday" ? t("较开盘参考") : t("价格")}
              </text>
              {[0, 1, 2, 3, 4].map((i) => {
                const tickPrice = maxPrice - (i * range) / 4,
                  pct = intradayAxis
                    ? (tickPrice / intradayAxis.open - 1) * 100
                    : null;
                return (
                  <g key={i}>
                    <line
                      x1="48"
                      x2="872"
                      y1={20 + i * 63.75}
                      y2={20 + i * 63.75}
                      stroke="#30352f"
                    />
                    <text x="4" y={24 + i * 63.75} fill="#929b8d" fontSize="10">
                      {price(tickPrice)}
                    </text>
                    <text
                      x="896"
                      y={24 + i * 63.75}
                      textAnchor="end"
                      fill="#929b8d"
                      fontSize="10"
                    >
                      {intradayAxis
                        ? `${pct! >= 0 ? "+" : ""}${pct!.toFixed(2)}%`
                        : price(tickPrice)}
                    </text>
                  </g>
                );
              })}
              {intradayAxis && (
                <g className="open-reference">
                  <line
                    x1="48"
                    x2="872"
                    y1={priceY(intradayAxis.open)}
                    y2={priceY(intradayAxis.open)}
                    stroke="#d6ee3e"
                    strokeDasharray="5 4"
                    opacity=".85"
                  />
                  <text
                    x="865"
                    y={priceY(intradayAxis.open) - 5}
                    textAnchor="end"
                    fill="#d6ee3e"
                    fontSize="9"
                  >
                    {t("开盘参考")} {price(intradayAxis.open)}
                  </text>
                </g>
              )}
              {chartMode === "intraday" ? (
                <>
                  <path
                    className="intraday-price-line"
                    d={bars
                      .map(
                        (bar: Any, i: number) =>
                          `${i ? "L" : "M"}${chartX(i, bars, chartMode, bar)},${priceY(Number(bar.close))}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke="#d6ee3e"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {bars.map((bar: Any, i: number) => {
                    const x = chartX(i, bars, chartMode, bar),
                      prevX =
                        i > 0
                          ? chartX(i - 1, bars, chartMode, bars[i - 1])
                          : null,
                      nextX =
                        i < bars.length - 1
                          ? chartX(i + 1, bars, chartMode, bars[i + 1])
                          : null,
                      spacing =
                        prevX == null
                          ? nextX == null
                            ? 2
                            : nextX - x
                          : nextX == null
                            ? x - prevX
                            : Math.min(x - prevX, nextX - x),
                      hitLeft =
                        prevX == null ? x - spacing / 2 : (prevX + x) / 2,
                      hitRight =
                        nextX == null ? x + spacing / 2 : (x + nextX) / 2,
                      y = priceY(Number(bar.close)),
                      bw = Math.max(0.5, Math.min(9, spacing * 0.7)),
                      vh = Math.max(
                        2,
                        ((Number(bar.volume) || 0) / volumeMax) * 45,
                      ),
                      showPoint =
                        dateOf(hover) === dateOf(bar) ||
                        dateOf(lockedBar) === dateOf(bar),
                      isLast = i === bars.length - 1,
                      volumeChange =
                        Number(bar.close) -
                        (i > 0 ? Number(bars[i - 1].close) : Number(bar.open)),
                      volumeFill =
                        volumeChange > 0
                          ? "#e27d76"
                          : volumeChange < 0
                            ? "#80d5a1"
                            : "#929b8d";
                    return (
                      <g
                        key={`${dateOf(bar)}-${bar.symbol}`}
                        className="intraday-point"
                        role="button"
                        tabIndex={0}
                        aria-label={t(
                          "{time} ET 收盘 {close}，成交量 {volume}",
                          {
                            time: chartTimeLabel(rawBarEnd(bar)),
                            close: price(bar.close),
                            volume: Number(bar.volume || 0).toLocaleString(
                              locale,
                            ),
                          },
                        )}
                        onMouseEnter={() => setHover(bar)}
                        onClick={() => {
                          onPause();
                          setHover(null);
                          setLockedBar((current: Any) =>
                            current && dateOf(current) === dateOf(bar)
                              ? null
                              : bar,
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            onPause();
                            setHover(null);
                            setLockedBar((current: Any) =>
                              current && dateOf(current) === dateOf(bar)
                                ? null
                                : bar,
                            );
                          }
                        }}
                      >
                        <circle
                          cx={x}
                          cy={y}
                          r={showPoint || isLast ? "3" : "0"}
                          fill="#d6ee3e"
                          pointerEvents="none"
                        />
                        <rect
                          x={x - bw / 2}
                          y={345 - vh}
                          width={bw}
                          height={vh}
                          fill={volumeFill}
                          opacity=".8"
                        >
                          <title>
                            {volumeChange > 0
                              ? t("成交量：收盘较前一根收盘上涨")
                              : volumeChange < 0
                                ? t("成交量：收盘较前一根收盘下跌")
                                : t("成交量：收盘较前一根收盘持平")}
                            {i === 0 ? t("（首根与开盘价比较）") : ""}
                          </title>
                        </rect>
                        <rect
                          x={hitLeft}
                          y="10"
                          width={Math.max(0, hitRight - hitLeft)}
                          height="350"
                          fill="transparent"
                        />
                      </g>
                    );
                  })}
                </>
              ) : (
                bars.map((bar: Any, i: number) => {
                  const x = chartX(i, bars, chartMode, bar),
                    bw = Math.max(3, Math.min(13, 700 / bars.length)),
                    o = priceY(Number(bar.open)),
                    c = priceY(Number(bar.close)),
                    hi = priceY(Number(bar.high)),
                    lo = priceY(Number(bar.low)),
                    change = Number(bar.close) - Number(bar.open),
                    volumeFill =
                      change > 0
                        ? "#e27d76"
                        : change < 0
                          ? "#80d5a1"
                          : "#929b8d",
                    vh = Math.max(
                      2,
                      ((Number(bar.volume) || 0) / volumeMax) * 45,
                    ),
                    forming = bar.is_complete === false;
                  return (
                    <g
                      key={`${dateOf(bar)}-${bar.symbol}`}
                      className="candle"
                      role="button"
                      tabIndex={0}
                      aria-label={t(
                        "{date} {symbol}：开 {open}，高 {high}，低 {low}，收 {close}，成交量 {volume}。{forming}点击查看，不改变回放时间。",
                        {
                          date: bar.date,
                          symbol: bar.symbol,
                          open: bar.open,
                          high: bar.high,
                          low: bar.low,
                          close: bar.close,
                          volume: bar.volume,
                          forming: forming
                            ? t("形成中的行情，不用于决策。")
                            : "",
                        },
                      )}
                      onMouseEnter={() => setHover(bar)}
                      onClick={() => {
                        onPause();
                        setHover(null);
                        setLockedBar((current: Any) =>
                          current && dateOf(current) === dateOf(bar)
                            ? null
                            : bar,
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          onPause();
                          setHover(null);
                          setLockedBar((current: Any) =>
                            current && dateOf(current) === dateOf(bar)
                              ? null
                              : bar,
                          );
                        }
                      }}
                    >
                      <line
                        x1={x}
                        x2={x}
                        y1={hi}
                        y2={lo}
                        stroke={volumeFill}
                        strokeWidth="1.5"
                        strokeDasharray={forming ? "3 2" : undefined}
                      />
                      <rect
                        x={x - bw / 2}
                        y={Math.min(o, c)}
                        width={bw}
                        height={Math.max(2, Math.abs(c - o))}
                        fill={volumeFill}
                        opacity={forming ? ".7" : "1"}
                      />
                      <rect
                        x={x - bw / 2}
                        y={345 - vh}
                        width={bw}
                        height={vh}
                        fill={volumeFill}
                        opacity=".8"
                      >
                        <title>
                          {change > 0
                            ? t("成交量：收涨")
                            : change < 0
                              ? t("成交量：收跌")
                              : t("成交量：收平")}
                        </title>
                      </rect>
                      <rect
                        x={x - 10}
                        y="10"
                        width="20"
                        height="350"
                        fill="transparent"
                      />
                    </g>
                  );
                })
              )}
              <line x1="48" x2="872" y1="297" y2="297" stroke="#444a40" />
              <text x="4" y="322" fill="#929b8d" fontSize="10">
                <LText id="VOL" />
              </text>
              {(() => {
                const focusBar = lockedBar || hover;
                if (
                  !focusBar ||
                  !bars.some((bar: Any) => dateOf(bar) === dateOf(focusBar))
                )
                  return null;
                const index = bars.findIndex(
                    (bar: Any) => dateOf(bar) === dateOf(focusBar),
                  ),
                  x = chartX(index, bars, chartMode, focusBar),
                  y = priceY(Number(focusBar.close));
                return (
                  <g className="crosshair" pointerEvents="none">
                    <line
                      x1={x}
                      x2={x}
                      y1="20"
                      y2="345"
                      stroke="#d6ee3e"
                      strokeDasharray="3 3"
                    />
                    <line
                      x1="48"
                      x2="872"
                      y1={y}
                      y2={y}
                      stroke="#d6ee3e"
                      strokeDasharray="3 3"
                    />
                    <circle cx={x} cy={y} r="3" fill="#d6ee3e" />
                  </g>
                );
              })()}
              {showOperations &&
                displayMarkers.map((m: Any, i: number) => (
                  <g
                    key={`marker-${i}`}
                    className={`chart-marker marker-${m.kind}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${m.title} · ${t("点击回看来源时点")}`}
                    onClick={() => {
                      onPause();
                      onNavigate(m.symbol, m.date);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        onPause();
                        onNavigate(m.symbol, m.date);
                      }
                    }}
                  >
                    <title>
                      {m.title} · {t("点击回看来源时点")}
                    </title>
                    <line
                      className="marker-leader"
                      pointerEvents="none"
                      x1={m.x}
                      y1={m.y}
                      x2={m.labelX}
                      y2={m.labelY}
                    />
                    <circle
                      className="marker-anchor"
                      pointerEvents="none"
                      cx={m.x}
                      cy={m.y}
                      r="3"
                    />
                    <rect
                      className="marker-chip"
                      x={m.labelX - 8}
                      y={m.labelY - 7}
                      width="16"
                      height="14"
                      rx="3"
                    />
                    <text x={m.labelX} y={m.labelY + 3.5} textAnchor="middle">
                      {m.label}
                    </text>
                  </g>
                ))}
              {chartMode === "intraday"
                ? [
                    [48, "09:30"],
                    [460, "12:45"],
                    [872, "16:00"],
                  ].map(([x, label], i) => (
                    <g key={`rth-${label}`}>
                      <line x1={x} x2={x} y1="297" y2="303" stroke="#929b8d" />
                      <text
                        x={x}
                        y="365"
                        textAnchor={
                          i === 0 ? "start" : i === 2 ? "end" : "middle"
                        }
                        fill="#929b8d"
                        fontSize="10"
                      >
                        {label} ET
                      </text>
                    </g>
                  ))
                : [0, Math.floor((bars.length - 1) / 2), bars.length - 1]
                    .filter((index, i, all) => all.indexOf(index) === i)
                    .map((index) => (
                      <text
                        key={`date-${index}`}
                        x={chartX(index, bars, chartMode, bars[index])}
                        y="365"
                        textAnchor={
                          index === 0
                            ? "start"
                            : index === bars.length - 1
                              ? "end"
                              : "middle"
                        }
                        fill="#929b8d"
                        fontSize="10"
                      >
                        {String(bars[index].date || dateOf(bars[index]))}
                      </text>
                    ))}
            </svg>
          </div>
          {market?.synthetic && (
            <div className="tag warn">
              <LText id="合成演示行情 · 不代表真实市场数据" />
            </div>
          )}
          {bars.some((bar: Any) => bar.is_complete === false) && (
            <div className="tag warn">
              <LText id="包含形成中的行情 · 价格仅作观察" />
            </div>
          )}
          {coverageLabel && (
            <div className="tag warn">
              {coverageLabel} · {t("未填充缺失数据")}
            </div>
          )}
          {market?.metadata?.timezone && (
            <div className="micro">
              {t("行情时间以 UTC 存储 · 查看为 ET / 北京时间 · 来源")}{" "}
              {market.source || market.metadata.feed || t("未记录")}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function spreadAggregateMarkers(
  markers: Any[],
  mode: string,
  barCount: number,
): Any[] {
  if (mode === "intraday") {
    const sorted = [...markers].sort((a, b) => a.x - b.x);
    const clusters: Any[][] = [];
    for (const marker of sorted) {
      const cluster = clusters[clusters.length - 1];
      if (cluster && marker.x - cluster[cluster.length - 1].x <= 24)
        cluster.push(marker);
      else clusters.push([marker]);
    }
    return clusters.flatMap((cluster) => {
      const center =
        cluster.reduce((sum, marker) => sum + marker.x, 0) / cluster.length;
      return cluster.map((marker, index) => ({
        ...marker,
        labelX: Math.max(
          58,
          Math.min(862, center + (index - (cluster.length - 1) / 2) * 24),
        ),
        labelY: Math.max(28, Math.min(286, marker.y + 15)),
      }));
    });
  }
  const groups = new Map<number, Any[]>();
  for (const marker of markers) {
    const group = groups.get(marker.x) || [];
    group.push(marker);
    groups.set(marker.x, group);
  }
  const columnWidth =
    824 / (barCount <= 3 ? barCount + 1 : Math.max(1, barCount - 1));
  const maxColumns = Math.max(1, Math.min(10, Math.floor(columnWidth / 22)));
  return [...groups.values()].flatMap((group) => {
    const columns = Math.min(group.length, maxColumns);
    return group.map((marker, index) => ({
      ...marker,
      labelX: Math.max(
        58,
        Math.min(862, marker.x + ((index % columns) - (columns - 1) / 2) * 22),
      ),
      labelY: Math.max(
        24,
        Math.min(286, marker.y + (Math.floor(index / columns) % 2 ? 14 : -12)),
      ),
    }));
  });
}

function Panel({
  title,
  children,
  className = "",
  symbol,
  quote,
  change,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  symbol: string;
  quote: string;
  change: number | null;
}) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = useId();
  const direction =
    change == null || change === 0
      ? "price-flat"
      : change > 0
        ? "price-up"
        : "price-down";
  return (
    <section
      className={`panel ${className}${collapsed ? " chart-collapsed" : ""}`}
    >
      <div className="chart-heading">
        <h3>{title}</h3>
        {collapsed && (
          <div className={`collapsed-quote ${direction}`}>
            <b>{quote}</b>
            {change != null && (
              <span>
                {change > 0 ? "+" : ""}
                {(change * 100).toFixed(2)}%
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          aria-label={t(collapsed ? "desk.expandChart" : "desk.collapseChart", {
            symbol,
          })}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span aria-hidden="true">{collapsed ? "▾" : "▴"}</span>
          {t(collapsed ? "desk.expand" : "desk.collapse")}
        </button>
      </div>
      <div className="chart-body" id={bodyId} hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
