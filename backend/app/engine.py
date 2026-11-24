"""Pure, deterministic trading runtime for Trading Lab.

The module has no persistence, web, network, or third-party dependencies. Public
mutators update a JSON-serializable state dictionary in place and return the
updated record/state. A mutator stages changes on a deep copy, so validation
errors never leave half-applied ledger changes.

Trading contract:
* Close-time proposals become eligible at the next available session open.
* Buys and sells use open prices adjusted by configured adverse slippage; fees
  are charged on slipped notional. Sells are processed before buys.
* Target maps describe a complete long-only allocation; omitted symbols target
  zero. ``hold`` skips rebalancing and creates no order.
* A target weight is checked against the per-name cap and total weight against
  100%. Buys are cash limited and additionally capped against the per-name
  limit after estimated execution costs.
* Missing bars do not create prices or fills. Existing holdings are marked at
  the last known close; an order waits for a later open for an unquoted symbol.
* No market data is stored in state. Each later call must supply the same
  canonical bar set, checked through a hash. Snapshots include only rows at or
  before the current replay date.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
from datetime import date
from typing import Any


class EngineError(ValueError):
    """A stable, user-correctable trading-runtime error.

    ``code`` is suitable for API mapping and ``detail`` is safe to display.
    Unexpected exceptions are deliberately not wrapped as this class.
    """

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


_EPSILON = 1e-10
_SECRET_PARTS = ("api_key", "apikey", "secret", "password", "authorization", "access_token", "refresh_token")
_CONFIG_KEYS = {
    "start_date",
    "end_date",
    "symbols",
    "initial_capital",
    "fee_bps",
    "slippage_bps",
    "max_position_weight",
    "mode",
    "strategy",
    "momentum_lookback",
    "team",
    "dataset_id",
    "provider_mode",
    "workflow_version",
    "harness_risk",
}


def _error(code: str, detail: str) -> EngineError:
    return EngineError(code, detail)


def _is_secret_key(key: Any) -> bool:
    lowered = str(key).lower().replace("-", "_")
    return any(part in lowered for part in _SECRET_PARTS)


def _safe_copy(value: Any) -> Any:
    """Copy JSON-like audit data while dropping credential-shaped keys."""
    if isinstance(value, dict):
        return {str(k): _safe_copy(v) for k, v in value.items() if not _is_secret_key(k)}
    if isinstance(value, (list, tuple)):
        return [_safe_copy(item) for item in value]
    if value is None or isinstance(value, (str, bool, int)):
        return copy.deepcopy(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _error("invalid_json", "Runtime inputs must contain only finite JSON numbers.")
        return value
    raise _error("invalid_json", "Runtime inputs must contain only JSON-compatible values.")


def _ensure_json_state(state: dict[str, Any]) -> None:
    try:
        json.dumps(state, allow_nan=False)
    except (TypeError, ValueError, OverflowError) as exc:
        raise _error("non_finite_result", "Runtime result could not be represented as finite JSON.") from exc


def _finite_number(value: Any, label: str, *, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _error("invalid_number", f"{label} must be a finite number.")
    number = float(value)
    if not math.isfinite(number):
        raise _error("invalid_number", f"{label} must be a finite number.")
    if minimum is not None and number < minimum:
        raise _error("invalid_number", f"{label} must be at least {minimum:g}.")
    return number


def _iso_date(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise _error("invalid_date", f"{label} must use YYYY-MM-DD format.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise _error("invalid_date", f"{label} must use YYYY-MM-DD format.") from exc
    if parsed.isoformat() != value:
        raise _error("invalid_date", f"{label} must use YYYY-MM-DD format.")
    return value


def _symbol(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _error("invalid_symbol", "Every symbol must be a non-empty string.")
    return value.strip().upper()


def _normalize_bars(bars: Any) -> list[dict[str, Any]]:
    if not isinstance(bars, list):
        raise _error("invalid_bars", "Market bars must be a list.")
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for index, raw in enumerate(bars):
        if not isinstance(raw, dict):
            raise _error("invalid_bars", f"Bar {index + 1} must be an object.")
        bar_date = _iso_date(raw.get("date"), f"Bar {index + 1} date")
        symbol = _symbol(raw.get("symbol"))
        key = (bar_date, symbol)
        if key in seen:
            raise _error("duplicate_bar", f"Duplicate bar for {symbol} on {bar_date}.")
        seen.add(key)
        open_price = _finite_number(raw.get("open"), f"{symbol} open", minimum=0.0)
        high_price = _finite_number(raw.get("high"), f"{symbol} high", minimum=0.0)
        low_price = _finite_number(raw.get("low"), f"{symbol} low", minimum=0.0)
        close_price = _finite_number(raw.get("close"), f"{symbol} close", minimum=0.0)
        volume = _finite_number(raw.get("volume", 0), f"{symbol} volume", minimum=0.0)
        if min(open_price, high_price, low_price, close_price) <= 0:
            raise _error("invalid_bars", f"Prices for {symbol} on {bar_date} must be positive.")
        if high_price + _EPSILON < max(open_price, close_price) or low_price - _EPSILON > min(open_price, close_price) or low_price > high_price:
            raise _error("invalid_bars", f"OHLC range is inconsistent for {symbol} on {bar_date}.")
        normalized.append(
            {
                "date": bar_date,
                "symbol": symbol,
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close_price,
                "volume": volume,
            }
        )
    normalized.sort(key=lambda bar: (bar["date"], bar["symbol"]))
    return normalized


def _bars_hash(bars: list[dict[str, Any]]) -> str:
    payload = json.dumps(bars, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalize_team(team: Any) -> list[dict[str, Any]]:
    if not isinstance(team, list):
        raise _error("invalid_team", "Team must be a list of expert assignments.")
    result: list[dict[str, Any]] = []
    for index, assignment in enumerate(team):
        if not isinstance(assignment, dict):
            raise _error("invalid_team", f"Team assignment {index + 1} must be an object.")
        expert_id = assignment.get("expert_id", assignment.get("id"))
        if not isinstance(expert_id, str) or not expert_id.strip():
            raise _error("invalid_team", f"Team assignment {index + 1} needs an expert_id.")
        role = assignment.get("role", "trader")
        if not isinstance(role, str) or not role.strip():
            raise _error("invalid_team", f"Team assignment {index + 1} needs a role.")
        enabled = assignment.get("enabled", True)
        if not isinstance(enabled, bool):
            raise _error("invalid_team", f"Team assignment {index + 1} enabled must be boolean.")
        cleaned = _safe_copy(assignment)
        cleaned["expert_id"] = expert_id.strip()
        cleaned["role"] = role.strip()
        cleaned["enabled"] = enabled
        result.append(cleaned)
    return result


def _normalize_config(config: Any, bars: list[dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise _error("invalid_config", "Experiment config must be an object.")
    bar_dates = [bar["date"] for bar in bars]
    if not bar_dates:
        raise _error("no_trading_sessions", "Dataset has no valid market bars.")
    start_date = _iso_date(config.get("start_date", min(bar_dates)), "start_date")
    end_date = _iso_date(config.get("end_date", max(bar_dates)), "end_date")
    if start_date > end_date:
        raise _error("invalid_config", "start_date must be on or before end_date.")
    raw_symbols = config.get("symbols")
    if raw_symbols is None:
        symbols = sorted({bar["symbol"] for bar in bars})
    else:
        if not isinstance(raw_symbols, list) or not raw_symbols:
            raise _error("invalid_config", "symbols must be a non-empty list.")
        symbols = sorted({_symbol(item) for item in raw_symbols})
        if len(symbols) != len(raw_symbols):
            raise _error("invalid_config", "symbols must not contain duplicates.")
    if not symbols:
        raise _error("invalid_config", "At least one market symbol is required.")
    capital = _finite_number(config.get("initial_capital", 100_000), "initial_capital", minimum=0.0)
    if capital <= 0:
        raise _error("invalid_config", "initial_capital must be greater than zero.")
    fee_bps = _finite_number(config.get("fee_bps", 0), "fee_bps", minimum=0.0)
    if fee_bps >= 10_000:
        raise _error("invalid_config", "fee_bps must be less than 10000.")
    slippage_bps = _finite_number(config.get("slippage_bps", 0), "slippage_bps", minimum=0.0)
    if slippage_bps >= 10_000:
        raise _error("invalid_config", "slippage_bps must be less than 10000.")
    max_weight = _finite_number(config.get("max_position_weight", 1), "max_position_weight", minimum=0.0)
    if max_weight <= 0 or max_weight > 1:
        raise _error("invalid_config", "max_position_weight must be greater than zero and no more than one.")
    mode = config.get("mode", "ai_only")
    if mode not in ("ai_only", "human_review"):
        raise _error("invalid_config", "mode must be ai_only or human_review.")
    lookback = config.get("momentum_lookback", 20)
    if isinstance(lookback, bool) or not isinstance(lookback, int) or lookback < 1:
        raise _error("invalid_config", "momentum_lookback must be a positive integer.")
    result = {key: _safe_copy(value) for key, value in config.items() if key in _CONFIG_KEYS and not _is_secret_key(key)}
    result.update(
        {
            "start_date": start_date,
            "end_date": end_date,
            "symbols": symbols,
            "initial_capital": capital,
            "fee_bps": fee_bps,
            "slippage_bps": slippage_bps,
            "max_position_weight": max_weight,
            "mode": mode,
            "momentum_lookback": lookback,
            "team": _normalize_team(config.get("team", [])),
        }
    )
    return result


def _sessions(config: dict[str, Any], bars: list[dict[str, Any]]) -> list[str]:
    symbols = set(config["symbols"])
    return sorted(
        {
            bar["date"]
            for bar in bars
            if bar["symbol"] in symbols and config["start_date"] <= bar["date"] <= config["end_date"]
        }
    )


def create_state(config: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
    """Create an isolated runtime state without retaining the source bars."""
    normalized_bars = _normalize_bars(bars)
    normalized_config = _normalize_config(config, normalized_bars)
    sessions = _sessions(normalized_config, normalized_bars)
    if not sessions:
        raise _error("no_trading_sessions", "No market sessions fall within the configured date range and symbols.")
    initial_capital = normalized_config["initial_capital"]
    return {
        "schema_version": 1,
        "config": normalized_config,
        "dataset_sha256": _bars_hash(normalized_bars),
        "current_date": None,
        "session_index": -1,
        "is_final_session": False,
        "status": "ready",
        "cash": initial_capital,
        "positions": {},
        "equity": initial_capital,
        "fees_paid": 0.0,
        "slippage_paid": 0.0,
        "history": [],
        "decisions": [],
        "orders": [],
        "events": [],
        "active_team": copy.deepcopy(normalized_config["team"]),
        "pending_team": None,
        "_seq": {"decision": 0, "order": 0, "event": 0},
    }


def _checked_bars(state: dict[str, Any], bars: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = _normalize_bars(bars)
    if _bars_hash(normalized) != state.get("dataset_sha256"):
        raise _error("data_snapshot_mismatch", "Market bars differ from the dataset snapshot used to create this experiment.")
    return normalized


def _event(state: dict[str, Any], event_type: str, details: dict[str, Any] | None = None, *, event_date: str | None = None) -> dict[str, Any]:
    state["_seq"]["event"] += 1
    event = {
        "id": f"event-{state['_seq']['event']}",
        "date": event_date if event_date is not None else state.get("current_date"),
        "type": event_type,
        "details": _safe_copy(details or {}),
    }
    state["events"].append(event)
    return event


def _market_equity(state: dict[str, Any], price_by_symbol: dict[str, float]) -> float:
    value = state["cash"]
    for symbol, position in state["positions"].items():
        price = price_by_symbol.get(symbol, position.get("last_price"))
        if price is not None:
            value += position["quantity"] * price
    return value


def _market_value(state: dict[str, Any], symbol: str, price_by_symbol: dict[str, float]) -> float:
    position = state["positions"].get(symbol)
    if not position:
        return 0.0
    price = price_by_symbol.get(symbol, position.get("last_price"))
    if price is None:
        return 0.0
    return position["quantity"] * price


def _fee_rate(state: dict[str, Any]) -> float:
    return state["config"]["fee_bps"] / 10_000.0


def _slippage_rate(state: dict[str, Any]) -> float:
    return state["config"]["slippage_bps"] / 10_000.0


def _fill_order_at_open(
    state: dict[str, Any],
    order: dict[str, Any],
    day_bars: dict[str, dict[str, Any]],
    open_prices: dict[str, float],
    session_date: str,
) -> None:
    from . import score_fusion
    preserve=set(order.get('preserve_symbols',[]))
    missing_marks=[s for s in preserve if state['positions'].get(s,{}).get('quantity',0)>_EPSILON and s not in day_bars]
    if missing_marks:
        order['pending_symbols']=sorted(missing_marks)
        order['unfilled_symbols']={s:'preserved_position_missing_price' for s in missing_marks}
        return
    equity=_market_equity(state,open_prices)
    target_weights = score_fusion.execution_targets(state,order['target_weights'],preserve,open_prices,equity)
    candidate_symbols = sorted(
        symbol
        for symbol in state["config"]["symbols"]
        if symbol not in preserve and (target_weights.get(symbol, 0.0) > _EPSILON
        or state["positions"].get(symbol, {}).get("quantity", 0.0) > _EPSILON)
    )
    processed = set(order.setdefault("processed_symbols", []))
    fills: list[dict[str, Any]] = []
    missing: list[str] = []
    for symbol in candidate_symbols:
        if symbol in processed:
            continue
        if symbol not in day_bars:
            missing.append(symbol)
    tradable = [symbol for symbol in candidate_symbols if symbol not in processed and symbol in day_bars]
    if not order.get("eligible_date"):
        order["eligible_date"] = session_date

    # Sell first so released cash is available for purchases in the same order.
    for symbol in tradable:
        position = state["positions"].get(
            symbol,
            {"quantity": 0.0, "average_cost": 0.0, "last_price": None, "last_price_date": None},
        )
        quantity = position["quantity"]
        open_price = open_prices[symbol]
        equity_before = _market_equity(state, open_prices)
        target_value = target_weights.get(symbol, 0.0) * max(equity_before, 0.0)
        desired_quantity = target_value / open_price
        delta = desired_quantity - quantity
        if delta >= -_EPSILON:
            continue
        sell_quantity = min(quantity, -delta)
        if sell_quantity <= _EPSILON:
            continue
        fill_price = open_price * (1.0 - _slippage_rate(state))
        notional = sell_quantity * fill_price
        fee = notional * _fee_rate(state)
        slippage_cost = sell_quantity * (open_price - fill_price)
        state["cash"] += notional - fee
        state["fees_paid"] += fee
        state["slippage_paid"] += slippage_cost
        remaining = quantity - sell_quantity
        if remaining <= _EPSILON:
            state["positions"].pop(symbol, None)
        else:
            state["positions"][symbol]["quantity"] = remaining
        fill = {
            "symbol": symbol,
            "side": "sell",
            "quantity": sell_quantity,
            "open_price": open_price,
            "fill_price": fill_price,
            "notional": notional,
            "fees": fee,
            "slippage_cost": slippage_cost,
            "date": session_date,
        }
        fills.append(fill)
        order["processed_symbols"].append(symbol)

    # Plan buys against one post-sell equity mark. Cash is allocated in symbol
    # order, then all buys are scaled together so aggregate fees and slippage
    # cannot push any newly bought name over the hard per-position cap.
    base_equity = max(_market_equity(state, open_prices), 0.0)
    available_cash = max(state["cash"], 0.0)
    if preserve:
        limits=state['config'].get('harness_risk') or {}
        reserve=max(limits.get('min_cash_weight',0.0),1-limits.get('max_gross_weight',1.0))
        available_cash=max(0.0,available_cash-reserve*base_equity)
    buy_plans: list[dict[str, float | str]] = []
    for symbol in tradable:
        if symbol in order["processed_symbols"]:
            continue
        open_price = open_prices[symbol]
        position = state["positions"].get(
            symbol,
            {"quantity": 0.0, "average_cost": 0.0, "last_price": None, "last_price_date": None},
        )
        quantity = position["quantity"]
        target_weight = target_weights.get(symbol, 0.0)
        desired_quantity = max(0.0, target_weight * base_equity / open_price - quantity)
        fill_price = open_price * (1.0 + _slippage_rate(state))
        fee_per_share = fill_price * _fee_rate(state)
        cash_per_share = fill_price + fee_per_share
        affordable = available_cash / cash_per_share if cash_per_share > 0 else 0.0
        cash_limited_quantity = min(desired_quantity, max(0.0, affordable))
        available_cash = max(0.0, available_cash - cash_limited_quantity * cash_per_share)
        if desired_quantity <= 0.0:
            order["processed_symbols"].append(symbol)
            continue
        buy_plans.append(
            {
                "symbol": symbol,
                "desired_quantity": desired_quantity,
                "cash_limited_quantity": cash_limited_quantity,
                "planned_quantity": cash_limited_quantity,
                "open_price": open_price,
                "fill_price": fill_price,
                "fee_per_share": fee_per_share,
            }
        )

    total_buy_cost = sum(
        float(plan["planned_quantity"])
        * (float(plan["fill_price"]) - float(plan["open_price"]) + float(plan["fee_per_share"]))
        for plan in buy_plans
    )
    max_weight = state["config"]["max_position_weight"]
    aggregate_scale = 1.0
    for plan in buy_plans:
        planned_quantity = float(plan["planned_quantity"])
        if planned_quantity <= _EPSILON:
            continue
        symbol = str(plan["symbol"])
        open_price = float(plan["open_price"])
        current_quantity = state["positions"].get(symbol, {}).get("quantity", 0.0)
        current_value = current_quantity * open_price
        headroom = max_weight * base_equity - current_value
        denominator = planned_quantity * open_price + max_weight * total_buy_cost
        if headroom <= 0:
            aggregate_scale = 0.0
            break
        if denominator > 0:
            aggregate_scale = min(aggregate_scale, headroom / denominator)
    aggregate_scale = max(0.0, min(1.0, aggregate_scale))

    unfilled_symbols = order.setdefault("unfilled_symbols", {})
    for plan in buy_plans:
        symbol = str(plan["symbol"])
        open_price = float(plan["open_price"])
        fill_price = float(plan["fill_price"])
        desired_quantity = float(plan["desired_quantity"])
        cash_limited_quantity = float(plan["cash_limited_quantity"])
        buy_quantity = float(plan["planned_quantity"]) * aggregate_scale
        position = state["positions"].get(
            symbol,
            {"quantity": 0.0, "average_cost": 0.0, "last_price": None, "last_price_date": None},
        )
        quantity = position["quantity"]
        if buy_quantity > 0.0:
            notional = buy_quantity * fill_price
            fee = notional * _fee_rate(state)
            slippage_cost = buy_quantity * (fill_price - open_price)
            state["cash"] -= notional + fee
            state["fees_paid"] += fee
            state["slippage_paid"] += slippage_cost
            old_basis = position.get("average_cost", 0.0)
            new_quantity = quantity + buy_quantity
            average_cost = ((quantity * old_basis) + (buy_quantity * fill_price)) / new_quantity
            state["positions"][symbol] = {
                "quantity": new_quantity,
                "average_cost": average_cost,
                "last_price": position.get("last_price"),
                "last_price_date": position.get("last_price_date"),
            }
            fills.append(
                {
                    "symbol": symbol,
                    "side": "buy",
                    "quantity": buy_quantity,
                    "open_price": open_price,
                    "fill_price": fill_price,
                    "notional": notional,
                    "fees": fee,
                    "slippage_cost": slippage_cost,
                    "date": session_date,
                }
            )
        actual_unfilled = max(0.0, desired_quantity - buy_quantity)
        if actual_unfilled > 0.0:
            cash_limited = desired_quantity > cash_limited_quantity + _EPSILON
            if aggregate_scale < 1.0 - _EPSILON and cash_limited:
                reason = "cash_and_position_limits"
            elif aggregate_scale < 1.0 - _EPSILON:
                reason = "max_position_weight_after_aggregate_costs"
            else:
                reason = "cash_limit"
            unfilled_symbols[symbol] = {
                "reason": reason,
                "requested_quantity": desired_quantity,
                "executed_quantity": buy_quantity,
                "unfilled_quantity": actual_unfilled,
                "date": session_date,
            }
            if not missing:
                order["processed_symbols"].append(symbol)
        else:
            unfilled_symbols.pop(symbol, None)
            order["processed_symbols"].append(symbol)

    # Roundoff must not leave a negative cash ledger after cash sizing.
    if state["cash"] < -_EPSILON:
        raise _error("cash_limit", "Order sizing exceeded available cash.")
    state["cash"] = max(0.0, state["cash"])

    # Sell costs can leave a formerly capped holding marginally above the cap.
    # Correct tradable names at this same open; missing-bar breaches are logged.
    stale_logged: set[str] = set()
    preserve_logged: set[str] = set()
    for _ in range(max(1, len(state["config"]["symbols"]) * 2)):
        equity_now = _market_equity(state, open_prices)
        violations: list[str] = []
        stale_violations: list[str] = []
        for symbol, position in state["positions"].items():
            mark = open_prices.get(symbol, position.get("last_price"))
            if mark is None or equity_now <= 0:
                continue
            if position["quantity"] * mark / equity_now > max_weight + 1e-9:
                if symbol in preserve:
                    if symbol not in preserve_logged:
                        _event(state,'preserved_position_limit_exceeded',{'symbol':symbol,'max_position_weight':max_weight},event_date=session_date)
                        preserve_logged.add(symbol)
                elif symbol in day_bars:
                    violations.append(symbol)
                else:
                    stale_violations.append(symbol)
        unlogged_stale = sorted(set(stale_violations) - stale_logged)
        if unlogged_stale:
            _event(
                state,
                "position_limit_unenforceable_missing_bar",
                {"symbols": unlogged_stale, "max_position_weight": max_weight},
                event_date=session_date,
            )
            stale_logged.update(unlogged_stale)
        if not violations:
            break
        corrected_any = False
        for symbol in violations:
            position = state["positions"].get(symbol)
            if not position:
                continue
            open_price = open_prices[symbol]
            equity_now = _market_equity(state, open_prices)
            fill_price = open_price * (1.0 - _slippage_rate(state))
            fee_per_share = fill_price * _fee_rate(state)
            per_share_equity_cost = open_price - fill_price + fee_per_share
            denominator = open_price - max_weight * per_share_equity_cost
            excess = position["quantity"] * open_price - max_weight * equity_now
            if denominator <= 0 or excess <= 0:
                continue
            sell_quantity = min(position["quantity"], excess / denominator)
            if sell_quantity <= _EPSILON:
                continue
            notional = sell_quantity * fill_price
            fee = notional * _fee_rate(state)
            slippage_cost = sell_quantity * (open_price - fill_price)
            state["cash"] += notional - fee
            state["fees_paid"] += fee
            state["slippage_paid"] += slippage_cost
            remaining = position["quantity"] - sell_quantity
            if remaining <= _EPSILON:
                state["positions"].pop(symbol, None)
            else:
                state["positions"][symbol]["quantity"] = remaining
            fills.append(
                {
                    "symbol": symbol,
                    "side": "sell",
                    "quantity": sell_quantity,
                    "open_price": open_price,
                    "fill_price": fill_price,
                    "notional": notional,
                    "fees": fee,
                    "slippage_cost": slippage_cost,
                    "date": session_date,
                    "reason": "max_position_weight_correction",
                }
            )
            corrected_any = True
        if not corrected_any:
            break

    order["fills"].extend(fills)
    order["fees_paid"] = sum(item["fees"] for item in order["fills"])
    order["slippage_paid"] = sum(item["slippage_cost"] for item in order["fills"])
    order["pending_symbols"] = missing
    order["settled"] = False
    if missing:
        order["status"] = "partially_filled" if order["fills"] else "queued"
        order["last_attempt_date"] = session_date
        _event(
            state,
            "order_waiting_for_bars",
            {"order_id": order["id"], "symbols": missing},
            event_date=session_date,
        )
    elif unfilled_symbols:
        order["status"] = "partially_filled" if order["fills"] else "unfilled"
        order["settled"] = True
        order["closed_date"] = session_date
        order["last_attempt_date"] = session_date
        _event(
            state,
            "order_partially_filled" if order["fills"] else "order_unfilled",
            {
                "order_id": order["id"],
                "fill_count": len(order["fills"]),
                "unfilled_symbols": unfilled_symbols,
                "fees_paid": order["fees_paid"],
                "slippage_paid": order["slippage_paid"],
            },
            event_date=session_date,
        )
    else:
        order["status"] = "filled"
        order["settled"] = True
        order["filled_date"] = session_date
        order["last_attempt_date"] = session_date
        _event(
            state,
            "order_filled",
            {
                "order_id": order["id"],
                "fill_count": len(order["fills"]),
                "fees_paid": sum(item["fees"] for item in order["fills"]),
                "slippage_paid": sum(item["slippage_cost"] for item in order["fills"]),
            },
            event_date=session_date,
        )


def _advance_market_mutating(state: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
    if state.get("status") in ("paused", "failed"):
        raise _error("runtime_not_active", "A paused or failed experiment cannot advance the market.")
    if state.get("status") == "awaiting_review":
        raise _error("review_pending", "Resolve the pending human review before advancing the market.")
    if state.get("status") == "completed":
        return state
    sessions = _sessions(state["config"], bars)
    current_date = state.get("current_date")
    next_sessions = [session for session in sessions if current_date is None or session > current_date]
    if not next_sessions:
        pending = []
        for order in state["orders"]:
            if order["status"] in ("queued", "partially_filled") and not order.get("settled"):
                order["status"] = "pending_final_session"
                order["pending_symbols"] = sorted(
                    symbol
                    for symbol in state["config"]["symbols"]
                    if order["target_weights"].get(symbol, 0.0) > _EPSILON
                    or state["positions"].get(symbol, {}).get("quantity", 0.0) > _EPSILON
                )
                pending.append(order["id"])
        state["status"] = "completed"
        _event(state, "replay_completed", {"reason": "no_later_market_session", "pending_orders": pending})
        if pending:
            _event(state, "final_session_orders_pending", {"order_ids": pending})
        return state
    session_date = next_sessions[0]
    day_bars = {
        bar["symbol"]: bar
        for bar in bars
        if bar["date"] == session_date and bar["symbol"] in state["config"]["symbols"]
    }
    open_prices = {symbol: bar["open"] for symbol, bar in day_bars.items()}
    state["current_date"] = session_date
    state["session_index"] += 1
    state["is_final_session"] = not any(day > session_date for day in sessions)
    _event(
        state,
        "market_session_advanced",
        {"session_index": state["session_index"], "is_final_session": state["is_final_session"]},
        event_date=session_date,
    )

    for order in state["orders"]:
        if (
            order["status"] in ("queued", "partially_filled")
            and not order.get("settled")
            and order["created_date"] < session_date
        ):
            _fill_order_at_open(state, order, day_bars, open_prices, session_date)

    missing_symbols = sorted(set(state["config"]["symbols"]) - set(day_bars))
    if missing_symbols:
        _event(state, "missing_market_bars", {"symbols": missing_symbols}, event_date=session_date)

    # Update marks from current closes. Missing symbols keep their last close.
    marks: dict[str, float] = {}
    for symbol, bar in day_bars.items():
        marks[symbol] = bar["close"]
    positions_snapshot: dict[str, dict[str, float]] = {}
    market_value = 0.0
    for symbol in sorted(list(state["positions"])):
        position = state["positions"][symbol]
        mark = marks.get(symbol, position.get("last_price"))
        if mark is None:
            continue
        position["last_price"] = mark
        if symbol in marks:
            position["last_price_date"] = session_date
        value = position["quantity"] * mark
        market_value += value
        positions_snapshot[symbol] = {
            "quantity": position["quantity"],
            "price": mark,
            "value": value,
            "weight": 0.0,
            "price_date": position.get("last_price_date"),
            "is_stale": position.get("last_price_date") != session_date,
        }
    equity = state["cash"] + market_value
    previous_equity = state["equity"]
    daily_return = equity / previous_equity - 1.0 if previous_equity > 0 else 0.0
    for position in positions_snapshot.values():
        position["weight"] = position["value"] / equity if equity > 0 else 0.0
    state["equity"] = equity
    state["history"].append(
        {
            "date": session_date,
            "cash": state["cash"],
            "market_value": market_value,
            "equity": equity,
            "daily_return": daily_return,
            "cumulative_return": equity / state["config"]["initial_capital"] - 1.0,
            "fees_paid_total": state["fees_paid"],
            "slippage_paid_total": state["slippage_paid"],
            "positions": positions_snapshot,
            "missing_symbols": missing_symbols,
        }
    )
    if state["is_final_session"]:
        pending_final: list[str] = []
        for order in state["orders"]:
            if order["status"] in ("queued", "partially_filled") and not order.get("settled"):
                order["status"] = "pending_final_session"
                order["pending_symbols"] = sorted(
                    symbol
                    for symbol in state["config"]["symbols"]
                    if symbol not in order.get("processed_symbols", [])
                    and (
                        order["target_weights"].get(symbol, 0.0) > _EPSILON
                        or state["positions"].get(symbol, {}).get("quantity", 0.0) > _EPSILON
                    )
                )
                pending_final.append(order["id"])
        if pending_final:
            _event(
                state,
                "final_session_orders_pending",
                {"order_ids": pending_final, "reason": "unfilled_symbols_at_last_session"},
                event_date=session_date,
            )
    if state["status"] != "awaiting_review":
        state["status"] = "ready"
    return state


def advance_market(state: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
    """Advance one available session, filling eligible prior close orders."""
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    normalized_bars = _checked_bars(state, bars)
    staged = copy.deepcopy(state)
    _advance_market_mutating(staged, normalized_bars)
    _ensure_json_state(staged)
    state.clear()
    state.update(staged)
    return state


def visible_snapshot(state: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
    """Return a point-in-time snapshot containing no later-dated market rows."""
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    normalized_bars = _checked_bars(state, bars)
    as_of_date = state.get("current_date")
    visible = [
        copy.deepcopy(bar)
        for bar in normalized_bars
        if as_of_date is not None
        and bar["date"] <= as_of_date
        and state["config"]["start_date"] <= bar["date"] <= state["config"]["end_date"]
        and bar["symbol"] in state["config"]["symbols"]
    ]
    positions: dict[str, dict[str, float]] = {}
    for symbol, position in state["positions"].items():
        price = position.get("last_price")
        value = position["quantity"] * price if price is not None else 0.0
        price_date = position.get("last_price_date")
        positions[symbol] = {
            "quantity": position["quantity"],
            "last_price": price,
            "value": value,
            "price_date": price_date,
            "is_stale": as_of_date is not None and price_date != as_of_date,
        }
    return {
        "as_of_date": as_of_date,
        "symbols": list(state["config"]["symbols"]),
        "bars": visible,
        "cash": state["cash"],
        "equity": state["equity"],
        "positions": positions,
        "history": copy.deepcopy(state["history"]),
    }


def _normalize_targets(state: dict[str, Any], targets: Any) -> dict[str, float]:
    if not isinstance(targets, dict):
        raise _error("invalid_targets", "targets must be an object mapping symbols to weights.")
    normalized: dict[str, float] = {}
    allowed = set(state["config"]["symbols"])
    for raw_symbol, raw_weight in targets.items():
        symbol = _symbol(raw_symbol)
        if symbol not in allowed:
            raise _error("invalid_targets", f"Target symbol {symbol} is not in this experiment.")
        weight = _finite_number(raw_weight, f"{symbol} target weight", minimum=0.0)
        if weight > state["config"]["max_position_weight"] + _EPSILON:
            raise _error(
                "position_limit",
                f"{symbol} target weight exceeds the {state['config']['max_position_weight']:.6g} maximum.",
            )
        normalized[symbol] = weight
    total = sum(normalized.values())
    if total > 1.0 + _EPSILON:
        raise _error("cash_limit", "Target weights cannot use more than 100% of portfolio equity.")
    return {symbol: normalized.get(symbol, 0.0) for symbol in state["config"]["symbols"]}


def _validate_proposal(state: dict[str, Any], proposal: Any) -> tuple[dict[str, Any], str, dict[str, float] | None]:
    if not isinstance(proposal, dict):
        raise _error("invalid_proposal", "Proposal must be an object.")
    from .score_fusion import validated_preserve
    validated_preserve(state,proposal)
    action = proposal.get("action")
    if action not in ("hold", "rebalance"):
        raise _error("invalid_proposal", "Proposal action must be hold or rebalance.")
    if action == "hold":
        targets = proposal.get("targets")
        if targets not in (None, {}):
            raise _error("invalid_proposal", "A hold proposal must omit targets or provide an empty object.")
        return _safe_copy(proposal), action, None
    if "targets" not in proposal:
        raise _error("invalid_proposal", "A rebalance proposal requires a targets object.")
    normalized_targets = _normalize_targets(state, proposal["targets"])
    return _safe_copy(proposal), action, normalized_targets


def _next_id(state: dict[str, Any], kind: str) -> str:
    state["_seq"][kind] += 1
    return f"{kind}-{state['_seq'][kind]}"


def _queue_order(state: dict[str, Any], decision: dict[str, Any], targets: dict[str, float]) -> dict[str, Any]:
    order_id = _next_id(state, "order")
    final_session = bool(state.get("is_final_session"))
    order = {
        "id": order_id,
        "decision_id": decision["id"],
        "created_date": state.get("current_date"),
        "eligible_date": None,
        "filled_date": None,
        "status": "pending_final_session" if final_session else "queued",
        "target_weights": copy.deepcopy(targets),
        "preserve_symbols": copy.deepcopy(decision.get('final_proposal',{}).get('preserve_symbols',[])),
        "processed_symbols": [],
        "pending_symbols": [],
        "unfilled_symbols": {},
        "settled": False,
        "fills": [],
        "fees_paid": 0.0,
        "slippage_paid": 0.0,
    }
    state["orders"].append(order)
    decision["order_id"] = order_id
    if final_session:
        _event(
            state,
            "final_session_order_pending",
            {"order_id": order_id, "decision_id": decision["id"], "reason": "no_later_session_within_experiment"},
        )
    else:
        _event(state, "order_queued", {"order_id": order_id, "decision_id": decision["id"]})
    return order


def _activate_pending_team(state: dict[str, Any]) -> None:
    pending = state.get("pending_team")
    if not pending:
        return
    previous = copy.deepcopy(state["active_team"])
    state["active_team"] = copy.deepcopy(pending["team"])
    state["pending_team"] = None
    _event(
        state,
        "team_activated",
        {"previous_team": previous, "active_team": state["active_team"], "requested_date": pending.get("requested_date")},
    )


def prepare_decision(state: dict[str, Any]) -> dict[str, Any]:
    """Apply a scheduled team at the open decision boundary before inference.

    Call after the current market session has advanced and before building the
    model snapshot/request. This operation is idempotent, so a same-session
    retry after an LLM failure sees the same already-activated team.
    """
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    if state.get("status") in ("awaiting_review", "completed", "paused", "failed"):
        raise _error("decision_boundary_unavailable", "The runtime is not at an available decision boundary.")
    if state.get("current_date") is None:
        raise _error("no_current_session", "Advance the market to a session before preparing a decision.")
    staged = copy.deepcopy(state)
    _activate_pending_team(staged)
    _ensure_json_state(staged)
    state.clear()
    state.update(staged)
    return state


def _cancel_open_orders(
    state: dict[str, Any],
    *,
    reason: str,
    decision_id: str | None = None,
    include_final_pending: bool = False,
) -> list[str]:
    active = {"queued", "partially_filled"}
    if include_final_pending:
        active.add("pending_final_session")
    cancelled: list[str] = []
    for order in state["orders"]:
        if order["status"] not in active or order.get("settled"):
            continue
        prior_fills = len(order.get("fills", []))
        order["status"] = "cancelled"
        order["cancelled_date"] = state.get("current_date")
        order["cancel_reason"] = reason
        order["cancelled_remainder"] = prior_fills > 0 or bool(order.get("pending_symbols"))
        order["pending_symbols"] = []
        cancelled.append(order["id"])
        _event(
            state,
            "order_remainder_cancelled",
            {
                "order_id": order["id"],
                "decision_id": decision_id,
                "reason": reason,
                "prior_fill_count": prior_fills,
            },
        )
    return cancelled


def _record_decision_mutating(state: dict[str, Any], proposal: Any) -> dict[str, Any]:
    if state.get("status") in ("paused", "failed"):
        raise _error("runtime_not_active", "A paused or failed experiment cannot record a decision.")
    if state.get("status") == "awaiting_review":
        raise _error("review_pending", "Resolve the pending human review before recording another decision.")
    if state.get("status") == "completed":
        raise _error("experiment_completed", "The replay has no remaining market session for a decision.")
    if state.get("current_date") is None:
        raise _error("no_current_session", "Advance the market to a session before recording a decision.")
    if any(decision.get("as_of_date") == state["current_date"] for decision in state["decisions"]):
        raise _error("decision_exists_for_session", "A decision is already recorded for this market session.")
    original, action, targets = _validate_proposal(state, proposal)
    _activate_pending_team(state)
    decision_id = _next_id(state, "decision")
    mode = state["config"]["mode"]
    status = "awaiting_review" if mode == "human_review" else "approved"
    final_proposal = _safe_copy(original)
    if action == "rebalance":
        final_proposal["targets"] = copy.deepcopy(targets)
    decision = {
        "id": decision_id,
        "as_of_date": state["current_date"],
        "strategy": original.get("strategy"),
        "action": action,
        "status": status,
        "original_proposal": original,
        "final_proposal": final_proposal,
        "review": None,
        "review_request": None,
        "team_snapshot": copy.deepcopy(state["active_team"]),
        "order_id": None,
    }
    state["decisions"].append(decision)
    if status == "awaiting_review":
        state["status"] = "awaiting_review"
        _event(state, "decision_awaiting_review", {"decision_id": decision_id, "action": action})
    else:
        # A newly accepted full allocation supersedes any remainder that was
        # waiting for missing bars. This applies to HOLD as well, which must
        # not allow an older unfilled target to execute later.
        _cancel_open_orders(
            state,
            reason="superseded_by_new_decision",
            decision_id=decision_id,
            include_final_pending=bool(state.get("is_final_session")),
        )
        _event(state, "decision_auto_approved", {"decision_id": decision_id, "action": action})
        if action == "rebalance":
            _queue_order(state, decision, targets or {})
        if state.get("is_final_session"):
            state["status"] = "completed"
    return decision


def record_decision(state: dict[str, Any], proposal: dict[str, Any]) -> dict[str, Any]:
    """Record an immutable original proposal and queue or await review."""
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    staged = copy.deepcopy(state)
    decision = _record_decision_mutating(staged, proposal)
    _ensure_json_state(staged)
    state.clear()
    state.update(staged)
    return copy.deepcopy(state["decisions"][-1])


def _decision_by_id(state: dict[str, Any], decision_id: str) -> dict[str, Any]:
    if not isinstance(decision_id, str):
        raise _error("decision_not_found", "Decision id must be a string.")
    for decision in state["decisions"]:
        if decision["id"] == decision_id:
            return decision
    raise _error("decision_not_found", f"Decision {decision_id} was not found.")


def _review_decision_mutating(
    state: dict[str, Any], decision_id: str, action: str, reason: str, targets: Any
) -> dict[str, Any]:
    decision = _decision_by_id(state, decision_id)
    if action not in ("approve", "modify", "reject"):
        raise _error("invalid_review", "Review action must be approve, modify, or reject.")
    if not isinstance(reason, str):
        raise _error("invalid_review", "Review reason must be text.")
    reason = reason.strip()
    if action in ("modify", "reject") and not reason:
        raise _error("reason_required", f"A reason is required to {action} a proposal.")
    normalized_targets: dict[str, float] | None = None
    if action == "modify":
        normalized_targets = _normalize_targets(state, targets)
    elif targets is not None:
        raise _error("invalid_review", "targets are accepted only for a modify review.")
    request = {"action": action, "reason": reason, "targets": copy.deepcopy(normalized_targets)}
    if decision["review_request"] is not None:
        if decision["review_request"] == request:
            return decision
        raise _error("decision_already_reviewed", "This decision already has a different review result.")
    if decision["status"] != "awaiting_review":
        raise _error("decision_not_reviewable", "Only a decision awaiting review can be reviewed.")

    decision["review_request"] = request
    decision["review"] = {
        "action": action,
        "reason": reason,
        "date": state.get("current_date"),
    }
    if action == "reject":
        decision["status"] = "rejected"
        decision["final_proposal"] = None
        _event(state, "decision_rejected", {"decision_id": decision_id, "reason": reason})
    else:
        decision["status"] = "approved"
        if action == "modify":
            modified = _safe_copy(decision["original_proposal"])
            modified.pop('preserve_symbols',None)
            modified["action"] = "rebalance"
            modified["targets"] = copy.deepcopy(normalized_targets)
            decision["final_proposal"] = modified
        else:
            decision["final_proposal"] = _safe_copy(decision["original_proposal"])
            if decision["action"] == "rebalance":
                decision["final_proposal"]["targets"] = _normalize_targets(state, decision["original_proposal"].get("targets"))
        _event(state, "decision_approved" if action == "approve" else "decision_modified", {"decision_id": decision_id, "reason": reason})
        _cancel_open_orders(
            state,
            reason="superseded_by_reviewed_decision",
            decision_id=decision_id,
            include_final_pending=bool(state.get("is_final_session")),
        )
        if decision["final_proposal"].get("action") == "rebalance":
            _queue_order(state, decision, decision["final_proposal"]["targets"])

    if not any(item["status"] == "awaiting_review" for item in state["decisions"]):
        state["status"] = "completed" if state.get("is_final_session") else "ready"
    return decision


def review_decision(
    state: dict[str, Any],
    decision_id: str,
    action: str,
    reason: str = "",
    targets: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Apply an auditable human review; an identical retry is idempotent."""
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    staged = copy.deepcopy(state)
    _review_decision_mutating(staged, decision_id, action, reason, targets)
    _ensure_json_state(staged)
    state.clear()
    state.update(staged)
    return copy.deepcopy(_decision_by_id(state, decision_id))


