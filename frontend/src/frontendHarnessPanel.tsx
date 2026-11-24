import { AnalysisPanel } from "./FourMode";
import React, { useEffect, useRef, useState } from 'react';
import { req } from './api';
import { enumLabel, useLocale } from './i18n';
import { ScrollRegion } from './ScrollRegion';

type Data = Record<string, any>;
const stageKeys: Record<string, string> = {
  point_in_time_evidence: 'harness.stageEvidence',
  bounded_proposal_and_citations: 'harness.stageProposal',
  deterministic_risk_gate: 'harness.stageRisk',
  bounded_revision: 'harness.stageRevision',
  workflow_failure: 'harness.stageFailure',
};
const statusKeys: Record<string, string> = {
  started: 'harness.statusStarted', succeeded: 'harness.statusSucceeded',
  passed: 'harness.statusPassed', risk_passed: 'harness.statusRiskPassed',
  rejected: 'harness.statusRejected', requested: 'harness.statusRequested', failed: 'harness.failed',
};

function RiskSummary({ risk }: { risk: Data }) {
  const { t, locale } = useLocale();
  const percent = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value) : '—';
  const history = risk.historical_risk;
  return <div>
    <table><tbody>
      <tr><th>{t('harness.cash')}</th><td>{percent(risk.cash_weight)}</td></tr>
      <tr><th>{t('harness.gross')}</th><td>{percent(risk.gross_weight)}</td></tr>
      <tr><th>{t('harness.turnover')}</th><td>{percent(risk.turnover_l1)}</td></tr>
      {history?.available && <>
        <tr><th>{t('harness.es')}</th><td>{percent(history.historical_expected_shortfall_95)}</td></tr>
        <tr><th>{t('harness.volatility')}</th><td>{percent(history.per_bar_volatility)}</td></tr>
        <tr><th>{t('harness.observations')}</th><td>{history.observations}</td></tr>
      </>}
    </tbody></table>
    {history?.available ? <p>{history.method?.includes('fractionally weighted boundary')
      ? t('harness.riskDefinition') : `${t('harness.raw')} ${history.method || '—'}`}</p>
      : <p>{t('harness.insufficientHistory')}</p>}
    {!!risk.failures?.length && <p>{t('harness.failureOriginal')} <span>{risk.failures.join(' · ')}</span></p>}
  </div>;
}

