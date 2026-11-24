import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  atOrBeforeAsOf,
  currentPendingDecision,
  decisionVisibleAt,
  fillAvailableAt,
  fillBelongsToHistoryPoint,
  fillVisibleAt,
  historyAsOf,
  historyKeyAtOrAfter,
  historyVisibleAt,
  orderVisibleAt,
  replayDateOf,
  replayFillSourceTime,
  responseMatchesSelection,
  reviewVisibleAt,
} from "../src/replayData.ts";

const vite = await createServer({ configFile: false, root: resolve(dirname(fileURLToPath(import.meta.url)), ".."), server: { middlewareMode: true }, appType: "custom" });
const { visibleBarsAt, chartBarIndexForSource } = await vite.ssrLoadModule("/src/chartData.ts");
test.after(() => vite.close());

const delayedBar = {
  symbol: "AAPL",
  bar_start: "2026-11-09T14:30:00Z",
  bar_end: "2026-11-09T14:31:00Z",
  available_at: "2026-11-09T14:35:00Z",
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 100,
};
const laterBar = {
  ...delayedBar,
  bar_start: "2026-11-09T14:31:00Z",
  bar_end: "2026-11-09T14:32:00Z",
  available_at: "2026-11-09T14:36:00Z",
};
const history = [
  { timestamp: delayedBar.bar_end, bar_end: delayedBar.bar_end, as_of_time: delayedBar.available_at, equity: 10_000 },
  { timestamp: laterBar.bar_end, bar_end: laterBar.bar_end, as_of_time: laterBar.available_at, equity: 10_001 },
];

test("market and account history use snapshot availability, not bar event time", () => {
  const cutoff = "2026-11-09T14:35:00Z";
  assert.deepEqual(visibleBarsAt([delayedBar, laterBar], cutoff).map((bar) => bar.bar_end), [delayedBar.bar_end]);
  assert.equal(historyAsOf(history[0]), cutoff);
  assert.equal(historyVisibleAt(history[0], cutoff), true);
  assert.equal(historyVisibleAt(history[1], cutoff), false);
  assert.equal(replayDateOf(history[0]), delayedBar.bar_end);
});

test("date-only cutoff does not expose same-day timestamped market bars", () => {
  assert.equal(atOrBeforeAsOf("2026-11-09T21:00:00Z", "2026-11-09"), false);
  assert.equal(atOrBeforeAsOf("2026-11-08T21:00:00Z", "2026-11-09"), true);
});

test("current pending stays actionable while late completion stays out of historical view", () => {
  const proposal = {
    id: "decision-1",
    as_of_time: delayedBar.available_at,
    decision_completed_at: "2026-11-09T14:35:30Z",
    status: "awaiting_review",
  };
  const cutoff = delayedBar.available_at;
  assert.equal(decisionVisibleAt(proposal, cutoff), false);
  assert.equal(currentPendingDecision([proposal]), proposal);
  assert.equal(decisionVisibleAt(proposal, proposal.decision_completed_at), true);
});

test("review, queued order, and fill become visible only at their own availability clocks", () => {
  const cutoff = delayedBar.available_at;
  const proposal = { id: "decision-1", status: "approved", review: { action: "approve", reviewed_at: "2026-11-09T14:36:00Z" } };
  const events = [{ type: "decision_reviewed", decision_id: proposal.id, timestamp: proposal.review.reviewed_at }];
  assert.equal(reviewVisibleAt(proposal, events, cutoff), false);
  assert.equal(reviewVisibleAt(proposal, events, proposal.review.reviewed_at), true);

  const order = { id: "order-1", submitted_at: "2026-11-09T14:36:00Z", status: "queued" };
  assert.equal(orderVisibleAt(order, cutoff), false);
  assert.equal(orderVisibleAt(order, order.submitted_at), true);

  const fill = { fill_at: "2026-11-09T14:36:00Z", source_bar_end: delayedBar.bar_end, symbol: "AAPL" };
  assert.equal(fillVisibleAt(fill, cutoff), false);
  assert.equal(fillVisibleAt(fill, fill.fill_at), true);
  assert.equal(replayFillSourceTime(fill), delayedBar.bar_end);
  assert.equal(chartBarIndexForSource([delayedBar], "AAPL", replayFillSourceTime(fill)), 0);
});

