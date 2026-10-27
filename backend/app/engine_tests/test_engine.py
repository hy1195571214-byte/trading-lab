import json
import math
import unittest

from backend.app.engine import (
    EngineError,
    advance_market,
    baseline_proposal,
    benchmark_report,
    create_state,
    performance_metrics,
    prepare_decision,
    record_decision,
    review_decision,
    schedule_team,
    visible_snapshot,
)


def bar(day, symbol="AAA", open_=100, close=100):
    return {
        "date": f"2025-01-{day:02d}",
        "symbol": symbol,
        "open": open_,
        "high": max(open_, close) * 1.01,
        "low": min(open_, close) * 0.99,
        "close": close,
        "volume": 1000,
    }


def config(**overrides):
    result = {
        "start_date": "2025-01-01",
        "end_date": "2025-01-31",
        "symbols": ["AAA"],
        "initial_capital": 1000,
        "fee_bps": 0,
        "slippage_bps": 0,
        "max_position_weight": 1,
        "mode": "ai_only",
    }
    result.update(overrides)
    return result


class EngineRuntimeTests(unittest.TestCase):
    def test_snapshot_excludes_future_bars_and_uses_current_close(self):
        bars = [bar(1, close=100), bar(2, open_=110, close=112), bar(3, open_=120, close=125)]
        state = create_state(config(), bars)
        advance_market(state, bars)
        snapshot = visible_snapshot(state, bars)
        self.assertEqual(snapshot["as_of_date"], "2025-01-01")
        self.assertEqual([item["date"] for item in snapshot["bars"]], ["2025-01-01"])
        self.assertEqual(snapshot["bars"][-1]["close"], 100)
        self.assertNotIn("2025-01-02", json.dumps(snapshot))

    def test_orders_fill_at_next_session_open(self):
        bars = [bar(1, close=100), bar(2, open_=110, close=111)]
        state = create_state(config(), bars)
        advance_market(state, bars)
        decision = record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}})
        order = state["orders"][0]
        self.assertEqual(order["status"], "queued")
        self.assertEqual(order["fills"], [])
        advance_market(state, bars)
        order = state["orders"][0]
        self.assertEqual(order["decision_id"], decision["id"])
        self.assertEqual(order["filled_date"], "2025-01-02")
        self.assertEqual(order["fills"][0]["open_price"], 110)
        self.assertAlmostEqual(state["positions"]["AAA"]["quantity"], 500 / 110)

    def test_fees_and_slippage_reduce_cash_and_equity(self):
        bars = [bar(1), bar(2, open_=10, close=10)]
        state = create_state(
            config(initial_capital=1000, fee_bps=100, slippage_bps=100, max_position_weight=0.5),
            bars,
        )
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}})
        advance_market(state, bars)
        fill = state["orders"][0]["fills"][0]
        self.assertAlmostEqual(fill["fill_price"], 10.1)
        self.assertAlmostEqual(fill["fees"], fill["quantity"] * 10.1 * 0.01)
        self.assertAlmostEqual(fill["slippage_cost"], fill["quantity"] * 0.1)
        self.assertAlmostEqual(state["fees_paid"], fill["fees"])
        self.assertAlmostEqual(state["slippage_paid"], fill["slippage_cost"])
        self.assertLess(state["equity"], 1000)
        self.assertEqual(state["orders"][0]["status"], "partially_filled")
        self.assertTrue(state["orders"][0]["settled"])
        self.assertEqual(
            state["orders"][0]["unfilled_symbols"]["AAA"]["reason"],
            "max_position_weight_after_aggregate_costs",
        )

    def test_aggregate_fees_cannot_push_multiple_positions_over_weight_cap(self):
        bars = [
            bar(1, "AAA", 10, 10),
            bar(1, "BBB", 10, 10),
            bar(2, "AAA", 10, 10),
            bar(2, "BBB", 10, 10),
        ]
        state = create_state(
            config(symbols=["AAA", "BBB"], fee_bps=100, slippage_bps=100, max_position_weight=0.5),
            bars,
        )
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5, "BBB": 0.5}})
        advance_market(state, bars)
        for symbol in ("AAA", "BBB"):
            marked_value = state["positions"][symbol]["quantity"] * 10
            self.assertLessEqual(marked_value / state["equity"], 0.5 + 1e-9)

    def test_sell_fills_before_buys_and_releases_cash(self):
        bars = [
            bar(1, "AAA", 10, 10),
            bar(1, "BBB", 10, 10),
            bar(2, "AAA", 10, 10),
            bar(2, "BBB", 10, 10),
            bar(3, "AAA", 10, 10),
            bar(3, "BBB", 10, 10),
        ]
        state = create_state(config(symbols=["AAA", "BBB"], max_position_weight=1), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 1.0}})
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"BBB": 1.0}})
        advance_market(state, bars)
        sides = [fill["side"] for fill in state["orders"][1]["fills"]]
        self.assertEqual(sides, ["sell", "buy"])
        self.assertNotIn("AAA", state["positions"])
        self.assertGreater(state["positions"]["BBB"]["quantity"], 0)

    def test_position_and_cash_limits_are_enforced(self):
        bars = [bar(1), bar(2, open_=10, close=10)]
        state = create_state(config(max_position_weight=0.25), bars)
        advance_market(state, bars)
        before = json.dumps(state, sort_keys=True)
        with self.assertRaises(EngineError) as raised:
            record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.3}})
        self.assertEqual(raised.exception.code, "position_limit")
        self.assertEqual(json.dumps(state, sort_keys=True), before)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.25}})
        advance_market(state, bars)
        self.assertLessEqual(state["positions"]["AAA"]["quantity"] * 10 / state["equity"], 0.25 + 1e-9)
        self.assertGreaterEqual(state["cash"], 0)

    def test_full_allocation_is_cash_limited_after_costs(self):
        bars = [bar(1), bar(2, open_=10, close=10)]
        state = create_state(config(fee_bps=50, slippage_bps=50), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 1.0}})
        advance_market(state, bars)
        self.assertGreaterEqual(state["cash"], -1e-8)
        self.assertLessEqual(state["positions"]["AAA"]["quantity"] * 10, 1000)
        self.assertEqual(state["orders"][0]["status"], "partially_filled")
        self.assertTrue(state["orders"][0]["settled"])
        self.assertEqual(state["orders"][0]["unfilled_symbols"]["AAA"]["reason"], "cash_limit")

    def test_cash_limited_buy_waits_for_pending_sell_in_missing_symbol(self):
        bars = [
            bar(1, "AAA", 10, 10),
            bar(1, "BBB", 10, 10),
            bar(2, "AAA", 10, 10),
            bar(2, "BBB", 10, 10),
            bar(3, "BBB", 10, 10),
            bar(4, "AAA", 10, 10),
            bar(4, "BBB", 10, 10),
        ]
        state = create_state(config(symbols=["AAA", "BBB"], max_position_weight=1), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 1.0}})
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"BBB": 1.0}})
        advance_market(state, bars)
        order = state["orders"][0]
        new_order = state["orders"][1]
        self.assertEqual(new_order["status"], "queued")
        self.assertFalse(new_order["settled"])
        self.assertEqual(new_order["pending_symbols"], ["AAA"])
        self.assertNotIn("BBB", new_order["processed_symbols"])
        self.assertEqual(new_order["fills"], [])
        self.assertEqual(new_order["unfilled_symbols"]["BBB"]["reason"], "cash_limit")
        advance_market(state, bars)
        new_order = state["orders"][1]
        self.assertEqual(new_order["status"], "filled")
        self.assertTrue(new_order["settled"])
        self.assertNotIn("AAA", state["positions"])
        self.assertIn("BBB", state["positions"])

    def test_missing_bar_waits_without_fabricating_price(self):
        bars = [
            bar(1, "AAA", 10, 10),
            bar(1, "BBB", 20, 20),
            bar(2, "BBB", 21, 21),
            bar(3, "AAA", 11, 11),
            bar(3, "BBB", 22, 22),
        ]
        state = create_state(config(symbols=["AAA", "BBB"], max_position_weight=0.5), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5, "BBB": 0.5}})
        advance_market(state, bars)
        order = state["orders"][0]
        self.assertEqual(order["status"], "partially_filled")
        self.assertEqual(order["pending_symbols"], ["AAA"])
        self.assertNotIn("AAA", state["positions"])
        self.assertEqual(state["history"][-1]["missing_symbols"], ["AAA"])
        advance_market(state, bars)
        order = state["orders"][0]
        self.assertEqual(order["status"], "partially_filled")
        self.assertTrue(order["settled"])
        self.assertEqual(order["closed_date"], "2025-01-03")
        self.assertEqual(order["unfilled_symbols"]["AAA"]["reason"], "cash_limit")
        self.assertIn("AAA", state["positions"])

    def test_missing_held_symbol_uses_stale_mark_and_cannot_be_sold(self):
        bars = [
            bar(1, "AAA", 10, 10),
            bar(1, "BBB", 20, 20),
            bar(2, "AAA", 10, 30),
            bar(2, "BBB", 20, 20),
            bar(3, "BBB", 21, 21),
        ]
        state = create_state(config(symbols=["AAA", "BBB"], max_position_weight=0.5), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}})
        advance_market(state, bars)
        self.assertAlmostEqual(state["positions"]["AAA"]["last_price"], 30)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.0}})
        advance_market(state, bars)
        self.assertIn("AAA", state["positions"])
        self.assertEqual(state["positions"]["AAA"]["last_price"], 30)
        self.assertEqual(state["positions"]["AAA"]["last_price_date"], "2025-01-02")
        stale_mark = state["history"][-1]["positions"]["AAA"]
        self.assertTrue(stale_mark["is_stale"])
        self.assertEqual(stale_mark["price_date"], "2025-01-02")
        self.assertTrue(visible_snapshot(state, bars)["positions"]["AAA"]["is_stale"])
        self.assertEqual(state["orders"][1]["status"], "pending_final_session")
        self.assertTrue(
            any(event["type"] == "position_limit_unenforceable_missing_bar" for event in state["events"])
        )

    def test_sell_cost_correction_keeps_position_under_cap_at_open(self):
        bars = [bar(1, "AAA", 10, 10), bar(2, "AAA", 10, 20), bar(3, "AAA", 20, 20)]
        state = create_state(config(fee_bps=100, slippage_bps=100, max_position_weight=0.5), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}})
        advance_market(state, bars)
        self.assertGreater(state["history"][-1]["positions"]["AAA"]["weight"], 0.5)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}})
        advance_market(state, bars)
        open_marked_value = state["positions"]["AAA"]["quantity"] * 20
        # Close is the same as open for this bar, so the open-time constraint
        # can be checked directly against the recorded close equity.
        self.assertLessEqual(open_marked_value / state["equity"], 0.5 + 1e-9)
        self.assertTrue(
            any(fill.get("reason") == "max_position_weight_correction" for fill in state["orders"][1]["fills"])
        )

    def test_later_hold_cancels_unfilled_remainder_of_missing_bar_order(self):
        bars = [
            bar(1, "AAA", 10, 10),
            bar(1, "BBB", 20, 20),
            bar(2, "BBB", 21, 21),
            bar(3, "AAA", 11, 11),
            bar(3, "BBB", 22, 22),
        ]
        state = create_state(config(symbols=["AAA", "BBB"], max_position_weight=0.5), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5, "BBB": 0.5}})
        advance_market(state, bars)
        old_order_id = state["orders"][0]["id"]
        self.assertEqual(state["orders"][0]["status"], "partially_filled")
        # HOLD is an accepted full decision that preserves the current ledger;
        # the old unfilled AAA remainder must not trade on a later date.
        record_decision(state, {"action": "hold", "strategy": "agent"})
        self.assertEqual(state["orders"][0]["status"], "cancelled")
        self.assertEqual(state["orders"][0]["cancel_reason"], "superseded_by_new_decision")
        advance_market(state, bars)
        self.assertEqual(state["orders"][0]["id"], old_order_id)
        self.assertNotIn("AAA", state["positions"])
        self.assertTrue(any(event["type"] == "order_remainder_cancelled" for event in state["events"]))

    def test_final_session_close_order_remains_pending(self):
        bars = [bar(1), bar(2, open_=101, close=102)]
        state = create_state(config(), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}})
        advance_market(state, bars)
        self.assertTrue(state["is_final_session"])
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.0}})
        self.assertEqual(state["orders"][-1]["status"], "pending_final_session")
        self.assertTrue(any(event["type"] == "final_session_order_pending" for event in state["events"]))
        self.assertEqual(state["status"], "completed")

    def test_review_is_idempotent_and_keeps_original_proposal(self):
        bars = [bar(1), bar(2)]
        state = create_state(config(mode="human_review"), bars)
        advance_market(state, bars)
        proposal = {"action": "rebalance", "targets": {"AAA": 0.4}, "rationale": "visible evidence"}
        original_copy = json.loads(json.dumps(proposal))
        decision = record_decision(state, proposal)
        self.assertEqual(state["status"], "awaiting_review")
        with self.assertRaises(EngineError) as raised:
            advance_market(state, bars)
        self.assertEqual(raised.exception.code, "review_pending")
        reviewed = review_decision(state, decision["id"], "approve")
        repeat = review_decision(state, decision["id"], "approve")
        self.assertEqual(reviewed, repeat)
        self.assertEqual(reviewed["original_proposal"], original_copy)
        self.assertEqual(reviewed["final_proposal"]["targets"]["AAA"], 0.4)
        self.assertEqual(len(state["orders"]), 1)
        with self.assertRaises(EngineError) as conflict:
            review_decision(state, decision["id"], "reject", "changed mind")
        self.assertEqual(conflict.exception.code, "decision_already_reviewed")

    def test_modify_and_reject_require_reasons(self):
        bars = [bar(1), bar(2)]
        state = create_state(config(mode="human_review"), bars)
        advance_market(state, bars)
        first = record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.4}})
        with self.assertRaises(EngineError) as reason_error:
            review_decision(state, first["id"], "modify", targets={"AAA": 0.2})
        self.assertEqual(reason_error.exception.code, "reason_required")
        modified = review_decision(state, first["id"], "modify", "reduce exposure", {"AAA": 0.2})
        self.assertEqual(modified["original_proposal"]["targets"]["AAA"], 0.4)
        self.assertEqual(modified["final_proposal"]["targets"]["AAA"], 0.2)
        state2 = create_state(config(mode="human_review"), bars)
        advance_market(state2, bars)
        rejected = record_decision(state2, {"action": "rebalance", "targets": {"AAA": 0.4}})
        with self.assertRaises(EngineError) as reject_error:
            review_decision(state2, rejected["id"], "reject")
        self.assertEqual(reject_error.exception.code, "reason_required")
        decision = review_decision(state2, rejected["id"], "reject", "risk is unclear")
        self.assertEqual(decision["status"], "rejected")
        self.assertEqual(state2["orders"], [])

    def test_team_change_activates_at_next_decision_boundary(self):
        bars = [bar(1), bar(2), bar(3)]
        old_team = [{"expert_id": "momentum", "role": "trader"}]
        new_team = [{"expert_id": "risk", "role": "advisor", "enabled": True}]
        state = create_state(config(team=old_team), bars)
        advance_market(state, bars)
        schedule_team(state, new_team)
        self.assertEqual(state["active_team"][0]["expert_id"], old_team[0]["expert_id"])
        advance_market(state, bars)
        prepare_decision(state)
        # This is the team the backend must use to build its expert call.
        self.assertEqual(state["active_team"][0]["expert_id"], new_team[0]["expert_id"])
        event_count = sum(event["type"] == "team_activated" for event in state["events"])
        prepare_decision(state)  # same-date retry after an LLM failure is safe
        self.assertEqual(sum(event["type"] == "team_activated" for event in state["events"]), event_count)
        decision = record_decision(state, {"action": "hold", "strategy": "agent"})
        self.assertEqual(state["active_team"][0]["expert_id"], new_team[0]["expert_id"])
        self.assertEqual(decision["team_snapshot"], state["active_team"])
        self.assertTrue(any(event["type"] == "team_activated" for event in state["events"]))

    def test_final_missing_order_is_marked_pending_and_preserved_after_final_review(self):
        bars = [bar(1, "AAA", 10, 10), bar(1, "BBB", 20, 20), bar(2, "BBB", 21, 21)]
        state = create_state(config(symbols=["AAA", "BBB"], mode="human_review", max_position_weight=0.5), bars)
        advance_market(state, bars)
        first = record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5, "BBB": 0.5}})
        review_decision(state, first["id"], "approve")
        advance_market(state, bars)
        old_order = state["orders"][0]
        self.assertEqual(old_order["status"], "pending_final_session")
        self.assertEqual(old_order["pending_symbols"], ["AAA"])
        final = record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.0, "BBB": 0.0}})
        self.assertEqual(state["orders"][0]["status"], "pending_final_session")
        review_decision(state, final["id"], "approve")
        self.assertEqual(state["status"], "completed")
        self.assertEqual(state["orders"][0]["status"], "cancelled")
        self.assertEqual(state["orders"][1]["status"], "pending_final_session")

    def test_discard_team_policy_supersedes_pending_review(self):
        bars = [bar(1), bar(2)]
        state = create_state(config(mode="human_review"), bars)
        advance_market(state, bars)
        decision = record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.4}})
        event = schedule_team(state, [{"expert_id": "risk", "role": "trader"}], pending_policy="discard")
        self.assertEqual(event["details"]["discarded_decisions"], [decision["id"]])
        self.assertEqual(state["decisions"][0]["status"], "superseded")
        self.assertEqual(state["status"], "ready")

    def test_metrics_report_returns_risk_costs_and_drawdown(self):
        bars = [bar(1, close=100), bar(2, open_=100, close=110), bar(3, open_=110, close=90)]
        state = create_state(config(initial_capital=1000, max_position_weight=1), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 1.0}})
        advance_market(state, bars)
        advance_market(state, bars)
        metrics = performance_metrics(state)
        self.assertAlmostEqual(metrics["total_return"], -0.1)
        self.assertAlmostEqual(metrics["max_drawdown"], 900 / 1100 - 1)
        self.assertEqual(metrics["sessions"], 3)
        self.assertEqual(metrics["return_convention"].split(";")[0], "close-to-close daily equity returns")
        self.assertTrue(math.isfinite(metrics["sharpe_ratio"]))

    def test_zero_volatility_has_null_sharpe_not_a_fabricated_zero_ratio(self):
        bars = [bar(1), bar(2), bar(3)]
        state = create_state(config(), bars)
        for _ in range(3):
            advance_market(state, bars)
        metrics = performance_metrics(state)
        self.assertEqual(metrics["annualized_volatility"], 0.0)
        self.assertIsNone(metrics["sharpe_ratio"])
        self.assertIn("Sharpe is null", metrics["return_convention"])

    def test_benchmark_replays_buy_hold_only_through_experiment_asof(self):
        bars = [
            bar(1, "AAA", 10, 10),
            bar(1, "BBB", 20, 20),
            bar(2, "AAA", 11, 12),
            bar(2, "BBB", 20, 18),
            bar(3, "AAA", 50, 60),
            bar(3, "BBB", 1, 1),
        ]
        state = create_state(
            config(symbols=["AAA", "BBB"], fee_bps=10, slippage_bps=5, max_position_weight=0.5),
            bars,
        )
        advance_market(state, bars)
        advance_market(state, bars)
        before = json.dumps(state, sort_keys=True)
        report = benchmark_report(state, bars)
        self.assertEqual(report["as_of_date"], "2025-01-02")
        self.assertTrue(report["available"])
        self.assertEqual(len(report["history"]), 2)
        self.assertEqual(report["history"][-1]["date"], "2025-01-02")
        self.assertEqual(report["metrics"]["sessions"], 2)
        self.assertLess(report["metrics"]["final_equity"], 1000)
        self.assertNotIn("2025-01-03", json.dumps(report))
        self.assertEqual(json.dumps(state, sort_keys=True), before)

    def test_benchmark_is_unavailable_before_first_market_session(self):
        bars = [bar(1), bar(2)]
        state = create_state(config(), bars)
        report = benchmark_report(state, bars)
        self.assertFalse(report["available"])
        self.assertIsNone(report["metrics"])
        self.assertEqual(report["history"], [])

    def test_invalid_model_proposal_is_atomic(self):
        bars = [bar(1), bar(2)]
        state = create_state(config(), bars)
        advance_market(state, bars)
        before = json.dumps(state, sort_keys=True)
        for proposal in (
            {"action": "buy", "targets": {"AAA": 0.5}},
            {"action": "rebalance", "targets": {"UNKNOWN": 0.5}},
            {"action": "rebalance", "targets": {"AAA": float("nan")}},
            {"action": "hold", "targets": {"AAA": 0.1}},
        ):
            with self.assertRaises(EngineError):
                record_decision(state, proposal)
            self.assertEqual(json.dumps(state, sort_keys=True), before)

    def test_same_session_rejects_a_second_decision_without_new_order(self):
        bars = [bar(1), bar(2)]
        state = create_state(config(), bars)
        advance_market(state, bars)
        record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}})
        before_orders = len(state["orders"])
        with self.assertRaises(EngineError) as raised:
            record_decision(state, {"action": "hold"})
        self.assertEqual(raised.exception.code, "decision_exists_for_session")
        self.assertEqual(len(state["orders"]), before_orders)

    def test_experiments_are_isolated_and_config_secrets_are_not_copied(self):
        bars = [bar(1), bar(2)]
        first = create_state(config(api_key="never-copy-this", dataset_id="data-1"), bars)
        second = create_state(config(dataset_id="data-1"), bars)
        advance_market(first, bars)
        proposal = {"action": "rebalance", "targets": {"AAA": 0.25}, "rationale": "test"}
        decision = record_decision(first, proposal)
        proposal["rationale"] = "mutated outside"
        decision["original_proposal"]["rationale"] = "mutated return value"
        self.assertEqual(first["decisions"][0]["original_proposal"]["rationale"], "test")
        self.assertIsNone(second["current_date"])
        self.assertEqual(second["cash"], 1000)
        serialized = json.dumps(first)
        self.assertNotIn("never-copy-this", serialized)
        self.assertNotIn("api_key", serialized)

    def test_changed_bars_are_rejected(self):
        original = [bar(1), bar(2)]
        state = create_state(config(), original)
        changed = [bar(1), bar(2, open_=101, close=101)]
        with self.assertRaises(EngineError) as raised:
            advance_market(state, changed)
        self.assertEqual(raised.exception.code, "data_snapshot_mismatch")
        self.assertIsNone(state["current_date"])

    def test_momentum_uses_only_visible_history(self):
        bars = [bar(1, "AAA", 10, 10), bar(2, "AAA", 11, 11), bar(3, "AAA", 12, 12)]
        state = create_state(config(momentum_lookback=1), bars)
        advance_market(state, bars)
        advance_market(state, bars)
        snapshot = visible_snapshot(state, bars)
        proposal = baseline_proposal(state, snapshot, "momentum")
        self.assertEqual(proposal["targets"], {"AAA": 1.0})
        self.assertAlmostEqual(proposal["momentum_scores"]["AAA"], 0.1)
        injected = dict(snapshot)
        injected["bars"] = snapshot["bars"] + [bar(3, "AAA", 12, 1000)]
        with self.assertRaises(EngineError):
            baseline_proposal(state, injected, "momentum")


if __name__ == "__main__":
    unittest.main()
