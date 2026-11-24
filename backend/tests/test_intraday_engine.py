from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone

import pytest

from backend.app import intraday_engine as engine


UTC = timezone.utc
BASE = datetime(2026, 11, 9, 14, 30, tzinfo=UTC)


def iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def bar(
    minute: int,
    symbol: str = "AAA",
    *,
    open_price: float = 100.0,
    close: float | None = None,
    available_at: datetime | None = None,
    received_at: datetime | None = None,
    revision: int = 0,
    complete: bool = True,
) -> dict:
    start = BASE + timedelta(minutes=minute)
    end = start + timedelta(minutes=1)
    close = open_price if close is None else close
    return {
        "event_id": f"{symbol}-{minute}-r{revision}",
        "revision": revision,
        "symbol": symbol,
        "bar_start": iso(start),
        "bar_end": iso(end),
        "available_at": iso(available_at or end),
        "received_at": iso(received_at or available_at or end),
        "timeframe": "1m",
        "source_feed": "test-iex",
        "open": open_price,
        "high": max(open_price, close) + 1,
        "low": min(open_price, close) - 1,
        "close": close,
        "volume": 1000,
        "is_complete": complete,
    }


def config(**overrides) -> dict:
    value = {
        "schema_version": 2,
        "market_mode": "historical",
        "bar_interval": "1m",
        "decision_interval": "1m",
        "holding_horizon": "4m",
        "latency_assumptions": {"simulated_latency_ms": 0},
        "symbols": ["AAA"],
        "initial_capital": 10_000,
        "fee_bps": 10,
        "slippage_bps": 10,
        "max_position_weight": 0.5,
        "mode": "ai_only",
        "momentum_lookback": 2,
        "team": [],
    }
    value.update(overrides)
    return value


def advance(state: dict, rows: list[dict], *, at: datetime | None = None, final: bool = False) -> dict:
    as_of = at or max(datetime.fromisoformat(row["available_at"].replace("Z", "+00:00")) for row in rows)
    return engine.advance_market(state, rows, as_of=iso(as_of), final=final)


def staggered_positions() -> tuple[dict, dict[int, list[dict]]]:
    rows = {minute: [bar(minute, symbol, open_price=100 + minute) for symbol in ("AAA", "BBB")] for minute in range(8)}
    all_bars = [row for minute_rows in rows.values() for row in minute_rows]
    state = engine.create_state(
        config(symbols=["AAA", "BBB"], fee_bps=20, slippage_bps=10, max_position_weight=0.5),
        all_bars,
    )
    state = advance(state, rows[0])
    engine.record_decision(
        state,
        {"action": "rebalance", "targets": {"AAA": 0.5}},
        decision_started_at=rows[0][0]["bar_end"],
        decision_completed_at=rows[0][0]["bar_end"],
    )
    state = advance(state, rows[1])
    state = advance(state, rows[2])
    engine.record_decision(
        state,
        {"action": "rebalance", "targets": {"AAA": 0.25, "BBB": 0.25}},
        decision_started_at=rows[2][0]["bar_end"],
        decision_completed_at=rows[2][0]["bar_end"],
    )
    state = advance(state, rows[3])
    return state, rows


def test_minute_cadence_and_eight_bar_historical_replay():
    rows = [bar(i, open_price=100 + i, close=100 + i) for i in range(8)]
    state = engine.create_state(config(decision_interval="2m", holding_horizon="3m"), rows)
    for i, row in enumerate(rows):
        state = advance(state, [row], final=i == len(rows) - 1)
        if engine.needs_decision(state):
            engine.prepare_decision(state)
            engine.record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}}, decision_started_at=state["current_time"], decision_completed_at=state["current_time"])
    assert state["status"] == "completed"
    assert len(state["history"]) == 8
    assert len(state["decisions"]) <= 5
    assert state["orders"][0]["status"] == "filled"
    assert state["orders"][0]["fills"][0]["execution_price_rule"] == "next_eligible_open"