def schedule_team(state: dict[str, Any], team: list[dict[str, Any]], pending_policy: str = "keep") -> dict[str, Any]:
    """Schedule an expert-team snapshot for the next decision boundary."""
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    if pending_policy not in ("keep", "discard"):
        raise _error("invalid_pending_policy", "pending_policy must be keep or discard.")
    normalized_team = _normalize_team(team)
    staged = copy.deepcopy(state)
    if staged.get("status") == "completed":
        raise _error("experiment_completed", "A completed replay cannot schedule a team change.")
    discarded_decisions: list[str] = []
    cancelled_orders: list[str] = []
    if pending_policy == "discard":
        for decision in staged["decisions"]:
            if decision["status"] == "awaiting_review":
                decision["status"] = "superseded"
                decision["review"] = {"action": "superseded", "reason": "Discarded by team-change request", "date": staged.get("current_date")}
                discarded_decisions.append(decision["id"])
        cancelled_orders = _cancel_open_orders(
            staged,
            reason="discarded_by_team_change",
            include_final_pending=True,
        )
        if not any(decision["status"] == "awaiting_review" for decision in staged["decisions"]):
            staged["status"] = "completed" if staged.get("is_final_session") else "ready"
    if staged.get("pending_team") is not None:
        _event(staged, "team_change_replaced", {"previous_request": staged["pending_team"]})
    staged["pending_team"] = {
        "team": normalized_team,
        "pending_policy": pending_policy,
        "requested_date": staged.get("current_date"),
    }
    event = _event(
        staged,
        "team_change_scheduled",
        {
            "team": normalized_team,
            "pending_policy": pending_policy,
            "discarded_decisions": discarded_decisions,
            "cancelled_orders": cancelled_orders,
        },
    )
    _ensure_json_state(staged)
    state.clear()
    state.update(staged)
    return copy.deepcopy(state["events"][-1])


