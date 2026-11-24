import React, { useEffect, useRef, useState } from "react";
import { Any, req } from "./api";
import { useLocale, enumLabel } from "./i18n";
import { Btn, ErrorMessage, pct } from "./ui";
import { ScrollRegion } from "./ScrollRegion";
import { analysisVisibleAt } from "./replayData";
import { ProposalAllocation } from "./ProposalAllocation";

export type LabMode =
  "quant_baseline" | "market_agent" | "multisource_agent" | "human_supervised";
export type Weights = { market: number; news: number; fundamentals: number };
export const defaultWeights: Weights = {
  market: 50,
  news: 30,
  fundamentals: 20,
};
export const validWeights = (w: Weights) =>
  Object.values(w).every((v) => Number.isFinite(v) && v >= 0 && v <= 100) &&
  Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 100) < 0.000001;
export const fractionalWeights = (w: Weights) => ({
  market: w.market / 100,
  news: w.news / 100,
  fundamentals: w.fundamentals / 100,
});
const percentageWeights = (w: Any | undefined): Weights => ({
  market: Number(w?.market ?? 0.5) * 100,
  news: Number(w?.news ?? 0.3) * 100,
  fundamentals: Number(w?.fundamentals ?? 0.2) * 100,
});
const sources = ["market", "news", "fundamentals"] as const;
export function WeightInputs({
  weights,
  onChange,
}: {
  weights: Weights;
  onChange: (w: Weights) => void;
}) {
  const { t } = useLocale();
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return (
    <div className="weight-inputs">
      {sources.map((source) => (
        <div className="weight-row" key={source}>
          <label htmlFor={`weight-number-${source}`}>
            {t(`four.${source}`)}
          </label>
          <input
            aria-label={`${t(`four.${source}`)} ${t("four.slider")}`}
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={Number.isFinite(weights[source]) ? weights[source] : 0}
            onChange={(e) =>
              onChange({ ...weights, [source]: Number(e.target.value) })
            }
          />
          <input
            id={`weight-number-${source}`}
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={Number.isFinite(weights[source]) ? weights[source] : ""}
            onChange={(e) =>
              onChange({
                ...weights,
                [source]: e.target.value === "" ? NaN : Number(e.target.value),
              })
            }
          />
          <span>%</span>
        </div>
      ))}
      <p className={validWeights(weights) ? "muted" : "error"}>
        {t("four.total")} {Number.isFinite(total) ? total.toFixed(1) : "—"}% ·{" "}
        {t("four.totalRule")}
      </p>
    </div>
  );
}
export function ModeSettings({
  mode,
  setMode,
  quant,
  setQuant,
  weights,
  setWeights,
  entry,
  setEntry,
  exit,
  setExit,
  horizon,
  setHorizon,
}: any) {
  const { t } = useLocale();
  return (
    <div className="stack four-config">
      <label>
        {t("four.template")}
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          {(
            [
              "quant_baseline",
              "market_agent",
              "multisource_agent",
              "human_supervised",
            ] as LabMode[]
          ).map((m) => (
            <option key={m} value={m}>
              {t(`four.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="notice">{t(`four.${mode}.description`)}</p>
      {mode === "quant_baseline" ? (
        <label>
          {t("four.quantStrategy")}
          <select value={quant} onChange={(e) => setQuant(e.target.value)}>
            <option value="bt_sma50">{t("four.sma50")}</option>
            <option value="bt_buy_hold">{t("four.buyHold")}</option>
          </select>
          <small>{t("four.smaWindow")}</small>
        </label>
      ) : (
        <>
          {mode === "market_agent" ? (
            <p>{t("four.fixedWeights")}</p>
          ) : (
            <>
              <h4>{t("four.weights")}</h4>
              <WeightInputs weights={weights} onChange={setWeights} />
            </>
          )}
          <h4>{t("four.policy")}</h4>
          <p className="muted">{t("four.policyExplanation")}</p>
          <div className="formgrid">
            <label>
              {t("four.entry")}
              <input
                type="number"
                min="-1"
                max="1"
                step="0.01"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
              />
            </label>
            <label>
              {t("four.exit")}
              <input
                type="number"
                min="-1"
                max="1"
                step="0.01"
                value={exit}
                onChange={(e) => setExit(e.target.value)}
              />
            </label>
            <label>
              {t("four.horizon")}
              <input
                type="number"
                min="1"
                step="1"
                value={horizon}
                onChange={(e) => setHorizon(e.target.value)}
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
export function useAnalysis(id: string, enabled: boolean, revision?: unknown) {
  const [data, setData] = useState<Any | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(false),
    [counter, setCounter] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    if (!id || !enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    req(`/experiments/${encodeURIComponent(id)}/analysis`)
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, enabled, revision, counter]);
  return { data, error, loading, refresh: () => setCounter((v) => v + 1) };
}
function sourceLabel(t: (k: string) => string, source: unknown) {
  const known: Record<string, string> = {
    demo: "four.demo",
    deterministic_demo: "four.demo",
    synthetic_demo_fixture: "four.syntheticFixture",
    unavailable: "four.unavailable",
    llm: "four.llm",
    real_llm: "four.llm",
    deterministic: "four.deterministic",
  };
  return known[String(source)]
    ? t(known[String(source)])
    : `${t("four.original")} ${String(source ?? "—")}`;
}
const analysisStatus = (t: (k: string) => string, status: unknown) =>
  [
    "scored",
    "unavailable",
    "abstain",
    "succeeded",
    "failed",
    "started",
  ].includes(String(status))
    ? enumLabel(t, status)
    : `${t("four.original")} ${String(status ?? "—")}`;
export function AnalysisRuns({ data, cutoff }: { data: Any; cutoff?: string }) {
  const { t } = useLocale();
  const runs = (data?.analysis_runs || []).filter(
    (run: Any) =>
      cutoff === undefined || analysisVisibleAt(run.available_at, cutoff),
  );
  return (
    <div className="stack">
      <h4>{t("four.analysisHistory")}</h4>
      {cutoff && (
        <small>
          {t("four.cutoff")} {cutoff} · {t("four.onlyAvailable")}
        </small>
      )}
      {!runs.length ? (
        <p className="muted">{t("four.noAnalysis")}</p>
      ) : (
        runs.map((run: Any, i: number) => (
          <details key={run.id || run.attempt_id || i} open={runs.length === 1}>
            <summary>
              {run.as_of || "—"} · {analysisStatus(t, run.status)} ·{" "}
              {t("four.weightVersion")} {run.weight_version ?? "—"}
            </summary>
            <p>
              {t("four.availableAt")} {run.available_at || "—"}
              {run.error && (
                <>
                  {" "}
                  · {t("four.original")} {run.error}
                </>
              )}
            </p>
            {Array.from(
              new Set([
                ...Object.keys(run.fusion || {}),
                ...sources.flatMap((source) =>
                  Object.keys(run.modules?.[source] || {}),
                ),
              ]),
            ).map((symbol: string) => {
              const fusion = run.fusion?.[symbol] || {};
              return (
                <div key={symbol} className="four-symbol">
                  <strong>
                    {symbol} · {t("four.combined")}{" "}
                    {fusion.score == null
                      ? "—"
                      : Number(fusion.score).toFixed(3)}
                  </strong>{" "}
                  · {analysisStatus(t, fusion.status)}
                  {sources.map((source) => {
                    const module = run.modules?.[source]?.[symbol];
                    const contribution = fusion.contributions?.[source];
                    const weight = run.weights?.[source];
                    return (
                      <details key={source} className="four-module">
                        <summary>
                          <b>{t(`four.${source}`)}</b> ·{" "}
                          {module
                            ? analysisStatus(t, module.status)
                            : t("four.unavailable")}{" "}
                          · {t("four.score")}{" "}
                          {module?.score == null
                            ? "—"
                            : Number(module.score).toFixed(3)}{" "}
                          · {t("four.weight")}{" "}
                          {weight == null ? "—" : pct(weight)} ·{" "}
                          {t("four.contribution")}{" "}
                          {contribution == null
                            ? "—"
                            : Number(
                                typeof contribution === "object"
                                  ? contribution.contribution
                                  : contribution,
                              ).toFixed(3)}
                          {module && (
                            <small>
                              {sourceLabel(t, module.source)}
                              {module.reason
                                ? ` · ${t("four.original")} ${module.reason}`
                                : ""}
                            </small>
                          )}
                        </summary>
                        {module && (
                          <>
                            {module.rationale && (
                              <p>
                                {t("four.original")} {module.rationale}
                              </p>
                            )}
                            {module.risks?.length > 0 && (
                              <p>
                                {t("four.risks")} ·{" "}
                                {Array.isArray(module.risks)
                                  ? module.risks.join(" · ")
                                  : String(module.risks)}
                              </p>
                            )}
                            {module.citation_ids?.length > 0 && (
                              <p>
                                {t("four.citations")} ·{" "}
                                {module.citation_ids.join(" · ")}
                              </p>
                            )}
                            {module.uncertainty && (
                              <p>
                                {t("four.uncertainty")} ·{" "}
                                {String(module.uncertainty)}
                              </p>
                            )}
                          </>
                        )}
                      </details>
                    );
                  })}
                </div>
              );
            })}
            {run.preserve_symbols?.length > 0 && (
              <p>
                {t("four.preserve")} · {run.preserve_symbols.join(", ")}
              </p>
            )}
            <p>
              {t("four.targets")} ·{" "}
              {Object.entries(run.targets || {})
                .map(([s, v]) => `${s}: ${pct(v as number)}`)
                .join(" · ") || "—"}
            </p>
          </details>
        ))
      )}
    </div>
  );
}
export function QuantDetails({
  config,
  decision,
  onTrace,
  showAllocation = true,
}: {
  config: Any;
  decision?: Any;
  onTrace?: () => void;
  showAllocation?: boolean;
}) {
  const { t } = useLocale();
  const proposal = decision?.original_proposal || decision?.proposal;
  const selected: string[] = proposal?.selected_symbols || [];
  return (
    <section
      className="four-analysis quant-record"
      aria-label={t("four.quantDetails")}
    >
      <div className="quant-record-heading">
        <span className="quant-rule-icon" aria-hidden="true">
          ∿
        </span>
        <div>
          <h3>{t("four.quantDetails")}</h3>
          <span className="quant-mode-tag">{t("desk.ruleBased")}</span>
        </div>
      </div>
      <div className="quant-strategy-name">
        {enumLabel(t, config.quant_strategy)}
      </div>
      <dl className="quant-rule-facts">
        <div>
          <dt>{t("desk.signalRule")}</dt>
          <dd>
            {t(
              config.quant_strategy === "bt_sma50"
                ? "desk.smaRule"
                : "desk.buyHoldRule",
            )}
          </dd>
        </div>
        <div>
          <dt>{t("desk.sizingRule")}</dt>
          <dd>{t("desk.equalWeights")}</dd>
        </div>
        <div>
          <dt>{t("desk.executionRule")}</dt>
          <dd>{t("desk.nextOpen")}</dd>
        </div>
      </dl>
      {proposal ? (
        <>
          {proposal.selected_symbols && (
            <div className="quant-selection">
              <h4>
                {t("four.selectedSymbols")} <span>{selected.length}</span>
              </h4>
              {selected.length ? (
                <div className="symbol-chips">
                  {selected.map((symbol) => (
                    <span key={symbol}>{symbol}</span>
                  ))}
                </div>
              ) : (
                <p className="muted">{t("four.none")}</p>
              )}
            </div>
          )}
          {showAllocation && (
            <ProposalAllocation proposal={proposal} label={t("four.targets")} />
          )}
          <details className="quant-source">
            <summary>{t("desk.reproducibility")}</summary>
            <dl>
              <div>
                <dt>{t("desk.project")}</dt>
                <dd>{proposal.upstream?.project || "—"}</dd>
              </div>
              <div>
                <dt>{t("desk.license")}</dt>
                <dd>{proposal.upstream?.license || "—"}</dd>
              </div>
              <div>
                <dt>{t("four.commit")}</dt>
                <dd>
                  <code>{proposal.upstream?.commit || "—"}</code>
                </dd>
              </div>
            </dl>
            {proposal.rationale && (
              <div className="quant-original">
                <small>{t("desk.ruleOriginal")}</small>
                <p>{proposal.rationale}</p>
              </div>
            )}
          </details>
        </>
      ) : (
        <p className="muted">{t("four.noQuantDecision")}</p>
      )}
      {onTrace && <Btn onClick={onTrace}>{t("four.openTrace")}</Btn>}
    </section>
  );
}
export function AnalysisPanel({
  id,
  config,
  cutoff,
  revision,
  showControls = false,
  decision,
}: {
  id: string;
  config: Any;
  cutoff?: string;
  revision?: unknown;
  showControls?: boolean;
  decision?: Any;
}) {
  const { t } = useLocale();
  const { data, error, loading, refresh } = useAnalysis(
    id,
    Boolean(config?.lab_mode && config.lab_mode !== "quant_baseline"),
    revision,
  );
  const [weights, setWeights] = useState<Weights>(defaultWeights),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [saveError, setSaveError] = useState<unknown>(null),
    [notice, setNotice] = useState(false);
  const currentId = useRef(id);
  currentId.current = id;
  useEffect(() => {
    setReason("");
    setSaveError(null);
    setNotice(false);
  }, [id]);
  useEffect(() => {
    if (data?.active_weights?.weights)
      setWeights(percentageWeights(data.active_weights.weights));
  }, [data]);
  if (!config?.lab_mode) return null;
  if (config.lab_mode === "quant_baseline")
    return <QuantDetails config={config} decision={decision} />;
  async function save() {
    if (!validWeights(weights) || !reason.trim() || busy) return;
    const requestedId = id;
    setBusy(true);
    setSaveError(null);
    try {
      await req(`/experiments/${encodeURIComponent(id)}/weights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weights: fractionalWeights(weights),
          reason: reason.trim(),
        }),
      });
      if (currentId.current === requestedId) {
        setReason("");
        setNotice(true);
        refresh();
      }
    } catch (e) {
      if (currentId.current === requestedId) setSaveError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="four-analysis">
      <h3>{t("four.analysis")}</h3>
      {loading && <p>{t("four.loading")}</p>}
      {Boolean(error) && (
        <p className="error">
          <ErrorMessage error={error as Error} />
        </p>
      )}
      {data && (
        <>
          {showControls && config.lab_mode !== "quant_baseline" && (
            <div className="four-current">
              <h4>{t("four.currentSettings")}</h4>
              <p>
                {t("four.active")} ·{" "}
                {formatWeights(data.active_weights?.weights, t)} ·{" "}
                {t("four.weightVersion")} {data.active_weights?.version ?? "—"}
              </p>
              <p>
                {t("four.pending")} ·{" "}
                {data.pending_weights
                  ? formatWeights(data.pending_weights.weights, t)
                  : t("four.none")}
              </p>
              {data.pending_weights && (
                <p>
                  {t("four.requestedAt")}{" "}
                  {data.pending_weights.requested_at || "—"} ·{" "}
                  {t("four.simulatedRequest")}{" "}
                  {data.pending_weights.requested_as_of || "—"} ·{" "}
                  {t("four.reason")} {t("four.original")}{" "}
                  {data.pending_weights.reason || "—"}
                </p>
              )}
              {config.lab_mode === "human_supervised" && (
                <small>{t("four.nextDecision")}</small>
              )}
              {config.lab_mode === "human_supervised" && (
                <>
                  <WeightInputs weights={weights} onChange={setWeights} />
                  <label>
                    {t("four.reason")}
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <Btn
                    kind="primary"
                    disabled={
                      busy ||
                      !!data.pending_weights ||
                      !validWeights(weights) ||
                      !reason.trim()
                    }
                    onClick={save}
                  >
                    {t("four.saveWeights")}
                  </Btn>
                  {notice && <p>{t("four.requestSaved")}</p>}
                  {Boolean(saveError) && (
                    <p className="error">
                      <ErrorMessage error={saveError as Error} />
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          <AnalysisRuns data={data} cutoff={cutoff} />
        </>
      )}
    </div>
  );
}
export function formatWeights(w: Any | undefined, t: (key: string) => string) {
  return w
    ? sources.map((k) => `${t(`four.${k}`)}: ${pct(w[k])}`).join(" · ")
    : "—";
}
export function InterventionHistory({ data }: { data: Any }) {
  const { t } = useLocale();
  const history = data?.weight_history || [];
  return (
    <>
      <div className="kpis report-kpis">
        <div className="kpi">
          <label>{t("four.weightRequests")}</label>
          <b>{data?.intervention_summary?.weight_changes ?? "—"}</b>
        </div>
        <div className="kpi">
          <label>{t("four.weightChanges")}</label>
          <b>{data?.intervention_summary?.weight_changes_effective ?? "—"}</b>
        </div>
        <div className="kpi">
          <label>{t("four.pendingCount")}</label>
          <b>{data?.intervention_summary?.weight_changes_pending ?? "—"}</b>
        </div>
      </div>
      <h4>{t("four.weightHistory")}</h4>
      {history.length ? (
        <ScrollRegion label={t("four.weightHistory")}>
          <table>
            <thead>
              <tr>
                <th>{t("four.weightVersion")}</th>
                <th>{t("four.previousWeights")}</th>
                <th>{t("four.newWeights")}</th>
                <th>{t("four.requestedAt")}</th>
                <th>{t("four.effectiveAt")}</th>
                <th>{t("four.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((x: Any, i: number) => (
                <tr key={i}>
                  <td>{x.version ?? "—"}</td>
                  <td>{formatWeights(x.previous_weights, t)}</td>
                  <td>{formatWeights(x.weights || x.new_weights, t)}</td>
                  <td>
                    {x.requested_at || "—"}
                    <br />
                    {t("four.simulatedRequest")} {x.requested_as_of || "—"}
                  </td>
                  <td>{x.effective_at || "—"}</td>
                  <td>
                    {x.reason ? `${t("four.original")} ${x.reason}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <p>{t("four.none")}</p>
      )}
    </>
  );
}