def test_historical_latency_skips_open_before_model_completion_and_charges_costs():
    rows = [bar(i, open_price=100 + i, close=101 + i) for i in range(4)]
    state = engine.create_state(config(), rows)
    state = advance(state, [rows[0]])
    decision = engine.record_decision(
        state,
        {"action": "rebalance", "targets": {"AAA": 0.5}},
        decision_started_at=rows[0]["bar_end"],
        decision_completed_at=iso(BASE + timedelta(minutes=1, seconds=30)),
    )
    assert decision["input_event_ids"] == [rows[0]["event_id"]]
    state = advance(state, [rows[1]])
    assert state["orders"][0]["status"] == "queued"  # 14:32 open is before completion.
    state = advance(state, [rows[2]])
    order = state["orders"][0]
    assert order["status"] == "filled"
    fill = order["fills"][0]
    assert fill["fill_at"] == rows[2]["bar_start"]
    assert fill["source_bar_start"] == rows[2]["bar_start"]
    assert fill["source_bar_end"] == rows[2]["bar_end"]
    assert fill["open_or_close_price"] == rows[2]["open"]
    assert state["fees_paid"] > 0
    assert state["slippage_paid"] > 0
    assert state["cash"] >= 0
    weight = order["target_weights_executed"]["AAA"]
    assert weight <= 0.5 + 1e-8


def test_future_incomplete_and_revised_bars_are_point_in_time_and_idempotent():
    first = bar(0, close=101)
    future = bar(1, close=103)
    state = engine.create_state(config(), [first, future])
    state = engine.advance_market(state, [first, future], as_of=first["bar_end"])
    snapshot = engine.visible_snapshot(state)
    assert [row["event_id"] for row in snapshot["bars"]] == [first["event_id"]]
    assert len(state["bar_events"]) == 1
    retry = copy.deepcopy(first)
    retry["received_at"] = iso(BASE + timedelta(minutes=4))
    assert engine.advance_market(state, [retry], as_of=first["bar_end"])["bar_events"] == state["bar_events"]
    changed_availability = copy.deepcopy(first)
    changed_availability["available_at"] = iso(BASE + timedelta(minutes=1, seconds=10))
    changed_availability["received_at"] = changed_availability["available_at"]
    with pytest.raises(engine.IntradayEngineError, match="different contents"):
        engine.advance_market(state, [changed_availability], as_of=changed_availability["available_at"])
    engine.record_decision(state, {"action": "hold"}, decision_started_at=first["bar_end"], decision_completed_at=first["bar_end"])

    incomplete = bar(1, available_at=BASE + timedelta(minutes=1, seconds=10), complete=False)
    state = engine.advance_market(state, [incomplete], as_of=iso(BASE + timedelta(minutes=1, seconds=20)))
    snapshot = engine.visible_snapshot(state)
    assert all(row["event_id"] != incomplete["event_id"] for row in snapshot["bars"])
    assert snapshot["forming_bars"][0]["is_complete"] is False
    assert not engine.needs_decision(state)  # the forming bar cannot satisfy the next boundary.

    corrected = bar(0, close=102, revision=1, available_at=BASE + timedelta(minutes=2))
    state = engine.advance_market(state, [corrected], as_of=corrected["available_at"])
    revised = engine.visible_snapshot(state)
    selected = next(row for row in revised["bars"] if row["bar_start"] == first["bar_start"])
    assert selected["close"] == 102
    same_id_different_payload = copy.deepcopy(corrected)
    same_id_different_payload["close"] = 105
    same_id_different_payload["high"] = 106
    with pytest.raises(engine.IntradayEngineError, match="different contents"):
        engine.advance_market(state, [same_id_different_payload], as_of=corrected["available_at"])


def test_naive_timestamps_are_rejected():
    row = bar(0)
    row["bar_start"] = "2026-11-09T14:30:00"
    state = engine.create_state(config(), [bar(0)])
    with pytest.raises(engine.IntradayEngineError, match="timezone offset"):
        engine.advance_market(state, [row], as_of=bar(0)["bar_end"])


def test_intraday_history_is_post_fill_and_asof_snapshot_does_not_leak_later_positions():
    rows = [bar(i, open_price=100 + i, close=100 + i) for i in range(4)]
    state = engine.create_state(config(), rows)
    state = advance(state, [rows[0]])
    engine.record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}}, decision_started_at=rows[0]["bar_end"], decision_completed_at=rows[0]["bar_end"])
    state = advance(state, [rows[1]])
    assert state["positions"]["AAA"]["quantity"] > 0
    filled_snapshot = engine.visible_snapshot(state, as_of=rows[1]["bar_end"])
    assert filled_snapshot["positions"]["AAA"]["quantity"] > 0
    state = advance(state, [rows[2]])
    past = engine.visible_snapshot(state, as_of=rows[1]["bar_end"])
    assert past["equity"] == filled_snapshot["equity"]
    assert past["positions"] == filled_snapshot["positions"]
    assert len(past["history"]) == 2
    assert past["history"][-1]["bar_end"] == rows[1]["bar_end"]


