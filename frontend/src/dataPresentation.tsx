import React from "react";
import { useLocale } from "./i18n";

type Translate = (key: string, params?: Record<string, string | number>) => string;
type Dataset = Record<string, any>;

export function datasetDisplayName(dataset: Dataset | undefined, t: Translate) {
  if (!dataset) return t("data.unavailable");
  const symbols: string[] = dataset.symbols || [];
  const interval = String(dataset.bar_interval || dataset.timeframe || (Number(dataset.schema_version || 1) >= 2 ? "1m" : "1d")).toLowerCase();
  const frequency = interval === "1m" || interval === "1min" ? t("data.minute")
    : interval === "1h" || interval === "1hour" ? t("data.hourly")
    : interval === "1d" || interval === "daily" ? t("data.daily") : interval;
  const subject = dataset.synthetic ? t("data.synthetic")
    : symbols.length === 1 ? (symbols[0] === "AAPL" ? t("data.apple") : symbols[0])
    : symbols.length > 1 ? t("data.stocks", { count: symbols.length })
    : dataset.name || t("Dataset");
  return `${subject} · ${frequency}`;
}

export function datasetCoverage(dataset: Dataset) {
  const start = String(dataset.start_date || dataset.range?.start || "").slice(0, 10);
  const end = String(dataset.end_date || dataset.range?.end || "").slice(0, 10);
  return start && end ? `${start} – ${end}` : start || end || "—";
}

export function groupDatasetImports(datasets: Dataset[]) {
  const groups = new Map<string, { dataset: Dataset; imports: Dataset[] }>();
  for (const dataset of datasets || []) {
    const key = dataset.checksum ? JSON.stringify([
      dataset.checksum, Boolean(dataset.synthetic), dataset.adjustment_policy || "",
      dataset.bar_interval || dataset.timeframe || "1d",
    ]) : dataset.id;
    const existing = groups.get(key);
    if (existing) existing.imports.push(dataset);
    else groups.set(key, { dataset, imports: [dataset] });
  }
  return [...groups.values()];
}

export function DatasetName({ id, datasets }: { id: string; datasets: Dataset[] }) {
  const { t } = useLocale();
  const dataset = datasets?.find(item => item.id === id);
  return <span className="dataset-name">
    <strong>{datasetDisplayName(dataset, t)}</strong>
    {dataset && <small>{datasetCoverage(dataset)}</small>}
  </span>;
}

function requirementKind(value: string) {
  const name = value.trim().toLowerCase();
  if (["price", "prices", "ohlcv", "price history", "historical prices"].includes(name)) return "price";
  if (/fundamental|financial/.test(name)) return "fundamentals";
  if (/news/.test(name)) return "news";
  return "other";
}

export function requirementLabel(value: string, t: Translate) {
  if (value.trim().toLowerCase() === "macro") return t("data.unconnected.macro");
  const kind = requirementKind(value);
  return kind === "other" ? value : t(`data.requirement.${kind}`);
}

export function isSupportedDataRequirement(value: string) {
  return requirementKind(value) !== "other";
}

export function DataRequirements({ items, showLabel = true }: { items?: string[]; showLabel?: boolean }) {
  const { t } = useLocale();
  const requirements = [...new Map((items?.length ? items : ["price"])
    .map(value => [requirementKind(value) === "other" ? value : requirementKind(value), value])).values()];
  const supported = requirements.filter(isSupportedDataRequirement);
  const unconnected = requirements.filter(value => !isSupportedDataRequirement(value));
  return <><div className="data-requirements" aria-label={t("Required data")}>
    {showLabel && <span className="data-requirements-label">{t("Required data")}</span>}
    <span className="data-requirement-list">{supported.map(value =>
      <span key={value} className={`data-chip data-chip--${requirementKind(value)}`}>
        <span className="data-chip-dot" aria-hidden="true" />{requirementLabel(value, t)}
      </span>)}
    </span>
  </div>
    {unconnected.length > 0 && <p className="error compact">{t("data.unconnected", { data: unconnected.map(value => requirementLabel(value, t)).join(" / ") })}</p>}
  </>;
}