def _allocate_equal(symbols: list[str], max_weight: float) -> dict[str, float]:
    if not symbols:
        return {}
    weight = min(max_weight, 1.0 / len(symbols))
    return {symbol: weight for symbol in symbols}


def baseline_proposal(state: dict[str, Any], snapshot: dict[str, Any], strategy: str) -> dict[str, Any]:
    """Build deterministic buy-and-hold or momentum proposals from visible bars."""
    if not isinstance(state, dict) or not isinstance(snapshot, dict):
        raise _error("invalid_snapshot", "State and point-in-time snapshot must be objects.")
    if strategy not in ("buy_hold", "momentum"):
        raise _error("unsupported_strategy", "Only buy_hold and momentum have deterministic baseline proposals.")
    as_of = state.get("current_date")
    if snapshot.get("as_of_date") != as_of:
        raise _error("invalid_snapshot", "Snapshot as_of_date does not match the runtime's current date.")
    snapshot_bars = snapshot.get("bars")
    if not isinstance(snapshot_bars, list):
        raise _error("invalid_snapshot", "Snapshot bars must be a list.")
    for bar in snapshot_bars:
        if not isinstance(bar, dict):
            raise _error("invalid_snapshot", "Every snapshot bar must be an object.")
        bar_date = bar.get("date")
        if not isinstance(bar_date, str):
            raise _error("invalid_snapshot", "Every snapshot bar needs a valid date.")
        try:
            bar_date = _iso_date(bar_date, "snapshot bar date")
        except EngineError as exc:
            raise _error("invalid_snapshot", "Every snapshot bar needs a valid date.") from exc
        if as_of is None or bar_date > as_of:
            raise _error("future_data", "Snapshot contains market data after the current replay date.")
    max_weight = state["config"]["max_position_weight"]
    if strategy == "buy_hold":
        already_started = any(item.get("strategy") == "buy_hold" for item in state["decisions"])
        if already_started:
            return {"action": "hold", "strategy": "buy_hold", "source": "deterministic_baseline", "rationale": "Keep the initial buy-and-hold allocation."}
        available = sorted(
            {
                bar["symbol"]
                for bar in snapshot_bars
                if bar.get("date") == as_of and bar.get("symbol") in state["config"]["symbols"]
            }
        )
        return {
            "action": "rebalance",
            "targets": _allocate_equal(available, max_weight),
            "strategy": "buy_hold",
            "source": "deterministic_baseline",
            "rationale": "Start an equal allocation in symbols with a bar visible at this close, subject to the per-position cap.",
        }

    by_symbol: dict[str, list[dict[str, Any]]] = {}
    for bar in snapshot_bars:
        by_symbol.setdefault(bar.get("symbol"), []).append(bar)
    lookback = state["config"]["momentum_lookback"]
    momentum: list[tuple[float, str]] = []
    for symbol in state["config"]["symbols"]:
        observations = sorted(by_symbol.get(symbol, []), key=lambda item: item["date"])
        if len(observations) < 2:
            continue
        window = observations[-(lookback + 1) :]
        first_close = window[0]["close"]
        last_close = window[-1]["close"]
        score = last_close / first_close - 1.0
        if score > 0:
            momentum.append((score, symbol))
    momentum.sort(key=lambda item: (-item[0], item[1]))
    selected = [symbol for _, symbol in momentum]
    targets = _allocate_equal(selected, max_weight)
    return {
        "action": "rebalance",
        "targets": targets,
        "strategy": "momentum",
        "source": "deterministic_baseline",
        "rationale": f"Allocate equally among symbols with positive trailing close-to-close momentum using at most {lookback} visible intervals; other symbols target cash.",
        "momentum_scores": {symbol: score for score, symbol in momentum},
    }