def test_live_multi_symbol_fill_waits_for_fresh_same_boundary_bars_and_never_backdates():
    live = config(market_mode="live", symbols=["AAA", "BBB"], holding_horizon="1h")
    state = engine.create_state(live)
    a0 = bar(0, "AAA", received_at=BASE + timedelta(minutes=1, seconds=2))
    b0 = bar(0, "BBB", received_at=BASE + timedelta(minutes=1, seconds=3))
    state = engine.advance_market(state, [a0], as_of=a0["received_at"])
    state = engine.advance_market(state, [b0], as_of=b0["received_at"])
    start = iso(BASE + timedelta(minutes=1, seconds=3))
    engine.prepare_decision(state, decision_started_at=start)
    engine.record_decision(
        state,
        {"action": "rebalance", "targets": {"AAA": 0.25, "BBB": 0.25}},
        decision_started_at=start,
        decision_completed_at=iso(BASE + timedelta(minutes=1, seconds=5)),
    )
    a1 = bar(1, "AAA", open_price=101, close=102, received_at=BASE + timedelta(minutes=2, seconds=2))
    b1 = bar(1, "BBB", open_price=201, close=202, received_at=BASE + timedelta(minutes=2, seconds=4))
    state = engine.advance_market(state, [a1], as_of=a1["received_at"])
    assert state["orders"][0]["status"] == "queued"
    state = engine.advance_market(state, [b1], as_of=b1["received_at"])
    order = state["orders"][0]
    assert order["status"] == "filled"
    assert order["execution_price_rule"] == "next_observed_close"
    assert order["filled_at"] == b1["received_at"]
    assert order["filled_at"] > order["submitted_at"]
    assert {fill["source_bar_end"] for fill in order["fills"]} == {a1["bar_end"], b1["bar_end"]}
    assert {fill["price_time"] for fill in order["fills"]} == {a1["bar_end"], b1["bar_end"]}
    assert {fill["open_or_close_price"] for fill in order["fills"]} == {102.0, 202.0}
    assert all(fill["price"] > fill["open_or_close_price"] for fill in order["fills"])


def test_live_old_completed_bar_is_stale_even_when_received_recently():
    state = engine.create_state(config(market_mode="live"))
    first = bar(0, received_at=BASE + timedelta(minutes=1, seconds=1))
    state = engine.advance_market(state, [first], as_of=first["received_at"])
    started = first["received_at"]
    engine.record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}}, decision_started_at=started, decision_completed_at=iso(BASE + timedelta(minutes=1, seconds=2)))
    old = bar(1, open_price=101, close=102, received_at=BASE + timedelta(minutes=5))
    state = engine.advance_market(state, [old], as_of=old["received_at"])
    assert state["orders"][0]["status"] == "queued"
    assert any(item["type"] == "stale_bar_skipped_for_fill" for item in state["events"])


def test_live_retry_ignores_only_adapter_derived_arrival_clock():
    state = engine.create_state(config(market_mode="live"))
    first = bar(0)
    arrival = BASE + timedelta(minutes=1, seconds=2)
    first["available_at"] = iso(arrival)
    first["received_at"] = iso(arrival)
    state = engine.advance_market(state, [first], as_of=iso(arrival))
    retry = copy.deepcopy(first)
    retry_arrival = arrival + timedelta(seconds=5)
    retry["available_at"] = iso(retry_arrival)
    retry["received_at"] = iso(retry_arrival)
    state = engine.advance_market(state, [retry], as_of=iso(retry_arrival))
    assert len(state["bar_events"]) == 1
    assert state["bar_events"][0]["received_at"] == iso(arrival)


