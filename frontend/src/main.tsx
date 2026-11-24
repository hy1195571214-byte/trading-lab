import { LText, useLocale, LocaleProvider, LanguageSwitch, enumLabel } from "./i18n";
import React, { useContext, useEffect, useRef, useState } from "react";
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
  ErrorMessage,
  ReturnValue,
  VolatilityValue,
} from "./ui";
import ActivityLog from "./ActivityLog";
import { conciseNumber } from "./presentationFormatting";
import { Any, req, ApiError } from "./api";
import { AuthContext, AuthGate } from "./AuthGate";
import ReplayDesk from "./ReplayDesk";
import HarnessPanel from "./frontendHarnessPanel";
import { ScrollRegion } from "./ScrollRegion";
import { responseMatchesSelection } from "./replayData";
import { DatasetName, DataRequirements, datasetDisplayName, datasetCoverage, groupDatasetImports, requirementLabel } from "./dataPresentation";
import { ModeSettings, AnalysisPanel, InterventionHistory, useAnalysis, defaultWeights, fractionalWeights, validWeights, LabMode, Weights } from "./FourMode";

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
  ["harness", "Experiments"],
];
function App() {
  const { t } = useLocale();
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
    [err, Z] = useState<Error | string>(""),
    [notice, setNotice] = useState<{key: string; params?: Record<string, string | number>}>({key: ""}),
    [modal, M] = useState(""),
    [wizard, W] = useState(1),
    [compare, C] = useState<string[]>([]),
    [comparisonData, CD] = useState<Any | null>(null),
    [pendingReview, PR] = useState<Any | null>(null),
    [pendingExpert, PE] = useState<Any | null>(null),
    [teamPolicy, TP] = useState<string | null>(null),
    [teamAdd, TA] = useState<Any | null>(null);
  const N = (key: string, params?: Record<string, string | number>) => setNotice({key, params});
  const selectedIdRef = useRef(sel);
  const chooseSelection = (id: string) => { selectedIdRef.current = id; Q(id); };
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
      if (!selectedIdRef.current && rs[0]) {
        chooseSelection(rs[0].id);
        localStorage.setItem("trading-lab-selected", rs[0].id);
      }
    } catch (e: any) {
      IL(false);
      Z(e);
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
    const requestedId = sel;
    let active = true;
    if (requestedId) {
      X(null);
      req(`/experiments/${sel}`)
        .then((data) => { if (active && responseMatchesSelection(requestedId, selectedIdRef.current, data)) X(data); })
        .catch((e: any) => { if (active && selectedIdRef.current === requestedId) Z(e); });
    } else X(null);
    return () => { active = false; };
  }, [sel]);
  useEffect(() => {
    if (!sel || detail?.status !== "running") return;
    const requestedId = sel;
    let active = true;
    let inFlight = false;
    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      req(`/experiments/${requestedId}`)
        .then((d) => {
          if (!active || !responseMatchesSelection(requestedId, selectedIdRef.current, d)) return;
          X(d);
          R((old) => old.map((r) => (r.id === d.id ? { ...r, ...d } : r)));
          if (d.status !== "running") reload();
        })
        .catch((e: any) => { if (active && selectedIdRef.current === requestedId) Z(e); })
        .finally(() => { inFlight = false; });
    };
    const timer = setInterval(poll, 1800);
    return () => { active = false; clearInterval(timer); };
  }, [sel, detail?.status]);
  const action = async (f: () => Promise<any>, message = "Saved", expectedResponseId?: string) => {
    const selectionAtStart = selectedIdRef.current;
    B(true);
    Z("");
    N("");
    try {
      const out = await f();
      if (out?.id && out?.config) {
        if (selectedIdRef.current === selectionAtStart && (!expectedResponseId || out.id === expectedResponseId)) {
          chooseSelection(out.id);
          localStorage.setItem("trading-lab-selected", out.id);
          X(out);
        }
      }
      await reload();
      if (selectedIdRef.current === selectionAtStart) N(message);
      return out;
    } catch (e: any) {
      if (selectedIdRef.current === selectionAtStart) Z(e);
      return null;
    } finally {
      B(false);
    }
  };
  const expConfig = detail?.config || {};
  const isRuleStrategy = expConfig.lab_mode === "quant_baseline" || Boolean(expConfig.strategy && expConfig.strategy !== "agent");
  const usesAiModel = !isRuleStrategy && expConfig.provider_mode === "llm";
  const selectedDetail = detail?.id === sel ? detail : null;
  const hasSelectedDetail = () => Boolean(sel && selectedIdRef.current === sel && detail?.id === sel);
  const title = page === "Trading desk" ? "Trading workspace" : page;
  const selectExp = (id: string) => {
    chooseSelection(id);
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
              {t(x)}
            </button>
          ))}
        </div>
        <span className="pill lime"><LText id="● Historical replay"/></span>
        {selectedDetail && <span className="pill" title={t(usesAiModel ? "copy.aiHelp" : "copy.demoHelp")}>
          ●{" "}
          {isRuleStrategy
            ? t("copy.ruleMode")
            : expConfig.provider_mode === "llm"
              ? t("LLM provider")
              : t("Deterministic agent demo")}
        </span>}
        {!!datasets.find((d: Any) => d.id === expConfig.dataset_id)
          ?.synthetic && <span className="pill" title={t("copy.virtualHelp")}><LText id="Synthetic dataset"/></span>}
        <LanguageSwitch />
        {auth.enabled && <button onClick={auth.logout}><LText id="Sign out"/></button>}
      </header>
      <aside className={sidebarCollapsed ? "sidebar-collapsed" : ""}>
        <button className="sidebar-toggle" aria-label={t(sidebarCollapsed ? "展开侧边栏" : "收起侧边栏")} aria-expanded={!sidebarCollapsed} title={t(sidebarCollapsed ? "展开侧边栏" : "收起侧边栏")} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>
          <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span><span className="sidebar-toggle-label">{t(sidebarCollapsed ? "展开" : "收起")}</span>
        </button>
        {nav.map(([n, ic]) => (
          <button
            key={n}
            aria-label={t(n)}
            title={t(n)}
            className={page === n ? "active" : ""}
            onClick={() => S(n)}
          >
            <span>
              <NavIcon name={ic} />
            </span>
            <span className="nav-label">{t(n)}</span>
          </button>
        ))}
        <div className="sidefoot"><LText id="RESEARCH WORKSPACE"/><br />
          <br /><LText id="Simulated capital only"/></div>
      </aside>
      <main className={sidebarCollapsed ? "sidebar-collapsed" : ""}>
        {initialLoading && (
          <div className="notice"><LText id="Loading saved workspace…"/></div>
        )}
        {page === "Trading desk" ? (
          <div className="desk-context">
            <h1 className="visually-hidden">{t("Trading workspace")}</h1>
            {selectedDetail && (
              <>
                <span>{t("Experiment")}</span>
                <strong title={selectedDetail.name}>{selectedDetail.name}</strong>
                <span>· {enumLabel(t, selectedDetail.config?.lab_mode || selectedDetail.config?.mode)}</span>
                {selectedDetail.config?.dataset_synthetic && <span>· {t("Synthetic dataset")}</span>}
              </>
            )}
          </div>
        ) : <div className="heading">
          <div>
            <h1>{t(title)}</h1>
            <div className="sub">{t(desc(page))}</div>
          </div>
          <div className="heading-actions">
            {page === "Experiments" && (
              <button
                className="primary"
                onClick={() => {
                  W(1);
                  M("wizard");
                }}
              ><LText id="＋ New experiment"/></button>
            )}
          </div>
        </div>}
        {err && (
          <div className="error" role="alert">
            <span>{t("Error")} · </span><ErrorMessage error={err} />
            <button
              onClick={() => {
                Z("");
                reload();
              }}
            ><LText id="Retry"/></button>
          </div>
        )}
        {notice.key && <div className="notice">{t(notice.key, notice.params)}</div>}
        {busy && <div className="notice"><LText id="Saving changes…"/></div>}
        {page === "Overview" && (
          <Overview
            runs={runs}
            datasets={datasets}
            detail={selectedDetail}
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
            datasets={datasets}
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
            detail={selectedDetail}
            selectedId={sel}
            experts={experts}
            go={S}
            decision={(d: any, act: string) => review({ ...d, experiment_id: d?.experiment_id || selectedDetail?.id, experiment_name: d?.experiment_name || selectedDetail?.name, selection_id_at_open: selectedIdRef.current }, act)}
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
        {page === "Portfolio" && <Portfolio detail={selectedDetail} />}
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
        {page === "Activity" && <ActivityLog items={activity} runs={runs} />}
        {page === "Data hub" && <DataHub datasets={datasets} upload={upload} onImported={reload} />}
        {page === "harness" && <HarnessPanel />}
        {page === "Settings" && (
          <Settings
            settings={settings}
            save={saveSettings}
            test={testSettings}
            refresh={reload}
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
      {modal === "team-editor" && selectedDetail && (
        <TeamEditor
          team={teamAdd && !(selectedDetail.state?.pending_team?.team || selectedDetail.state?.active_team || selectedDetail.config?.team || []).some((t: Any) => (t.expert_id || t.id) === teamAdd.id) ? (selectedDetail.state?.pending_team?.team || selectedDetail.state?.active_team || selectedDetail.config?.team || []).concat({
            expert_id: teamAdd.id,
            role: String(teamAdd.role || "trader").toLowerCase(),
            enabled: true,
          }) : (selectedDetail.state?.pending_team?.team || selectedDetail.state?.active_team || selectedDetail.config?.team || []).map((t: Any) => ({ ...t, expert_id: t.expert_id || t.id }))}
          experts={experts}
          dataset={datasets.find((d: Any) => d.id === selectedDetail.config?.dataset_id)}
          pendingPolicy={teamPolicy}
          hasPending={(selectedDetail.decisions || []).some((d: Any) =>
            ["pending", "awaiting_review"].includes(d.status),
          )}
          close={() => { M(""); TP(null); TA(null); PE(null); }}
          save={saveTeam}
        />
      )}
      {modal === "branch" && selectedDetail && (
        <BranchModal
          detail={detail}
          close={() => M("")}
          create={createBranch}
        />
      )}
    </>
  );
  async function doStep() {
    if (!hasSelectedDetail()) { Z("Wait for the selected experiment to finish loading before advancing it."); return; }
    const out = await action(
      () => req(`/experiments/${sel}/step`, { method: "POST" }),
      "Session advanced",
      sel,
    );
    if ((out?.status === "paused" || out?.status === "failed") && selectedIdRef.current === sel) {
      const errorEvent = [...(out.events || [])]
        .reverse()
        .find((event: Any) => event.type === "error");
      const failedTrace = [...(out.decision_traces || [])].reverse().find((trace: Any) => trace.status === "failed");
      const failure = errorEvent?.message || failedTrace?.error;
      Z(failure ? new ApiError(failure) : "The replay paused. Inspect the audit event, then retry from this saved snapshot.");
      N("");
    }
  }
  async function doRun(mode = "run") {
    if (!hasSelectedDetail()) { Z("Wait for the selected experiment to finish loading before changing its run state."); return; }
    if (sel) {
      const out = await action(
        () => req(`/experiments/${sel}/${mode}`, { method: "POST" }),
        mode === "pause" ? "Run paused" : "Run started",
        sel,
      );
      if (out?.status === "failed" && selectedIdRef.current === sel) {
        const errorEvent = [...(out.events || [])].reverse().find((event: Any) => event.type === "error");
        const failedTrace = [...(out.decision_traces || [])].reverse().find((trace: Any) => trace.status === "failed");
        const failure = errorEvent?.message || failedTrace?.error;
        Z(failure ? new ApiError(failure) : "The replay failed. Inspect the saved audit record before retrying.");
        N("");
      }
    }
  }
  function openTeamEditor(add?: Any) {
    if (!hasSelectedDetail()) { Z("Wait for the selected experiment to finish loading before editing its team."); return; }
    if (expConfig.lab_mode || (expConfig.strategy && expConfig.strategy !== "agent")) {
      N(expConfig.lab_mode ? "four.expertNotUsed" : "Expert cards do not run in a deterministic baseline experiment.");
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
    if (!hasSelectedDetail()) { Z("The selected experiment changed. Reopen its team editor before saving."); return; }
    const out = await action(
      () => req(`/experiments/${sel}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team, pending_policy: policy || "keep" }),
      }),
      "Team change scheduled for next decision boundary",
      sel,
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
    if (decision?.selection_id_at_open && selectedIdRef.current !== decision.selection_id_at_open) {
      Z("The selected experiment changed while this review was open. Reopen the decision before submitting.");
      return;
    }
    if (decision?.experiment_id ? decision.experiment_id !== runId : detail?.id !== runId) {
      Z("The displayed decision no longer matches its experiment. Reopen the correct experiment before reviewing.");
      return;
    }
    if ((act === "modify" || act === "reject") && !reason) {
      const selectionAtOpen = selectedIdRef.current;
      let context = { ...decision, experiment_id: runId, experiment_name: decision?.experiment_name || runs.find((run: Any) => run.id === runId)?.name, selection_id_at_open: selectionAtOpen };
      if (act === "modify" && !context?.config?.symbols) {
        try {
          const experiment = await req(`/experiments/${runId}`);
          if (experiment?.id !== runId || selectedIdRef.current !== selectionAtOpen) throw new Error("The selected experiment changed while loading review limits. Reopen the decision.");
          context = { ...context, config: experiment.config };
        } catch (e: any) {
          Z(e);
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
      runId,
    );
    if (out) {
      PR(null);
      M("");
    }
  }
  async function assign(ex: Any, policy?: string) {
    if (expConfig.lab_mode || (expConfig.strategy && expConfig.strategy !== "agent")) {
      N(expConfig.lab_mode ? "four.expertNotUsed" : "Expert cards do not run in a deterministic baseline experiment.");
      return;
    }
    if (
      (ex.required_data || []).some((d: string) =>
        /fundamental|financial/i.test(d),
      )
    ) {
      N("{expert} requires fundamental data that is not available in this dataset.", {expert:ex.name});
      return;
    }
    if (!sel) {
      N("Select or create an experiment first.");
      return;
    }
    openTeamEditor(ex);
  }
  async function createBranch(mode: string) {
    if (!hasSelectedDetail()) { Z("Wait for the selected experiment to finish loading before creating a branch."); return; }
    const out = await action(
      () =>
        req(`/experiments/${sel}/branch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(expConfig.lab_mode === "multisource_agent" ? { name: `${detail?.name || "Research run"} · Human oversight`, lab_mode: "human_supervised", mode: "human_review", harness_version: "research-v1", fusion_weights: expConfig.fusion_weights, score_policy: expConfig.score_policy, strategy: "agent" } : { mode }),
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
      Z(e);
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
        throw new ApiError(error.detail || "", response.status);
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
function Overview({ runs, datasets, detail, go, open, select, loading, refresh, create }: any) {
  const { t } = useLocale();
  return (
    <>
      <KPIs detail={detail} />
      <div className="grid2">
        <Panel title={t("Performance at a glance")}>
          <Chart
            history={detail?.history}
            benchmark={detail?.benchmark_history}
          />
          <div className="micro">
            <span title={t("metric.sharpeHelp")}>{t("metric.sharpe")}</span>{" "}
            {detail?.metrics?.sharpe == null
              ? "—"
              : Number(detail.metrics.sharpe).toFixed(2)}
            　 {t("Trades")} {detail?.orders?.length || 0}　 {t("Exposure")}{" "}
            {pct(detail?.metrics?.exposure)}
          </div>
        </Panel>
        <Panel title={t("Continue your work")}>
          <div className="tag warn">
            {detail?.status ? enumLabel(t, detail.status) : t("No experiment selected")}
          </div>
          <h2>{detail?.name || t("Start an experiment")}</h2>
          <p>
            {detail
              ? t("Replay status: {status}. View server-recorded decisions and continue the replay.", {status: enumLabel(t, detail.status)})
              : t("Create an experiment to see its real state here.")}
          </p>
          <Btn kind="primary" onClick={open}><LText id="Open trading desk"/></Btn>
          <Btn onClick={() => go("Review queue")}><LText id="Review queue"/></Btn>
        </Panel>
      </div>
      <Panel title={t("Recent experiments")}>
        <div className="toolbar end"><Btn onClick={refresh} disabled={loading}><LText id="Refresh"/></Btn></div>
        {loading ? <Empty><LText id="Loading saved experiments…"/></Empty> : runs?.length ? <RunTable runs={runs} datasets={datasets} select={select} /> : <Empty><LText id="No experiments found."/> <Btn kind="primary" onClick={create}><LText id="Create an experiment"/></Btn></Empty>}
      </Panel>
    </>
  );
}
function RunTable({ runs, datasets, select }: any) {
  const { t } = useLocale();
  return runs?.length ? (
    <ScrollRegion label={t("Recent experiments")}>
<table>
      <thead>
        <tr>
          <th><LText id="Experiment"/></th>
          <th><LText id="Mode"/></th>
          <th><LText id="Status"/></th>
          <th><LText id="Return"/></th>
          <th><LText id="Dataset"/></th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r: any) => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td>{enumLabel(t, r.mode || r.config?.mode)}</td>
            <td>
              <span className="tag">{enumLabel(t, r.status)}</span>
            </td>
            <td><ReturnValue value={r.total_return} /></td>
            <td><DatasetName id={r.dataset_id} datasets={datasets} /></td>
            <td>
              <Btn onClick={() => select(r.id)}><LText id="Open"/></Btn>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
</ScrollRegion>
  ) : (
    <Empty><LText id="No experiments have been created."/></Empty>
  );
}
function Experiments({ runs, datasets, compare, C, select, start }: any) {
  const { t } = useLocale();
  return (
    <>
      <Panel title={t("Experiment registry")}>
        <div className="toolbar">
          <span><LText id="Compare compatible experiment snapshots"/></span>
          <Btn
            kind="primary"
            onClick={() =>
              C(compare.length ? [] : runs.slice(0, 2).map((x: any) => x.id))
            }
          >
            {t("Compare selected ({count})", {count: compare.length})}
          </Btn>
        </div>
        {runs?.length ? (
          <ScrollRegion label={t("Experiment registry")}>
<table>
            <thead>
              <tr>
                <th></th>
                <th><LText id="Experiment"/></th>
                <th><LText id="Mode"/></th>
                <th><LText id="State"/></th>
                <th><LText id="Return"/></th>
                <th><LText id="Dataset"/></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={t("Select {name} for comparison", {name:r.name})}
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
                  <td>{enumLabel(t, r.lab_mode || r.config?.lab_mode || r.mode)}</td>
                  <td>{enumLabel(t, r.status)}</td>
                  <td><ReturnValue value={r.total_return} /></td>
                  <td><DatasetName id={r.dataset_id} datasets={datasets} /></td>
                  <td>
                    <Btn onClick={() => select(r.id)}><LText id="Open"/></Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</ScrollRegion>
        ) : (
          <Empty><LText id="Create a research run to start comparing strategies."/></Empty>
        )}
      </Panel>
      <Panel title={t("copy.comparingTitle")}>
        <p>{t("copy.comparing")}</p>
        <Btn kind="primary" onClick={start}><LText id="＋ New experiment"/></Btn>
      </Panel>
    </>
  );
}
function Desk({
  detail,
  selectedId,
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
  const { t } = useLocale();
  if (!detail || detail.id !== selectedId)
    return (
      <Panel title={t("Trading desk")}>
        <Empty>{selectedId ? t("Loading the selected experiment…") : t("Select an experiment from the registry, or create one to start.")}</Empty>
        {!selectedId && <Btn onClick={() => go("Experiments")}><LText id="Browse experiments"/></Btn>}
      </Panel>
    );
  return (
    <>
      <ReplayDesk detail={detail} selectedId={selectedId} doStep={doStep} doRun={doRun} branch={branch} decision={decision} experts={experts} editTeam={editTeam} go={go} renderExpert={(ex: Any, role: string, enabled: boolean) => <ExpertBadge ex={ex} role={role} enabled={enabled} />} busy={busy} />
    </>
  );
}
function ExpertBadge({ ex, role, enabled }: any) {
  const { t } = useLocale();
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
  const focus = ({momentum:"Trend", value:"Value", risk:"Risk"} as Record<string,string>)[String(ex?.strategy || "")];
  return (
    <div className="badge">
      <div className="lanyard"></div>
      <div className="strip">
        {ex?.name?.toUpperCase() || t("Expert")} <span>{enumLabel(t, role || ex?.role)}</span>
        {enabled !== undefined && <i aria-label={t(enabled ? "Enabled" : "data.disabled")}>{enabled ? "●" : "○"}</i>}
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
          <b>{enumLabel(t, role || ex?.role || "advisor")}</b>
          {focus && <span className="expert-focus">{t(focus)}</span>}
        </div>
      </div>
      {enabled !== undefined && <footer className="badge-status">{t(enabled ? "Enabled" : "data.disabled")}</footer>}
    </div>
  );
}
function Experts({ experts, add, create }: any) {
  const { t } = useLocale();
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
        <input aria-label={t("Search experts")} placeholder={t("Search experts")} value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label={t("Filter by strategy")} value={strategyFilter} onChange={(event) => setStrategyFilter(event.target.value)}>
          <option value="all"><LText id="All strategies"/></option>
          <option value="momentum"><LText id="Trend"/></option>
          <option value="value"><LText id="Value"/></option>
          <option value="risk"><LText id="Risk"/></option>
          <option value="macro">宏观与灵活交易 / Macro</option>
        </select>
        <Btn kind="primary" onClick={create}><LText id="Create expert"/></Btn>
      </div>
      <ScrollRegion label={t("Expert library")}><div className="expertgrid">
        {matches.map((ex: any) => (
          <Panel key={ex.id}>
            <ExpertBadge ex={ex} />
            {ex.activation_status === "research_only" && <><p>{ex.style_label}</p><p className="error compact">研究草稿 / Research only · 可审阅来源，尚未验证或启用交易。</p></>}
            <DataRequirements items={ex.required_data} />
            {missingData(ex).length > 0 && <p className="error compact">{t("data.missing", { data: missingData(ex).map((field: string) => requirementLabel(field, t)).join(" / ") })}</p>}
            <div className="toolbar">
              <Btn disabled={ex.activation_status === "research_only"} onClick={() => add(ex)}><LText id="Add to team"/></Btn>
              <Btn disabled={ex.activation_status === "research_only"} onClick={() => add({ ...ex, role: "Advisor" })}><LText id="Add as advisor"/></Btn>
              <Btn onClick={() => setSelectedExpert(ex)}><LText id="Strategy details"/></Btn>
            </div>
          </Panel>
        ))}
        {!matches.length && <Empty><LText id="No expert cards match these filters."/></Empty>}
      </div>
      </ScrollRegion>
      <Panel title={t("Role rules")}>
        <p>
          <LText id="Advisors provide evidence and dissent. The execution engine accepts one final target plan. Missing required data must block or limit activation."/>
        </p>
      </Panel>
      {selectedExpert && <div className="overlay"><div className="modal">
        <button className="x" aria-label={t("Close dialog")} onClick={() => setSelectedExpert(null)}>×</button>
        <h2>{selectedExpert.name} · v{selectedExpert.version || "1"}</h2>
        <p>{t("原文 / Original")} · {selectedExpert.description || selectedExpert.objective}</p>
        <p className="muted"><LText id="Saved expert profile text is shown in its original language."/></p>
        <dl className="expert-details">
          <dt><LText id="Strategy objective"/></dt><dd>{selectedExpert.objective || t("Not provided")}</dd>
          <dt><LText id="Horizon"/></dt><dd>{selectedExpert.horizon || t("Not specified")}</dd>
          <dt><LText id="Required data"/></dt><dd><DataRequirements items={requiredData(selectedExpert)} showLabel={false} /></dd>
          <dt><LText id="Instructions"/></dt><dd>{selectedExpert.instructions || t("Not provided")}</dd>
          <dt><LText id="Risk notes"/></dt><dd>{selectedExpert.risk_notes || t("Not provided")}</dd>
        </dl>
        {selectedExpert.research && <section>
          <h3>来源与研究审查 / Sources and research review</h3>
          <p>{selectedExpert.research.scope}</p>
          <p>{selectedExpert.research.academic_use}</p>
          <p>{selectedExpert.research.attribution_limit}</p>
          <p>{selectedExpert.research.validation_status}</p>
          {(selectedExpert.research.principles || []).map((principle: Any) => <div key={principle.id}>
            <b>{principle.id} · {principle.statement}</b>
            <p>{principle.attribution_scope} · {principle.classification} · {principle.runtime_candidate ? "拟用候选，未启用 / Candidate only" : "仅保留研究，不编入交易政策 / Research record only"}</p>
            <p>{principle.evidence_assessment}</p>
            <small>{(principle.source_ids || []).join(" · ")}</small>
          </div>)}
          <ul>{(selectedExpert.research.sources || []).map((source: Any) => <li key={source.id}>
            <a href={/^https?:\/\//.test(source.url || "") ? source.url : undefined} target="_blank" rel="noreferrer">{source.id} · {source.title}</a>
            <p>{source.locator || "定位详见本地证据档案"}</p>
            {source.quote && <blockquote>{source.quote}</blockquote>}
            <small>{source.published_at || "发表时间待核"} · {source.rights_note || "引用与数据分析；再分发许可须另审"}</small>
          </li>)}</ul>
          <p>缺口 / Gaps: {(selectedExpert.research.gaps || []).join("；")}</p>
        </section>}
        {missingData(selectedExpert).length > 0 && <p className="error compact">{t("data.missing", {data: missingData(selectedExpert).map((field: string) => requirementLabel(field, t)).join(" / ")})}</p>}
        <Btn onClick={() => setSelectedExpert(null)}><LText id="Close details"/></Btn>
      </div></div>}
    </>
  );
}
function Reviews({ items, review }: any) {
  const { t } = useLocale();
  return (
    <Panel title={t("Pending decisions")}>
      {items?.length ? (
        <ScrollRegion label={t("Pending decisions")}>
<table>
          <thead>
            <tr>
              <th><LText id="Decision"/></th>
              <th><LText id="Experiment"/></th>
              <th><LText id="Date"/></th>
              <th><LText id="Proposal"/></th>
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
                  <b>{enumLabel(t, (d.decision?.original_proposal || d.proposal || d.original_proposal)?.action || d.decision?.action || d.action || t("Proposal"))}</b>
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
                    {t("原文 / Original")} · {(d.decision?.original_proposal || d.proposal || d.original_proposal)?.rationale || d.rationale ||
                      t("No rationale was returned with this proposal.")}
                  </small>
                </td>
                <td>
                  <Btn kind="primary" onClick={() => review(normalizeReview(d), "approve")}><LText id="Approve"/></Btn>
                  <Btn onClick={() => review(normalizeReview(d), "modify")}><LText id="Modify"/></Btn>
                  <Btn kind="danger" onClick={() => review(normalizeReview(d), "reject")}><LText id="Reject"/></Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</ScrollRegion>
      ) : (
        <Empty><LText id="No pending review decisions."/></Empty>
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
  const { t } = useLocale();
  const originalTargets = item?.original_proposal?.targets || {};
  const [reason, setReason] = useState("");
  const hasPreserved = (item?.original_proposal?.preserve_symbols || []).length > 0;
  const [targetsText, setTargetsText] = useState(hasPreserved ? "" : JSON.stringify(originalTargets, null, 2));
  const symbols: string[] = item?.config?.symbols || [];
  const maxWeight = Number(item?.config?.max_position_weight);
  const validateTargets = (source: string) => {
    try {
      const targets = JSON.parse(source);
      if (!targets || Array.isArray(targets) || typeof targets !== "object") return t("Enter a JSON object mapping symbols to target weights.");
      if (!Number.isFinite(maxWeight) || !symbols.length) return t("Experiment limits are still loading.");
      let total = 0;
      for (const [rawSymbol, rawWeight] of Object.entries(targets)) {
        const symbol = rawSymbol.toUpperCase();
        if (!symbols.includes(symbol)) return t("{symbol} is not in this experiment’s asset universe.", {symbol});
        if (typeof rawWeight !== "number" || !Number.isFinite(rawWeight) || rawWeight < 0) return t("{symbol} must have a finite, non-negative weight.", {symbol});
        if (rawWeight > maxWeight + 1e-9) return t("{symbol} exceeds the {limit}% per-position limit.", {symbol, limit:(maxWeight * 100).toFixed(2)});
        total += rawWeight;
      }
      if (total > 1 + 1e-9) return t("Target weights cannot exceed 100% in total.");
      return "";
    } catch {
      return t("Targets must be valid JSON.");
    }
  };
  const targetProblem = validateTargets(targetsText);
  return (
    <div className="overlay">
      <div className="modal">
        <button className="x" aria-label={t("Close dialog")} onClick={close}>
          ×
        </button>
        <h2>
          {t("Review decision")} · {item?.experiment_name ? `${item.experiment_name} · ` : ""}
          {item?.as_of_date || item?.date || t("Date unavailable")}
        </h2>
        <p><LText id="Original proposal remains in the audit record."/></p>
        {String(item?.original_proposal?.action || "").toLowerCase() === "hold" && <p className="tag"><LText id="Approving HOLD keeps the current portfolio and creates no new order."/></p>}
        {item?.original_proposal && (
          <div className="proposal-preview">
            <b>
              {enumLabel(t, item.original_proposal.action || t("Proposal"))}
            </b>
            <p>
              {t("原文 / Original")} · {item.original_proposal.rationale || t("No rationale provided.")}
            </p>
            {hasPreserved && <p>{t("four.preserve")} · {item.original_proposal.preserve_symbols.join(", ")}</p>}
            {item.original_proposal.targets && (
              <pre>
                {JSON.stringify(item.original_proposal.targets, null, 2)}
              </pre>
            )}
          </div>
        )}
        <label><LText id="Reason (required for modify/reject)"/><textarea placeholder={t("Explain your intervention")} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        {hasPreserved && <p className="notice">{t("four.fullTargetsWarning")}</p>}
        <label><LText id="Modified target weights (JSON; example target AAPL at 10%)"/><textarea
            placeholder={'{"AAPL":0.1}'}
            value={targetsText}
            onChange={(event) => setTargetsText(event.target.value)}
          />
        </label>
        {targetProblem && <p className="error compact">{targetProblem}</p>}
        <div className="toolbar">
          <Btn kind="primary" onClick={() => review(item, "approve")}><LText id="Approve"/></Btn>
          <Btn
            disabled={!reason.trim() || !!targetProblem}
            onClick={() => {
              if (!reason.trim() || targetProblem) return;
              review(item, "modify", reason.trim(), JSON.parse(targetsText));
            }}
          ><LText id="Modify"/></Btn>
          <Btn
            kind="danger"
            disabled={!reason.trim()}
            onClick={() => review(item, "reject", reason.trim())}
          ><LText id="Reject"/></Btn>
        </div>
      </div>
    </div>
  );
}
function TeamEditor({ team: initialTeam, experts, pendingPolicy, hasPending, close, save }: any) {
  const { t } = useLocale();
  const [team, setTeam] = useState<Any[]>(initialTeam.map((item: Any) => ({
    expert_id: item.expert_id || item.id,
    role: String(item.role || "advisor").toLowerCase().includes("trad") || item.role === "strategy" ? "trader" : "advisor",
    enabled: item.enabled !== false,
  })));
  const [newExpert, setNewExpert] = useState("");
  const expertFor = (id: string) => experts.find((item: Any) => item.id === id);
  const available = (expert: Any) => expert?.activation_status !== "research_only" && (expert?.required_data || []).every((item: string) => ["price", "prices", "ohlcv", "price history", "historical prices"].includes(item.toLowerCase()));
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
        <button className="x" aria-label={t("Close dialog")} onClick={close}>×</button>
        <h2><LText id="Trading team"/></h2>
        <p><LText id="Changes become active at the next decision boundary. Disabled or removed experts will not participate in the next decision."/></p>
        {hasPending && <p className="tag">{t("Pending review policy")} · {pendingPolicy ? enumLabel(t, pendingPolicy) : t("Choose before saving")}</p>}
        <div className="team-edit-list">
          {team.map((item) => {
            const expert = expertFor(item.expert_id) || { name: item.expert_id, description: t("Expert profile unavailable") };
            const supported = available(expert);
            return <article className="team-edit-row" key={item.expert_id}>
              <div className="team-edit-main">
                <strong>{expert.name}</strong>
                <span className="muted">{expert.version ? `v${expert.version}` : ""}</span>
                <p>{expert.objective || expert.description || ""}</p>
                <DataRequirements items={expert.required_data} />
                {!supported && <small className="error"><LText id="Unavailable: this experiment supplies price history only."/></small>}
                <details><summary><LText id="Instructions and limits"/></summary><p>{expert.instructions || t("No instructions provided.")}</p><small>{expert.risk_notes || t("No risk notes provided.")}</small></details>
              </div>
              <label className="team-role"><LText id="Role"/><select value={item.role} onChange={(event) => update(item.expert_id, { role: event.target.value })}>
                <option value="trader"><LText id="Trader"/></option><option value="advisor"><LText id="Advisor"/></option>
              </select></label>
              <label className="team-enabled"><input type="checkbox" checked={item.enabled} disabled={!supported} onChange={(event) => update(item.expert_id, { enabled: event.target.checked })} /> <LText id="Enabled"/></label>
              <Btn kind="danger" onClick={() => setTeam((items) => items.filter((row) => row.expert_id !== item.expert_id))}><LText id="Remove"/></Btn>
            </article>;
          })}
        </div>
        <div className="toolbar">
          <select value={newExpert} onChange={(event) => setNewExpert(event.target.value)}>
            <option value=""><LText id="Add an expert…"/></option>
            {experts.filter((expert: Any) => !team.some((item) => item.expert_id === expert.id) && available(expert)).map((expert: Any) => <option key={expert.id} value={expert.id}>{expert.name} · {enumLabel(t, expert.role || "advisor")}</option>)}
          </select>
          <Btn onClick={add} disabled={!newExpert}><LText id="Add to team"/></Btn>
        </div>
        <p className={canSave ? "muted" : "error"}>
          {enabledTraders !== 1 ? t("Enable exactly one trader. Other enabled experts must be advisors.") : unavailable.length ? t("An enabled expert requires data that this experiment does not have.") : duplicate ? t("Remove duplicate expert assignments.") : t("Exactly one enabled trader is selected.")}
        </p>
        <div className="toolbar">
          <Btn onClick={close}><LText id="Cancel"/></Btn>
          <Btn kind="primary" disabled={!canSave} onClick={() => save(team, pendingPolicy || "keep")}><LText id="Schedule team change"/></Btn>
        </div>
      </div>
    </div>
  );
}
function TeamChangeModal({ expert, close, choose }: any) {
  const { t } = useLocale();
  return (
    <div className="overlay">
      <div className="modal">
        <button className="x" aria-label={t("Close dialog")} onClick={close}>
          ×
        </button>
        <h2><LText id="Schedule expert change"/></h2>
        <p><LText id="A review proposal is waiting. Choose what happens to it before changing the team."/></p>
        {expert && <p><b>{expert.name}</b> <LText id="will take effect at the next decision boundary."/></p>}
        <div className="toolbar">
          <Btn onClick={() => choose("keep")}><LText id="Keep proposal for review"/></Btn>
          <Btn kind="danger" onClick={() => choose("discard")}><LText id="Discard proposal; change next decision"/></Btn>
        </div>
      </div>
    </div>
  );
}
function BranchModal({ detail, close, create }: any) {
  const { t } = useLocale();
  return (
    <div className="overlay">
      <div className="modal">
        <button className="x" aria-label={t("Close dialog")} onClick={close}>
          ×
        </button>
        <h2>{t(detail.config?.lab_mode === "multisource_agent" ? "four.branchTitle" : "Start an oversight branch")}</h2>
        <p><LText id="This creates a separate experiment with its own audit trail. The current run remains unchanged."/></p>
        {detail.config?.lab_mode === "multisource_agent" ? <p>{t("four.branchHuman")}</p> : detail.config?.lab_mode ? <p>{t("four.branchUnavailable")}</p> : <label><LText id="Oversight mode"/><select
            id="branch-mode"
            defaultValue={
              detail.config?.mode === "ai_only" ? "human_review" : "ai_only"
            }
          >
            <option value="ai_only"><LText id="AI only"/></option>
            <option value="human_review"><LText id="AI + Human Review"/></option>
          </select>
        </label>}
        <div className="toolbar end">
          <Btn onClick={close}><LText id="Cancel"/></Btn>
          <Btn kind="primary" disabled={!!detail.config?.lab_mode && detail.config.lab_mode !== "multisource_agent"} onClick={() => create(value("branch-mode"))}>{t(detail.config?.lab_mode === "multisource_agent" ? "four.branchTitle" : "Create branch")}</Btn>
        </div>
      </div>
    </div>
  );
}
function Portfolio({ detail }: any) {
  const { t } = useLocale();
  return (
    <>
      <KPIs detail={detail} />
      <Panel title={t("Open holdings")}>
        <ScrollRegion label={t("Portfolio")}>
<table>
          <thead>
            <tr>
              <th><LText id="Symbol"/></th>
              <th><LText id="Quantity"/></th>
              <th><LText id="Weight"/></th>
              <th><LText id="Market value"/></th>
              <th><LText id="Unrealized P&L"/></th>
              <th><LText id="Quote freshness"/></th>
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
                    {h.is_stale ? t("Stale") : t("As of")} · 
                    {h.price_date || t("Date unavailable")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</ScrollRegion>
        {!detail?.holdings?.length && (
          <Empty><LText id="Select a run with recorded holdings."/></Empty>
        )}
      </Panel>
      <Panel title={t("Order ledger")}>
        <ScrollRegion label={t("Order ledger")}>
<table>
          <thead>
            <tr>
              <th><LText id="Order"/></th>
              <th><LText id="Target allocation"/></th>
              <th><LText id="Recorded fills"/></th>
              <th><LText id="Status"/></th>
              <th><LText id="Eligible date"/></th>
            </tr>
          </thead>
          <tbody>
            {(detail?.orders || []).map((o: any) => (
              <tr key={o.id}>
                <td>{o.id}<small className="muted">{t("Created")} · {o.created_date || "—"}</small></td>
                <td>{o.target_weights && Object.keys(o.target_weights).length ? Object.entries(o.target_weights).map(([symbol, weight]) => <span key={symbol} className="tag">{symbol} {pct(weight)}</span>) : t("Cash / no targets")}</td>
                <td>{(o.fills || []).length ? o.fills.map((fill: Any, index: number) => <div key={`${fill.symbol}-${index}`}><span className="tag">{enumLabel(t, fill.side)} {fill.symbol} · {Number(fill.quantity).toFixed(4)} @ {money(fill.fill_price, 4)}</span><small>{fill.date || t("Fill date unavailable")} · {t("Fee")} {money(fill.fees, 4)}</small></div>) : t("No fills recorded")}</td>
                <td>{enumLabel(t, o.status)}</td>
                <td>{o.eligible_date || t("Not yet eligible")}</td>
              </tr>
            ))}
          </tbody>
        </table>
</ScrollRegion>
        {!detail?.orders?.length && <Empty><LText id="No orders in this run."/></Empty>}
      </Panel>
    </>
  );
}
function Reports({ runs, compare, C, exportRun, result, compareNow }: any) {
  const { t } = useLocale();
  const [selectedReport, setSelectedReport] = useState("");
  const [reportDetail, setReportDetail] = useState<Any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<Error | string>("");
  const reportAnalysis = useAnalysis(selectedReport, Boolean(reportDetail?.config?.lab_mode));
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
      .catch((error: any) => { if (active) setReportError(error); })
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
      <Panel title={t("Experiment comparison")}>
        {runs.length ? (
          <ScrollRegion label={t("Experiment comparison")}>
<table>
            <thead>
              <tr>
                <th></th>
                <th><LText id="Experiment"/></th>
                <th><LText id="Mode"/></th>
                <th><LText id="Status"/></th>
                <th><LText id="As of"/></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={t("Select {name} for comparison", {name:r.name})}
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
                  <td>{enumLabel(t, r.lab_mode || r.config?.lab_mode || r.mode)}</td>
                  <td>{enumLabel(t, r.status)}</td>
                  <td>{r.current_date || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
</ScrollRegion>
        ) : (
          <Empty><LText id="No saved experiments to compare yet."/></Empty>
        )}
        <div className="toolbar">
          <span><LText id="Compatibility checks include data version, date range, capital, costs and strategy."/></span>
          <Btn kind="primary" onClick={compareNow}>
            {t("Compare selected ({count})", {count: compare.length})}
          </Btn>
        </div>
        {result && (
          <div className="comparison-result">
            <div className={result.comparable ? "tag lime" : "tag warn"}>
              {result.comparable
                ? t("Compatible configurations")
                : t("Configuration differences found")}
            </div>
            {result.notice && <p>{t(result.comparable ? "copy.comparisonReady" : "copy.comparisonDifference")}</p>}
            <ScrollRegion label={t("Experiment comparison")}>
<table>
              <thead>
                <tr>
                  <th><LText id="Experiment"/></th>
                  <th><LText id="Oversight"/></th>
                  <th><LText id="Status"/></th>
                  <th><LText id="As of"/></th>
                  <th><LText id="Total return"/></th>
                  <th><LText id="Max drawdown"/></th>
                  <th>{t("metric.volatility")}</th>
                  <th><LText id="Fees"/></th>
                  <th title={t("metric.sharpeHelp")}>{t("metric.sharpe")}</th>
                </tr>
              </thead>
              <tbody>
                {result.experiments.map((x: any, i: number) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td>{enumLabel(t, result.treatment_modes?.[i])}</td>
                    <td>{enumLabel(t, x.status)}</td>
                    <td className="metric-number">{x.as_of_date || "—"}</td>
                    <td><ReturnValue value={x.metrics?.total_return} /></td>
                    <td className="metric-number">{pct(x.metrics?.max_drawdown)}</td>
                    <td><VolatilityValue value={x.metrics?.annualized_volatility} reference={Math.max(...result.experiments.map((run: Any) => Number(run.metrics?.annualized_volatility) || 0))} /></td>
                    <td className="metric-number">{money(x.metrics?.fees_paid ?? x.metrics?.fees, 2)}</td>
                    <td className="metric-number">{conciseNumber(x.metrics?.sharpe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
</ScrollRegion>
            <p className="metric-explanation">{t("metric.sharpeHelp")} {t("metric.volatilityHelp")}</p>
            <details className="metric-explanation"><summary>{t("metric.calculation")}</summary><p>{t("metric.calculationDetail")}</p></details>
            {(result.treatment_differences || result.control_differences) ? <>
              <details><summary>{t("four.treatmentDifferences")}</summary><pre>{JSON.stringify(result.treatment_differences || {}, null, 2)}</pre></details>
              <details><summary>{t("four.controlDifferences")}</summary><pre>{JSON.stringify(result.control_differences || {}, null, 2)}</pre></details>
            </> : Object.keys(result.differences || {}).length > 0 && (
              <details><summary><LText id="Review settings that differ"/></summary><pre>{JSON.stringify(result.differences, null, 2)}</pre></details>
            )}
          </div>
        )}
      </Panel>
      <Panel title={t("Experiment report details")}>
        <label><LText id="Experiment"/><select value={selectedReport} onChange={(event) => setSelectedReport(event.target.value)}>
            {runs.map((run: Any) => <option key={run.id} value={run.id}>{run.name}</option>)}
          </select>
        </label>
        {reportLoading && <p className="muted"><LText id="Loading saved report details…"/></p>}
        {reportError && <p className="error"><ErrorMessage error={reportError}/></p>}
        {reportDetail && !reportLoading && <>
          <div className="kpis report-kpis">
            <div className="kpi"><label>{t("metric.volatility")}</label><b><VolatilityValue value={reportDetail.metrics?.annualized_volatility} /></b></div>
            <div className="kpi"><label><LText id="Trading fees"/></label><b>{money(reportDetail.metrics?.fees_paid ?? reportDetail.metrics?.fees, 2)}</b></div>
            <div className="kpi"><label><LText id="Human reviews"/></label><b>{reviewedDecisions.length}</b><small>{t("Approve")} {reviewCounts.approve} · {t("Modify")} {reviewCounts.modify} · {t("Reject")} {reviewCounts.reject}</small></div>
            <div className="kpi"><label><LText id="LLM calls / estimated cost"/></label><b>{reportDetail.state?.llm_calls ?? usage.length} / {money(estimatedCost, 6)}</b><small>{t("Cost sums recorded estimates only")}{usage.some((item: Any) => item.estimated_cost_usd == null) ? ` · ${t("Some costs are unknown")}` : ""}</small></div>
          </div>
          {reportDetail.config?.lab_mode && (reportAnalysis.loading ? <p>{t("four.loading")}</p> : reportAnalysis.error ? <p className="error"><ErrorMessage error={reportAnalysis.error as Error}/></p> : reportAnalysis.data && <InterventionHistory data={reportAnalysis.data}/>)}
          <p className="muted"><LText id="Review timestamps are shown where recorded. Review duration is unavailable."/></p>
          <h4><LText id="Review actions"/></h4>
          {reviewedDecisions.length ? <ScrollRegion label={t("Review actions")}>
<table><thead><tr><th><LText id="Decision"/></th><th><LText id="Action"/></th><th><LText id="Recorded time"/></th><th><LText id="Reason"/></th></tr></thead><tbody>
            {reviewedDecisions.map((decision: Any) => {
              const event = (reportDetail.events || []).find((item: Any) => item.type === "decision_reviewed" && item.decision_id === decision.id);
              const recorded = event?.created_at || (decision.review.date ? `${decision.review.date} · ${t("Time unavailable")}` : t("Timestamp unavailable"));
              return <tr key={decision.id}><td>{decision.id}</td><td>{enumLabel(t, decision.review.action)}</td><td>{recorded}</td><td>{decision.review.reason ? <>{t("原文 / Original")} · {decision.review.reason}</> : "—"}</td></tr>;
            })}
          </tbody></table>
</ScrollRegion> : <Empty><LText id="No human review actions recorded."/></Empty>}
          {usage.length > 0 && <><h4><LText id="LLM usage"/></h4><ScrollRegion label={t("LLM usage")}>
<table><thead><tr><th><LText id="Expert"/></th><th><LText id="Role"/></th><th><LText id="Status"/></th><th><LText id="Elapsed"/></th><th><LText id="Estimated cost"/></th></tr></thead><tbody>
            {usage.map((item: Any, index: number) => <tr key={`${item.expert_id || "call"}-${index}`}><td>{item.expert_id || "—"}</td><td>{enumLabel(t, item.role)}</td><td>{enumLabel(t, item.status)}</td><td>{item.elapsed_seconds == null ? "—" : `${item.elapsed_seconds}s`}</td><td>{item.estimated_cost_usd == null ? t("Unknown") : money(item.estimated_cost_usd, 6)}</td></tr>)}
          </tbody></table>
</ScrollRegion></>}
        </>}
        {!reportDetail && !reportLoading && !runs.length && <Empty><LText id="No experiment report is available yet."/></Empty>}
      </Panel>
      <Panel title={t("Report export")}>
        <p><LText id="Exports contain saved run metrics, configuration and audit records. Check data and execution settings before attributing differences."/></p>
        <select id="export-run" aria-label={t("Experiment to export")}>
          {runs.map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select id="export-format" aria-label={t("Export format")}>
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
        <Btn
          onClick={() => exportRun(value("export-run"), value("export-format"))}
        ><LText id="Export report"/></Btn>
      </Panel>
    </>
  );
}
function DataHub({ datasets, upload, onImported }: any) {
  const { t, locale } = useLocale();
  const datasetGroups = groupDatasetImports(datasets || []);
  const [form, setForm] = useState({ symbol: "AAPL", timeframe: "1m", start: "", end: "" });
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState<Any>({});
  const [collectors, setCollectors] = useState<Any[]>([]);
  const [collectorSource, setCollectorSource] = useState("demo");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{key: string; params?: Record<string, string | number>}>({key: ""});
  const [error, setError] = useState<Error | string>("");
  const loadLiveState = async () => {
    try {
      const [p, c] = await Promise.all([req("/market/settings"), req("/market/collector")]);
      setProvider(p || {});
      setCollectors(Array.isArray(c) ? c : c?.sessions || c?.collectors || []);
    } catch (e: any) { setError(e instanceof Error ? e : "Unable to read market data status"); }
  };
  useEffect(() => {
    loadLiveState();
    const timer = window.setInterval(loadLiveState, 5000);
    return () => window.clearInterval(timer);
  }, []);
  const submitImport = async (e: any) => {
    e.preventDefault(); setLoading(true); setError(""); setMessage({key: ""});
    try {
      const payload = { symbols: [form.symbol.trim().toUpperCase()], timeframe: form.timeframe === "1m" ? "1Min" : "1Hour", start: new Date(form.start).toISOString(), end: new Date(form.end).toISOString(), feed: "iex" };
      const result = await req("/market/alpaca/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const count = result.rows ?? result.bar_count ?? "—";
      setMessage({key: "Historical bars saved as dataset {id} · {count} rows · IEX feed.", params: {id: result.dataset_id || result.id || "", count}});
      await onImported?.();
    } catch (e: any) { setError(e instanceof Error ? e : "Historical data import failed"); }
    finally { setLoading(false); }
  };
  const startCollector = async () => {
    setLoading(true); setError(""); setMessage({key: ""});
    try {
      const result = await req("/market/collector/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: [form.symbol.trim().toUpperCase()], timeframe: "1Min", feed: "iex", source: collectorSource }) });
      setMessage({key: collectorSource === "demo" ? "Synthetic demo collector started · {id}. This collects market data only." : "Alpaca IEX collector started · {id}. This collects market data only.", params: {id: result?.id || "—"}});
      await loadLiveState();
    } catch (e: any) { setError(e instanceof Error ? e : "Collector could not start"); }
    finally { setLoading(false); }
  };
  const createDemo = async () => {
    setLoading(true); setError(""); setMessage({key: ""});
    try {
      const result = await req("/market/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: [form.symbol.trim().toUpperCase() || "DEMO-A"], timeframe: form.timeframe, bars_per_day: form.timeframe === "1m" ? 390 : 7, days: 5 }) });
      setMessage({key: "Synthetic demo dataset created · {count} bars. Generated data only.", params: {count: result.rows ?? "—"}}); await onImported?.();
    } catch (e: any) { setError(e instanceof Error ? e : "Could not create demo data"); }
    finally { setLoading(false); }
  };
  const stopCollector = async (session: Any) => {
    setLoading(true); setError(""); setMessage({key: ""});
    try {
      await req("/market/collector/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: session.id || session.collector_id }) });
      setMessage({key: "Collector paused. Its saved data remains available."}); await loadLiveState();
    } catch (e: any) { setError(e instanceof Error ? e : "Collector could not be paused"); }
    finally { setLoading(false); }
  };
  return <>
    <Panel title={t("Available datasets")}>{datasets?.length ? <>
      <p className="muted">{t("data.inventory", {count: datasetGroups.length, imports: datasets.length})}</p>
      <ScrollRegion label={t("Available datasets")}><table>
        <thead><tr><th><LText id="Name"/></th><th><LText id="Coverage"/></th><th><LText id="Symbols"/></th><th>{t("data.type")}</th><th><LText id="Rows"/></th></tr></thead>
        <tbody>{datasetGroups.map(({dataset: d, imports}) => <tr key={d.id}>
          <td><span className="dataset-name"><strong>{datasetDisplayName(d, t)}</strong></span>
            {imports.length > 1 && <span className="dataset-copy-note">{t("data.copies", {count: imports.length})}</span>}
            <details className="dataset-imports"><summary>{t("data.details")}</summary>
              {imports.map(item => <div key={item.id}><span>{item.name}</span><code>{item.id}</code></div>)}
            </details>
          </td>
          <td>{datasetCoverage(d)}</td><td>{(d.symbols || []).join(", ")}</td>
          <td><span className={`data-chip ${d.synthetic ? "data-chip--demo" : "data-chip--price"}`}>{t(d.synthetic ? "data.synthetic" : "data.imported")}</span></td>
          <td>{d.rows ?? "—"}</td>
        </tr>)}</tbody>
      </table></ScrollRegion>
    </> : <Empty><LText id="No datasets yet. Import a CSV file or fetch historical bars."/></Empty>}</Panel>

    <Panel title={t("Historical minute data")}>
      <p><LText id="Request timestamped historical bars from Alpaca using the IEX feed. Each import creates a separate immutable dataset. The secret stays in the local backend."/></p>
      {!provider.configured && <div className="tag warn"><LText id="Alpaca credentials are not configured. Add them under Settings before requesting data."/></div>}
      <form className="settings" onSubmit={submitImport}>
        <label><LText id="Symbol"/><input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} required /></label>
        <label><LText id="Bar interval"/><select value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value })}><option value="1m"><LText id="1 minute"/></option><option value="1h"><LText id="1 hour"/></option></select><small><LText id="Intervals are stored as received; no chart resampling is applied."/></small></label>
        <label><LText id="Start time"/><input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required /><small><LText id="Computer local time, converted to UTC when requested."/></small></label>
        <label><LText id="End time"/><input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required /><small><LText id="Computer local time, converted to UTC when requested."/></small></label>
        <div className="toolbar"><button className="primary" disabled={loading || !provider.configured || !form.start || !form.end}><LText id="Import Alpaca IEX bars"/></button><span><LText id="Feed: IEX · API usage depends on your account limits"/></span></div>
      </form>
      <div className="toolbar"><Btn disabled={loading} onClick={createDemo}><LText id="Create synthetic demo dataset"/></Btn><span><LText id="Deterministic fixture · clearly marked synthetic"/></span></div>
      {message.key && <div className="notice">{t(message.key, message.params)}</div>}{error && <div className="error"><ErrorMessage error={error}/></div>}
    </Panel>
    <Panel title={t("Market collector")}>
      <p><LText id="Collectors fetch data separately from experiments. Starting or pausing a collector never submits brokerage orders or starts an Agent."/></p>
      <div className="toolbar"><label><LText id="Source"/><select value={collectorSource} onChange={(e) => setCollectorSource(e.target.value)}><option value="demo"><LText id="Synthetic demo"/></option><option value="alpaca" disabled={!provider.configured}>Alpaca IEX</option></select></label><span>{collectorSource === "demo" ? t("Synthetic demo · accelerated virtual clock · 1m bars") : t("Alpaca IEX · 1m bars · freshness depends on account permissions.")}</span><Btn disabled={loading || (collectorSource === "alpaca" && !provider.configured)} onClick={startCollector}><LText id="Start 1m collector"/></Btn></div>
      {!collectors.length ? <Empty><LText id="No collector sessions recorded."/></Empty> : <ScrollRegion label={t("Market collector")}><table><thead><tr><th><LText id="Source / feed"/></th><th><LText id="Symbols · interval"/></th><th><LText id="Status"/></th><th><LText id="Latest bar"/></th><th><LText id="Data age"/></th><th></th></tr></thead><tbody>{collectors.map((c: Any) => {
        const latest = c.last_bar_at || c.last_timestamp || c.last_received_at || "";
        const age = latest ? Math.max(0, Math.floor((Date.now() - new Date(latest).getTime()) / 1000)) : null;
        const active = ["running", "starting", "reconnecting", "active", "connected"].includes(String(c.status || "").toLowerCase());
        const rawStatus = String(c.status || "").toLowerCase();
        const stale = ["running", "active", "connected"].includes(rawStatus) && (age == null || age > (c.source === "demo" ? 8 : 180));
        const label = ["starting"].includes(rawStatus) ? t("Connecting") : rawStatus === "reconnecting" ? t("Reconnecting") : stale ? t("Stale / no recent bar") : active && age == null ? t("Waiting for first bar") : active ? t("Collecting") : c.status ? enumLabel(t, c.status) : t("Unknown");
        return <tr key={c.id || c.collector_id}><td>{c.source === "demo" || c.synthetic ? t("Synthetic demo") : c.source || "Alpaca"} · {c.feed || "IEX"}</td><td>{(c.symbols || [c.symbol]).filter(Boolean).join(", ")} · {c.timeframe || c.bar_interval || "—"}</td><td><span className={`tag ${stale ? "warn" : ""}`}>{label}{c.error ? ` · ${t("Server response (original)")} · ${c.error}` : ""}</span></td><td>{latest ? formatMarketTime(latest, locale) : t("No bar received")}</td><td>{age == null ? "—" : `${age}s`}</td><td>{active && <Btn disabled={loading} onClick={() => stopCollector(c)}><LText id="Pause"/></Btn>}</td></tr>;
      })}</tbody></table></ScrollRegion>}
      <small><LText id="“Live” describes incoming data. A forming bar is not a completed decision input. Check the saved bar timestamp and source before starting a live experiment."/></small>
    </Panel>
    <Panel title={t("Import CSV")}><p><LText id="Import a local OHLCV CSV as a versioned dataset. Timestamp CSV files preserve intraday bars; date-only files remain daily data."/></p><Btn kind="upload" onClick={() => csvInputRef.current?.click()}><LText id="Choose CSV"/></Btn><input ref={csvInputRef} type="file" hidden accept=".csv,text/csv" onChange={(e: any) => e.target.files?.[0] && upload(e.target.files[0])} /></Panel>

  </>;
}
function Settings({ settings, save, test, refresh }: any) {
  const { t } = useLocale();
  return (
    <>
    <Panel title={t("Model connection")}>
      <p><LText id="Compatible chat completions endpoint. Connection tests make a real minimal request. API key is write-only and is never shown again."/> </p>
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
        <label><LText id="Base URL"/><input
            id="base_url"
            defaultValue={settings.base_url || ""}
            placeholder="https://…/v1"
          />
        </label>
        <label><LText id="Model"/><input
            id="model"
            defaultValue={settings.model || ""}
            placeholder={t("Model name")}
          />
        </label>
        <label>
          {t("API key")}{" "}
          <small>
            {settings.api_key_configured
              ? t("Configured; enter to replace")
              : t("Not configured")}
          </small>
          <input
            type="password"
            id="api_key"
            autoComplete="new-password"
            placeholder={t("Stored by backend only")}
          />
        </label>
        <label><LText id="Max calls"/><input
            type="number"
            id="max_calls"
            defaultValue={settings.max_calls || 20}
          />
        </label>
        <label><LText id="Budget (USD)"/><input
            type="number"
            id="budget_usd"
            defaultValue={settings.budget_usd || 5}
          />
        </label>
        <label><LText id="Input cost / million"/><input
            type="number"
            id="input_cost_per_million"
            defaultValue={settings.input_cost_per_million ?? ""}
          />
        </label>
        <label><LText id="Output cost / million"/><input
            type="number"
            id="output_cost_per_million"
            defaultValue={settings.output_cost_per_million ?? ""}
          />
        </label>
        <div className="toolbar">
          <button className="primary"><LText id="Save settings"/></button>
          <Btn onClick={test}><LText id="Test connection"/></Btn>
        </div>
      </form>
    </Panel>
    <AlpacaSettings refresh={refresh} />
    </>
  );
}
function AlpacaSettings({ refresh }: any) {
  const { t } = useLocale();
  const [state, setState] = useState<Any>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<Error | string>("");
  const load = async () => { try { setState(await req("/market/settings")); } catch (e: any) { setError(e instanceof Error ? e : "Unable to read Alpaca settings"); } };
  useEffect(() => { load(); }, []);
  const submit = async (e: any) => {
    e.preventDefault(); const form = e.currentTarget as HTMLFormElement; setBusy(true); setMessage(""); setError("");
    try {
      const body = { key_id: value("alpaca_key_id"), secret: value("alpaca_secret") };
      const saved = await req("/market/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setState(saved || {}); (form.elements.namedItem("alpaca_key_id") as HTMLInputElement).value = ""; (form.elements.namedItem("alpaca_secret") as HTMLInputElement).value = "";
      setMessage("Alpaca credentials saved by the local backend. No provider connection was started."); await refresh?.();
    } catch (e: any) { setError(e instanceof Error ? e : "Could not save Alpaca settings"); }
    finally { setBusy(false); }
  };
  return <Panel title={t("Market data provider · Alpaca")}><p><LText id="Data credentials are separate from the LLM key. They are write-only: this page never reads or displays the key or secret. Saving credentials does not connect to Alpaca."/></p><div className="tag">{t("Status")}: {state.configured ? t("credentials saved") : t("not configured")}</div><form className="settings" onSubmit={submit}><label><LText id="Key ID"/><input type="password" id="alpaca_key_id" autoComplete="new-password" placeholder={state.configured ? t("Enter to replace saved key") : t("Alpaca key ID")} /></label><label><LText id="Secret key"/><input type="password" id="alpaca_secret" autoComplete="new-password" placeholder={t("Stored by backend only")} /></label><div className="toolbar"><button className="primary" disabled={busy}><LText id="Save data credentials"/></button><span><LText id="No connection test runs until you explicitly request data or start an Alpaca collector."/></span></div></form>{message && <div className="notice">{t(message)}</div>}{error && <div className="error"><ErrorMessage error={error}/></div>}</Panel>;
}
function Wizard({ step, setStep, close, datasets, experts, submit }: any) {
  const { t } = useLocale();
  const [evidencePacks, setEvidencePacks] = useState<Any[]>([]);
  const [evidenceError, setEvidenceError] = useState<Error | string>("");
  const [capabilities, setCapabilities] = useState<Any | null>(null);
  useEffect(() => {
    let active = true;
    req("/harness").then((value) => { if (active) setCapabilities(value); }).catch(() => { if (active) setCapabilities(null); });
    req("/harness/evidence-packs")
      .then((packs) => { if (active) setEvidencePacks(Array.isArray(packs) ? packs : []); })
      .catch((error) => { if (active) setEvidenceError(error); });
    return () => { active = false; };
  }, []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [labMode, setLabMode] = useState<LabMode>("quant_baseline");
  const [legacyTeam, setLegacyTeam] = useState(false);
  const supported = legacyTeam || (capabilities?.workflow_version === "score-fusion-v1" && Array.isArray(capabilities?.lab_modes) && capabilities.lab_modes.includes(labMode));
  const [quant, setQuant] = useState("bt_sma50");
  const [weights, setWeights] = useState<Weights>(defaultWeights);
  const [entry, setEntry] = useState("0.25"), [exit, setExit] = useState("-0.25"), [horizon, setHorizon] = useState("5");
  const field = (id: string, fallback = "") =>
    value(id) || draft[id] || fallback;
  const selectedDataset = datasets.find((d: Any) => d.id === field("dataset_id", datasets[0]?.id || "")) || datasets[0] || {};
  const isTimestampDataset = Number(selectedDataset.schema_version || 1) >= 2;
  const dateBound = (input: any) => String(input || "").slice(0, 10);
  const captureForm = (form: HTMLFormElement | null) => {
    if (!form) return;
    const values: Record<string, string> = {};
    Array.from(form.elements).forEach((item: any) => {
      if (!item.id || !(item instanceof HTMLInputElement || item instanceof HTMLSelectElement || item instanceof HTMLTextAreaElement)) return;
      values[item.id] = item.type === "checkbox" && item instanceof HTMLInputElement ? String(item.checked) : item.value;
    });
    setDraft((old) => ({ ...old, ...values }));
  };
  return (
    <div className="overlay">
      <div className="modal wide">
        <button className="x" aria-label={t("Close dialog")} onClick={close}>
          ×
        </button>
        <div className="steps">
          {["Market & data", "four.template", "Risk & review"].map(
            (x: string, i: number) => (
              <span key={i} className={step === i + 1 ? "selected" : ""}>
                0{i + 1}　{t(x)}
              </span>
            ),
          )}
        </div>
        <h2>
          {t(
            [
              "Market & data",
              "four.template",
              "Risk, execution & review",
            ][step - 1])
          }
        </h2>
        <form
          onChange={(e: any) => {
            if (!e.target.id) return;
            if (e.target.id === "dataset_id") {
              const values: Record<string, string> = {};
              Array.from(e.currentTarget.elements as HTMLFormControlsCollection).forEach((item: any) => {
                if (!item.id || !(item instanceof HTMLInputElement || item instanceof HTMLSelectElement || item instanceof HTMLTextAreaElement)) return;
                values[item.id] = item.type === "checkbox" && item instanceof HTMLInputElement ? String(item.checked) : item.value;
              });
              setDraft((old) => ({ ...old, ...values, dataset_id: e.target.value, start_date: "", end_date: "", start_at: "", end_at: "" }));
            } else setDraft((old) => ({ ...old, [e.target.id]: e.target.type === "checkbox" ? String(e.target.checked) : e.target.value }));
          }}
          onSubmit={async (e: any) => {
            e.preventDefault();
            if (step < 3) {
              captureForm(e.currentTarget);
              setStep(step + 1);
              return;
            }
            if (!supported) return alert(t("four.notReady"));
            const d = field("dataset_id", datasets[0]?.id || "");
            if (!d) {
              return alert(t("Choose a dataset first."));
            }
            const team = experts.map((x: Any, i: number) => ({expert_id:x.id, role:field(`role${i}`, i === 0 ? "trader" : "advisor"), enabled: field(`enable${i}`, String(!(x.required_data || []).some((d: string) => !["price", "ohlcv"].includes(d.toLowerCase())))) === "true"}));
            if (legacyTeam && team.filter((member: Any)=>member.enabled && member.role === "trader").length !== 1) return alert(t("Choose exactly one enabled trading lead."));
            if (!legacyTeam && labMode !== "quant_baseline") {
              if ((labMode === "multisource_agent" || labMode === "human_supervised") && !validWeights(weights)) return alert(t("four.totalRule"));
              if (entry.trim() === "" || exit.trim() === "" || horizon.trim() === "" || !Number.isFinite(Number(entry)) || !Number.isFinite(Number(exit)) || Number(entry) > 1 || Number(entry) < -1 || Number(exit) > 1 || Number(exit) < -1 || Number(exit) >= Number(entry) || !Number.isInteger(Number(horizon)) || Number(horizon) < 1) return alert(t("four.invalidPolicy"));
            }
            const dataMode = isTimestampDataset ? field("market_mode", "historical") : "historical";
            const dataset = datasets.find((x: Any) => x.id === d) || {};
            if (dataMode === "live" && Number(dataset.schema_version || 1) < 2) return alert(t("Forward simulation requires a timestamped v2 dataset."));
            if (dataMode === "live" && (dataset.bar_interval || "1m") !== "1m") return alert(t("The current live collector supports 1-minute bars only. Choose a 1-minute warmup dataset."));
            if (Number(dataset.schema_version || 1) >= 2 && (!field("start_at") || !field("end_at"))) return alert(t("Choose a timestamp range for the v2 market data."));
            await submit({
              name: field("run_name", "Research run"),
              dataset_id: d,
              start_date: field("start_date", dateBound(dataset.range?.start || dataset.start_date)),
              end_date: field("end_date", dateBound(dataset.range?.end || dataset.end_date)),
              schema_version: dataset.schema_version || 1,
              ...(Number(dataset.schema_version || 1) >= 2 ? {
                market_mode: dataMode,
                bar_interval: dataset.bar_interval || "1m",
                decision_interval: field("decision_interval", "15m"),
                holding_horizon: field("holding_horizon", "1h"),
                latency_assumptions: { simulated_latency_ms: Number(field("latency_ms", "0")) },
              } : {}),
              ...(Number(dataset.schema_version || 1) >= 2 && field("start_at") ? { start_at: new Date(`${field("start_at")}:00Z`).toISOString() } : {}),
              ...(Number(dataset.schema_version || 1) >= 2 && field("end_at") ? { end_at: new Date(`${field("end_at")}:00Z`).toISOString() } : {}),
              initial_capital: Number(field("capital") || 100000),
              fee_bps: Number(field("fees") || 0),
              slippage_bps: Number(field("slippage") || 0),
              max_position_weight: Number(field("weight") || 25) / 100,
              ...(!legacyTeam ? {lab_mode: labMode,
              quant_strategy: quant,
              fusion_weights: labMode === "market_agent" || labMode === "quant_baseline" ? {market: 1, news: 0, fundamentals: 0} : fractionalWeights(weights),
              score_policy: {entry_threshold: Number(entry), exit_threshold: Number(exit), horizon_bars: Number(horizon)},
              workflow_version: "score-fusion-v1"} : {}),
              mode: legacyTeam ? field("legacy_mode", "human_review") : labMode === "human_supervised" ? "human_review" : "ai_only",
              strategy: legacyTeam ? field("legacy_strategy", "agent") : "agent",
              team: legacyTeam ? team : [],
              provider_mode: !legacyTeam && labMode === "quant_baseline" ? "demo" : field("provider_mode") || "demo",
              harness_version: "research-v1",
              evidence_pack_id: field("evidence_pack_id") || null,
              ...(true ? {
                harness_risk: {
                  min_cash_weight: Number(field("min_cash_weight", "0")) / 100,
                  max_gross_weight: Number(field("max_gross_weight", "100")) / 100,
                  max_turnover: Number(field("max_turnover", "200")) / 100,
                },
              } : {}),
              max_calls: Number(field("calls") || 20),
              budget_usd: Number(field("budget") || 5),
            });
          }}
        >
          {step === 1 && (
            <div className="formgrid" key={selectedDataset.id || "no-dataset"}>
              <label className="full checkline"><input type="checkbox" checked={legacyTeam} onChange={e=>setLegacyTeam(e.target.checked)}/>{t("four.legacyTeam")}</label>
              <p className="full notice">{t(legacyTeam ? "four.legacyDescription" : "four.workflow")}</p>
              <label>{t("Evidence pack (optional)")}<select id="evidence_pack_id" defaultValue={draft.evidence_pack_id || ""}><option value="">{t("Do not use an evidence pack")}</option>{evidencePacks.map((pack: Any) => <option key={pack.id} value={pack.id}>{pack.created_at || t("Date unavailable")} · {pack.id.slice(0, 8)}</option>)}</select><small>{t("Evidence packs are optional and must be imported from Decision workflow first.")}</small>{evidenceError && <small className="error"><ErrorMessage error={evidenceError}/></small>}</label>
              <label><LText id="Experiment name"/><input
                  id="run_name"
                  defaultValue={draft.run_name || "Research run"}
                />
              </label>
              <label><LText id="Dataset"/><select
                  id="dataset_id"
                  defaultValue={draft.dataset_id || datasets[0]?.id || ""}
                >
                  <option value=""><LText id="Select dataset"/></option>
                  {datasets.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {datasetDisplayName(d, t)} · {datasetCoverage(d)}
                    </option>
                  ))}
                </select>
                <small><LText id="For intraday experiments, choose a timestamped v2 dataset with a matching bar interval."/></small>
              </label>
              <label><LText id="Chart bar period"/><input value={selectedDataset.bar_interval || (Number(selectedDataset.schema_version || 1) >= 2 ? "1m" : "1d")} readOnly /><small><LText id="Inherited from this dataset. The chart does not resample bars."/></small></label>
              {isTimestampDataset ? <>
                <label><LText id="Data mode"/><select id="market_mode" defaultValue={draft.market_mode || "historical"}><option value="historical"><LText id="Historical replay"/></option><option value="live"><LText id="Forward simulation"/></option></select><small><LText id="Forward simulation needs a 1-minute warmup dataset and a separate collector. It never places real orders."/></small></label>
                <label><LText id="Decision interval"/><select id="decision_interval" defaultValue={draft.decision_interval || "15m"}><option value="15m"><LText id="Every 15 minutes"/></option><option value="1h"><LText id="Every hour"/></option><option value="1d"><LText id="Every 1 elapsed day"/></option><option value="7d"><LText id="Every 7 elapsed days"/></option></select><small><LText id="How often the experiment may decide. Independent of chart bars."/></small></label>
                <label><LText id="Holding horizon"/><select id="holding_horizon" defaultValue={draft.holding_horizon || "1h"}><option value="1h"><LText id="About 1 hour"/></option><option value="4h"><LText id="About 4 hours"/></option><option value="1d"><LText id="About 1 day"/></option><option value="7d"><LText id="About 7 days"/></option><option value="30d"><LText id="About 30 days"/></option></select><small><LText id="Enforced elapsed UTC duration. Expiry submits a cash exit at the first eligible later bar; market closures can extend the actual time."/></small></label>
                <label><LText id="Simulated decision latency (ms)"/><input id="latency_ms" type="number" min="0" max="60000" step="100" defaultValue={draft.latency_ms || "0"} /><small><LText id="Deterministic timing assumption. No LLM call is made."/></small></label>
              </> : <p className="full notice"><LText id="Daily legacy dataset: its existing daily replay behavior is unchanged. Intraday decision intervals, holding horizons, and latency settings are unavailable for this dataset."/></p>}
              <label><LText id="Start date"/><input
                  id="start_date"
                  type="date"
                  required
                  defaultValue={draft.start_date || dateBound(selectedDataset.range?.start || selectedDataset.start_date)}
                />
              </label>
              <label><LText id="End date"/><input
                  id="end_date"
                  type="date"
                  required
                  defaultValue={draft.end_date || dateBound(selectedDataset.range?.end || selectedDataset.end_date)}
                />
              </label>
              {Number(selectedDataset.schema_version || 1) >= 2 && <><label><LText id="Start time (UTC)"/><input id="start_at" type="datetime-local" required defaultValue={draft.start_at || String(selectedDataset.range?.start || "").slice(0, 16)} /></label><label><LText id="End time (UTC)"/><input id="end_at" type="datetime-local" required defaultValue={draft.end_at || String(selectedDataset.range?.end || "").slice(0, 16)} /></label></>}

            </div>
          )}
          {step === 2 && <>{legacyTeam ? <><p>{t("four.legacyDescription")}</p><label>{t("Replay strategy")}<select id="legacy_strategy" defaultValue={draft.legacy_strategy || "agent"}><option value="agent">{t("Agent")}</option><option value="momentum">{t("Momentum baseline")}</option><option value="buy_hold">{t("Buy and hold baseline")}</option></select></label><div className="expertgrid">{experts.map((x:Any,i:number)=>{const unavailable=(x.required_data || []).some((d:string)=>!["price","ohlcv"].includes(d.toLowerCase())); return <Panel key={x.id}><ExpertBadge ex={x} role={x.role}/>{unavailable && <p className="error compact">{t("Required fundamentals are unavailable in this OHLCV dataset. This expert is disabled.")}</p>}<label>{t("Role")}<select id={`role${i}`} defaultValue={draft[`role${i}`] || (i===0 ? "trader" : "advisor")}><option value="trader">{t("Trader")}</option><option value="advisor">{t("Advisor")}</option></select></label><label className="checkline"><input id={`enable${i}`} type="checkbox" disabled={unavailable} defaultChecked={!unavailable && draft[`enable${i}`] !== "false"}/>{t("Enable for this run")}</label></Panel>})}</div></> : <ModeSettings mode={labMode} setMode={setLabMode} quant={quant} setQuant={setQuant} weights={weights} setWeights={setWeights} entry={entry} setEntry={setEntry} exit={exit} setExit={setExit} horizon={horizon} setHorizon={setHorizon}/>}{(legacyTeam || labMode !== "quant_baseline") && <label><LText id="Provider mode"/><select id="provider_mode" defaultValue={draft.provider_mode || "demo"}><option value="demo"><LText id="Deterministic demo strategy"/></option><option value="llm"><LText id="Configured LLM"/></option></select><small><LText id="Demo runs do not represent LLM results."/></small></label>}</>}
          {step === 3 && (
            <div className="formgrid">
              <label><LText id="Initial simulated capital ($)"/><input
                  id="capital"
                  type="number"
                  defaultValue={draft.capital || "100000"}
                />
              </label>
              <label><LText id="Maximum position weight (%)"/><input
                  id="weight"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={draft.weight || "25"}
                />
              </label>
              <label><LText id="Fee (basis points)"/><input
                  id="fees"
                  type="number"
                  defaultValue={draft.fees || "10"}
                />
              </label>
              <label><LText id="Slippage (basis points)"/><input
                  id="slippage"
                  type="number"
                  defaultValue={draft.slippage || "5"}
                />
              </label>
              {legacyTeam ? <label><LText id="Human oversight"/><select id="legacy_mode" defaultValue={draft.legacy_mode || "human_review"}><option value="human_review">{t("Review every proposed order")}</option><option value="ai_only">{t("AI only")}</option></select></label> : <p className="full notice">{t(labMode === "human_supervised" ? "four.reviewMode" : "four.autoMode")}</p>}
              <label><LText id="Maximum model calls"/><input
                  id="calls"
                  type="number"
                  defaultValue={draft.calls || "20"}
                />
              </label>
              <label><LText id="Budget (USD)"/><input
                  id="budget"
                  type="number"
                  defaultValue={draft.budget || "5"}
                />
              </label>
              {<>
                <label><LText id="Minimum cash weight (%)"/><input id="min_cash_weight" type="number" min="0" max="100" step="0.1" required defaultValue={draft.min_cash_weight ?? "0"}/></label>
                <label><LText id="Maximum gross target exposure (%)"/><input id="max_gross_weight" type="number" min="0" max="100" step="0.1" required defaultValue={draft.max_gross_weight ?? "100"}/></label>
                <label><LText id="Maximum L1 turnover (%)"/><input id="max_turnover" type="number" min="0" max="200" step="0.1" required defaultValue={draft.max_turnover ?? "200"}/><small><LText id="L1 turnover sums absolute asset-weight changes. Moving entirely between two assets can reach 200%."/></small></label>
                <p className="full muted"><LText id="Research workflow risk limits apply to this new experiment. Existing experiment configurations stay frozen."/></p>
              </>}
              <p className="full"><LText id="Simulated portfolios only. Approved orders queue for eligible next-session execution. Run configuration is frozen at launch."/> </p>
            </div>
          )}
          <div className="toolbar end">
            <Btn onClick={(e: any) => { if (step === 1) close(); else { captureForm(e.currentTarget.closest("form")); setStep(step - 1); } }}>
              {t(step === 1 ? "Cancel" : "Back")}
            </Btn>
            {step === 3 && !supported && <span className="error">{t("four.notReady")}</span>}
            <button className="primary" disabled={step === 3 && !supported}>
              {t(step === 3 ? "Launch experiment" : "Continue →")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function ExpertForm({ close, save }: any) {
  const { t } = useLocale();
  return (
    <div className="overlay">
      <div className="modal">
        <button className="x" aria-label={t("Close dialog")} onClick={close}>
          ×
        </button>
        <h2><LText id="Create expert card"/></h2>
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
          <label><LText id="Name"/><input id="exname" required />
          </label>
          <label><LText id="Default role"/><select id="exrole">
              <option value="Advisor"><LText id="Advisor"/></option>
              <option value="Trader"><LText id="Trader"/></option>
            </select>
          </label>
          <label><LText id="Horizon"/><input id="horizon" />
          </label>
          <label><LText id="Objective"/><textarea id="objective" required />
          </label>
          <label><LText id="Required data"/><input id="required_data" defaultValue="OHLCV" />
          </label>
          <label><LText id="Analysis instructions"/><textarea id="instructions" />
          </label>
          <label><LText id="Risk constraints"/><textarea id="risk_notes" />
          </label>
          <button className="primary"><LText id="Save version 1"/></button>
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
function formatMarketTime(input: string, locale: "en" | "zh-CN") {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return input;
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  return `${new Intl.DateTimeFormat(locale, { ...options, timeZone: "America/New_York" }).format(date)} ET / ${new Intl.DateTimeFormat(locale, { ...options, timeZone: "Asia/Shanghai" }).format(date)} ${locale === "en" ? "Beijing" : "北京时间"}`;
}
createRoot(document.getElementById("root")!).render(<LocaleProvider><AuthGate><App /></AuthGate></LocaleProvider>);
