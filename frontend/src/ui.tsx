import React from "react";
export function Btn({ children, onClick, kind = "", disabled = false, ...props }: any) {
  return (
    <button type="button" className={kind} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  );
}
export function Panel({ title, children, className = "" }: any) {
  return (
    <section className={"panel " + className}>
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}
export function Empty({ children }: any) {
  return <div className="empty">{children}</div>;
}
export function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    Overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    Experiments:
      "M8 3h8M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8",
    "Trading desk": "M4 19V9m5 10V5m5 14v-7m5 7V3",
    "Expert library":
      "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    "Review queue": "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
    Portfolio: "M3 7h18v14H3zM7 7V4h10v3M3 12h18",
    Reports: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
    Activity: "M3 12h4l3-8 4 16 3-8h4",
    "Data hub":
      "M12 3c5 0 9 2 9 4s-4 4-9 4-9-2-9-4 4-4 9-4zM3 7v5c0 2 4 4 9 4s9-2 9-4V7M3 12v5c0 2 4 4 9 4s9-2 9-4v-5",
    Settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.1l-.2.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.6-1h-.2l-2.9-1.7.1-.2a1.7 1.7 0 0 0-.1-1.8l-.1-.2v-3.4l.2-.1a1.7 1.7 0 0 0 1-1.6v-.2l1.7-2.9.2.1a1.7 1.7 0 0 0 1.8-.1l.2-.1h3.4l.1.2a1.7 1.7 0 0 0 1.6 1h.2l2.9 1.7-.1.2a1.7 1.7 0 0 0 .1 1.8l.1.2v3.4z",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] || paths.Overview} />
    </svg>
  );
}
export function FlaskIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6M10 3v7l-5 9a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-9V3M8 15h8" />
    </svg>
  );
}
export function KPIs({ detail }: any) {
  const m = detail?.metrics || {};
  return (
    <div className="kpis">
      <div className="kpi">
        <label>Portfolio value</label>
        <b>{m.portfolio_value != null ? money(m.portfolio_value) : "—"}</b>
        <small>
          {detail ? "Current replay value" : "Select an experiment"}
        </small>
      </div>
      <div className="kpi">
        <label>Total return</label>
        <b className={m.total_return < 0 ? "red" : "green"}>{pct(m.total_return)}</b>
        <small>Since experiment start</small>
      </div>
      <div className="kpi">
        <label>Max drawdown</label>
        <b className="red">{pct(m.max_drawdown)}</b>
        <small>Peak to trough</small>
      </div>
      <div className="kpi">
        <label>Cash available</label>
        <b>{money(detail?.state?.cash)}</b>
        <small>Simulated cash</small>
      </div>
    </div>
  );
}
export function Chart({ history = [], benchmark = [] }: any) {
  const valuesFor = (rows: any[]) =>
    (rows || [])
      .map((x: any) => Number(x.equity ?? x.value ?? x.portfolio_value))
      .filter(Number.isFinite);
  const portfolioValues = valuesFor(history);
  const benchmarkValues = valuesFor(benchmark);
  const returns = (values: number[]) =>
    values.map((value) => (value / values[0] - 1) * 100);
  const portfolioReturns = returns(portfolioValues);
  const benchmarkReturns = returns(benchmarkValues);
  const allReturns = [...portfolioReturns, ...benchmarkReturns];
  const low = Math.min(0, ...allReturns);
  const high = Math.max(0, ...allReturns);
  const seriesPoints = (values: number[]) => {
    const points = returns(values);
    if (!points.length) return "";
    return points
      .map(
        (value, i) =>
          `${20 + (i * 660) / Math.max(1, points.length - 1)},${210 - ((value - low) / (high - low || 1)) * 160}`,
      )
      .join(" ");
  };
  const points = seriesPoints(portfolioValues);
  const benchmarkPoints = seriesPoints(benchmarkValues);
  return (
    <div className="chart">
      <div className="chartlegend">
        <span>● Portfolio</span>
        {benchmark?.length > 0 && (
          <span className="muted">● Buy &amp; hold benchmark</span>
        )}
      </div>
      <svg viewBox="0 0 700 240" preserveAspectRatio="none">
        <path d="M20 40H680M20 90H680M20 140H680M20 190H680" stroke="#30352f" />
        {benchmarkPoints && (
          <polyline
            points={benchmarkPoints}
            fill="none"
            stroke="#899187"
            strokeWidth="2"
            strokeDasharray="6 7"
          />
        )}
        {points && (
          <polyline
            points={points}
            fill="none"
            stroke="#d6ee3e"
            strokeWidth="3"
          />
        )}
      </svg>
      <div className="axis">
        {history?.[0]?.date || "Awaiting history"}{" "}
        <span>{history?.at(-1)?.date || "No replay yet"}</span>
      </div>
    </div>
  );
}
export function money(n: any, maximumFractionDigits = 0) {
  return n == null
    ? "—"
    : Number(n).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits,
      });
}
export function pct(n: any) {
  return n == null ? "—" : `${(Number(n) * 100).toFixed(2)}%`;
}