def test_holding_horizon_survives_partial_rebalance_and_exit_blocks_same_bar_decision():
    rows = [bar(i, open_price=100 + i, close=100 + i) for i in range(8)]
    state = engine.create_state(config(decision_interval="2m", holding_horizon="4m"), rows)
    state = advance(state, [rows[0]])
    engine.record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}}, decision_started_at=rows[0]["bar_end"], decision_completed_at=rows[0]["bar_end"])
    state = advance(state, [rows[1]])
    original_expiry = state["positions"]["AAA"]["expires_at"]
    assert original_expiry == iso(BASE + timedelta(minutes=5))
    state = advance(state, [rows[2]])
    assert engine.needs_decision(state)
    engine.record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.4}}, decision_started_at=rows[2]["bar_end"], decision_completed_at=rows[2]["bar_end"])
    state = advance(state, [rows[3]])
    assert state["positions"]["AAA"]["expires_at"] == original_expiry
    state = engine.advance_market(state, [], as_of=original_expiry)
    exit_id = next(order["id"] for order in state["orders"] if order["source"] == "system_hold_expiry")
    assert next(order for order in state["orders"] if order["id"] == exit_id)["status"] == "queued"
    state = advance(state, [rows[5]])  # first eligible open is the expiry boundary
    exit_order = next(order for order in state["orders"] if order["id"] == exit_id)
    assert exit_order["status"] == "filled"
    assert state["positions"] == {}
    assert state["decision_block_until"] == rows[5]["bar_end"]
    assert not engine.needs_decision(state)  # no re-entry on the liquidation event's bar.
    state = advance(state, [rows[6]])
    assert engine.needs_decision(state)


def test_expiry_keeps_pending_review_visible_and_prevents_stale_approval():
    rows = [bar(i) for i in range(7)]
    state = engine.create_state(config(mode="human_review", decision_interval="2m", holding_horizon="4m"), rows)
    state = advance(state, [rows[0]])
    first = engine.record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}}, decision_started_at=rows[0]["bar_end"], decision_completed_at=rows[0]["bar_end"])
    engine.review_decision(state, first["id"], "approve", reviewed_at=rows[0]["bar_end"])
    state = advance(state, [rows[1]])
    state = advance(state, [rows[2]])
    assert engine.needs_decision(state)
    second = engine.record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.4}}, decision_started_at=rows[2]["bar_end"], decision_completed_at=rows[2]["bar_end"])
    assert state["status"] == "awaiting_review"
    expiry = state["positions"]["AAA"]["expires_at"]
    state = engine.advance_market(state, [], as_of=expiry)
    assert state["status"] == "awaiting_review"
    assert next(order for order in state["orders"] if order["source"] == "system_hold_expiry")["status"] == "queued"
    pending = next(item for item in state["decisions"] if item["id"] == second["id"])
    assert pending["status"] == "awaiting_review" and pending["stale"] is True and pending["review"] is None
    with pytest.raises(engine.IntradayEngineError, match="stale"):
        engine.review_decision(state, second["id"], "approve", reviewed_at=expiry)
    engine.review_decision(state, second["id"], "reject", reason="Horizon exit is already due", reviewed_at=expiry)
    assert state["decisions"][-1]["status"] == "rejected"


def test_daily_risk_metrics_aggregate_intraday_points_by_utc_date():
    day_one = bar(0)
    day_one["bar_start"] = "2026-11-09T23:58:00Z"
    day_one["bar_end"] = "2026-11-09T23:59:00Z"
    day_one["available_at"] = day_one["bar_end"]
    day_one["received_at"] = day_one["bar_end"]
    day_two_a = copy.deepcopy(day_one)
    day_two_a.update({"event_id": "next-day-a", "revision": 0, "bar_start": "2026-11-09T23:59:00Z", "bar_end": "2026-11-10T00:00:00Z", "available_at": "2026-11-10T00:00:00Z", "received_at": "2026-11-10T00:00:00Z", "close": 101, "high": 102})
    day_two_b = copy.deepcopy(day_two_a)
    day_two_b.update({"event_id": "next-day-b", "bar_start": "2026-11-10T00:00:00Z", "bar_end": "2026-11-10T00:01:00Z", "available_at": "2026-11-10T00:01:00Z", "received_at": "2026-11-10T00:01:00Z", "close": 102, "high": 103})
    state = engine.create_state(config(holding_horizon=None), [day_one, day_two_a, day_two_b])
    state = engine.advance_market(state, [day_one, day_two_a, day_two_b], as_of=day_two_b["bar_end"])
    metrics = engine.performance_metrics(state)
    assert len(state["history"]) == 3
    assert metrics["intraday_observations"] == 3
    assert metrics["sessions"] == 2
    assert len(metrics["equity_curve"]) == 2
    assert "UTC calendar date" in metrics["return_convention"]


