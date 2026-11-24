import React from "react";
import { Any } from "./api";
import { useLocale } from "./i18n";
import { money, pct } from "./ui";
import { ScrollRegion } from "./ScrollRegion";
import {
  allocationAtSnapshot,
  historicalMarketValue,
  holdingsAtSnapshot,
  priceDirection,
} from "./portfolio";

const colors = [
  "#d6ee3e",
  "#91bdc2",
  "#b99edb",
  "#dfa774",
  "#86b391",
  "#cc9eb0",
  "#84a9d4",
  "#c4bd85",
  "#a8a0cc",
  "#83b8ac",
];
const signedMoney = (value: number) =>
  `${value > 0 ? "+" : ""}${money(value, 2)}`;

export default function HoldingsPanel({
  snapshot,
  fills,
  timeLabel,
}: {
  snapshot: Any | null;
  fills: Any[];
  timeLabel: string;
}) {
  const { t } = useLocale();
  const holdings = holdingsAtSnapshot(snapshot, fills);
  const marketValue = historicalMarketValue(snapshot, holdings);
  const pnl =
    holdings.length && holdings.every((holding) => Number.isFinite(holding.pnl))
      ? holdings.reduce((sum, holding) => sum + holding.pnl, 0)
      : Number.NaN;
  const slices = allocationAtSnapshot(snapshot, holdings);
  const circumference = 2 * Math.PI * 74;
  let offset = 0;
  return (
    <section className="holdings-panel" aria-label={t("所选时间点持仓")}>
      <div className="holdings-heading">
        <div>
          <h3>{t("所选时间点持仓")}</h3>
          <span>
            {timeLabel} · {t("仅按历史账户快照展示")}
          </span>
        </div>
        <div className="holdings-summary">
          <span>
            {t("账户净值")} <b>{money(snapshot?.equity, 2)}</b>
          </span>
          <span>
            {t("现金")} <b>{money(snapshot?.cash, 2)}</b>
          </span>
          <span>
            {t("持仓市值")}{" "}
            <b>{money(Number.isFinite(marketValue) ? marketValue : null, 2)}</b>
          </span>
          <span>
            {t("浮动盈亏")}{" "}
            <b className={priceDirection(pnl)}>
              {Number.isFinite(pnl) ? signedMoney(pnl) : "—"}
            </b>
          </span>
        </div>
      </div>
      {!snapshot ? (
        <p className="holdings-empty">{t("该时间点没有已保存的账户快照。")}</p>
      ) : !holdings.length ? (
        <p className="holdings-empty">{t("该时间点没有持仓。")}</p>
      ) : (
        <ScrollRegion
          label={t("所选时间点持仓")}
          className="holdings-table-wrap"
        >
          <table className="holdings-table">
            <thead>
              <tr>
                {[
                  "标的",
                  "数量",
                  "平均成本",
                  "所选时点标记价",
                  "市值",
                  "浮动盈亏",
                  "盈亏率",
                  "仓位",
                ].map((label) => (
                  <th key={label}>{t(label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={holding.symbol}>
                  <td>
                    <strong>{holding.symbol}</strong>
                  </td>
                  <td>
                    {Number.isFinite(holding.quantity)
                      ? `${holding.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${t("股")}`
                      : "—"}
                  </td>
                  <td
                    title={t(
                      holding.costSource === "fills"
                        ? "desk.costFromFills"
                        : holding.costSource === "snapshot"
                          ? "desk.costFromSnapshot"
                          : "历史快照未记录成本",
                    )}
                  >
                    {Number.isFinite(holding.cost)
                      ? money(holding.cost, 2)
                      : "—"}
                    {holding.costSource === "fills" && (
                      <span
                        className="cost-derived"
                        aria-label={t("desk.costFromFills")}
                      >
                        *
                      </span>
                    )}
                  </td>
                  <td className={priceDirection(holding.pnlPct)}>
                    {Number.isFinite(holding.mark)
                      ? money(holding.mark, 2)
                      : "—"}
                  </td>
                  <td className={priceDirection(holding.pnlPct)}>
                    {Number.isFinite(holding.value)
                      ? money(holding.value, 2)
                      : "—"}
                  </td>
                  <td className={priceDirection(holding.pnl)}>
                    {Number.isFinite(holding.pnl)
                      ? signedMoney(holding.pnl)
                      : "—"}
                  </td>
                  <td className={priceDirection(holding.pnlPct)}>
                    {Number.isFinite(holding.pnlPct)
                      ? `${holding.pnlPct > 0 ? "+" : ""}${pct(holding.pnlPct)} ${t(holding.pnlPct > 0 ? "涨" : holding.pnlPct < 0 ? "跌" : "持平")}`
                      : "—"}
                  </td>
                  <td>
                    {Number.isFinite(holding.weight)
                      ? pct(holding.weight)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      <p className="holdings-note">{t("desk.holdingsColorNote")}</p>
      {holdings.some((holding) => holding.costSource === "fills") && (
        <p className="holdings-note">* {t("desk.costFromFillsNote")}</p>
      )}
      <div className="holdings-allocation">
        <div className="allocation-heading">
          <h4>{t("desk.allocation")}</h4>
          <span>{t("desk.allocationBasis")}</span>
        </div>
        {slices.length ? (
          <div className="allocation-chart-layout">
            <svg
              className="allocation-donut"
              viewBox="0 0 200 200"
              role="img"
              aria-label={t("desk.allocation")}
            >
              <circle
                cx="100"
                cy="100"
                r="74"
                fill="none"
                stroke="#30352f"
                strokeWidth="26"
              />
              {slices.map((slice, index) => {
                const start = offset;
                offset += slice.weight;
                const color =
                  slice.kind === "cash"
                    ? "#7e887a"
                    : colors[index % colors.length];
                return (
                  <circle
                    key={`${slice.kind}-${slice.symbol}`}
                    cx="100"
                    cy="100"
                    r="74"
                    fill="none"
                    stroke={color}
                    strokeWidth="26"
                    strokeDasharray={`${slice.weight * circumference} ${circumference}`}
                    strokeDashoffset={-start * circumference}
                    transform="rotate(-90 100 100)"
                  >
                    <title>
                      {slice.kind === "cash" ? t("现金") : slice.symbol} ·{" "}
                      {pct(slice.weight)} · {money(slice.value, 2)}
                    </title>
                  </circle>
                );
              })}
              <text
                x="100"
                y="96"
                textAnchor="middle"
                className="donut-total-label"
              >
                {t("desk.assets")}
              </text>
              <text
                x="100"
                y="118"
                textAnchor="middle"
                className="donut-total-value"
              >
                {money(
                  slices.reduce((sum, slice) => sum + slice.value, 0),
                  0,
                )}
              </text>
            </svg>
            <ul className="allocation-legend">
              {slices.map((slice, index) => (
                <li key={`${slice.kind}-${slice.symbol}`}>
                  <span
                    className="allocation-swatch"
                    style={{
                      background:
                        slice.kind === "cash"
                          ? "#7e887a"
                          : colors[index % colors.length],
                    }}
                  />
                  <strong>
                    {slice.kind === "cash" ? t("现金") : slice.symbol}
                  </strong>
                  <span>{money(slice.value, 2)}</span>
                  <b>{pct(slice.weight)}</b>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">{t("desk.noAllocation")}</p>
        )}
      </div>
    </section>
  );
}