export default function HarnessPanel() {
  const { t, locale } = useLocale();
  const [capabilities, setCapabilities] = useState<Data | null>(null);
  const [packs, setPacks] = useState<Data[]>([]);
  const [experiments, setExperiments] = useState<Data[]>([]);
  const [experimentId, setExperimentId] = useState('');
  const [experiment, setExperiment] = useState<Data | null>(null);
  const [trace, setTrace] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef('');
  const percent = (value: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value);
  const statusLabel = (value: string) => statusKeys[value] ? t(statusKeys[value]) : enumLabel(t, value);

  async function refresh() {
    try {
      const [c, p, e] = await Promise.all([req('/harness'), req('/harness/evidence-packs'), req('/experiments')]);
      setCapabilities(c); setPacks(p); setExperiments(e);
    } catch (e) { setError(String(e)); }
  }
  useEffect(() => { void refresh(); }, []);
  async function loadTrace() {
    if (!experimentId) return;
    const requestedId = experimentId;
    setBusy(true); setError(''); setTrace(null); setExperiment(null);
    try {
      const path = `/experiments/${encodeURIComponent(experimentId)}`;
      const [savedTrace, savedExperiment] = await Promise.all([req(`${path}/harness`), req(path)]);
      if (selectionRef.current === requestedId) { setTrace(savedTrace); setExperiment(savedExperiment); }
    } catch (e) { if (selectionRef.current === requestedId) setError(String(e)); }
    finally { setBusy(false); }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const data = new FormData(); data.append('file', file);
      await req('/harness/evidence-packs/upload', { method: 'POST', body: data });
      await refresh();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return <div className="stack">
    <p>{t('harness.description')}</p>
    {error && <div role="alert" className="error">{t('harness.error')} <span>{error}</span></div>}
    <details className="panel"><summary>{t('harness.capabilities')}</summary>
      {capabilities ? <>
        <p>{capabilities.versions?.join(' · ')}</p><p>{t('harness.coverageNote')}</p>
        <h4>{t('harness.sources')}</h4>
        <ul>{capabilities.sources?.map((source: Data) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer" style={{ color: '#d6ee3e', textDecoration: 'underline' }}>{source.title}</a></li>)}</ul>
      </> : <p>{t('harness.loading')}</p>}
    </details>
    <section className="panel"><h3>{t('harness.packs')}</h3>
      <button type="button" disabled={busy} onClick={() => evidenceInputRef.current?.click()}>{t('harness.import')}</button>
      <input ref={evidenceInputRef} type="file" hidden accept=".jsonl,application/x-ndjson" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      {packs.length ? <ScrollRegion label={t('harness.packs')}><ul>{packs.map(pack => <li key={pack.id}><code style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{pack.id}</code></li>)}</ul></ScrollRegion> : <p>{t('harness.noPacks')}</p>}
    </section>
    <section className="panel"><h3>{t('harness.trace')}</h3>
      <label>{t('harness.experiment')} <select disabled={busy} value={experimentId} onChange={event => {
        selectionRef.current = event.target.value; setExperimentId(event.target.value); setTrace(null); setExperiment(null);
      }}><option value="">{t('harness.selectExperiment')}</option>
        {experiments.map(saved => <option key={saved.id} value={saved.id}>{saved.name}</option>)}
      </select></label>{' '}
      <button type="button" disabled={!experimentId || busy} onClick={() => void loadTrace()}>{busy ? t('harness.loading') : t('harness.load')}</button>
      {!experiments.length && capabilities && <p>{t('harness.noExperiments')}</p>}
      {!trace && <p>{t('harness.empty')}</p>}
      {trace && experiment && <>
        <h4>{experiment.name}</h4>
        {experiment.config?.lab_mode && <AnalysisPanel id={experiment.id} config={experiment.config} revision={experiment.state?.cursor} decision={(experiment.decisions || []).at(-1)} />}
        <p>{t('harness.version')} <strong>{trace.version}</strong> · {enumLabel(t, experiment.status)}</p>
        <p>{t('harness.evidence')} <code style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{trace.evidence_pack_id || '—'}</code></p>
        <p>{t('harness.execution')} · {experiment.config?.market_mode === 'live'
          ? t('按下一条已观察到的 K 线收盘价模拟成交') : t('按下一根符合条件的 K 线开盘价模拟成交')}</p>
        <h4>{t('harness.runs')}</h4>
        {trace.runs?.length ? <ScrollRegion label={t('harness.runs')}><div className="stack">{trace.runs.map((run: Data, index: number) => {
          const savedAttempt = experiment.decision_traces?.find((attempt: Data) => attempt.attempt_id === run.attempt_id);
          const decision = experiment.decisions?.find((saved: Data) => saved.id === savedAttempt?.decision_id);
          const stages: Data[] = run.stages || [];
          const proposalStage = [...stages].reverse().find(stage => stage.proposal);
          const proposal = proposalStage?.proposal || decision?.original_proposal || savedAttempt?.coordination?.final_proposal;
          const modelCalls = experiment.llm_usage?.filter((call: Data) => call.step_attempt_id === run.attempt_id) || [];
          const coverage = run.coverage || {};
          return <article key={run.attempt_id || index} className="panel">
            <h4><time>{run.as_of}</time> · {statusLabel(run.status)}</h4>
            <h5>{t('harness.stage')}</h5>
            <ol>{stages.map((stage, stageIndex) => <li key={stageIndex}>
              {stageKeys[stage.stage] ? t(stageKeys[stage.stage]) : `${t('harness.unknownField')} ${stage.stage}`} · {statusLabel(stage.status)}
            </li>)}</ol>
            <h5>{t('harness.coverage')}</h5>
            <p>{t('harness.eligible')} {coverage.eligible ?? '—'} · {t('harness.included')} {coverage.included ?? '—'} · {t('harness.unknownExcluded')} {coverage.unknown_availability_excluded ?? '—'}</p>
            {coverage.truncated && <p>{t('harness.truncated')}</p>}
            {coverage.by_symbol && <details><summary>{t('harness.symbolCoverage')}</summary><table><tbody>
              {Object.entries(coverage.by_symbol).map(([symbol, value]) => {
                const item = value as Data;
                const eligible = Object.values(item.eligible_by_kind || {}).reduce<number>((sum, count) => sum + Number(count), 0);
                const included = Object.values(item.included_by_kind || {}).reduce<number>((sum, count) => sum + Number(count), 0);
                return <tr key={symbol}><th>{symbol}</th><td>{t('harness.eligible')} {eligible}</td><td>{t('harness.included')} {included}</td></tr>;
              })}
            </tbody></table></details>}
            <h5>{t('harness.targets')}</h5>
            {proposal ? <>
              {proposal.action === 'hold' ? <p>{t('harness.preserveHoldings')}</p> : Object.keys(proposal.targets || {}).length
                ? <ul>{Object.entries(proposal.targets).map(([symbol, weight]) => <li key={symbol}>{symbol} {percent(Number(weight))}</li>)}</ul>
                : <p>{t('harness.cashOnly')}</p>}
              {proposal.rationale && <><p>{t('harness.proposalOriginal')}</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{proposal.rationale}</p></>}
            </> : <p>{t('harness.noProposal')}</p>}
            {run.risk && <><h5>{t('harness.risk')}</h5><RiskSummary risk={run.risk} /></>}
            {run.error && <p className="error">{t('harness.failureOriginal')} <span>{run.error}</span></p>}
            <h5>{t('harness.reviewSummary')}</h5>
            {decision?.review ? <p>{enumLabel(t, decision.review.action)} · {decision.review.reviewed_at || decision.review.date} · {decision.review.reason}</p>
              : <p>{decision?.status === 'awaiting_review' ? enumLabel(t, decision.status) : t('harness.noReview')}</p>}
            {!!modelCalls.length && <details><summary>{t('harness.rawModel')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(modelCalls.map((call: Data) => ({ status: call.status, raw_output: call.raw_output, error: call.error })), null, 2)}</pre></details>}
            <details><summary>{t('harness.raw')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(run, null, 2)}</pre></details>
          </article>;
        })}</div></ScrollRegion> : <p>{t('harness.noRuns')}</p>}
        {!!trace.review_risk_checks?.length && <>
          <h4>{t('harness.reviewSummary')}</h4>
          {trace.review_risk_checks.map((check: Data, index: number) => <details key={index}>
            <summary>{enumLabel(t, check.action)} · {check.risk?.passed ? t('harness.statusPassed') : t('harness.statusRejected')} · <code>{check.decision_id}</code></summary>
            {check.risk && <RiskSummary risk={check.risk} />}
            <details><summary>{t('harness.raw')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(check, null, 2)}</pre></details>
          </details>)}
        </>}
      </>}
    </section>
  </div>;
}