def test_final_unfilled_order_is_explicitly_pending_not_filled():
    rows = [bar(0)]
    state = engine.create_state(config(), rows)
    state = advance(state, [rows[0]])
    engine.record_decision(state, {"action": "rebalance", "targets": {"AAA": 0.5}}, decision_started_at=rows[0]["bar_end"], decision_completed_at=rows[0]["bar_end"])
    state = engine.advance_market(state, [], as_of=rows[0]["bar_end"], final=True)
    assert state["status"] == "completed"
    assert state["orders"][0]["status"] == "pending_final"
    assert state["orders"][0]["fills"] == []


def test_holding_expiry_only_exits_due_symbol_and_preserves_later_position():
    state, rows = staggered_positions()
    aaa_expiry = state["positions"]["AAA"]["expires_at"]
    bbb_before = copy.deepcopy(state["positions"]["BBB"])
    assert aaa_expiry == iso(BASE + timedelta(minutes=5))
    assert bbb_before["expires_at"] == iso(BASE + timedelta(minutes=7))

    state = engine.advance_market(state, [], as_of=aaa_expiry)
    expiry_orders = [order for order in state["orders"] if order.get("source") == "system_hold_expiry"]
    assert len(expiry_orders) == 1
    assert expiry_orders[0]["execution_scope_symbols"] == ["AAA"]
    assert expiry_orders[0]["target_weights"]["AAA"] == 0
    assert expiry_orders[0]["target_weights"]["BBB"] > 0

    fees_before_exit = state["fees_paid"]
    state = advance(state, rows[5])
    expiry_order = next(order for order in state["orders"] if order.get("source") == "system_hold_expiry")
    assert expiry_order["status"] == "filled"
    assert [(fill["symbol"], fill["side"]) for fill in expiry_order["fills"]] == [("AAA", "sell")]
    assert expiry_order["fills"][0]["fees"] > 0
    assert state["fees_paid"] > fees_before_exit
    assert "AAA" not in state["positions"]
    assert state["positions"]["BBB"]["quantity"] == bbb_before["quantity"]
    assert state["positions"]["BBB"]["expires_at"] == bbb_before["expires_at"]
    assert state["holding_expires_at"] == bbb_before["expires_at"]


def test_missing_quote_for_one_expired_asset_does_not_block_another_exit():
    all_rows = [bar(minute, symbol) for minute in (0, 1, 5, 6) for symbol in ("AAA", "BBB")]
    state = engine.create_state(config(symbols=["AAA", "BBB"], fee_bps=20, slippage_bps=10), all_rows)
    first = [bar(0, "AAA"), bar(0, "BBB")]
    state = advance(state, first)
    engine.record_decision(
        state,
        {"action": "rebalance", "targets": {"AAA": 0.25, "BBB": 0.25}},
        decision_started_at=first[0]["bar_end"],
        decision_completed_at=first[0]["bar_end"],
    )
    state = advance(state, [bar(1, "AAA"), bar(1, "BBB")])
    expiry = state["positions"]["AAA"]["expires_at"]
    assert state["positions"]["BBB"]["expires_at"] == expiry
    state = engine.advance_market(state, [], as_of=expiry)
    expiry_orders = {order["execution_scope_symbols"][0]: order for order in state["orders"] if order.get("source") == "system_hold_expiry"}
    assert set(expiry_orders) == {"AAA", "BBB"}

    state = advance(state, [bar(5, "AAA")])
    expiry_orders = {order["execution_scope_symbols"][0]: order for order in state["orders"] if order.get("source") == "system_hold_expiry"}
    assert expiry_orders["AAA"]["status"] == "filled"
    assert expiry_orders["BBB"]["status"] == "queued"
    assert "AAA" not in state["positions"] and "BBB" in state["positions"]

    state = advance(state, [bar(6, "BBB")])
    expiry_orders = {order["execution_scope_symbols"][0]: order for order in state["orders"] if order.get("source") == "system_hold_expiry"}
    assert expiry_orders["BBB"]["status"] == "filled"
    assert state["positions"] == {}


