import React from "react";
import { Any } from "./api";
import { useLocale, enumLabel } from "./i18n";
import { pct } from "./ui";

export function ProposalAllocation({
  proposal,
  label,
}: {
  proposal: Any;
  label: string;
}) {
  const { t } = useLocale();
  const action = String(proposal.action || "hold").toLowerCase();
  const targets = Object.entries(proposal.targets || {}) as [string, number][];
  const preserved: string[] = proposal.preserve_symbols || [];
  const total = targets.reduce((sum, [, value]) => sum + value, 0);
  const cash =
    action === "hold" || preserved.length ? null : Math.max(0, 1 - total);
  return (
    <section className="proposal-allocation" aria-label={label}>
      <h4>{label}</h4>
      <dl className="decision-facts">
        <div>
          <dt>{t("desk.action")}</dt>
          <dd>{enumLabel(t, action)}</dd>
        </div>
        <div>
          <dt>{t("desk.targetCount")}</dt>
          <dd>{action === "hold" ? "—" : targets.length}</dd>
        </div>
        <div>
          <dt>{t("desk.targetCash")}</dt>
          <dd>{cash == null ? "—" : pct(cash)}</dd>
        </div>
      </dl>
      {action === "hold" ? (
        <p className="allocation-notice">{t("four.holdShares")}</p>
      ) : (
        <>
          {targets.length > 0 ? (
            <table className="allocation-table">
              <thead>
                <tr>
                  <th>{t("标的")}</th>
                  <th>{t("目标仓位")}</th>
                </tr>
              </thead>
              <tbody>
                {targets.map(([symbol, weight]) => (
                  <tr key={symbol}>
                    <td>
                      <strong>{symbol}</strong>
                    </td>
                    <td>
                      <span className="allocation-track" aria-hidden="true">
                        <i
                          style={{
                            width: `${Math.max(0, Math.min(1, weight)) * 100}%`,
                          }}
                        />
                      </span>
                      <b>{pct(weight)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="allocation-notice">
              {t(
                preserved.length ? "four.noAdditionalTargets" : "four.cashOnly",
              )}
            </p>
          )}
          <p className="allocation-timing">{t("desk.targetTiming")}</p>
        </>
      )}
      {preserved.length > 0 && (
        <div className="preserved-symbols">
          <small>{t("four.preserve")}</small>
          <div className="symbol-chips">
            {preserved.map((symbol) => (
              <span key={symbol}>{symbol}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