def performance_metrics(state: dict[str, Any]) -> dict[str, Any]:
    """Calculate close-to-close performance metrics (252 sessions, zero RF)."""
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    initial = float(state["config"]["initial_capital"])
    points = [
        {"date": item["date"], "equity": item["equity"], "daily_return": item["daily_return"]}
        for item in state["history"]
    ]
    final_equity = float(state["equity"])
    total_return = final_equity / initial - 1.0
    returns = [float(item["daily_return"]) for item in state["history"]]
    if len(returns) >= 2:
        mean = sum(returns) / len(returns)
        variance = sum((value - mean) ** 2 for value in returns) / (len(returns) - 1)
        daily_vol = math.sqrt(variance)
    else:
        mean = returns[0] if returns else 0.0
        daily_vol = 0.0
    annual_volatility = daily_vol * math.sqrt(252.0)
    sharpe = mean / daily_vol * math.sqrt(252.0) if daily_vol > 0 else None
    peak = initial
    max_drawdown = 0.0
    for item in state["history"]:
        equity = float(item["equity"])
        peak = max(peak, equity)
        if peak > 0:
            max_drawdown = min(max_drawdown, equity / peak - 1.0)
    return {
        "initial_capital": initial,
        "final_equity": final_equity,
        "total_return": total_return,
        "annualized_volatility": annual_volatility,
        "sharpe_ratio": sharpe,
        "max_drawdown": max_drawdown,
        "fees_paid": float(state["fees_paid"]),
        "slippage_paid": float(state["slippage_paid"]),
        "sessions": len(state["history"]),
        "return_convention": "close-to-close daily equity returns; 252 sessions/year; sample standard deviation; zero risk-free rate; Sharpe is null when sample volatility is zero or unavailable",
        "equity_curve": points,
    }


