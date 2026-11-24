import React, { useState } from "react";
import { useLocale } from "./i18n";
import { Any } from "./api";
import { Panel, Empty, Btn } from "./ui";
import { ScrollRegion } from "./ScrollRegion";
import { activityRecordKeys, activityTime } from "./presentationFormatting";

export default function ActivityLog({ items, runs }: { items: Any[]; runs: Any[] }) {
  const { t, locale } = useLocale();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil((items?.length || 0) / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = (items || []).slice(currentPage * 25, (currentPage + 1) * 25);
  const recordKeys = activityRecordKeys(items || []);
  const number = (value: unknown, price = false) => typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(locale, { minimumFractionDigits: price ? 2 : 0, maximumFractionDigits: price ? 4 : 6 }) : value;
  const fieldValue = (value: unknown) => value && typeof value === "object"
    ? <pre>{JSON.stringify(value, null, 2)}</pre> : String(value);
  const summary = (event: Any) => {
    const info = { ...event, ...event.details };
    const type = event.type || event.event || event.action;
    if (type === "decision_reviewed") {
      const key = `activity.review.${info.action}`, text = t(key);
      return text === key ? t("activity.recorded") : text;
    }
    if (type === "decision_created" || type === "live_decision_created") return t(info.provider === "deterministic_demo" || info.provider === "deterministic_baseline" ? "activity.ruleDecision" : info.provider === "llm" ? "activity.aiDecision" : "activity.decision");
    if (type === "dataset_imported" || type === "market_dataset_imported") return t("activity.imported", {count: info.rows ?? "—"});
    if (type === "error") return t("activity.errorSummary");
    const key = `activity.summary.${type}`;
    const text = t(key);
    return text === key ? t("activity.recorded") : text;
  };
  return <Panel title={t("activity.title")}>
    {items?.length ? <ScrollRegion label={t("activity.title")}><table className="activity-table">
      <thead><tr><th>{t("activity.time")}</th><th>{t("Experiment")}</th><th>{t("activity.action")}</th><th>{t("activity.description")}</th></tr></thead>
      <tbody>{visibleItems.map((event, index) => {
        const stamp = activityTime(event.created_at || event.timestamp || event.date);
        const name = runs?.find(run => run.id === event.experiment_id)?.name || event.experiment_name
          || t(event.experiment_id && event.experiment_id !== "system" ? "activity.unnamed" : "activity.workspace");
        const info = { ...event, ...event.details };
        const actionKey = `activity.kind.${event.type || event.event || event.action}`;
        const actionLabel = t(actionKey);
        const replay = activityTime(info.date);
        const fields = [["activity.replayDate", replay ? `${replay.date}${replay.time ? ` ${replay.time}` : ""}` : info.date],
          ["activity.symbol", info.symbol || (Array.isArray(info.symbols) ? info.symbols.join(", ") : info.symbols)],
          ["activity.quantity", number(info.quantity)], ["activity.price", number(info.price ?? info.fill_price, true)],
          ["Rows", number(info.rows)], ["Fees", number(info.fees_paid, true)],
          ["Decision", info.decision_id], ["Order", info.order_id], ["activity.reason", info.reason || info.message]];
        return <tr key={recordKeys[currentPage * 25 + index]}>
          <td>{stamp ? <time className="activity-time" dateTime={stamp.replayDate ? stamp.date : undefined}><span>{stamp.date}</span><small>{stamp.replayDate ? t("activity.replayDate") : stamp.time}</small></time> : t("Timestamp unavailable")}</td>
          <td className="activity-experiment">{name}</td>
          <td>{actionLabel === actionKey ? t("activity.otherAction") : actionLabel}</td>
          <td><p className="activity-summary">{summary(event)}</p>
            <details className="activity-details"><summary>{t("activity.details")}</summary>
              <dl>{fields.filter(([, value]) => value != null && value !== "").map(([label, value]) =>
                <React.Fragment key={String(label)}><dt>{t(String(label))}</dt><dd>{fieldValue(value)}</dd></React.Fragment>)}</dl>
              <details><summary>{t("activity.raw")}</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
            </details>
          </td>
        </tr>;
      })}</tbody>
    </table></ScrollRegion> : <Empty>{t("No recorded activity yet.")}</Empty>}
    {pageCount > 1 && <div className="toolbar activity-pagination">
      <span>{t("activity.page", {current:currentPage + 1,pages:pageCount,count:items.length})}</span>
      <Btn disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("activity.previous")}</Btn>
      <Btn disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>{t("activity.next")}</Btn>
    </div>}
  </Panel>;
}