def test_legacy_global_expiry_order_recovers_only_due_scope_once():
    state, rows = staggered_positions()
    aaa_expiry = state["positions"]["AAA"]["expires_at"]
    state["_seq"]["order"] += 1
    legacy_order = {
        "id": f"order-{state['_seq']['order']}",
        "decision_id": None,
        "source": "system_hold_expiry",
        "order_type": "system_hold_expiry",
        "system_reason": "holding_horizon_expired",
        "created_at": aaa_expiry,
        "submitted_at": aaa_expiry,
        "executable_at": aaa_expiry,
        "status": "queued",
        "target_weights": {"AAA": 0.0, "BBB": 0.0},
        "fills": [],
        "fees_paid": 0.0,
        "slippage_paid": 0.0,
        "reason": "configured_holding_horizon_elapsed",
    }
    state["orders"].append(legacy_order)
    state["holding_expires_at"] = None  # Schema-v2 states saved by the earlier runtime did this.
    state = engine.advance_market(state, [], as_of=aaa_expiry)
    expiry_orders = [order for order in state["orders"] if order.get("source") == "system_hold_expiry"]
    assert len(expiry_orders) == 1
    state = advance(state, rows[5])
    legacy_order = next(order for order in state["orders"] if order["id"] == legacy_order["id"])
    assert legacy_order["status"] == "filled"
    assert legacy_order["execution_scope_symbols"] == ["AAA"]
    assert [(fill["symbol"], fill["side"]) for fill in legacy_order["fills"]] == [("AAA", "sell")]
    assert "BBB" in state["positions"]


def test_legacy_global_expiry_order_records_partial_fill_before_final_fill():
    source_bars = [bar(minute, symbol) for minute in range(8) for symbol in ("AAA", "BBB")]
    state = engine.create_state(config(symbols=["AAA", "BBB"], holding_horizon="4m"), source_bars)
    first = [bar(0, "AAA"), bar(0, "BBB")]
    state = advance(state, first)
    engine.record_decision(
        state,
        {"action": "rebalance", "targets": {"AAA": 0.25, "BBB": 0.25}},
        decision_started_at=first[0]["bar_end"],
        decision_completed_at=first[0]["bar_end"],
    )
    state = advance(state, [bar(1, "AAA"), bar(1, "BBB")])
    expiry = state["positions"]["AAA"]["expires_at"]
    assert state["positions"]["BBB"]["expires_at"] == expiry

    state["_seq"]["order"] += 1
    legacy_order = {
        "id": f"order-{state['_seq']['order']}",
        "decision_id": None,
        "source": "system_hold_expiry",
        "order_type": "system_hold_expiry",
        "system_reason": "holding_horizon_expired",
        "created_at": expiry,
        "submitted_at": expiry,
        "executable_at": expiry,
        "status": "queued",
        "target_weights": {"AAA": 0.0, "BBB": 0.0},
        "fills": [],
        "fees_paid": 0.0,
        "slippage_paid": 0.0,
        "reason": "configured_holding_horizon_elapsed",
    }
    state["orders"].append(legacy_order)
    state = engine.advance_market(state, [], as_of=expiry)
    legacy_order = next(order for order in state["orders"] if order["id"] == legacy_order["id"])
    assert legacy_order["execution_scope_symbols"] == ["AAA", "BBB"]

    state = advance(state, [bar(5, "AAA")])
    legacy_order = next(order for order in state["orders"] if order["id"] == legacy_order["id"])
    assert legacy_order["status"] == "partially_filled"
    assert legacy_order["pending_symbols"] == ["BBB"]
    assert [fill["symbol"] for fill in legacy_order["fills"]] == ["AAA"]
    events = [event for event in state["events"] if event["details"].get("order_id") == legacy_order["id"]]
    event_types = [event["type"] for event in events]
    assert "order_partially_filled" in event_types
    assert "order_filled" not in event_types
    assert "holding_horizon_exit_partially_filled" in event_types
    assert "holding_horizon_exit_filled" not in event_types

    state = advance(state, [bar(6, "BBB")])
    legacy_order = next(order for order in state["orders"] if order["id"] == legacy_order["id"])
    assert legacy_order["status"] == "filled"
    assert legacy_order["pending_symbols"] == []
    assert [fill["symbol"] for fill in legacy_order["fills"]] == ["AAA", "BBB"]
    assert state["positions"] == {}
    events = [event for event in state["events"] if event["details"].get("order_id") == legacy_order["id"]]
    event_types = [event["type"] for event in events]
    assert event_types.count("order_partially_filled") == 1
    assert event_types.count("order_filled") == 1
    assert event_types.count("holding_horizon_exit_partially_filled") == 1
    assert event_types.count("holding_horizon_exit_filled") == 1