def benchmark_report(state: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
    """Replay an equal-weight buy-and-hold benchmark through the current date.

    The benchmark is isolated from the experiment state and receives only the
    point-in-time prefix of its pinned bar set. It uses the experiment's
    capital, fee/slippage assumptions, position cap, symbols, and date start.
    No benchmark value is emitted before the experiment has a market date.
    """
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    normalized_bars = _checked_bars(state, bars)
    as_of_date = state.get("current_date")
    if as_of_date is None:
        return {
            "strategy": "buy_hold",
            "as_of_date": None,
            "available": False,
            "history": [],
            "metrics": None,
            "pending_orders": [],
        }
    visible_bars = [
        bar
        for bar in normalized_bars
        if bar["date"] <= as_of_date
        and state["config"]["start_date"] <= bar["date"] <= state["config"]["end_date"]
        and bar["symbol"] in state["config"]["symbols"]
    ]
    if not visible_bars:
        return {
            "strategy": "buy_hold",
            "as_of_date": as_of_date,
            "available": False,
            "history": [],
            "metrics": None,
            "pending_orders": [],
        }
    benchmark_config = copy.deepcopy(state["config"])
    benchmark_config["mode"] = "ai_only"
    benchmark_config["team"] = []
    benchmark_state = create_state(benchmark_config, visible_bars)
    for _ in _sessions(benchmark_state["config"], visible_bars):
        # This replay owns its state and validated bars. Reuse the ledger
        # mutations without copying the growing audit history every session.
        _advance_market_mutating(benchmark_state, visible_bars)
        snapshot = {
            "as_of_date": benchmark_state["current_date"],
            "bars": [bar for bar in visible_bars if bar["date"] == benchmark_state["current_date"]],
        }
        proposal = baseline_proposal(benchmark_state, snapshot, "buy_hold")
        _record_decision_mutating(benchmark_state, proposal)
    _ensure_json_state(benchmark_state)
    metrics = performance_metrics(benchmark_state)
    metrics.pop("equity_curve", None)
    pending_orders = [
        {
            "id": order["id"],
            "created_date": order["created_date"],
            "status": order["status"],
            "target_weights": copy.deepcopy(order["target_weights"]),
            "pending_symbols": copy.deepcopy(order.get("pending_symbols", [])),
        }
        for order in benchmark_state["orders"]
        if order["status"] in ("queued", "partially_filled", "pending_final_session")
    ]
    return {
        "strategy": "buy_hold",
        "as_of_date": as_of_date,
        "available": True,
        "history": copy.deepcopy(benchmark_state["history"]),
        "metrics": metrics,
        "pending_orders": pending_orders,
    }


__all__ = [
    "EngineError",
    "advance_market",
    "baseline_proposal",
    "benchmark_report",
    "create_state",
    "performance_metrics",
    "prepare_decision",
    "record_decision",
    "review_decision",
    "schedule_team",
    "visible_snapshot",
]
