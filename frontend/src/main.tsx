import React, { useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {
  Btn,
  Panel,
  Empty,
  KPIs,
  Chart,
  money,
  pct,
  NavIcon,
  FlaskIcon,
} from "./ui";
import { Any, req } from "./api";
import { AuthContext, AuthGate } from "./AuthGate";
import ReplayDesk from "./ReplayDesk";

const nav = [
  ["Overview", "Overview"],
  ["Experiments", "Experiments"],
  ["Trading desk", "Trading desk"],
  ["Expert library", "Expert library"],
  ["Review queue", "Review queue"],
  ["Portfolio", "Portfolio"],
  ["Reports", "Reports"],
  ["Activity", "Activity"],
  ["Data hub", "Data hub"],
  ["Settings", "Settings"],
];
function App() {
  const auth = useContext(AuthContext);
  const initialQuery = new URLSearchParams(window.location.search);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = window.localStorage.getItem("trading-lab-sidebar-collapsed");
      return saved == null ? window.matchMedia("(max-width: 800px)").matches : saved === "true";
    }
    catch { return false; }
  });
  const [page, S] = useState(initialQuery.get("view") === "desk" ? "Trading desk" : "Overview"),
    [datasets, D] = useState<Any[]>([]),
    [experts, E] = useState<Any[]>([]),
    [runs, R] = useState<Any[]>([]),
    [reviews, V] = useState<Any[]>([]),
    [activity, A] = useState<Any[]>([]),
    [sel, Q] = useState(initialQuery.get("experiment") || localStorage.getItem("trading-lab-selected") || ""),
    [detail, X] = useState<Any | null>(null),
    [settings, T] = useState<Any>({}),
    [busy, B] = useState(false),
    [initialLoading, IL] = useState(true),
    [err, Z] = useState(""),
    [notice, N] = useState(""),
    [modal, M] = useState(""),
    [wizard, W] = useState(1),
    [compare, C] = useState<string[]>([]),
    [comparisonData, CD] = useState<Any | null>(null),
    [pendingReview, PR] = useState<Any | null>(null),
    [pendingExpert, PE] = useState<Any | null>(null),
    [teamPolicy, TP] = useState<string | null>(null),
    [teamAdd, TA] = useState<Any | null>(null);
  const reload = async () => {
    try {
      let [ds, ex, rs, rv, ac, st] = await Promise.all([
        req("/datasets"),
        req("/experts"),
        req("/experiments"),
        req("/reviews"),
        req("/activity"),
        req("/settings"),
      ]);
      D(ds);
      E(ex);
      R(rs);
      V(rv);
      A(ac);
      T(st);
      IL(false);
      if (!sel && rs[0]) {
        Q(rs[0].id);
        localStorage.setItem("trading-lab-selected", rs[0].id);
      }
    } catch (e: any) {
      IL(false);
      Z(e.message);
    }
  };
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem("trading-lab-sidebar-collapsed", String(sidebarCollapsed)); }
    catch { /* Keep the preference for this visit when storage is unavailable. */ }
  }, [sidebarCollapsed]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); }, [page]);
  useEffect(() => {
    let active = true;
    if (sel) {
      X(null);
      req(`/experiments/${sel}`)
        .then((data) => { if (active) X(data); })
        .catch((e: any) => { if (active) Z(e.message); });
    } else X(null);
    return () => { active = false; };
  }, [sel]);
  useEffect(() => {
    if (!sel || detail?.status !== "running") return;
    const timer = setInterval(
      () =>
        req(`/experiments/${sel}`)
          .then((d) => {
            X(d);
            R((old) => old.map((r) => (r.id === d.id ? { ...r, ...d } : r)));
            if (d.status !== "running") reload();
          })
          .catch((e: any) => Z(e.message)),
      1800,
    );
    return () => clearInterval(timer);
  }, [sel, detail?.status]);
  const action = async (f: () => Promise<any>, message = "Saved") => {
    B(true);
    Z("");
    N("");
    try {
      const out = await f();
      if (out?.id && out?.config) {
        Q(out.id);
        localStorage.setItem("trading-lab-selected", out.id);
        X(out);
      }
      await reload();
      N(message);
      return out;
    } catch (e: any) {
      Z(e.message);
      return null;
    } finally {
      B(false);
    }
  };
  const expConfig = detail?.config || {};
  const title = page === "Trading desk" ? "Trading workspace" : page;
  const selectExp = (id: string) => {
    Q(id);
    localStorage.setItem("trading-lab-selected", id);
  };
  return (
    <>
      <header>
        <b className="logo">
          <FlaskIcon />
        </b>
        <strong>Trading Lab</strong>
        <div className="toplinks">
          {["Overview", "Experiments", "Expert library", "Reports"].map((x) => (
            <button key={x} className={page === x ? "active" : ""} onClick={() => S(x)}>
              {x}
            </button>
          ))}
        </div>
        <span className="pill lime">● Historical replay</span>
        <span className="pill">
          ●{" "}
          {expConfig.strategy && expConfig.strategy !== "agent"
            ? `Baseline · ${expConfig.strategy}`
            : expConfig.provider_mode === "llm"
              ? "LLM provider"
              : "Deterministic agent demo"}
        </span>
        {!!datasets.find((d: Any) => d.id === expConfig.dataset_id)
          ?.synthetic && <span className="pill">Synthetic dataset</span>}
        {auth.enabled && <button onClick={auth.logout}>Sign out</button>}
      </header>
      <aside className={sidebarCollapsed ? "sidebar-collapsed" : ""}>
        <button className="sidebar-toggle" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>
          <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span><span className="sidebar-toggle-label">{sidebarCollapsed ? "展开" : "收起"}</span>
        </button>
        {nav.map(([n, ic]) => (
          <button
            key={n}
            aria-label={n}
            title={n}
            className={page === n ? "active" : ""}
            onClick={() => S(n)}
          >
            <span>
              <NavIcon name={ic} />
            </span>
            <span className="nav-label">{n}</span>
          </button>
        ))}
        <div className="sidefoot">
          RESEARCH WORKSPACE
          <br />
          <br />
          Simulated capital only
        </div>
      </aside>
      <main className={sidebarCollapsed ? "sidebar-collapsed" : ""}>
        {initialLoading && (
          <div className="notice">Loading saved workspace…</div>
        )}
        <div className="heading">
          <div>
            <h1>{title}</h1>
            <div className="sub">
              {page === "Trading desk" && detail
                ? `${detail.id} / ${detail.name} · Decisions use visible history only`
                : desc(page)}
            </div>
          </div>
          <div className="heading-actions">
            {page === "Experiments" && (
              <button
                className="primary"
                onClick={() => {
                  W(1);
                  M("wizard");
                }}
              >
                ＋ New experiment
              </button>
            )}
          </div>
        </div>
        {err && (
          <div className="error">
            {err}
            <button
              onClick={() => {
                Z("");
                reload();
              }}
            >
              Retry
            </button>
          </div>
        )}
        {notice && <div className="notice">{notice}</div>}
        {busy && <div className="notice">Saving changes…</div>}
        {page === "Overview" && (
          <Overview
            runs={runs}
            detail={detail}
            go={S}
            open={() => S("Trading desk")}
            select={selectExp}
            loading={initialLoading}
            refresh={reload}
            create={() => { W(1); M("wizard"); }}
          />
        )}
        {page === "Experiments" && (
          <Experiments
            runs={runs}
            compare={compare}
            C={C}
            select={(id: string) => {
              selectExp(id);
              S("Trading desk");
            }}
            start={() => {
              W(1);
              M("wizard");
            }}
          />
        )}
        {page === "Trading desk" && (
          <Desk
            detail={detail}
            experts={experts}
            go={S}
            decision={(d: any, act: string) => review(d, act)}
            doStep={doStep}
            doRun={doRun}
            busy={busy}
            selectExp={selectExp}
            runs={runs}
            branch={() => M("branch")}
            editTeam={openTeamEditor}
          />
        )}
        {page === "Expert library" && (
          <Experts
            experts={experts}
            add={(e: any) => assign(e)}
            create={() => M("expert")}
          />
        )}
        {page === "Review queue" && (
          <Reviews
            items={reviews}
            review={review}
            open={(d: any) => {
              M("review");
              X(detail);
            }}
          />
        )}
        {page === "Portfolio" && <Portfolio detail={detail} />}
        {page === "Reports" && (
          <Reports
            runs={runs}
            compare={compare}
            C={C}
            exportRun={exportRun}
            result={comparisonData}
            compareNow={compareNow}
          />
        )}
        {page === "Activity" && <Activity items={activity} />}
        {page === "Data hub" && <DataHub datasets={datasets} upload={upload} />}
        {page === "Settings" && (
          <Settings
            settings={settings}
            save={saveSettings}
            test={testSettings}
          />
        )}
      </main>
      {modal === "wizard" && (
        <Wizard
          step={wizard}
          setStep={W}
          close={() => M("")}
          datasets={datasets}
          experts={experts}
          submit={createRun}
        />
      )}
      {modal === "expert" && (
        <ExpertForm close={() => M("")} save={createExpert} />
      )}
      {modal === "review" && (
        <ReviewModal
          item={pendingReview}
          close={() => {
            M("");
            PR(null);
          }}
          review={review}
        />
      )}
      {modal === "team" && (
        <TeamChangeModal
          expert={pendingExpert}
          close={() => {
            M("");
            PE(null);
          }}
          choose={(policy: string) => {
            TP(policy);
            M("team-editor");
          }}
        />
      )}
      {modal === "team-editor" && detail && (
        <TeamEditor
          team={teamAdd && !(detail.state?.pending_team?.team || detail.state?.active_team || expConfig.team || []).some((t: Any) => (t.expert_id || t.id) === teamAdd.id) ? (detail.state?.pending_team?.team || detail.state?.active_team || expConfig.team || []).concat({
            expert_id: teamAdd.id,
            role: String(teamAdd.role || "trader").toLowerCase(),
            enabled: true,
          }) : (detail.state?.pending_team?.team || detail.state?.active_team || expConfig.team || []).map((t: Any) => ({ ...t, expert_id: t.expert_id || t.id }))}
          experts={experts}
          dataset={datasets.find((d: Any) => d.id === expConfig.dataset_id)}
          pendingPolicy={teamPolicy}
          hasPending={(detail.decisions || []).some((d: Any) =>
            ["pending", "awaiting_review"].includes(d.status),
          )}
          close={() => { M(""); TP(null); TA(null); PE(null); }}
          save={saveTeam}
        />
      )}
      {modal === "branch" && detail && (
        <BranchModal
          detail={detail}
          close={() => M("")}
          create={createBranch}
        />
      )}
    </>
  );
  async function doStep() {
    if (!sel) return;
    const out = await action(
      () => req(`/experiments/${sel}/step`, { method: "POST" }),
      "Session advanced",
    );
    if (out?.status === "paused") {
      const errorEvent = [...(out.events || [])]
        .reverse()
        .find((event: Any) => event.type === "error");
      Z(
        errorEvent?.message ||
          "The replay paused. Inspect the audit event, then retry from this saved snapshot.",
      );
      N("");
    }
  }
  function doRun(mode = "run") {
    if (sel)
      action(
        () => req(`/experiments/${sel}/${mode}`, { method: "POST" }),
        mode === "pause" ? "Run paused" : "Run started",
      );
  }
  function openTeamEditor(add?: Any) {
    if (expConfig.strategy && expConfig.strategy !== "agent") {
      N("Expert cards do not run in a deterministic baseline experiment.");
      return;
    }
    if (!sel) {
      N("Select or create an experiment first.");
      return;
    }
    const pending = (detail?.decisions || []).some((d: Any) =>
      ["pending", "awaiting_review"].includes(d.status),
    );
    TA(add || null);
    TP(null);
    if (pending) {
      PE(add || null);
      M("team");
    } else M("team-editor");
  }
  async function saveTeam(team: Any[], policy?: string) {
    const out = await action(
      () => req(`/experiments/${sel}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team, pending_policy: policy || "keep" }),
      }),
      "Team change scheduled for next decision boundary",
    );
    if (out) { M(""); TP(null); TA(null); PE(null); }
  }
  async function review(
    decision: any,
    act = "approve",
    reason = "",
    targets?: Any,
  ) {
    const d = decision?.decision_id || decision?.id;
    const runId = decision?.experiment_id || sel;
    if (!runId || !d) return;
    if ((act === "modify" || act === "reject") && !reason) {
      let context = decision;
      if (act === "modify" && !context?.config?.symbols) {
        try {
          const experiment = await req(`/experiments/${runId}`);
          context = { ...context, config: experiment.config };
        } catch (e: any) {
          Z(`Could not load experiment limits for review: ${e.message}`);
          return;
        }
      }
      PR(context);
      M("review");
      return;
    }
    const out = await action(
      () =>
        req(`/experiments/${runId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision_id: d,
            action: act,
            reason,
            targets: act === "modify" ? targets : undefined,
          }),
        }),
      "Review recorded",
    );
    if (out) {
      PR(null);
      M("");
    }
  }
  async function assign(ex: Any, policy?: string) {
    if (expConfig.strategy && expConfig.strategy !== "agent") {
      N("Expert cards do not run in a deterministic baseline experiment.");
      return;
    }
    if (
      (ex.required_data || []).some((d: string) =>
        /fundamental|financial/i.test(d),
      )
    ) {
      N(
        `${ex.name} requires fundamental data that is not available in this dataset.`,
      );
      return;
    }
    if (!sel) {
      N("Select or create an experiment first.");
      return;
    }
    openTeamEditor(ex);
  }
  async function createBranch(mode: string) {
    const out = await action(
      () =>
        req(`/experiments/${sel}/branch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        }),
      "Configuration branch created",
    );
    if (out) {
      M("");
      S("Trading desk");
    }
  }
  async function compareNow() {
    if (compare.length < 2) {
      Z("Select at least two experiments to compare.");
      return;
    }
    B(true);
    Z("");
    try {
      CD(await req(`/compare?ids=${compare.join(",")}`));
    } catch (e: any) {
      Z(e.message);
    } finally {
      B(false);
    }
  }
  async function createRun(v: Any) {
    const out = await action(
      () =>
        req("/experiments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        }),
      "Experiment created",
    );
    if (out) {
      M("");
      S("Trading desk");
    }
  }
  function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    action(
      () => req("/datasets/import", { method: "POST", body: fd }),
      "Dataset imported",
    );
  }
  async function saveSettings(v: Any) {
    return action(
      () =>
        req("/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        }),
      "Settings saved",
    );
  }
  function testSettings() {
    action(
      () => req("/settings/test", { method: "POST" }),
      "Connection test succeeded",
    );
  }
  async function createExpert(v: Any) {
    const out = await action(
      () =>
        req("/experts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        }),
      "Expert saved",
    );
    if (out) M("");
  }
  async function exportRun(id: string, format = "json") {
    if (!id) { Z("Select an experiment to export."); return; }
    await action(async () => {
      const response = await fetch(`/api/experiments/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`);
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event("trading-lab-auth-expired"));
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `trading-lab-${id}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }, "Report download prepared");
  }
}
function desc(p: string) {
  return (
    (
      {
        Overview: "Build a team. Run an experiment. Understand every decision.",
        Experiments:
          "Versioned configurations and isolated simulated portfolios.",
        "Expert library":
          "Plug investment perspectives into your trading team.",
        "Review queue":
          "Inspect evidence, then record an auditable human decision.",
        Portfolio: "Simulated holdings and queued orders.",
        Reports: "Compare performance with compatible experiment settings.",
        Activity:
          "A permanent trail of evidence, proposals, interventions and fills.",
        "Data hub": "Import and version historical market data.",
        Settings:
          "Configure a compatible model endpoint. Secrets are write-only.",
      } as any
    )[p] || ""
  );
}
function Overview({ runs, detail, go, open, select, loading, refresh, create }: any) {
  return (
    <>
      <KPIs detail={detail} />
      <div className="grid2">
        <Panel title="Performance at a glance">
          <Chart
            history={detail?.history}
            benchmark={detail?.benchmark_history}
          />
          <div className="micro">
            Sharpe{" "}
            {detail?.metrics?.sharpe == null
              ? "—"
              : Number(detail.metrics.sharpe).toFixed(2)}
            　 Trades {detail?.orders?.length || 0}　 Exposure{" "}
            {pct(detail?.metrics?.exposure)}
          </div>
        </Panel>
        <Panel title="Continue your work">
          <div className="tag warn">
            {detail?.status || "No experiment selected"}
          </div>
          <h2>{detail?.name || "Start an experiment"}</h2>
          <p>
            {detail
              ? `Replay status: ${detail.status}. View server-recorded decisions and continue the replay.`
              : "Create an experiment to see its real state here."}
          </p>
          <Btn kind="primary" onClick={open}>
            Open trading desk
          </Btn>
          <Btn onClick={() => go("Review queue")}>Review queue</Btn>
        </Panel>
      </div>
      <Panel title="Recent experiments">
        <div className="toolbar end"><Btn onClick={refresh} disabled={loading}>Refresh</Btn></div>
        {loading ? <Empty>Loading saved experiments…</Empty> : runs?.length ? <RunTable runs={runs} select={select} /> : <Empty>No experiments found. <Btn kind="primary" onClick={create}>Create an experiment</Btn></Empty>}
      </Panel>
    </>
  );
}
function RunTable({ runs, select }: any) {
  return runs?.length ? (
    <table>
      <thead>
        <tr>
          <th>Experiment</th>
          <th>Mode</th>
          <th>Status</th>
          <th>Return</th>
          <th>Dataset</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r: any) => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td>{r.mode || r.config?.mode || "—"}</td>
            <td>
              <span className="tag">{r.status}</span>
            </td>
            <td>{pct(r.total_return)}</td>
            <td>{r.dataset_id || "—"}</td>
            <td>
              <Btn onClick={() => select(r.id)}>Open</Btn>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <Empty>No experiments have been created.</Empty>
  );
}
function Experiments({ runs, compare, C, select, start }: any) {
  return (
    <>
      <Panel title="Experiment registry">
        <div className="toolbar">
          <span>Compare compatible experiment snapshots</span>
          <Btn
            kind="primary"
            onClick={() =>
              C(compare.length ? [] : runs.slice(0, 2).map((x: any) => x.id))
            }
          >
            Compare selected ({compare.length})
          </Btn>
        </div>
        {runs?.length ? (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Experiment</th>
                <th>Mode</th>
                <th>State</th>
                <th>Return</th>
                <th>Dataset</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={compare.includes(r.id)}
                      onChange={() =>
                        C(
                          compare.includes(r.id)
                            ? compare.filter((x: string) => x !== r.id)
                            : [...compare, r.id],
                        )
                      }
                    />
                  </td>
                  <td>{r.name}</td>
                  <td>{r.mode || "—"}</td>
                  <td>{r.status}</td>
                  <td>{pct(r.total_return)}</td>
                  <td>{r.dataset_id}</td>
                  <td>
                    <Btn onClick={() => select(r.id)}>Open</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Create a research run to start comparing strategies.</Empty>
        )}
      </Panel>
      <Panel title="Research integrity">
        <p>
          Results are simulated. Comparisons may be misleading when dates,
          assets, starting capital or execution costs differ.
        </p>
        <Btn kind="primary" onClick={start}>
          ＋ New experiment
        </Btn>
      </Panel>
    </>
  );
}
function Desk({
  detail,
  experts,
  go,
  decision,
  doStep,
  doRun,
  busy,
  selectExp,
  runs,
  branch,
  editTeam,
}: any) {
  if (!detail)
    return (
      <Panel title="Trading desk">
        <Empty>
          Select an experiment from the registry, or create one to start.
        </Empty>
        <Btn onClick={() => go("Experiments")}>Browse experiments</Btn>
      </Panel>
    );
  const baseline =
    detail.config?.strategy && detail.config.strategy !== "agent";
  return (
    <>
      <ReplayDesk detail={detail} doStep={doStep} doRun={doRun} branch={branch} decision={decision} experts={experts} busy={busy} />
      <Panel
        title={baseline ? "Experts not used by this baseline" : "Expert team"}
      >
        {baseline ? (
          <p>
            This deterministic {detail.config.strategy} baseline does not call
            experts or an LLM. The configured expert team is not part of this
            result.
          </p>
        ) : (
          <>
            <div className="badgegrid">
              {(detail.state?.active_team?.length ? detail.state.active_team : detail.config?.team || []).map((t: any) => {
                const expert = experts.find((e: Any) => e.id === (t.expert_id || t.id)) || t;
                return <ExpertBadge key={`active-${t.expert_id || t.id}`} ex={expert} role={t.role} enabled={true} />;
              })}
              <div className="addbadge" onClick={() => go("Expert library")}>
                ＋<br />
                Add expert
              </div>
            </div>
            <p className="muted">
              Changes are scheduled at the next decision boundary and preserved
              in experiment history.
            </p>
            {detail.state?.pending_team && <p className="tag">Team update scheduled for the next decision boundary · {detail.state.pending_team.team.length} expert(s)</p>}
            <Btn onClick={() => editTeam()}>Edit team</Btn>
          </>
        )}
      </Panel>
      <Panel title="Current holdings">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Shares</th>
              <th>Weight</th>
              <th>Current value</th>
              <th>Quote freshness</th>
            </tr>
          </thead>
          <tbody>
            {(detail.holdings || []).map((h: any) => (
              <tr key={h.symbol || h.asset}>
                <td>{h.symbol || h.asset}</td>
                <td>{h.quantity ?? h.shares}</td>
                <td>{pct(h.weight)}</td>
                <td>{money(h.market_value ?? h.value)}</td>
                <td>
                  <span className={h.is_stale ? "tag warn" : "tag"}>
                    {h.is_stale ? "Stale · " : "As of "}
                    {h.price_date || "date unavailable"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!detail.holdings?.length && (
          <Empty>No positions in this snapshot.</Empty>
        )}
      </Panel>
    </>
  );
}
function ExpertBadge({ ex, role, enabled }: any) {
  const map = [
    [
      "0000011111100000",
      "0001111111111000",
      "0011111111111100",
      "0011111111111100",
      "0011100000011100",
      "0011000000001100",
      "0011011001101100",
      "0011000000001100",
      "0001000100001000",
      "0001000000001000",
      "0000101111010000",
      "0000010000100000",
      "0000011111100000",
      "0001110110111000",
      "0011110011111100",
      "0111110011111110",
    ],
    [
      "0000001111000000",
      "0000111111110000",
      "0001100000011000",
      "0001000000001000",
      "0011011001101100",
      "0011111111111100",
      "0011011001101100",
      "0001000000001000",
      "0001000110001000",
      "0000100000010000",
      "0000011111100000",
      "0000001001000000",
      "0000111001110000",
      "0011111001111100",
      "0111110110111110",
      "1111110110111111",
    ],
    [
      "0000011111100000",
      "0001111111111000",
      "0011111111111100",
      "0011100000011100",
      "0111000000001110",
      "0111011001101110",
      "0111111111111110",
      "0111011001101110",
      "0111000000001110",
      "0111000110001110",
      "0111100000011110",
      "0011111111111100",
      "0000011111100000",
      "0001110110111000",
      "0011111001111100",
      "0111111111111110",
    ],
  ];
  const n = ex?.strategy === "value" ? 1 : ex?.strategy === "risk" ? 2 : 0;
  return (
    <div className="badge">
      <div className="lanyard"></div>
      <div className="strip">
        {ex?.name?.toUpperCase() || "EXPERT"} <span>{role || ex?.role}</span>
        <i>{enabled ? "●" : "○"}</i>
      </div>
      <div className="badgebody">
        <svg className="portrait" viewBox="-2 -2 20 20">
          <rect x="-2" y="-2" width="20" height="20" fill="#f3f5ef" />
          {map[n].map((row, y) =>
            [...row].map((c, x) =>
              c === "1" ? (
                <rect
                  key={`${n}-${y}-${x}`}
                  x={x}
                  y={y}
                  width="1"
                  height="1"
                  fill="#11140d"
                />
              ) : null,
            ),
          )}
        </svg>
        <div>
          <b>{role || ex?.role || "Advisor"}</b>
          <small>{ex?.description || ex?.objective}</small>
        </div>
      </div>
      <footer>
        EXP · v{ex?.version || "1.0"}　
        <span>{enabled === false ? "○" : "●"}</span>{" "}
        {enabled === false
          ? "Disabled · data unavailable"
          : enabled === true
            ? "Active next decision"
            : "Versioned · not assigned"}
      </footer>
    </div>
  );
}
function Experts({ experts, add, create }: any) {
  const [search, setSearch] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [selectedExpert, setSelectedExpert] = useState<Any | null>(null);
  const matches = (experts || []).filter((expert: Any) => {
    const query = search.trim().toLowerCase();
    const haystack = [expert.name, expert.strategy, expert.description, expert.objective, expert.horizon, ...(expert.required_data || [])].join(" ").toLowerCase();
    const strategy = String(expert.strategy || "").toLowerCase();
    return (!query || haystack.includes(query)) && (strategyFilter === "all" || strategy === strategyFilter);
  });
  const requiredData = (expert: Any) => expert.required_data || [];
  const missingData = (expert: Any) => requiredData(expert).filter((field: string) => !["price", "prices", "ohlcv", "price history", "historical prices"].includes(field.toLowerCase()));
  return (
    <>
      <div className="toolbar">
        <input placeholder="Search experts" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select value={strategyFilter} onChange={(event) => setStrategyFilter(event.target.value)}>
          <option value="all">All strategies</option>
          <option value="momentum">Trend</option>
          <option value="value">Value</option>
          <option value="risk">Risk</option>
        </select>
        <Btn kind="primary" onClick={create}>
          Create expert
        </Btn>
      </div>
      <div className="expertgrid">
        {matches.map((ex: any) => (
          <Panel key={ex.id}>
            <ExpertBadge ex={ex} />
            <p>{ex.objective || ex.description}</p>
            <small>
              Required data: {(ex.required_data || []).join(", ") || "OHLCV"}
            </small>
            {missingData(ex).length > 0 && <p className="error compact">Unavailable for the current OHLCV-only datasets: requires {missingData(ex).join(", ")}. No financial data is fabricated.</p>}
            <div className="toolbar">
              <Btn onClick={() => add(ex)}>Add to team</Btn>
              <Btn onClick={() => add({ ...ex, role: "Advisor" })}>
                Add as advisor
              </Btn>
              <Btn onClick={() => setSelectedExpert(ex)}>Strategy details</Btn>
            </div>
          </Panel>
        ))}
        {!matches.length && <Empty>No expert cards match these filters.</Empty>}
      </div>
      <Panel title="Role rules">
        <p>
          Advisors provide evidence and dissent; the execution engine accepts
          one final target plan. Missing required data must block or limit
          activation.
        </p>
      </Panel>
      {selectedExpert && <div className="overlay"><div className="modal">
        <button className="x" onClick={() => setSelectedExpert(null)}>×</button>
        <h2>{selectedExpert.name} · v{selectedExpert.version || "1"}</h2>
        <p>{selectedExpert.description || selectedExpert.objective}</p>
        <dl className="expert-details">
          <dt>Strategy objective</dt><dd>{selectedExpert.objective || "Not provided"}</dd>
          <dt>Horizon</dt><dd>{selectedExpert.horizon || "Not specified"}</dd>
          <dt>Required data</dt><dd>{requiredData(selectedExpert).join(", ") || "OHLCV"}</dd>
          <dt>Instructions</dt><dd>{selectedExpert.instructions || "Not provided"}</dd>
          <dt>Risk notes</dt><dd>{selectedExpert.risk_notes || "Not provided"}</dd>
        </dl>
        {missingData(selectedExpert).length > 0 && <p className="error compact">Unavailable for the current OHLCV-only datasets: requires {missingData(selectedExpert).join(", ")}. No financial data is fabricated.</p>}
        <Btn onClick={() => setSelectedExpert(null)}>Close details</Btn>
      </div></div>}
    </>
  );
}
function Reviews({ items, review }: any) {
  return (
    <Panel title="Pending decisions">
      {items?.length ? (
        <table>
          <thead>
            <tr>
              <th>Decision</th>
              <th>Experiment</th>
              <th>Date</th>
              <th>Proposal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((d: any) => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td>{d.experiment_name || d.experiment_id}</td>
                <td>{d.date || "—"}</td>
                <td>
                  <b>{(d.decision?.original_proposal || d.proposal || d.original_proposal)?.action || d.decision?.action || d.action || "Proposal"}</b>
                  {(d.decision?.original_proposal || d.proposal || d.original_proposal)?.targets && (
                    <div>
                      {Object.entries((d.decision?.original_proposal || d.proposal || d.original_proposal).targets).map(
                        ([symbol, weight]) => (
                          <span key={symbol} className="tag">
                            {symbol} {pct(weight)}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  <small>
                    {(d.decision?.original_proposal || d.proposal || d.original_proposal)?.rationale || d.rationale ||
                      "No rationale was returned with this proposal."}
                  </small>
                </td>
                <td>
                  <Btn kind="primary" onClick={() => review(normalizeReview(d), "approve")}>
                    Approve
                  </Btn>
                  <Btn onClick={() => review(normalizeReview(d), "modify")}>Modify</Btn>
                  <Btn kind="danger" onClick={() => review(normalizeReview(d), "reject")}>
                    Reject
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No pending review decisions.</Empty>
      )}
    </Panel>
  );
}
function normalizeReview(item: Any) {
  const decision = item?.decision || {};
  return {
    ...decision,
    ...item,
    decision_id: item?.decision_id || item?.id || decision?.id,
    experiment_id: item?.experiment_id || decision?.experiment_id,
    as_of_date: item?.date || decision?.as_of_date || decision?.date,
    original_proposal: item?.proposal || item?.original_proposal || decision?.original_proposal,
  };
}
function ReviewModal({ item, close, review }: any) {
  const originalTargets = item?.original_proposal?.targets || {};
  const [reason, setReason] = useState("");
  const [targetsText, setTargetsText] = useState(JSON.stringify(originalTargets, null, 2));
  const symbols: string[] = item?.config?.symbols || [];
  const maxWeight = Number(item?.config?.max_position_weight);
  const validateTargets = (source: string) => {
    try {
      const targets = JSON.parse(source);
      if (!targets || Array.isArray(targets) || typeof targets !== "object") return "Enter a JSON object mapping symbols to target weights.";
      if (!Number.isFinite(maxWeight) || !symbols.length) return "Experiment limits are still loading.";
      let total = 0;
      for (const [rawSymbol, rawWeight] of Object.entries(targets)) {
        const symbol = rawSymbol.toUpperCase();
        if (!symbols.includes(symbol)) return `${symbol} is not in this experiment’s asset universe.`;
        if (typeof rawWeight !== "number" || !Number.isFinite(rawWeight) || rawWeight < 0) return `${symbol} must have a finite, non-negative weight.`;
        if (rawWeight > maxWeight + 1e-9) return `${symbol} exceeds the ${(maxWeight * 100).toFixed(2)}% per-position limit.`;
        total += rawWeight;
      }
      if (total > 1 + 1e-9) return "Target weights cannot exceed 100% in total.";
      return "";
    } catch {
      return "Targets must be valid JSON.";
    }
  };
  const targetProblem = validateTargets(targetsText);
  return (
    <div className="overlay">
      <div className="modal">
        <button className="x" onClick={close}>
          ×
        </button>
        <h2>
          Review decision ·{" "}
          {item?.as_of_date || item?.date || "date unavailable"}
        </h2>
        <p>Original proposal remains in the audit record.</p>
        {String(item?.original_proposal?.action || "").toLowerCase() === "hold" && <p className="tag">Approving HOLD keeps the current portfolio and creates no new order.</p>}
        {item?.original_proposal && (
          <div className="proposal-preview">
            <b>
              {String(
                item.original_proposal.action || "Proposal",
              ).toUpperCase()}
            </b>
            <p>
              {item.original_proposal.rationale || "No rationale provided."}
            </p>
            {item.original_proposal.targets && (
              <pre>
                {JSON.stringify(item.original_proposal.targets, null, 2)}
              </pre>
            )}
          </div>
        )}
        <label>
          Reason (required for modify/reject)
          <textarea placeholder="Explain your intervention" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <label>
          Modified target weights (JSON; example target AAPL at 10%)
          <textarea
            placeholder={'{"AAPL":0.1}'}
            value={targetsText}
            onChange={(event) => setTargetsText(event.target.value)}
          />
        </label>
        {targetProblem && <p className="error compact">{targetProblem}</p>}
        <div className="toolbar">
          <Btn kind="primary" onClick={() => review(item, "approve")}>
            Approve
          </Btn>
          <Btn
            disabled={!reason.trim() || !!targetProblem}
            onClick={() => {
              if (!reason.trim() || targetProblem) return;
              review(item, "modify", reason.trim(), JSON.parse(targetsText));
            }}
          >
            Modify
          </Btn>
          <Btn
            kind="danger"
            disabled={!reason.trim()}
            onClick={() => review(item, "reject", reason.trim())}
          >
            Reject
          </Btn>
        </div>
      </div>
    </div>
  );
}
function TeamEditor({ team: initialTeam, experts, pendingPolicy, hasPending, close, save }: any) {
  const [team, setTeam] = useState<Any[]>(initialTeam.map((item: Any) => ({
    expert_id: item.expert_id || item.id,
    role: String(item.role || "advisor").toLowerCase().includes("trad") || item.role === "strategy" ? "trader" : "advisor",
    enabled: item.enabled !== false,
  })));
  const [newExpert, setNewExpert] = useState("");
  const expertFor = (id: string) => experts.find((item: Any) => item.id === id);
  const available = (expert: Any) => (expert?.required_data || []).every((item: string) => ["price", "prices", "ohlcv", "price history", "historical prices"].includes(item.toLowerCase()));
  const enabledTraders = team.filter((item) => item.enabled && item.role === "trader").length;
  const unavailable = team.filter((item) => item.enabled && !available(expertFor(item.expert_id)));
  const duplicate = team.some((item, index) => team.findIndex((other) => other.expert_id === item.expert_id) !== index);
  const add = () => {
    const expert = expertFor(newExpert);
    if (!expert || !available(expert)) return;
    setTeam((items) => items.concat({
      expert_id: expert.id,
      role: items.some((item) => item.enabled && item.role === "trader") ? "advisor" : "trader",
      enabled: true,
    }));
    setNewExpert("");
  };
  const update = (id: string, change: Any) => setTeam((items) => items.map((item) => item.expert_id === id ? { ...item, ...change } : item));
  const canSave = enabledTraders === 1 && unavailable.length === 0 && !duplicate;
  return (
    <div className="overlay">
      <div className="modal team-editor">
        <button className="x" onClick={close}>×</button>
        <h2>Trading team</h2>
        <p>Changes become active at the next decision boundary. Disabled or removed experts will not participate in the next decision.</p>
        {hasPending && <p className="tag">Pending review policy: {pendingPolicy || "choose before saving"}</p>}
        <div className="team-edit-list">
          {team.map((item) => {
            const expert = expertFor(item.expert_id) || { name: item.expert_id, description: "Expert profile unavailable" };
            const supported = available(expert);
            return <article className="team-edit-row" key={item.expert_id}>
              <div className="team-edit-main">
                <strong>{expert.name}</strong>
                <span className="muted">{expert.version ? `v${expert.version}` : ""}</span>
                <p>{expert.objective || expert.description || ""}</p>
                <small>Requires: {(expert.required_data || []).join(", ") || "OHLCV"}</small>
                {!supported && <small className="error">Unavailable: this experiment supplies price history only.</small>}
                <details><summary>Instructions and limits</summary><p>{expert.instructions || "No instructions provided."}</p><small>{expert.risk_notes || "No risk notes provided."}</small></details>
              </div>
              <label className="team-role">Role<select value={item.role} onChange={(event) => update(item.expert_id, { role: event.target.value })}>
                <option value="trader">Trader</option><option value="advisor">Advisor</option>
              </select></label>
              <label className="team-enabled"><input type="checkbox" checked={item.enabled} disabled={!supported} onChange={(event) => update(item.expert_id, { enabled: event.target.checked })} /> Enabled</label>
              <Btn kind="danger" onClick={() => setTeam((items) => items.filter((row) => row.expert_id !== item.expert_id))}>Remove</Btn>
            </article>;
          })}
        </div>
        <div className="toolbar">
          <select value={newExpert} onChange={(event) => setNewExpert(event.target.value)}>
            <option value="">Add an expert…</option>
            {experts.filter((expert: Any) => !team.some((item) => item.expert_id === expert.id) && available(expert)).map((expert: Any) => <option key={expert.id} value={expert.id}>{expert.name} · {(expert.role || "advisor")}</option>)}
          </select>
          <Btn onClick={add} disabled={!newExpert}>Add to team</Btn>
        </div>
        <p className={canSave ? "muted" : "error"}>
          {enabledTraders !== 1 ? "Enable exactly one trader. Other enabled experts must be advisors." : unavailable.length ? "An enabled expert requires data that this experiment does not have." : duplicate ? "Remove duplicate expert assignments." : "Exactly one enabled trader is selected."}
        </p>
        <div className="toolbar">
          <Btn onClick={close}>Cancel</Btn>
          <Btn kind="primary" disabled={!canSave} onClick={() => save(team, pendingPolicy || "keep")}>Schedule team change</Btn>
        </div>
      </div>
    </div>
  );
}
function TeamChangeModal({ expert, close, choose }: any) {
  return (
    <div className="overlay">
      <div className="modal">
        <button className="x" onClick={close}>
          ×
        </button>
        <h2>Schedule expert change</h2>
        <p>
          A review proposal is waiting. Choose what happens to it before
          changing the team.
        </p>
        {expert && <p><b>{expert.name}</b> will take effect at the next decision boundary.</p>}
        <div className="toolbar">
          <Btn onClick={() => choose("keep")}>Keep proposal for review</Btn>
          <Btn kind="danger" onClick={() => choose("discard")}>
            Discard proposal; change next decision
          </Btn>
        </div>
      </div>
    </div>
  );
}
function BranchModal({ detail, close, create }: any) {
  return (
    <div className="overlay">
      <div className="modal">
        <button className="x" onClick={close}>
          ×
        </button>
        <h2>Start an oversight branch</h2>
        <p>
          This creates a separate experiment with its own audit trail. The
          current run remains unchanged.
        </p>
        <label>
          Oversight mode
          <select
            id="branch-mode"
            defaultValue={
              detail.config?.mode === "ai_only" ? "human_review" : "ai_only"
            }
          >
            <option value="ai_only">AI only</option>
            <option value="human_review">AI + Human Review</option>
          </select>
        </label>
        <div className="toolbar end">
          <Btn onClick={close}>Cancel</Btn>
          <Btn kind="primary" onClick={() => create(value("branch-mode"))}>
            Create branch
          </Btn>
        </div>
      </div>
    </div>
  );
}
function Portfolio({ detail }: any) {
  return (
    <>
      <KPIs detail={detail} />
      <Panel title="Open holdings">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Quantity</th>
              <th>Weight</th>
              <th>Market value</th>
              <th>Unrealized P&L</th>
              <th>Quote freshness</th>
            </tr>
          </thead>
          <tbody>
            {(detail?.holdings || []).map((h: any) => (
              <tr key={h.symbol || h.asset}>
                <td>{h.symbol || h.asset}</td>
                <td>{h.quantity}</td>
                <td>{pct(h.weight)}</td>
                <td>{money(h.market_value)}</td>
                <td>{money(h.unrealized_pnl)}</td>
                <td>
                  <span className={h.is_stale ? "tag warn" : "tag"}>
                    {h.is_stale ? "Stale · " : "As of "}
                    {h.price_date || "date unavailable"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!detail?.holdings?.length && (
          <Empty>Select a run with recorded holdings.</Empty>
        )}
      </Panel>
      <Panel title="Order ledger">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Target allocation</th>
              <th>Recorded fills</th>
              <th>Status</th>
              <th>Eligible date</th>
            </tr>
          </thead>
          <tbody>
            {(detail?.orders || []).map((o: any) => (
              <tr key={o.id}>
                <td>{o.id}<small className="muted">Created {o.created_date || "—"}</small></td>
                <td>{o.target_weights && Object.keys(o.target_weights).length ? Object.entries(o.target_weights).map(([symbol, weight]) => <span key={symbol} className="tag">{symbol} {pct(weight)}</span>) : "Cash / no targets"}</td>
                <td>{(o.fills || []).length ? o.fills.map((fill: Any, index: number) => <div key={`${fill.symbol}-${index}`}><span className="tag">{fill.side} {fill.symbol} · {Number(fill.quantity).toFixed(4)} @ {money(fill.fill_price, 4)}</span><small>{fill.date || "Fill date unavailable"} · fee {money(fill.fees, 4)}</small></div>) : "No fills recorded"}</td>
                <td>{o.status}</td>
                <td>{o.eligible_date || "Not yet eligible"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!detail?.orders?.length && <Empty>No orders in this run.</Empty>}
      </Panel>
    </>
  );
}
function Reports({ runs, compare, C, exportRun, result, compareNow }: any) {
  const [selectedReport, setSelectedReport] = useState("");
  const [reportDetail, setReportDetail] = useState<Any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const firstRunId = runs?.[0]?.id || "";
  useEffect(() => {
    if (!selectedReport && firstRunId) {
      setSelectedReport(firstRunId);
      return;
    }
    if (!selectedReport) {
      setReportDetail(null);
      return;
    }
    let active = true;
    setReportLoading(true);
    setReportError("");
    req(`/experiments/${selectedReport}`)
      .then((data) => { if (active) setReportDetail(data); })
      .catch((error: any) => { if (active) setReportError(error.message); })
      .finally(() => { if (active) setReportLoading(false); });
    return () => { active = false; };
  }, [selectedReport, firstRunId]);
  const reviewedDecisions = (reportDetail?.decisions || []).filter((decision: Any) =>
    ["approve", "modify", "reject"].includes(String(decision.review?.action || "").toLowerCase()),
  );
  const reviewCounts = reviewedDecisions.reduce((counts: Any, decision: Any) => {
    const action = String(decision.review.action).toLowerCase();
    counts[action] = (counts[action] || 0) + 1;
    return counts;
  }, { approve: 0, modify: 0, reject: 0 });
  const usage = reportDetail?.llm_usage || [];
  const estimatedCost = usage.reduce((sum: number, item: Any) => sum + (Number(item.estimated_cost_usd) || 0), 0);
  return (
    <>
      <Panel title="Experiment comparison">
        {runs.length ? (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Experiment</th>
                <th>Mode</th>
                <th>Status</th>
                <th>As of</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={compare.includes(r.id)}
                      onChange={() =>
                        C(
                          compare.includes(r.id)
                            ? compare.filter((x: string) => x !== r.id)
                            : [...compare, r.id],
                        )
                      }
                    />
                  </td>
                  <td>{r.name}</td>
                  <td>{r.mode || "—"}</td>
                  <td>{r.status}</td>
                  <td>{r.current_date || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No saved experiments to compare yet.</Empty>
        )}
        <div className="toolbar">
          <span>
            Compatibility checks include data version, date range, capital,
            costs and strategy.
          </span>
          <Btn kind="primary" onClick={compareNow}>
            Compare selected ({compare.length})
          </Btn>
        </div>
        {result && (
          <div className="comparison-result">
            <div className={result.comparable ? "tag lime" : "tag warn"}>
              {result.comparable
                ? "Compatible configurations"
                : "Configuration differences found"}
            </div>
            {result.notice && <p>{result.notice}</p>}
            <table>
              <thead>
                <tr>
                  <th>Experiment</th>
                  <th>Oversight</th>
                  <th>Status</th>
                  <th>As of</th>
                  <th>Total return</th>
                  <th>Max drawdown</th>
                  <th>Annual volatility</th>
                  <th>Fees</th>
                  <th>Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {result.experiments.map((x: any, i: number) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td>{result.treatment_modes?.[i]}</td>
                    <td>{x.status}</td>
                    <td>{x.as_of_date || "—"}</td>
                    <td>{pct(x.metrics?.total_return)}</td>
                    <td>{pct(x.metrics?.max_drawdown)}</td>
                    <td>{pct(x.metrics?.annualized_volatility)}</td>
                    <td>{money(x.metrics?.fees_paid ?? x.metrics?.fees, 2)}</td>
                    <td>{x.metrics?.sharpe ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {Object.keys(result.differences || {}).length > 0 && (
              <details>
                <summary>Review settings that differ</summary>
                <pre>{JSON.stringify(result.differences, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
      </Panel>
      <Panel title="Experiment report details">
        <label>
          Experiment
          <select value={selectedReport} onChange={(event) => setSelectedReport(event.target.value)}>
            {runs.map((run: Any) => <option key={run.id} value={run.id}>{run.name}</option>)}
          </select>
        </label>
        {reportLoading && <p className="muted">Loading saved report details…</p>}
        {reportError && <p className="error">{reportError}</p>}
        {reportDetail && !reportLoading && <>
          <div className="kpis report-kpis">
            <div className="kpi"><label>Annualized volatility</label><b>{pct(reportDetail.metrics?.annualized_volatility)}</b></div>
            <div className="kpi"><label>Trading fees</label><b>{money(reportDetail.metrics?.fees_paid ?? reportDetail.metrics?.fees, 2)}</b></div>
            <div className="kpi"><label>Human reviews</label><b>{reviewedDecisions.length}</b><small>Approve {reviewCounts.approve} · Modify {reviewCounts.modify} · Reject {reviewCounts.reject}</small></div>
            <div className="kpi"><label>LLM calls / estimated cost</label><b>{reportDetail.state?.llm_calls ?? usage.length} / {money(estimatedCost, 6)}</b><small>Cost sums recorded estimates only{usage.some((item: Any) => item.estimated_cost_usd == null) ? "; some costs unknown" : ""}</small></div>
          </div>
          <p className="muted">Review timestamps are shown where recorded. Review duration is unavailable.</p>
          <h4>Review actions</h4>
          {reviewedDecisions.length ? <table><thead><tr><th>Decision</th><th>Action</th><th>Recorded time</th><th>Reason</th></tr></thead><tbody>
            {reviewedDecisions.map((decision: Any) => {
              const event = (reportDetail.events || []).find((item: Any) => item.type === "decision_reviewed" && item.decision_id === decision.id);
              const recorded = event?.created_at || (decision.review.date ? `${decision.review.date} · time unavailable` : "Timestamp unavailable");
              return <tr key={decision.id}><td>{decision.id}</td><td>{decision.review.action}</td><td>{recorded}</td><td>{decision.review.reason || "—"}</td></tr>;
            })}
          </tbody></table> : <Empty>No human review actions recorded.</Empty>}
          {usage.length > 0 && <><h4>LLM usage</h4><table><thead><tr><th>Expert</th><th>Role</th><th>Status</th><th>Elapsed</th><th>Estimated cost</th></tr></thead><tbody>
            {usage.map((item: Any, index: number) => <tr key={`${item.expert_id || "call"}-${index}`}><td>{item.expert_id || "—"}</td><td>{item.role || "—"}</td><td>{item.status || "—"}</td><td>{item.elapsed_seconds == null ? "—" : `${item.elapsed_seconds}s`}</td><td>{item.estimated_cost_usd == null ? "Unknown" : money(item.estimated_cost_usd, 6)}</td></tr>)}
          </tbody></table></>}
        </>}
        {!reportDetail && !reportLoading && !runs.length && <Empty>No experiment report is available yet.</Empty>}
      </Panel>
      <Panel title="Report export">
        <p>
          Exports contain saved run metrics, configuration and audit records.
          Check data and execution settings before attributing differences.
        </p>
        <select id="export-run">
          {runs.map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select id="export-format">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
        <Btn
          onClick={() => exportRun(value("export-run"), value("export-format"))}
        >
          Export report
        </Btn>
      </Panel>
    </>
  );
}
function Activity({ items }: any) {
  return (
    <Panel title="Audit trail">
      {items?.length ? (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Experiment</th>
              <th>Event</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e: any, index: number) => (
              <tr key={`${e.experiment_id || "system"}:${e.id || e.event_id || index}`}>
                <td>{e.created_at || e.timestamp || e.date || "—"}</td>
                <td>{e.experiment_id || "—"}</td>
                <td>{e.type || e.event || e.action}</td>
                <td>{e.details ? JSON.stringify(e.details) : e.message || e.detail || JSON.stringify(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No recorded activity yet.</Empty>
      )}
    </Panel>
  );
}
function DataHub({ datasets, upload }: any) {
  return (
    <>
      <Panel title="Import market data">
        <p>
          CSV should contain date, symbol, open, high, low, close and volume.
          Import creates an immutable dataset version.
        </p>
        <label className="upload">
          Choose CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e: any) =>
              e.target.files?.[0] && upload(e.target.files[0])
            }
          />
        </label>
      </Panel>
      <Panel title="Available datasets">
        {datasets?.length ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Dataset ID</th>
                <th>Coverage</th>
                <th>Symbols</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.id}</td>
                  <td>
                    {d.start_date} – {d.end_date}
                  </td>
                  <td>{(d.symbols || []).join(", ")}</td>
                  <td>{d.synthetic ? "Synthetic demo" : "Imported"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>
            No datasets yet. Import a CSV file or seed the demo dataset in the
            service.
          </Empty>
        )}
      </Panel>
    </>
  );
}
function Settings({ settings, save, test }: any) {
  return (
    <Panel title="Model connection">
      <p>
        Compatible chat completions endpoint. Connection tests make a real
        minimal request. API key is write-only and is never shown again.
      </p>
      <form
        onSubmit={async (e: any) => {
          e.preventDefault();
          const form = e.currentTarget as HTMLFormElement;
          const out = await save({
            base_url: value("base_url"),
            model: value("model"),
            api_key: value("api_key"),
            max_calls: Number(value("max_calls")),
            budget_usd: Number(value("budget_usd")),
            input_cost_per_million:
              value("input_cost_per_million") === ""
                ? null
                : Number(value("input_cost_per_million")),
            output_cost_per_million:
              value("output_cost_per_million") === ""
                ? null
                : Number(value("output_cost_per_million")),
          });
          if (out) (form.elements.namedItem("api_key") as HTMLInputElement).value = "";
        }}
        className="settings"
      >
        <label>
          Base URL
          <input
            id="base_url"
            defaultValue={settings.base_url || ""}
            placeholder="https://…/v1"
          />
        </label>
        <label>
          Model
          <input
            id="model"
            defaultValue={settings.model || ""}
            placeholder="Model name"
          />
        </label>
        <label>
          API key{" "}
          <small>
            {settings.api_key_configured
              ? "Configured; enter to replace"
              : "Not configured"}
          </small>
          <input
            type="password"
            id="api_key"
            autoComplete="new-password"
            placeholder="Stored by backend only"
          />
        </label>
        <label>
          Max calls
          <input
            type="number"
            id="max_calls"
            defaultValue={settings.max_calls || 20}
          />
        </label>
        <label>
          Budget (USD)
          <input
            type="number"
            id="budget_usd"
            defaultValue={settings.budget_usd || 5}
          />
        </label>
        <label>
          Input cost / million
          <input
            type="number"
            id="input_cost_per_million"
            defaultValue={settings.input_cost_per_million ?? ""}
          />
        </label>
        <label>
          Output cost / million
          <input
            type="number"
            id="output_cost_per_million"
            defaultValue={settings.output_cost_per_million ?? ""}
          />
        </label>
        <div className="toolbar">
          <button className="primary">Save settings</button>
          <Btn onClick={test}>Test connection</Btn>
        </div>
      </form>
    </Panel>
  );
}
function Wizard({ step, setStep, close, datasets, experts, submit }: any) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const field = (id: string, fallback = "") =>
    value(id) || draft[id] || fallback;
  const enabled = (index: number, expert: Any) => {
    const input = document.getElementById(
      `enable${index}`,
    ) as HTMLInputElement | null;
    const unavailable = (expert.required_data || []).some((d: string) =>
      /fundamental|financial/i.test(d),
    );
    return (
      !unavailable &&
      (input ? input.checked : draft[`enable${index}`] !== "false")
    );
  };
  return (
    <div className="overlay">
      <div className="modal wide">
        <button className="x" onClick={close}>
          ×
        </button>
        <div className="steps">
          {["Market & data", "Expert team", "Risk & review"].map(
            (x: string, i: number) => (
              <span key={i} className={step === i + 1 ? "selected" : ""}>
                0{i + 1}　{x}
              </span>
            ),
          )}
        </div>
        <h2>
          {
            [
              "Market & data",
              "Choose your expert team",
              "Risk, execution & review",
            ][step - 1]
          }
        </h2>
        <form
          onChange={(e: any) =>
            e.target.id &&
            setDraft((old) => ({
              ...old,
              [e.target.id]:
                e.target.type === "checkbox"
                  ? String(e.target.checked)
                  : e.target.value,
            }))
          }
          onSubmit={async (e: any) => {
            e.preventDefault();
            if (step < 3) {
              setStep(step + 1);
              return;
            }
            const d = field("dataset_id", datasets[0]?.id || "");
            if (!d) {
              return alert("Choose a dataset first.");
            }
            const roles = experts.map((x: any, i: number) =>
              String(
                field(`role${i}`) || (i === 0 ? "trader" : "advisor"),
              ).toLowerCase(),
            );
            if (
              roles.filter(
                (role: string, i: number) =>
                  role === "trader" && enabled(i, experts[i]),
              ).length !== 1
            ) {
              return alert("Choose exactly one enabled trading lead.");
            }
            await submit({
              name: field("run_name", "Research run"),
              dataset_id: d,
              start_date: field("start_date", datasets[0]?.start_date || ""),
              end_date: field("end_date", datasets[0]?.end_date || ""),
              initial_capital: Number(field("capital") || 100000),
              fee_bps: Number(field("fees") || 0),
              slippage_bps: Number(field("slippage") || 0),
              max_position_weight: Number(field("weight") || 25) / 100,
              mode: field("mode") || "human_review",
              strategy: field("strategy") || "agent",
              team: experts.map((x: any, i: number) => ({
                expert_id: x.id,
                role: roles[i],
                enabled: enabled(i, x),
              })),
              provider_mode: field("provider_mode") || "demo",
              max_calls: Number(field("calls") || 20),
              budget_usd: Number(field("budget") || 5),
            });
          }}
        >
          {step === 1 && (
            <div className="formgrid">
              <label>
                Experiment name
                <input
                  id="run_name"
                  defaultValue={draft.run_name || "Research run"}
                />
              </label>
              <label>
                Dataset
                <select
                  id="dataset_id"
                  defaultValue={draft.dataset_id || datasets[0]?.id || ""}
                >
                  <option value="">Select dataset</option>
                  {datasets.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.synthetic ? " · SYNTHETIC DEMO" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start date
                <input
                  id="start_date"
                  type="date"
                  required
                  defaultValue={draft.start_date || datasets[0]?.start_date}
                />
              </label>
              <label>
                End date
                <input
                  id="end_date"
                  type="date"
                  required
                  defaultValue={draft.end_date || datasets[0]?.end_date}
                />
              </label>
              <label>
                Replay strategy
                <select id="strategy">
                  <option value="agent">Agent</option>
                  <option value="momentum">Momentum baseline</option>
                  <option value="buy_hold">Buy and hold baseline</option>
                </select>
              </label>
              <label>
                Provider mode
                <select id="provider_mode">
                  <option value="demo">Deterministic demo strategy</option>
                  <option value="llm">Configured LLM</option>
                </select>
                <small>Demo runs do not represent LLM results.</small>
              </label>
            </div>
          )}
          {step === 2 && (
            <>
              <p>
                One trading lead creates the final order plan; advisors
                contribute opinions only.
              </p>
              <div className="expertgrid">
                {experts.map((x: any, i: number) => (
                  <Panel key={x.id}>
                    <ExpertBadge ex={x} role={x.role} />
                    {((x.required_data || []) as string[]).some((d) =>
                      /fundamental|financial/i.test(d),
                    ) && (
                      <div className="error compact">
                        Required fundamentals are unavailable in this OHLCV
                        dataset. This expert is disabled.
                      </div>
                    )}
                    <label>
                      Role
                      <select
                        id={`role${i}`}
                        defaultValue={
                          draft[`role${i}`] || (i === 0 ? "trader" : "advisor")
                        }
                      >
                        <option value="trader">Trader</option>
                        <option value="advisor">Advisor</option>
                      </select>
                    </label>
                    <label className="checkline">
                      <input
                        id={`enable${i}`}
                        type="checkbox"
                        defaultChecked={
                          !(x.required_data || []).some((d: string) =>
                            /fundamental|financial/i.test(d),
                          )
                        }
                        disabled={(x.required_data || []).some((d: string) =>
                          /fundamental|financial/i.test(d),
                        )}
                      />
                      Enable for this run
                    </label>
                    <p>
                      <small>
                        Requires: {(x.required_data || []).join(", ")}
                      </small>
                    </p>
                  </Panel>
                ))}
              </div>
            </>
          )}
          {step === 3 && (
            <div className="formgrid">
              <label>
                Initial simulated capital ($)
                <input
                  id="capital"
                  type="number"
                  defaultValue={draft.capital || "100000"}
                />
              </label>
              <label>
                Maximum position weight (%)
                <input
                  id="weight"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={draft.weight || "25"}
                />
              </label>
              <label>
                Fee (basis points)
                <input
                  id="fees"
                  type="number"
                  defaultValue={draft.fees || "10"}
                />
              </label>
              <label>
                Slippage (basis points)
                <input
                  id="slippage"
                  type="number"
                  defaultValue={draft.slippage || "5"}
                />
              </label>
              <label>
                Human oversight
                <select id="mode">
                  <option value="human_review">
                    Review every proposed order
                  </option>
                  <option value="ai_only">AI only</option>
                </select>
              </label>
              <label>
                Maximum model calls
                <input
                  id="calls"
                  type="number"
                  defaultValue={draft.calls || "20"}
                />
              </label>
              <label>
                Budget (USD)
                <input
                  id="budget"
                  type="number"
                  defaultValue={draft.budget || "5"}
                />
              </label>
              <p className="full">
                Simulated portfolios only. Approved orders queue for eligible
                next-session execution. Run configuration is frozen at launch.
              </p>
            </div>
          )}
          <div className="toolbar end">
            <Btn onClick={() => (step === 1 ? close() : setStep(step - 1))}>
              {step === 1 ? "Cancel" : "Back"}
            </Btn>
            <button className="primary">
              {step === 3 ? "Launch experiment" : "Continue →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function ExpertForm({ close, save }: any) {
  return (
    <div className="overlay">
      <div className="modal">
        <button className="x" onClick={close}>
          ×
        </button>
        <h2>Create expert card</h2>
        <form
          onSubmit={async (e: any) => {
            e.preventDefault();
            await save({
              name: value("exname"),
              role: value("exrole"),
              strategy: "custom",
              description: value("objective"),
              objective: value("objective"),
              horizon: value("horizon"),
              required_data: value("required_data")
                .split(",")
                .map((x: string) => x.trim()),
              instructions: value("instructions"),
              risk_notes: value("risk_notes"),
            });
          }}
          className="settings"
        >
          <label>
            Name
            <input id="exname" required />
          </label>
          <label>
            Default role
            <select id="exrole">
              <option>Advisor</option>
              <option>Trader</option>
            </select>
          </label>
          <label>
            Horizon
            <input id="horizon" />
          </label>
          <label>
            Objective
            <textarea id="objective" required />
          </label>
          <label>
            Required data
            <input id="required_data" defaultValue="OHLCV" />
          </label>
          <label>
            Analysis instructions
            <textarea id="instructions" />
          </label>
          <label>
            Risk constraints
            <textarea id="risk_notes" />
          </label>
          <button className="primary">Save version 1</button>
        </form>
      </div>
    </div>
  );
}
function value(id: string) {
  return (
    (
      document.getElementById(id) as
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
    )?.value || ""
  );
}
createRoot(document.getElementById("root")!).render(<AuthGate><App /></AuthGate>);