test("fill marker navigation advances to the first saved snapshot that includes the fill", () => {
  const key = historyKeyAtOrAfter(history, "2026-11-09T14:35:30Z");
  assert.equal(key, laterBar.bar_end);
});

test("a late live fill is listed at its first containing history point even when neither time equals the point key", () => {
  const fill = { fill_at: "2026-11-09T14:35:30Z", source_bar_end: "2026-11-09T14:31:00Z", symbol: "AAPL" };
  const selectedKey = historyKeyAtOrAfter(history, fill.fill_at);
  assert.equal(selectedKey, "2026-11-09T14:32:00Z");
  assert.notEqual(fill.source_bar_end, selectedKey);
  assert.notEqual(fill.fill_at, selectedKey);
  assert.equal(fillVisibleAt(fill, "2026-11-09T14:36:00Z"), true);
  assert.equal(fillBelongsToHistoryPoint(fill, selectedKey, history), true);
  assert.equal(fillBelongsToHistoryPoint(fill, "2026-11-09T14:31:00Z", history), false);
});

test("a live fill waits for its source bar observation before appearing in history", () => {
  const firstSnapshot = { timestamp: "2026-11-09T14:31:00Z", bar_end: "2026-11-09T14:31:00Z", as_of_time: "2026-11-09T14:35:00Z", cash: 10_000, positions: [] };
  const nextSnapshot = { timestamp: "2026-11-09T14:32:00Z", bar_end: "2026-11-09T14:32:00Z", as_of_time: "2026-11-09T14:36:00Z", cash: 9_900, positions: [{ symbol: "AAPL" }] };
  const snapshots = [firstSnapshot, nextSnapshot];
  const fill = {
    fill_at: "2026-11-09T14:35:00Z",
    source_bar_start: "2026-11-09T14:35:00Z",
    source_bar_end: "2026-11-09T14:36:00Z",
    bar_observed_at: "2026-11-09T14:36:00Z",
    symbol: "AAPL",
  };
  assert.equal(fillAvailableAt(fill), "2026-11-09T14:36:00Z");
  assert.equal(fillVisibleAt(fill, firstSnapshot.as_of_time), false);
  assert.equal(fillBelongsToHistoryPoint(fill, firstSnapshot.bar_end, snapshots), false);
  const visibleKey = historyKeyAtOrAfter(snapshots, fillAvailableAt(fill));
  assert.equal(visibleKey, nextSnapshot.bar_end);
  assert.equal(fillVisibleAt(fill, nextSnapshot.as_of_time), true);
  assert.equal(fillBelongsToHistoryPoint(fill, visibleKey, snapshots), true);
  assert.equal(fill.fill_at, "2026-11-09T14:35:00Z");
});

test("stale A detail response cannot replace selected and rendered B", () => {
  const rendered = { id: "B", name: "B detail" };
  const staleA = { id: "A", name: "A detail" };
  const currentB = { id: "B", name: "B refreshed" };
  assert.equal(responseMatchesSelection("A", "B", staleA), false);
  assert.equal(responseMatchesSelection("B", "B", currentB), true);
  const afterLateResponse = responseMatchesSelection("A", "B", staleA) ? staleA : rendered;
  assert.equal(afterLateResponse.id, "B");
});

test('analysis visibility uses simulated completion time and the New York daily close', async () => {
  const { analysisVisibleAt } = await import('../src/replayData.ts');
  assert.equal(analysisVisibleAt('2023-01-03T21:00:00Z', '2023-01-03'), true);
  assert.equal(analysisVisibleAt('2023-01-03T21:00:01Z', '2023-01-03'), false);
  assert.equal(analysisVisibleAt('2023-07-03T20:00:00Z', '2023-07-03'), true);
  assert.equal(analysisVisibleAt('2023-07-03T20:00:00.001Z', '2023-07-03'), false);
  assert.equal(analysisVisibleAt('2023-01-04T14:30:01Z', '2023-01-04T14:30:00Z'), false);
  assert.equal(analysisVisibleAt('', '2023-01-03'), false);
  assert.equal(analysisVisibleAt('2023-01-03T21:00:00Z', ''), false);
});