def test_historical_latency_catchup_keeps_snapshot_and_never_fills_new_order_before_completion():
    rows = [bar(minute, open_price=100 + minute, close=101 + minute) for minute in range(6)]
    state = engine.create_state(config(latency_assumptions={"simulated_latency_ms": 180000}), rows)
    state = advance(state, [rows[0]])
    decision_start = rows[0]["bar_end"]
    decision_complete = rows[3]["bar_end"]
    decision = engine.record_decision(
        state,
        {"action": "rebalance", "targets": {"AAA": 0.5}},
        decision_started_at=decision_start,
        decision_completed_at=decision_complete,
    )
    frozen_input = copy.deepcopy(decision["input_snapshot"])
    assert state["current_time"] == decision_complete

    missed_ids = engine.unseen_bar_event_ids(state, rows[1:4])
    assert missed_ids == [row["event_id"] for row in rows[1:4]]
    state = engine.advance_market(state, rows[1:4], as_of=decision_complete)
    order = state["orders"][0]
    assert state["current_time"] == decision_complete
    assert order["status"] == "queued" and order["fills"] == []
    assert [point["bar_end"] for point in state["history"]] == [row["bar_end"] for row in rows[:4]]
    assert state["decisions"][0]["input_snapshot"] == frozen_input
    assert [item["bar_end"] for item in engine.visible_snapshot(state, as_of=decision_start)["bars"]] == [rows[0]["bar_end"]]
    assert engine.unseen_bar_event_ids(state, rows[1:4]) == []

    history_before_skip_audit = copy.deepcopy(state["history"])
    skipped = engine.record_skipped_decision_boundaries(
        state,
        through_time=decision_complete,
        reason="decision_in_flight",
        eligible_event_ids=missed_ids,
    )
    assert [item["scheduled_at"] for item in skipped] == [rows[1]["bar_end"], rows[2]["bar_end"]]
    assert state["history"] == history_before_skip_audit
    assert state["current_time"] == decision_complete
    assert engine.record_skipped_decision_boundaries(
        state,
        through_time=decision_complete,
        reason="decision_in_flight",
        eligible_event_ids=missed_ids,
    ) == []

    state = advance(state, [rows[4]])
    order = state["orders"][0]
    assert order["status"] == "filled"
    assert order["fills"][0]["fill_at"] == decision_complete
    assert order["fills"][0]["source_bar_start"] == decision_complete


def test_live_catchup_is_valuation_only_and_fill_time_uses_processing_clock():
    state = engine.create_state(config(market_mode="live", holding_horizon=None))
    first = bar(0)
    state = engine.advance_market(state, [first], as_of=first["received_at"])
    decision = engine.record_decision(
        state,
        {"action": "rebalance", "targets": {"AAA": 0.5}},
        decision_started_at=first["bar_end"],
        decision_completed_at="2026-11-09T14:32:00Z",
    )
    frozen_input = copy.deepcopy(decision["input_snapshot"])
    delayed = bar(
        1,
        available_at=BASE + timedelta(minutes=2),
        received_at=BASE + timedelta(minutes=2, seconds=30),
    )
    unseen = engine.unseen_bar_event_ids(state, [delayed])
    assert unseen == [delayed["event_id"]]
    state = engine.advance_market(state, [delayed], as_of="2026-11-09T14:40:00Z", live_fill_event_ids=[])
    assert state["current_time"] == "2026-11-09T14:40:00Z"
    assert state["orders"][0]["status"] == "queued"
    assert state["orders"][0]["fills"] == []
    assert delayed["event_id"] in {row["event_id"] for row in state["bar_events"]}
    assert delayed["bar_end"] in {point["bar_end"] for point in state["history"]}
    assert state["decisions"][0]["input_snapshot"] == frozen_input

    latest = bar(
        9,
        open_price=110,
        close=111,
        available_at=BASE + timedelta(minutes=10),
        received_at=BASE + timedelta(minutes=9, seconds=30),
    )
    state = engine.advance_market(
        state,
        [latest],
        as_of="2026-11-09T14:40:10Z",
        live_fill_event_ids=[latest["event_id"]],
    )
    fill = state["orders"][0]["fills"][0]
    assert state["orders"][0]["status"] == "filled"
    assert fill["fill_at"] == "2026-11-09T14:40:10Z"
    assert fill["bar_observed_at"] == latest["available_at"]
    assert fill["bar_received_at"] == latest["received_at"]
    assert fill["source_bar_start"] == latest["bar_start"]
    assert state["current_time"] == "2026-11-09T14:40:10Z"


