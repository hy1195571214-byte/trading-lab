import React from "react";
import { Any } from "./api";
import { useLocale } from "./i18n";
import { DataRequirements } from "./dataPresentation";
import { Btn } from "./ui";

export default function ExpertProfile({ expert, close }: { expert: Any; close: () => void }) {
  const { t } = useLocale();
  const policy = expert.decision_policy;
  const research = expert.research;
  return <div className="overlay"><div className="modal expert-profile" role="dialog" aria-modal="true" aria-labelledby="expert-profile-title">
    <button className="x" aria-label={t("Close dialog")} onClick={close}>×</button>
    <h2 id="expert-profile-title">{expert.name}</h2>
    <p className="expert-summary">{expert.description || expert.objective}</p>
    {expert.activation_status === "research_only" && <p className="notice expert-availability">{t("expert.researchStatus")}</p>}
    <dl className="expert-details">
      <dt>{t("Strategy objective")}</dt><dd>{expert.objective || t("Not provided")}</dd>
      <dt>{t("Horizon")}</dt><dd>{expert.horizon || t("Not specified")}</dd>
      <dt>{t("Required data")}</dt><dd><DataRequirements items={expert.required_data || []} showLabel={false} /></dd>
    </dl>
    {policy?.rules?.length > 0 && <section className="expert-policy">
      <h3>{t("expert.decisionPrinciples")}</h3>
      <p className="muted">{t("expert.principlesIntro")}</p>
      <ol>{policy.rules.map((rule: Any, index: number) => <li key={index}>
        <h4>{rule.title}</h4><p>{rule.text}</p>
      </li>)}</ol>
    </section>}
    <details className="expert-disclosure">
      <summary>{t(policy ? "expert.systemPrompt" : "Instructions")}</summary>
      {expert.activation_status === "research_only" && <p className="muted">{t("expert.promptStatus")}</p>}
      <pre className="expert-prompt">{expert.instructions || t("Not provided")}</pre>
      {policy?.version && <small>{policy.version}</small>}
    </details>
    {research && <details className="expert-disclosure">
      <summary>{t("expert.sourcesAndLimits")}</summary>
      <p className="muted">{t("expert.sourceSeparation")}</p>
      <p>{research.scope}</p><p>{research.academic_use}</p><p>{research.attribution_limit}</p>
      {research.policy_revision && <details>
        <summary>{t("expert.ruleProvenance")}</summary>
        {(research.policy_revision.rules || []).map((rule: Any, index: number) => <p key={index}><b>{rule.title}</b> · {(rule.principle_ids || []).join(" · ")}</p>)}
        {(research.policy_revision.omitted_principles || []).map((item: Any) => <p key={item.id}>{item.id} · {item.reason}</p>)}
        {research.policy_revision.adaptation_note && <p>{research.policy_revision.adaptation_note}</p>}
      </details>}
      <h4>{t("expert.retainedPrinciples")}</h4>
      {(research.principles || []).map((principle: Any) => <details key={principle.id}>
        <summary>{principle.statement}</summary>
        <p>{principle.attribution_scope}</p>
        <p>{principle.evidence_assessment}</p>
        <p>{t("expert.conditions")}: {(principle.conditions || []).join("；")}</p>
        <p>{t("expert.exceptions")}: {(principle.exceptions || []).join("；")}</p>
        <p>{t("expert.extractionStatus")}: {principle.runtime_candidate ? t("expert.sourceCandidate") : t("expert.sourceExcluded")}</p>
        <small>{principle.id} · {principle.classification} · {(principle.source_ids || []).join(" · ")}</small>
      </details>)}
      <h4>{t("expert.originalSources")}</h4>
      <ul className="expert-source-list">{(research.sources || []).map((source: Any) => <li key={source.id}>
        <a href={/^https?:\/\//.test(source.url || "") ? source.url : undefined} target="_blank" rel="noreferrer">{source.title}</a>
        <p>{source.locator || t("expert.localLocator")}</p>
        {source.quote && <blockquote>{source.quote}</blockquote>}
        <small>{source.id} · {source.published_at || t("expert.dateUnknown")} · {source.rights_note || t("expert.rightsUnknown")}</small>
      </li>)}</ul>
      <h4>{t("expert.remainingGaps")}</h4><ul>{(research.gaps || []).map((gap: string, index: number) => <li key={index}>{gap}</li>)}</ul>
      <p>{expert.risk_notes}</p>
    </details>}
    {!research && <p>{expert.risk_notes}</p>}
    <Btn onClick={close}>{t("Close details")}</Btn>
  </div></div>;
}