def test_subsecond_decision_completion_advances_monotonic_runtime_clock():
    first = bar(0)
    state = engine.create_state(config(), [first, bar(1)])
    state = advance(state, [first])
    completed = "2026-11-09T14:31:00.100Z"
    engine.record_decision(
        state,
        {"action": "hold"},
        decision_started_at=first["bar_end"],
        decision_completed_at=completed,
    )
    assert state["current_time"] == "2026-11-09T14:31:00.100000Z"
    assert datetime.fromisoformat(state["current_time"].replace("Z", "+00:00")) >= datetime.fromisoformat(completed.replace("Z", "+00:00"))


def test_live_default_fill_boundary_and_history_order_use_instant_not_iso_text():
    state = engine.create_state(config(market_mode="live", symbols=["AAA", "BBB"], holding_horizon=None))
    first = bar(0, "AAA")
    state = engine.advance_market(state, [first], as_of=first["received_at"])
    engine.record_decision(
        state,
        {"action": "rebalance", "targets": {"AAA": 0.5}},
        decision_started_at=first["bar_end"],
        decision_completed_at="2026-11-09T14:31:00.500000Z",
    )

    whole_second = bar(1, "BBB")
    whole_second.update(
        {
            "event_id": "BBB-whole-second-boundary",
            "bar_start": "2026-11-09T14:30:00Z",
            "bar_end": "2026-11-09T14:31:00Z",
            "available_at": "2026-11-09T14:31:00Z",
            "received_at": "2026-11-09T14:31:00Z",
        }
    )
    fractional_second = bar(1, "AAA")
    fractional_second.update(
        {
            "event_id": "AAA-fractional-second-boundary",
            "bar_start": "2026-11-09T14:30:00.100000Z",
            "bar_end": "2026-11-09T14:31:00.900000Z",
            "available_at": "2026-11-09T14:31:00.900000Z",
            "received_at": "2026-11-09T14:31:00.900000Z",
        }
    )
    state = engine.advance_market(state, [fractional_second, whole_second])

    order = state["orders"][0]
    assert order["status"] == "filled"
    assert order["fills"][0]["source_bar_end"] == fractional_second["bar_end"]
    assert [point["bar_end"] for point in state["history"]] == [first["bar_end"], fractional_second["bar_end"]]


def test_forming_bars_are_sorted_by_timestamp_when_precision_differs():
    as_of = BASE + timedelta(seconds=59, milliseconds=950)
    exact = bar(0, "AAA", complete=False)
    exact.update(
        {
            "bar_start": iso(BASE),
            "bar_end": iso(BASE + timedelta(minutes=1)),
            "available_at": iso(as_of),
            "received_at": iso(as_of),
        }
    )
    fractional = bar(1, "BBB", complete=False)
    fractional.update(
        {
            "bar_start": iso(BASE),
            "bar_end": "2026-11-09T14:31:00.900000Z",
            "available_at": iso(as_of),
            "received_at": iso(as_of),
        }
    )
    state = engine.create_state(config(market_mode="live", symbols=["AAA", "BBB"], holding_horizon=None))
    state = engine.advance_market(state, [fractional, exact], as_of=iso(as_of))

    snapshot = engine.visible_snapshot(state, as_of=iso(as_of))
    assert [item["symbol"] for item in snapshot["forming_bars"]] == ["AAA", "BBB"]


def test_candidate_groups_keep_mixed_precision_bar_boundaries_in_time_order():
    exact = bar(0, "AAA")
    fractional = bar(1, "BBB")
    fractional.update(
        {
            "bar_start": "2026-11-09T14:30:00.100000Z",
            "bar_end": "2026-11-09T14:31:00.900000Z",
            "available_at": "2026-11-09T14:31:00.900000Z",
            "received_at": "2026-11-09T14:31:00.900000Z",
        }
    )
    state = engine.create_state(config(symbols=["AAA", "BBB"]), [exact, fractional])
    state = engine.advance_market(state, [fractional, exact], as_of=fractional["bar_end"])

    assert [point["bar_end"] for point in state["history"]] == [exact["bar_end"], fractional["bar_end"]]


def test_new_runtime_helpers_are_exported_from_module():
    assert "unseen_bar_event_ids" in engine.__all__
    assert "record_skipped_decision_boundaries" in engine.__all__

