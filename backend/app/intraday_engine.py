"""Timestamp-aware, append-only bar replay runtime for simulated trading.

This module is intentionally independent from FastAPI, persistence, providers,
and the daily engine.  It accepts completed minute/hour bars, keeps the bars
that have become observable, and freezes the exact point-in-time inputs used
by every decision.  It never sends a brokerage order.

Historical execution uses the first eligible later bar open.  Live-forward
bar simulation uses the close of a newly observed completed bar and timestamps
the simulated fill at the local processing clock.  Each fill also preserves
the source bar's observation, availability, and receipt times.  This avoids
backdating a live fill to an open that happened before the completed bar was
received.  Neither mode models ticks, queue priority, or market impact.

Holding horizons are elapsed UTC durations.  When a position reaches its
expiry, the runtime queues a system cash-exit for the first eligible later
execution and records that action separately from model decisions.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any


UTC = timezone.utc
EPSILON = 1e-10
SECRET_PARTS = ("api_key", "apikey", "secret", "password", "authorization", "access_token", "refresh_token")
BAR_INTERVALS = {"1m": 60, "1h": 3600, "1d": 86400}
DURATION_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|min|h|d)\s*$", re.IGNORECASE)


class IntradayEngineError(ValueError):
    """Stable runtime error with a safe, client-displayable detail."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _error(code: str, detail: str) -> IntradayEngineError:
    return IntradayEngineError(code, detail)


def _secret_key(key: Any) -> bool:
    lowered = str(key).lower().replace("-", "_")
    return any(part in lowered for part in SECRET_PARTS)


def _safe_copy(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _safe_copy(v) for k, v in value.items() if not _secret_key(k)}
    if isinstance(value, (list, tuple)):
        return [_safe_copy(item) for item in value]
    if value is None or isinstance(value, (str, bool, int)):
        return copy.deepcopy(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _error("invalid_json", "Runtime inputs must contain only finite JSON numbers.")
        return value
    raise _error("invalid_json", "Runtime inputs must contain only JSON-compatible values.")


def _finite(value: Any, label: str, *, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _error("invalid_number", f"{label} must be a finite number.")
    result = float(value)
    if not math.isfinite(result) or (minimum is not None and result < minimum):
        raise _error("invalid_number", f"{label} must be a finite number at least {minimum or 0:g}.")
    return result


def _timestamp(value: Any, label: str, *, optional: bool = False) -> datetime | None:
    if value is None and optional:
        return None
    if not isinstance(value, str) or not value.strip():
        raise _error("invalid_timestamp", f"{label} must be an RFC3339 timestamp with an explicit UTC offset.")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise _error("invalid_timestamp", f"{label} must be an RFC3339 timestamp with an explicit UTC offset.") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise _error("invalid_timestamp", f"{label} must include a timezone offset; naive timestamps are not accepted.")
    return parsed.astimezone(UTC)


def _later_timestamp_iso(current: str | None, candidate: datetime, label: str) -> str:
    current_time = _timestamp(current, label, optional=True)
    return _iso(max(current_time, candidate))


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    value = value.astimezone(UTC)
    timespec = "microseconds" if value.microsecond else "seconds"
    return value.isoformat(timespec=timespec).replace("+00:00", "Z")


def _seconds(value: Any, label: str, *, optional: bool = False) -> float | None:
    if value is None and optional:
        return None
    if not isinstance(value, str):
        raise _error("invalid_duration", f"{label} must use a duration such as 15m, 4h, or 7d.")
    match = DURATION_RE.fullmatch(value)
    if not match:
        raise _error("invalid_duration", f"{label} must use a duration such as 15m, 4h, or 7d.")
    number = float(match.group(1))
    unit = match.group(2).lower()
    scale = {"ms": 0.001, "s": 1.0, "m": 60.0, "min": 60.0, "h": 3600.0, "d": 86400.0}[unit]
    result = number * scale
    if not math.isfinite(result) or result <= 0:
        raise _error("invalid_duration", f"{label} must be greater than zero.")
    return result


def _symbol(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _error("invalid_symbol", "Every market symbol must be a non-empty string.")
    return value.strip().upper()


def _normalize_interval(value: Any) -> str:
    aliases = {"1min": "1m", "1minute": "1m", "1hour": "1h", "1day": "1d"}
    interval = aliases.get(str(value).strip().lower(), str(value).strip().lower())
    if interval not in BAR_INTERVALS:
        raise _error("invalid_bar_interval", "bar_interval must be 1m, 1h, or 1d.")
    return interval


def _normalize_team(team: Any) -> list[dict[str, Any]]:
    if not isinstance(team, list):
        raise _error("invalid_team", "Team must be a list of expert assignments.")
    result: list[dict[str, Any]] = []
    for index, raw in enumerate(team):
        if not isinstance(raw, dict):
            raise _error("invalid_team", f"Team assignment {index + 1} must be an object.")
        expert_id = raw.get("expert_id", raw.get("id"))
        if not isinstance(expert_id, str) or not expert_id.strip():
            raise _error("invalid_team", f"Team assignment {index + 1} needs an expert_id.")
        role = raw.get("role", "trader")
        enabled = raw.get("enabled", True)
        if not isinstance(role, str) or not role.strip() or not isinstance(enabled, bool):
            raise _error("invalid_team", f"Team assignment {index + 1} has an invalid role or enabled flag.")
        cleaned = _safe_copy(raw)
        cleaned.update({"expert_id": expert_id.strip(), "role": role.strip(), "enabled": enabled})
        result.append(cleaned)
    return result


def _normalize_config(config: Any, bars: list[dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise _error("invalid_config", "Experiment config must be an object.")
    market_mode = config.get("market_mode", "historical")
    if market_mode not in ("historical", "live"):
        raise _error("invalid_config", "market_mode must be historical or live.")
    bar_interval = _normalize_interval(config.get("bar_interval", "1m"))
    duration_interval = _seconds(config.get("decision_interval", bar_interval), "decision_interval")
    holding_horizon = _seconds(config.get("holding_horizon"), "holding_horizon", optional=True)
    if market_mode == "historical" and not bars:
        raise _error("no_market_data", "A historical intraday experiment needs at least one market bar.")
    raw_symbols = config.get("symbols")
    if raw_symbols is None:
        symbols = sorted({bar["symbol"] for bar in bars})
    elif not isinstance(raw_symbols, list) or not raw_symbols:
        raise _error("invalid_config", "symbols must be a non-empty list.")
    else:
        symbols = sorted({_symbol(item) for item in raw_symbols})
        if len(symbols) != len(raw_symbols):
            raise _error("invalid_config", "symbols must not contain duplicates.")
    if not symbols:
        raise _error("invalid_config", "At least one market symbol is required.")
    capital = _finite(config.get("initial_capital", 100_000), "initial_capital", minimum=0)
    if capital <= 0:
        raise _error("invalid_config", "initial_capital must be greater than zero.")
    fee_bps = _finite(config.get("fee_bps", 0), "fee_bps", minimum=0)
    slippage_bps = _finite(config.get("slippage_bps", 0), "slippage_bps", minimum=0)
    if fee_bps >= 10_000 or slippage_bps >= 10_000:
        raise _error("invalid_config", "fee_bps and slippage_bps must be below 10000.")
    max_weight = _finite(config.get("max_position_weight", 1), "max_position_weight", minimum=0)
    if max_weight <= 0 or max_weight > 1:
        raise _error("invalid_config", "max_position_weight must be greater than zero and no more than one.")
    mode = config.get("mode", "ai_only")
    if mode not in ("ai_only", "human_review"):
        raise _error("invalid_config", "mode must be ai_only or human_review.")
    lookback = config.get("momentum_lookback", 20)
    if isinstance(lookback, bool) or not isinstance(lookback, int) or lookback < 1:
        raise _error("invalid_config", "momentum_lookback must be a positive integer.")
    latency = config.get("latency_assumptions", {})
    if not isinstance(latency, dict):
        raise _error("invalid_config", "latency_assumptions must be an object.")
    simulated_latency_ms = _finite(latency.get("simulated_latency_ms", 1000), "simulated_latency_ms", minimum=0)
    if simulated_latency_ms > 86_400_000:
        raise _error("invalid_config", "simulated_latency_ms must not exceed one day.")
    live_age = _finite(config.get("max_live_data_age_seconds", 120), "max_live_data_age_seconds", minimum=0)
    if live_age <= 0:
        raise _error("invalid_config", "max_live_data_age_seconds must be greater than zero.")
    normalized = {key: _safe_copy(value) for key, value in config.items() if key not in {"api_key", "apiKey", "secret"} and not _secret_key(key)}
    normalized.update(
        {
            "schema_version": 2,
            "market_mode": market_mode,
            "bar_interval": bar_interval,
            "decision_interval": config.get("decision_interval", bar_interval),
            "decision_interval_seconds": duration_interval,
            "holding_horizon": config.get("holding_horizon"),
            "holding_horizon_seconds": holding_horizon,
            "latency_assumptions": {**_safe_copy(latency), "simulated_latency_ms": simulated_latency_ms},
            "max_live_data_age_seconds": live_age,
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
    return normalized


def _normalize_bar(raw: Any, index: int, config: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise _error("invalid_bars", f"Bar {index + 1} must be an object.")
    symbol = _symbol(raw.get("symbol"))
    start = _timestamp(raw.get("bar_start"), f"Bar {index + 1} bar_start")
    end = _timestamp(raw.get("bar_end"), f"Bar {index + 1} bar_end")
    assert start is not None and end is not None
    if start >= end:
        raise _error("invalid_bars", f"Bar {index + 1} bar_start must be before bar_end.")
    timeframe = _normalize_interval(raw.get("timeframe", (config or {}).get("bar_interval", "1m")))
    if config and timeframe != config["bar_interval"]:
        raise _error("bar_interval_mismatch", f"Bar timeframe {timeframe} does not match experiment interval {config['bar_interval']}.")
    complete = raw.get("is_complete", True)
    if not isinstance(complete, bool):
        raise _error("invalid_bars", f"Bar {index + 1} is_complete must be boolean.")
    available_at = _timestamp(raw.get("available_at", _iso(end)), f"Bar {index + 1} available_at")
    received_at = _timestamp(raw.get("received_at", _iso(available_at)), f"Bar {index + 1} received_at")
    assert available_at is not None and received_at is not None
    if complete and available_at < end:
        raise _error("invalid_bars", f"Completed bar {index + 1} cannot be available before its bar_end.")
    prices: dict[str, float] = {}
    for field in ("open", "high", "low", "close"):
        prices[field] = _finite(raw.get(field), f"{symbol} {field}", minimum=0)
        if prices[field] <= 0:
            raise _error("invalid_bars", f"Prices for {symbol} must be positive.")
    volume = _finite(raw.get("volume", 0), f"{symbol} volume", minimum=0)
    if prices["high"] + EPSILON < max(prices["open"], prices["close"]) or prices["low"] - EPSILON > min(prices["open"], prices["close"]) or prices["low"] > prices["high"]:
        raise _error("invalid_bars", f"OHLC range is inconsistent for {symbol}.")
    source_feed = raw.get("source_feed", "unspecified")
    if not isinstance(source_feed, str) or not source_feed.strip():
        raise _error("invalid_bars", "source_feed must be a non-empty string.")
    revision = raw.get("revision", 0)
    if not isinstance(revision, (str, int)) or isinstance(revision, bool):
        raise _error("invalid_bars", "revision must be a string or integer.")
    revision = str(revision)
    supplied_id = raw.get("event_id")
    if supplied_id is not None and (not isinstance(supplied_id, str) or not supplied_id.strip()):
        raise _error("invalid_bars", "event_id must be a non-empty string when provided.")
    natural = "|".join((symbol, timeframe, _iso(start) or "", _iso(end) or "", source_feed.strip(), revision))
    event_id = supplied_id.strip() if supplied_id else hashlib.sha256(natural.encode()).hexdigest()[:24]
    return {
        "event_id": event_id,
        "revision": revision,
        "symbol": symbol,
        "bar_start": _iso(start),
        "bar_end": _iso(end),
        "available_at": _iso(available_at),
        "received_at": _iso(received_at),
        "timeframe": timeframe,
        "source_feed": source_feed.strip(),
        "open": prices["open"],
        "high": prices["high"],
        "low": prices["low"],
        "close": prices["close"],
        "volume": volume,
        "is_complete": complete,
    }


def _bar_fingerprint(bar: dict[str, Any], *, live: bool) -> str:
    # Local receipt time may differ when the same upstream event is redelivered;
    # keep the first observed timestamp, but treat an otherwise-identical event
    # as an idempotent retry. Market/source payload fields remain fingerprinted.
    stable = {key: value for key, value in bar.items() if key != "received_at"}
    if live and bar.get("available_at") == bar.get("received_at"):
        # The live adapter may use its receive instant as the arrival bound.
        # Ignore that transport-derived clock only when it is explicitly the
        # same instant as received_at; source availability remains meaningful.
        stable.pop("available_at", None)
    return hashlib.sha256(json.dumps(stable, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _bar_visible_at(state: dict[str, Any], bar: dict[str, Any]) -> datetime:
    available = _timestamp(bar["available_at"], "available_at")
    received = _timestamp(bar["received_at"], "received_at")
    assert available is not None and received is not None
    if state["config"]["market_mode"] == "live":
        return max(available, received)
    return available


def _natural_key(bar: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (bar["symbol"], bar["timeframe"], bar["bar_start"], bar["bar_end"], bar["source_feed"])


def _event(state: dict[str, Any], event_type: str, details: dict[str, Any] | None = None, *, at: str | None = None) -> dict[str, Any]:
    state["_seq"]["event"] += 1
    event = {
        "id": f"event-{state['_seq']['event']}",
        "timestamp": at or state.get("current_time"),
        "type": event_type,
        "details": _safe_copy(details or {}),
    }
    state["events"].append(event)
    return event


def _ensure_state(state: dict[str, Any]) -> None:
    try:
        json.dumps(state, allow_nan=False)
    except (TypeError, ValueError, OverflowError) as exc:
        raise _error("non_finite_result", "Runtime result could not be represented as finite JSON.") from exc


def _commit(state: dict[str, Any], staged: dict[str, Any]) -> None:
    _ensure_state(staged)
    state.clear()
    state.update(staged)


def create_state(config: dict[str, Any], bars: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Create schema-v2 state; bars are validated for config/universe only.

    No bars enter the point-in-time store until ``advance_market`` observes
    them.  Historical callers pass the pinned source set to infer symbols,
    then append each replay event with the corresponding ``as_of`` clock.
    Live experiments may start without warmup bars when symbols are explicit.
    """
    raw_bars = bars or []
    if not isinstance(raw_bars, list):
        raise _error("invalid_bars", "Market bars must be a list.")
    interval_hint = _normalize_interval(config.get("bar_interval", "1m"))
    normalized_for_config = [_normalize_bar(raw, i, {"bar_interval": interval_hint}) for i, raw in enumerate(raw_bars)]
    normalized_config = _normalize_config(config, normalized_for_config)
    for bar in normalized_for_config:
        if bar["timeframe"] != normalized_config["bar_interval"]:
            raise _error("bar_interval_mismatch", "Initial bars must match the configured bar_interval.")
        if bar["symbol"] not in normalized_config["symbols"]:
            raise _error("invalid_bars", f"Bar symbol {bar['symbol']} is not in the experiment universe.")
    capital = normalized_config["initial_capital"]
    return {
        "schema_version": 2,
        "config": normalized_config,
        "current_time": None,
        "as_of_time": None,
        "current_date": None,
        "status": "ready",
        "cash": capital,
        "positions": {},
        "equity": capital,
        "fees_paid": 0.0,
        "slippage_paid": 0.0,
        "history": [],
        "decisions": [],
        "decision_skips": [],
        "orders": [],
        "events": [],
        "bar_events": [],
        "active_team": copy.deepcopy(normalized_config["team"]),
        "pending_team": None,
        "last_decision_at": None,
        "last_decision_bar_end": None,
        "next_decision_at": None,
        "decision_in_flight": None,
        "holding_expires_at": None,
        "decision_block_until": None,
        "is_final": False,
        "_consumed_fill_boundaries": [],
        "_seen_bar_events": {},
        "_seq": {"decision": 0, "order": 0, "event": 0, "bar": 0},
    }


def _ingest(state: dict[str, Any], bars: list[dict[str, Any]], as_of: datetime) -> list[str]:
    seen = state.setdefault("_seen_bar_events", {})
    new_ids: list[str] = []
    for index, raw in enumerate(bars):
        bar = _normalize_bar(raw, index, state["config"])
        if bar["symbol"] not in state["config"]["symbols"]:
            raise _error("invalid_bars", f"Bar symbol {bar['symbol']} is not in the experiment universe.")
        observed_at = _bar_visible_at(state, bar)
        bar_end = _timestamp(bar["bar_end"], "bar_end")
        assert bar_end is not None
        if observed_at > as_of or (bar["is_complete"] and bar_end > as_of):
            # Callers may pass a page that includes not-yet-due events.  They
            # are ignored until a later advance submits them at an eligible
            # replay clock; they are never retained as future-visible state.
            continue
        fingerprint = _bar_fingerprint(bar, live=state["config"]["market_mode"] == "live")
        prior = seen.get(bar["event_id"])
        if prior is not None:
            if prior != fingerprint:
                raise _error("bar_event_conflict", f"Bar event {bar['event_id']} was already recorded with different contents.")
            continue
        state["_seq"]["bar"] += 1
        stored = {**bar, "_event_seq": state["_seq"]["bar"], "_visible_at": _iso(observed_at)}
        state["bar_events"].append(stored)
        seen[bar["event_id"]] = fingerprint
        new_ids.append(bar["event_id"])
    return new_ids


def unseen_bar_event_ids(state: dict[str, Any], bars: list[dict[str, Any]]) -> list[str]:
    """Return event IDs not yet ingested, validating retries and conflicts.

    The persistence layer can use this helper to recover durable market events
    after a dropped in-memory queue batch.  It does not mutate state or filter
    by time; callers still pass the selected events to ``advance_market`` at a
    monotonic clock so the runtime can enforce point-in-time visibility.
    """
    if not isinstance(state, dict) or state.get("schema_version") != 2:
        raise _error("invalid_state", "Intraday state must use schema_version 2.")
    if not isinstance(bars, list):
        raise _error("invalid_bars", "Market bars must be a list.")
    seen = state.get("_seen_bar_events", {})
    pending: dict[str, str] = {}
    unseen: list[str] = []
    for index, raw in enumerate(bars):
        bar = _normalize_bar(raw, index, state["config"])
        if bar["symbol"] not in state["config"]["symbols"]:
            raise _error("invalid_bars", f"Bar symbol {bar['symbol']} is not in the experiment universe.")
        fingerprint = _bar_fingerprint(bar, live=state["config"]["market_mode"] == "live")
        prior = seen.get(bar["event_id"], pending.get(bar["event_id"]))
        if prior is not None:
            if prior != fingerprint:
                raise _error("bar_event_conflict", f"Bar event {bar['event_id']} was already recorded with different contents.")
            continue
        pending[bar["event_id"]] = fingerprint
        unseen.append(bar["event_id"])
    return unseen


def _effective_bars(state: dict[str, Any], as_of: datetime, *, include_forming: bool = False) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    events = state.get("bar_events", [])
    latest: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    for bar in events:
        visible = _timestamp(bar.get("_visible_at"), "visible_at")
        end = _timestamp(bar.get("bar_end"), "bar_end")
        if visible is None or end is None or visible > as_of:
            continue
        if not bar.get("is_complete") or end > as_of:
            continue
        key = _natural_key(bar)
        prior = latest.get(key)
        if prior is None or (bar["_event_seq"] > prior["_event_seq"]):
            latest[key] = bar
    complete = sorted(latest.values(), key=lambda b: (_timestamp(b["bar_end"], "bar_end"), b["symbol"], b["source_feed"]))
    forming: list[dict[str, Any]] = []
    if include_forming:
        for bar in events:
            visible = _timestamp(bar.get("_visible_at"), "visible_at")
            start = _timestamp(bar.get("bar_start"), "bar_start")
            end = _timestamp(bar.get("bar_end"), "bar_end")
            if visible is not None and start is not None and end is not None and visible <= as_of and start <= as_of < end and not bar.get("is_complete"):
                forming.append(bar)
        forming.sort(key=lambda b: (_timestamp(b["bar_end"], "bar_end"), b["symbol"]))
    return complete, forming


def _public_bar(bar: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in bar.items() if not key.startswith("_")}


def _visible_clock(state: dict[str, Any], as_of: str | datetime | None) -> datetime | None:
    if as_of is not None:
        if isinstance(as_of, str):
            return _timestamp(as_of, "as_of")
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise _error("invalid_timestamp", "as_of must include a timezone offset.")
        return as_of.astimezone(UTC)
    return _timestamp(state.get("current_time"), "current_time", optional=True)


def visible_snapshot(state: dict[str, Any], bars: list[dict[str, Any]] | None = None, *, as_of: str | datetime | None = None) -> dict[str, Any]:
    """Return complete, point-in-time bars and separately flagged forming bars."""
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    clock = _visible_clock(state, as_of)
    if clock is None:
        return {"as_of_time": None, "current_date": None, "symbols": list(state["config"]["symbols"]), "bars": [], "forming_bars": [], "positions": copy.deepcopy(state.get("positions", {})), "cash": state.get("cash"), "equity": state.get("equity"), "history": copy.deepcopy(state.get("history", []))}
    if bars:
        # Compatibility convenience: only already-due input is appended.  The
        # state clock is not moved by a read-only snapshot operation.
        staged = copy.deepcopy(state)
        _ingest(staged, bars, clock)
        source = staged
    else:
        source = state
    complete, forming = _effective_bars(source, clock, include_forming=True)
    result_bars = [_public_bar(bar) for bar in complete]
    result_forming = [_public_bar(bar) for bar in forming]
    history = [point for point in state.get("history", []) if (_timestamp(point.get("as_of_time"), "history as_of_time", optional=True) or datetime.min.replace(tzinfo=UTC)) <= clock]
    selected = history[-1] if history else None
    if selected is None:
        positions = {}
        cash = float(state["config"]["initial_capital"])
        equity = cash
        fees_paid_total = 0.0
        slippage_paid_total = 0.0
        interval_return = 0.0
    else:
        positions = copy.deepcopy(selected.get("positions", {}))
        cash = float(selected.get("cash", state["config"]["initial_capital"]))
        equity = float(selected.get("equity", cash))
        fees_paid_total = float(selected.get("fees_paid_total", 0.0))
        slippage_paid_total = float(selected.get("slippage_paid_total", 0.0))
        interval_return = float(selected.get("interval_return", 0.0))
    return {
        "as_of_time": _iso(clock),
        "current_date": _iso(clock)[:10],
        "symbols": list(state["config"]["symbols"]),
        "bars": result_bars,
        "forming_bars": result_forming,
        "positions": positions,
        "cash": cash,
        "equity": equity,
        "market_value": float(equity - cash),
        "fees_paid_total": fees_paid_total,
        "slippage_paid_total": slippage_paid_total,
        "interval_return": interval_return,
        "history": copy.deepcopy(history),
        "input_event_ids": [bar["event_id"] for bar in complete],
    }


def _open_orders(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [order for order in state["orders"] if order.get("status") in ("queued", "partially_filled")]


def _price_map_at(state: dict[str, Any], bars: list[dict[str, Any]], *, field: str) -> dict[str, float]:
    result: dict[str, float] = {}
    for bar in bars:
        result[bar["symbol"]] = float(bar[field])
    return result


def _portfolio_value(state: dict[str, Any], prices: dict[str, float]) -> float:
    total = float(state["cash"])
    for symbol, position in state["positions"].items():
        price = prices.get(symbol, position.get("last_price"))
        if price is not None:
            total += float(position["quantity"]) * float(price)
    return total


def _mark(state: dict[str, Any], bars: list[dict[str, Any]], at: datetime, new_event_ids: set[str]) -> None:
    latest_by_symbol: dict[str, dict[str, Any]] = {}
    for bar in bars:
        prior = latest_by_symbol.get(bar["symbol"])
        bar_end = _timestamp(bar["bar_end"], "bar_end")
        prior_end = _timestamp(prior["bar_end"], "bar_end") if prior is not None else None
        if prior is None or (bar_end, bar["_event_seq"]) > (prior_end, prior["_event_seq"]):
            latest_by_symbol[bar["symbol"]] = bar
    for bar in latest_by_symbol.values():
        position = state["positions"].get(bar["symbol"])
        if position is not None:
            position["last_price"] = float(bar["close"])
            position["last_price_at"] = bar["bar_end"]
    prices = {symbol: float(pos["last_price"]) for symbol, pos in state["positions"].items() if pos.get("last_price") is not None}
    state["equity"] = _portfolio_value(state, prices)
    if not math.isfinite(state["equity"]):
        raise _error("non_finite_result", "Portfolio equity became non-finite.")
    new_complete = [bar for bar in bars if bar["event_id"] in new_event_ids and bar["is_complete"]]
    if new_complete:
        newest_end_time = max(_timestamp(bar["bar_end"], "bar_end") for bar in new_complete)
        newest_end = _iso(newest_end_time)
        assert newest_end is not None
        boundary_bars = [bar for bar in bars if bar["bar_end"] == newest_end]
        boundary_time = _timestamp(newest_end, "bar_end")
        assert boundary_time is not None
        available_at_time = max(_timestamp(bar["_visible_at"], "visible_at") for bar in boundary_bars)
        available_at = _iso(available_at_time)
        assert available_at is not None
        prior_points = [point for point in state["history"] if point.get("bar_end") != newest_end]
        prior_equity = float(prior_points[-1]["equity"]) if prior_points else float(state["config"]["initial_capital"])
        point = {
            "date": newest_end[:10],
            "timestamp": newest_end,
            "bar_end": newest_end,
            "as_of_time": _iso(at),
            "available_at": available_at,
            "bar_event_ids": sorted({bar["event_id"] for bar in boundary_bars}),
            "equity": float(state["equity"]),
            "cash": float(state["cash"]),
            "market_value": float(state["equity"] - state["cash"]),
            "fees_paid_total": float(state["fees_paid"]),
            "slippage_paid_total": float(state["slippage_paid"]),
            "interval_return": float(state["equity"] / prior_equity - 1.0) if prior_equity > 0 else 0.0,
            "positions": copy.deepcopy(state["positions"]),
        }
        if state["history"] and state["history"][-1].get("bar_end") == newest_end:
            state["history"][-1] = point
        else:
            last_history_end = _timestamp(state["history"][-1].get("bar_end"), "history bar_end", optional=True) if state["history"] else None
            if not state["history"] or (last_history_end is not None and last_history_end < boundary_time):
                state["history"].append(point)


def _positions_targets(state: dict[str, Any]) -> dict[str, float]:
    prices = {symbol: float(pos["last_price"]) for symbol, pos in state["positions"].items() if pos.get("last_price")}
    equity = _portfolio_value(state, prices)
    if equity <= 0:
        return {}
    return {symbol: float(pos["quantity"]) * prices.get(symbol, float(pos.get("last_price") or 0)) / equity for symbol, pos in state["positions"].items() if float(pos.get("quantity", 0)) > EPSILON}


def _normal_targets(state: dict[str, Any], targets: Any) -> dict[str, float]:
    if not isinstance(targets, dict):
        raise _error("invalid_targets", "Rebalance targets must be an object of symbol weights.")
    allowed = set(state["config"]["symbols"])
    result = {symbol: 0.0 for symbol in state["config"]["symbols"]}
    for raw_symbol, raw_weight in targets.items():
        symbol = _symbol(raw_symbol)
        if symbol not in allowed:
            raise _error("invalid_targets", f"Target symbol {symbol} is not in this experiment.")
        weight = _finite(raw_weight, f"{symbol} target weight", minimum=0)
        if weight > state["config"]["max_position_weight"] + EPSILON:
            raise _error("position_limit", f"{symbol} target weight exceeds the configured per-position maximum.")
        result[symbol] = weight
    if sum(result.values()) > 1.0 + EPSILON:
        raise _error("cash_limit", "Target weights cannot use more than 100% of portfolio equity.")
    return result


def _proposal(state: dict[str, Any], proposal: Any) -> tuple[dict[str, Any], str, dict[str, float] | None]:
    if not isinstance(proposal, dict):
        raise _error("invalid_proposal", "Proposal must be an object.")
    from .score_fusion import validated_preserve
    validated_preserve(state,proposal)
    action = proposal.get("action")
    if action not in ("hold", "rebalance"):
        raise _error("invalid_proposal", "Proposal action must be hold or rebalance.")
    if action == "hold":
        if proposal.get("targets") not in (None, {}):
            raise _error("invalid_proposal", "A hold proposal must omit targets or provide an empty object.")
        return _safe_copy(proposal), action, None
    if "targets" not in proposal:
        raise _error("invalid_proposal", "A rebalance proposal requires a targets object.")
    return _safe_copy(proposal), action, _normal_targets(state, proposal["targets"])


def _next_id(state: dict[str, Any], kind: str) -> str:
    state["_seq"][kind] += 1
    return f"{kind}-{state['_seq'][kind]}"


def _activate_team(state: dict[str, Any]) -> None:
    pending = state.get("pending_team")
    if not pending:
        return
    previous = copy.deepcopy(state["active_team"])
    state["active_team"] = copy.deepcopy(pending["team"])
    state["pending_team"] = None
    _event(state, "team_activated", {"previous_team": previous, "active_team": state["active_team"], "requested_at": pending.get("requested_at")})


def prepare_decision(state: dict[str, Any], *, decision_started_at: str | None = None) -> dict[str, Any]:
    """Activate the scheduled team and freeze the exact snapshot before inference."""
    if not isinstance(state, dict):
        raise _error("invalid_state", "Runtime state must be an object.")
    if not needs_decision(state, as_of=decision_started_at):
        raise _error("decision_boundary_unavailable", "There is no fresh eligible decision boundary.")
    staged = copy.deepcopy(state)
    started = _timestamp(decision_started_at, "decision_started_at") if decision_started_at else _timestamp(staged.get("current_time"), "current_time")
    assert started is not None
    _activate_team(staged)
    snapshot = visible_snapshot(staged, as_of=started)
    in_flight = {"id": _next_id(staged, "decision"), "started_at": _iso(started), "snapshot": snapshot}
    staged["decision_in_flight"] = in_flight
    _event(staged, "decision_started", {"decision_id": in_flight["id"], "as_of_time": _iso(started), "input_event_ids": snapshot.get("input_event_ids", [])}, at=_iso(started))
    _commit(state, staged)
    return copy.deepcopy(state["decision_in_flight"])


def _decision_gate_clock(state: dict[str, Any], as_of: str | datetime | None) -> datetime | None:
    if as_of is not None:
        if isinstance(as_of, str):
            return _timestamp(as_of, "as_of")
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise _error("invalid_timestamp", "as_of must include a timezone offset.")
        return as_of.astimezone(UTC)
    return _timestamp(state.get("current_time"), "current_time", optional=True)


def needs_decision(state: dict[str, Any], *, as_of: str | datetime | None = None) -> bool:
    """Whether one fresh completed-bar decision is due at the current clock."""
    if not isinstance(state, dict) or state.get("schema_version") != 2:
        raise _error("invalid_state", "Intraday state must use schema_version 2.")
    if state.get("status") in ("paused", "failed", "completed", "awaiting_review") or state.get("is_final") or state.get("decision_in_flight"):
        return False
    if any(
        order.get("source") == "system_hold_expiry" and order.get("status") in ("queued", "partially_filled")
        for order in state.get("orders", [])
    ):
        return False
    clock = _decision_gate_clock(state, as_of)
    if clock is None:
        return False
    complete, _ = _effective_bars(state, clock)
    eligible = [bar for bar in complete if bar["symbol"] in state["config"]["symbols"]]
    if not eligible:
        return False
    latest_end = max(_timestamp(bar["bar_end"], "bar_end") for bar in eligible)
    assert latest_end is not None
    if state.get("last_decision_bar_end"):
        prior_end = _timestamp(state["last_decision_bar_end"], "last_decision_bar_end")
        if prior_end is not None and latest_end <= prior_end:
            return False
    if state.get("next_decision_at"):
        due = _timestamp(state["next_decision_at"], "next_decision_at")
        if due is not None and clock < due:
            return False
    if state["config"]["market_mode"] == "live":
        latest_observed = max(_timestamp(bar.get("_visible_at"), "visible_at") for bar in eligible)
        assert latest_observed is not None
        if (clock - latest_observed).total_seconds() > state["config"]["max_live_data_age_seconds"] or (clock - latest_end).total_seconds() > state["config"]["max_live_data_age_seconds"]:
            return False
    block_until = _timestamp(state.get("decision_block_until"), "decision_block_until", optional=True)
    if block_until is not None and latest_end <= block_until:
        return False
    return True


def record_skipped_decision_boundaries(
    state: dict[str, Any],
    *,
    through_time: str,
    reason: str,
    eligible_event_ids: list[str],
) -> list[dict[str, Any]]:
    """Audit scheduled decision boundaries crossed while no decision ran.

    A boundary is recorded only if a complete bar from ``eligible_event_ids``
    was visible by that scheduled instant and extends beyond the previous
    decision's bar boundary. Records are audit-only: they never move the
    runtime clock or alter market history, decisions, or frozen inputs.
    """
    if not isinstance(state, dict) or state.get("schema_version") != 2:
        raise _error("invalid_state", "Intraday state must use schema_version 2.")
    if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 120:
        raise _error("invalid_skip_reason", "reason must be non-empty text of at most 120 characters.")
    if not isinstance(eligible_event_ids, list) or any(not isinstance(item, str) or not item for item in eligible_event_ids):
        raise _error("invalid_bar_event_ids", "eligible_event_ids must be a list of non-empty event IDs.")
    through = _timestamp(through_time, "through_time")
    current = _timestamp(state.get("current_time"), "current_time", optional=True)
    if current is None or through is None or through > current:
        raise _error("invalid_skip_time", "through_time must be at or before the current runtime clock.")
    due = _timestamp(state.get("next_decision_at"), "next_decision_at", optional=True)
    if due is None:
        return []
    interval = float(state["config"]["decision_interval_seconds"])
    if interval <= 0:
        raise _error("invalid_config", "decision_interval must be greater than zero.")
    seen = state.get("_seen_bar_events", {})
    eligible_ids = set(eligible_event_ids)
    unknown_ids = eligible_ids - set(seen)
    if unknown_ids:
        raise _error("unknown_bar_event_id", "Every eligible_event_id must already be visible to this experiment.")
    prior_end = _timestamp(state.get("last_decision_bar_end"), "last_decision_bar_end", optional=True)
    candidates: list[tuple[datetime, str]] = []
    for bar in state.get("bar_events", []):
        if bar.get("event_id") not in eligible_ids or not bar.get("is_complete"):
            continue
        visible = _timestamp(bar.get("_visible_at"), "visible_at")
        bar_end = _timestamp(bar.get("bar_end"), "bar_end")
        if visible is None or bar_end is None or (prior_end is not None and bar_end <= prior_end):
            continue
        if visible < through:
            candidates.append((visible, bar["event_id"]))
    if not candidates:
        return []

    earliest_visible = min(item[0] for item in candidates)
    offset = (earliest_visible - due).total_seconds()
    first_index = max(0, math.ceil(offset / interval - 1e-12))
    through_offset = (through - due).total_seconds()
    last_exclusive = max(0, math.ceil(through_offset / interval - 1e-12))
    last_index = last_exclusive - 1
    if first_index > last_index:
        return []

    staged = copy.deepcopy(state)
    anchor = _iso(due)
    existing = [item for item in staged.setdefault("decision_skips", []) if item.get("schedule_anchor") == anchor]
    covered: list[tuple[int, int]] = []
    for item in existing:
        start_index = item.get("schedule_index_start", item.get("schedule_index"))
        end_index = item.get("schedule_index_end", item.get("schedule_index"))
        if isinstance(start_index, int) and isinstance(end_index, int):
            covered.append((start_index, end_index))
    uncovered: list[tuple[int, int]] = []
    cursor = first_index
    for start_index, end_index in sorted(covered):
        if end_index < cursor or start_index > last_index:
            continue
        if start_index > cursor:
            uncovered.append((cursor, min(last_index, start_index - 1)))
        cursor = max(cursor, end_index + 1)
        if cursor > last_index:
            break
    if cursor <= last_index:
        uncovered.append((cursor, last_index))

    new_records: list[dict[str, Any]] = []
    for range_start, range_end in uncovered:
        count = range_end - range_start + 1
        compressed = count > 1000
        segments = [(range_start, range_end)] if compressed else [(index, index) for index in range(range_start, range_end + 1)]
        for segment_start, segment_end in segments:
            scheduled_at = due + timedelta(seconds=interval * segment_start)
            scheduled_through = due + timedelta(seconds=interval * segment_end)
            contributing_ids = sorted(
                event_id
                for visible, event_id in candidates
                if visible <= scheduled_through
            )
            record = {
                "scheduled_at": _iso(scheduled_at),
                "schedule_anchor": anchor,
                "schedule_index_start": segment_start,
                "schedule_index_end": segment_end,
                "scheduled_count": segment_end - segment_start + 1,
                "compressed": compressed,
                "reason": reason.strip(),
                "recorded_at": _iso(through),
                "eligible_event_ids": contributing_ids,
            }
            if segment_end != segment_start:
                record["scheduled_through"] = _iso(scheduled_through)
            staged["decision_skips"].append(record)
            _event(staged, "decision_boundary_skipped", record, at=_iso(through))
            new_records.append(copy.deepcopy(record))
    if new_records:
        _commit(state, staged)
    return new_records


def _cancel_orders(state: dict[str, Any], reason: str) -> list[str]:
    cancelled: list[str] = []
    for order in state["orders"]:
        if order.get("status") == "queued" and order.get("source") != "system_hold_expiry":
            order["status"] = "cancelled"
            order["cancel_reason"] = reason
            order["cancelled_at"] = state.get("current_time")
            cancelled.append(order["id"])
    if cancelled:
        _event(state, "queued_orders_cancelled", {"order_ids": cancelled, "reason": reason})
    return cancelled


def _make_order(
    state: dict[str, Any],
    target_weights: dict[str, float],
    *,
    decision_id: str | None,
    source: str,
    submitted_at: datetime,
    executable_at: datetime,
    reason: str | None = None,
    execution_scope_symbols: list[str] | None = None,
    preserve_symbols: list[str] | None = None,
) -> dict[str, Any]:
    order_id = _next_id(state, "order")
    order = {
        "id": order_id,
        "decision_id": decision_id,
        "source": source,
        "order_type": source,
        "system_reason": "holding_horizon_expired" if source == "system_hold_expiry" else None,
        "created_at": _iso(submitted_at),
        "submitted_at": _iso(submitted_at),
        "executable_at": _iso(executable_at),
        "status": "pending_final" if state.get("is_final") else "queued",
        "target_weights": copy.deepcopy(target_weights),
        "execution_scope_symbols": copy.deepcopy(execution_scope_symbols),
        "preserve_symbols": copy.deepcopy(preserve_symbols or []),
        "fills": [],
        "fees_paid": 0.0,
        "slippage_paid": 0.0,
        "reason": reason,
    }
    state["orders"].append(order)
    _event(state, "final_order_pending" if state.get("is_final") else "order_queued", {"order_id": order_id, "decision_id": decision_id, "source": source, "executable_at": _iso(executable_at), "reason": reason, "execution_scope_symbols": copy.deepcopy(execution_scope_symbols)}, at=_iso(submitted_at))
    return order


def _candidate_groups(
    state: dict[str, Any],
    as_of: datetime,
    new_event_ids: set[str],
    *,
    live: bool,
    trigger_event_ids: set[str] | None = None,
) -> list[list[dict[str, Any]]]:
    complete, _ = _effective_bars(state, as_of)
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    triggering_ids = new_event_ids | (trigger_event_ids or set())
    for bar in complete:
        key = (bar["bar_start"], bar["bar_end"])
        if not live or bar["event_id"] in triggering_ids:
            # A live boundary may arrive one symbol at a time. Include its
            # earlier same-boundary quotes as context, while requiring the
            # execution checks below to prove every needed quote is fresh.
            groups.setdefault(key, []).append(bar)
    if live:
        all_groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for bar in complete:
            key = (bar["bar_start"], bar["bar_end"])
            if key in groups:
                all_groups.setdefault(key, []).append(bar)
        groups = all_groups
    return [groups[key] for key in sorted(groups, key=lambda key: (_timestamp(key[0], "bar_start"), _timestamp(key[1], "bar_end")))]


def _execute_order(state: dict[str, Any], order: dict[str, Any], bars: list[dict[str, Any]], *, fill_at: datetime, price_field: str, price_rule: str) -> bool:
    from . import score_fusion
    targets = order["target_weights"]
    preserve=set(order.get('preserve_symbols',[]))
    candidate_symbols = sorted(symbol for symbol in state["config"]["symbols"] if targets.get(symbol, 0.0) > EPSILON or float(state["positions"].get(symbol, {}).get("quantity", 0.0)) > EPSILON)
    by_symbol = {bar["symbol"]: bar for bar in bars}
    if not candidate_symbols:
        order["status"] = "filled"
        order["filled_at"] = _iso(fill_at)
        order["execution_price_rule"] = price_rule
        return True
    if any(symbol not in by_symbol for symbol in candidate_symbols):
        return False
    prices = {symbol: float(by_symbol[symbol][price_field]) for symbol in candidate_symbols}
    opening_equity = _portfolio_value(state, prices)
    if opening_equity <= 0:
        raise _error("invalid_equity", "Portfolio equity must remain positive to execute an order.")
    for symbol in preserve:
        value=float(state['positions'].get(symbol,{}).get('quantity',0))*prices.get(symbol,0)
        if value/opening_equity>state['config']['max_position_weight']+1e-9:
            _event(state,'preserved_position_limit_exceeded',{'symbol':symbol,'max_position_weight':state['config']['max_position_weight']},at=_iso(fill_at))
    targets=score_fusion.execution_targets(state,targets,preserve,prices,opening_equity)
    fee_rate = state["config"]["fee_bps"] / 10_000.0
    slip_rate = state["config"]["slippage_bps"] / 10_000.0
    old_positions = copy.deepcopy(state["positions"])

    def plan(final_equity: float) -> tuple[dict[str, float], float, list[dict[str, Any]]]:
        quantities = {symbol: (float(old_positions.get(symbol,{}).get('quantity',0.0)) if symbol in preserve else targets.get(symbol, 0.0) * final_equity / prices[symbol]) for symbol in candidate_symbols}
        cash = float(state["cash"])
        fills: list[dict[str, Any]] = []
        for symbol in candidate_symbols:
            old_qty = float(old_positions.get(symbol, {}).get("quantity", 0.0))
            delta = quantities[symbol] - old_qty
            if delta >= -EPSILON:
                continue
            qty = -delta
            price = prices[symbol] * (1.0 - slip_rate)
            notional = qty * price
            fee = notional * fee_rate
            slip = qty * (prices[symbol] - price)
            cash += notional - fee
            fills.append({"symbol": symbol, "side": "sell", "quantity": qty, "price": price, "open_or_close_price": prices[symbol], "notional": notional, "fees": fee, "slippage_cost": slip})
        for symbol in candidate_symbols:
            old_qty = float(old_positions.get(symbol, {}).get("quantity", 0.0))
            delta = quantities[symbol] - old_qty
            if delta <= EPSILON:
                continue
            qty = delta
            price = prices[symbol] * (1.0 + slip_rate)
            notional = qty * price
            fee = notional * fee_rate
            slip = qty * (price - prices[symbol])
            cash -= notional + fee
            fills.append({"symbol": symbol, "side": "buy", "quantity": qty, "price": price, "open_or_close_price": prices[symbol], "notional": notional, "fees": fee, "slippage_cost": slip})
        return quantities, cash, fills

    candidate_equity = opening_equity
    for _ in range(32):
        quantities, cash_after, fills = plan(candidate_equity)
        position_value = sum(quantities[symbol] * prices[symbol] for symbol in candidate_symbols)
        actual_equity = cash_after + position_value
        if abs(actual_equity - candidate_equity) <= max(1e-8, opening_equity * 1e-12):
            break
        candidate_equity = max(0.0, actual_equity)
    quantities, cash_after, fills = plan(candidate_equity)
    limits=state['config'].get('harness_risk') or {}
    reserve=max(limits.get('min_cash_weight',0.0),1-limits.get('max_gross_weight',1.0)) if preserve else 0.0
    def reserve_shortfall(quantities, cash):
        actual=cash+sum(quantities[symbol]*prices[symbol] for symbol in candidate_symbols)
        return reserve*actual-cash
    if cash_after < -1e-7 or reserve_shortfall(quantities,cash_after)>1e-7:
        # A portfolio configured at 100% investment still needs to fund fees.
        # Shrink target exposure proportionally until the cash ledger is valid.
        low, high = 0.0, candidate_equity
        for _ in range(64):
            middle = (low + high) / 2
            candidate_quantities, candidate_cash, _ = plan(middle)
            if candidate_cash >= 0 and reserve_shortfall(candidate_quantities,candidate_cash)<=0:
                low = middle
            else:
                high = middle
        candidate_equity = low
        quantities, cash_after, fills = plan(candidate_equity)
    if cash_after < -1e-6:
        raise _error("cash_limit", "Order sizing exceeded available simulated cash.")

    total_fees = sum(item["fees"] for item in fills)
    total_slippage = sum(item["slippage_cost"] for item in fills)
    state["cash"] = max(0.0, cash_after)
    state["fees_paid"] += total_fees
    state["slippage_paid"] += total_slippage
    position_expiry_seconds = state["config"]["holding_horizon_seconds"]
    for symbol in candidate_symbols:
        quantity = quantities[symbol]
        if quantity <= EPSILON:
            state["positions"].pop(symbol, None)
            continue
        old = old_positions.get(symbol, {})
        changed = abs(quantity - float(old.get("quantity", 0.0))) > max(EPSILON, float(old.get("quantity", 0.0)) * 1e-9)
        # Holding duration starts with the first non-flat entry. Adding to or
        # trimming a still-open position cannot extend that original expiry;
        # flat then re-open starts a new holding clock.
        entry_at = old.get("opened_at", _iso(fill_at)) if old and float(old.get("quantity", 0.0)) > EPSILON else _iso(fill_at)
        expiry = None
        if position_expiry_seconds is not None:
            prior_expiry = _timestamp(old.get("expires_at"), "expires_at", optional=True)
            expiry = _iso(prior_expiry if old and float(old.get("quantity", 0.0)) > EPSILON and prior_expiry else fill_at + timedelta(seconds=position_expiry_seconds))
        last_price = prices[symbol]
        total_qty = quantity
        total_cost = sum(item["quantity"] * item["price"] for item in fills if item["symbol"] == symbol and item["side"] == "buy")
        sold_qty = sum(item["quantity"] for item in fills if item["symbol"] == symbol and item["side"] == "sell")
        previous_qty = float(old.get("quantity", 0.0))
        if total_cost > 0 and total_qty > 0:
            previous_cost = max(0.0, previous_qty - sold_qty) * float(old.get("average_cost", last_price))
            average_cost = (previous_cost + total_cost) / total_qty
        else:
            average_cost = float(old.get("average_cost", last_price))
        state["positions"][symbol] = {
            "quantity": total_qty,
            "average_cost": average_cost,
            "last_price": last_price,
            "last_price_at": by_symbol[symbol]["bar_end"],
            "opened_at": entry_at,
            "expires_at": expiry,
        }

    fill_records = []
    for fill in fills:
        bar = by_symbol[fill["symbol"]]
        fill_records.append(
            {
                **fill,
                "fill_at": _iso(fill_at),
                "price_time": bar["bar_start"] if price_rule == "next_eligible_open" else bar["bar_end"],
                "source_bar_start": bar["bar_start"],
                "source_bar_end": bar["bar_end"],
                "timeframe": bar["timeframe"],
                "source_feed": bar["source_feed"],
                "bar_available_at": bar["available_at"],
                "bar_received_at": bar["received_at"],
                "bar_observed_at": _iso(_bar_visible_at(state, bar)),
                "execution_price_rule": price_rule,
                "reason": order.get("system_reason") or order.get("reason"),
            }
        )
    order["fills"].extend(fill_records)
    order["fees_paid"] = sum(item["fees"] for item in order["fills"])
    order["slippage_paid"] = sum(item["slippage_cost"] for item in order["fills"])
    order["filled_at"] = _iso(fill_at)
    order["price_time"] = order["fills"][-1]["price_time"] if order["fills"] else None
    order["source_bar_start"] = order["fills"][-1]["source_bar_start"] if order["fills"] else None
    order["source_bar_end"] = order["fills"][-1]["source_bar_end"] if order["fills"] else None
    order["execution_price_rule"] = price_rule
    order["status"] = "filled"
    order["target_weights_executed"] = _positions_targets(state)
    state["equity"] = _portfolio_value(state, prices)
    return True


def _refresh_holding_expiry(state: dict[str, Any]) -> None:
    expiries = [
        expiry
        for position in state.get("positions", {}).values()
        if (expiry := _timestamp(position.get("expires_at"), "expires_at", optional=True)) is not None
    ]
    state["holding_expires_at"] = _iso(min(expiries)) if expiries else None


def _execute_system_expiry_order(
    state: dict[str, Any],
    order: dict[str, Any],
    bars: list[dict[str, Any]],
    *,
    fill_at: datetime,
    price_field: str,
    price_rule: str,
) -> bool:
    """Sell only the expiring symbol scoped to this system order.

    Each expired asset gets its own order so a missing quote for one holding
    cannot delay an otherwise executable exit for another.  ``fill_at`` is
    the market open in historical replay and the processing/observation clock
    in live simulation; each fill also records the source bar and its original
    availability and receipt timestamps.
    """
    scope = order.get("execution_scope_symbols")
    if not isinstance(scope, list) or not scope:
        # Backward compatibility for an in-progress state created before
        # execution scopes were recorded: infer the expired symbols from their
        # immutable position expiry and this order's executable boundary.
        executable = _timestamp(order.get("executable_at"), "executable_at")
        scope = [
            symbol
            for symbol, position in state.get("positions", {}).items()
            if executable is not None
            and (_timestamp(position.get("expires_at"), "expires_at", optional=True) or datetime.max.replace(tzinfo=UTC)) <= executable
        ]
        order["execution_scope_symbols"] = sorted(scope)
    by_symbol = {bar["symbol"]: bar for bar in bars}
    fee_rate = state["config"]["fee_bps"] / 10_000.0
    slip_rate = state["config"]["slippage_bps"] / 10_000.0
    expiry = _timestamp(order.get("executable_at"), "executable_at")
    live = state["config"]["market_mode"] == "live"
    max_age = state["config"]["max_live_data_age_seconds"]
    fills: list[dict[str, Any]] = []
    mark_prices: dict[str, float] = {}
    for symbol in sorted(set(scope)):
        position = state["positions"].get(symbol)
        if position is None:
            continue
        bar = by_symbol.get(symbol)
        if bar is None:
            continue
        observed_at = _bar_visible_at(state, bar)
        bar_end = _timestamp(bar["bar_end"], "bar_end")
        if expiry is not None and (bar_end is None or bar_end < expiry or (live and observed_at < expiry)):
            continue
        if live and (
            (fill_at - observed_at).total_seconds() > max_age
            or bar_end is None
            or (fill_at - bar_end).total_seconds() > max_age
        ):
            continue
        reference = float(bar[price_field])
        quantity = float(position.get("quantity", 0.0))
        if quantity <= EPSILON:
            state["positions"].pop(symbol, None)
            continue
        fill_price = reference * (1.0 - slip_rate)
        notional = quantity * fill_price
        fee = notional * fee_rate
        slippage_cost = quantity * (reference - fill_price)
        state["cash"] += notional - fee
        state["fees_paid"] += fee
        state["slippage_paid"] += slippage_cost
        state["positions"].pop(symbol, None)
        mark_prices[symbol] = reference
        fills.append(
            {
                "symbol": symbol,
                "side": "sell",
                "quantity": quantity,
                "price": fill_price,
                "open_or_close_price": reference,
                "notional": notional,
                "fees": fee,
                "slippage_cost": slippage_cost,
                "fill_at": _iso(fill_at),
                "price_time": bar["bar_start"] if price_rule == "next_eligible_open" else bar["bar_end"],
                "source_bar_start": bar["bar_start"],
                "source_bar_end": bar["bar_end"],
                "timeframe": bar["timeframe"],
                "source_feed": bar["source_feed"],
                "bar_available_at": bar["available_at"],
                "bar_received_at": bar["received_at"],
                "bar_observed_at": _iso(observed_at),
                "execution_price_rule": price_rule,
                "reason": order.get("system_reason") or order.get("reason"),
            }
        )
    pending_symbols = sorted(symbol for symbol in scope if symbol in state["positions"])
    if not fills and pending_symbols:
        return False
    order["fills"].extend(fills)
    order["fees_paid"] = sum(item["fees"] for item in order["fills"])
    order["slippage_paid"] = sum(item["slippage_cost"] for item in order["fills"])
    order["filled_at"] = _iso(fill_at)
    order["price_time"] = order["fills"][-1]["price_time"] if order["fills"] else None
    if fills:
        order["source_bar_start"] = fills[-1]["source_bar_start"]
        order["source_bar_end"] = fills[-1]["source_bar_end"]
    order["execution_price_rule"] = price_rule
    order["pending_symbols"] = pending_symbols
    order["status"] = "partially_filled" if pending_symbols else "filled"
    order["settled"] = not pending_symbols
    order["last_attempt_at"] = _iso(fill_at)
    order["target_weights_executed"] = _positions_targets(state)
    state["equity"] = _portfolio_value(state, mark_prices)
    return True


def _expire_positions(state: dict[str, Any], clock: datetime) -> None:
    if not state.get("positions"):
        state["holding_expires_at"] = None
        return
    due_positions = []
    for symbol, position in state["positions"].items():
        expiry = _timestamp(position.get("expires_at"), "expires_at", optional=True)
        if expiry is not None and expiry <= clock:
            due_positions.append((symbol, position, expiry))
    _refresh_holding_expiry(state)
    if not due_positions:
        return
    cancelled = _cancel_orders(state, "system_holding_horizon_expiry")
    for decision in state["decisions"]:
        if decision.get("status") == "awaiting_review" and not decision.get("stale"):
            decision["stale"] = True
            decision["stale_reason"] = "A system holding-horizon exit is now due; this proposal cannot be approved against its older snapshot."
            _event(state, "decision_stale_due_to_holding_horizon", {"decision_id": decision["id"], "holding_expires_at": state.get("holding_expires_at")})
    for order in state["orders"]:
        if order.get("source") != "system_hold_expiry" or order.get("status") not in ("queued", "partially_filled", "pending_final"):
            continue
        if isinstance(order.get("execution_scope_symbols"), list) and order["execution_scope_symbols"]:
            continue
        executable = _timestamp(order.get("executable_at"), "executable_at", optional=True)
        order["execution_scope_symbols"] = sorted(
            symbol
            for symbol, position in state["positions"].items()
            if executable is not None
            and (_timestamp(position.get("expires_at"), "expires_at", optional=True) or datetime.max.replace(tzinfo=UTC)) <= executable
        )
    active_exit_scopes = {
        symbol
        for order in state["orders"]
        if order.get("source") == "system_hold_expiry" and order.get("status") in ("queued", "partially_filled", "pending_final")
        for symbol in order.get("execution_scope_symbols", [])
    }
    for symbol, position, expiry in due_positions:
        if symbol in active_exit_scopes:
            continue
        target_weights = _positions_targets(state)
        for member in state["config"]["symbols"]:
            target_weights.setdefault(member, 0.0)
        target_weights[symbol] = 0.0
        order = _make_order(
            state,
            target_weights,
            decision_id=None,
            source="system_hold_expiry",
            submitted_at=expiry,
            executable_at=expiry,
            reason="configured_holding_horizon_elapsed",
            execution_scope_symbols=[symbol],
        )
        order["position_expires_at"] = _iso(expiry)
        order["superseded_order_ids"] = cancelled
        _event(
            state,
            "holding_horizon_exit_queued",
            {"order_id": order["id"], "symbol": symbol, "holding_expires_at": _iso(expiry), "superseded_order_ids": cancelled},
            at=_iso(expiry),
        )
        active_exit_scopes.add(symbol)


def advance_market(
    state: dict[str, Any],
    bars: list[dict[str, Any]],
    *,
    as_of: str | None = None,
    final: bool = False,
    live_fill_event_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Append newly available bars, advance time, mark holdings, and fill due orders.

    Repeating an identical event is a no-op.  A changed event with the same ID
    is rejected; revisions must have distinct event IDs/revision numbers.
    In live mode, ``as_of`` is the processing clock used for simulated fills.
    ``live_fill_event_ids=[]`` marks an ingest-only backlog batch; when omitted,
    only the latest newly ingested bar-end boundary may fill.  A later call can
    pass IDs from an already-ingested boundary to make it fill-eligible without
    ingesting or valuing the source bars twice.
    """
    if not isinstance(state, dict) or state.get("schema_version") != 2:
        raise _error("invalid_state", "Intraday state must use schema_version 2.")
    if not isinstance(bars, list):
        raise _error("invalid_bars", "Market bars must be a list.")
    if live_fill_event_ids is not None and (
        not isinstance(live_fill_event_ids, list)
        or any(not isinstance(event_id, str) or not event_id for event_id in live_fill_event_ids)
    ):
        raise _error("invalid_bar_event_ids", "live_fill_event_ids must be a list of non-empty event IDs or None.")
    staged = copy.deepcopy(state)
    before_clock = _timestamp(staged.get("current_time"), "current_time", optional=True)
    normalized_for_clock = [_normalize_bar(raw, i, staged["config"]) for i, raw in enumerate(bars)]
    if as_of is not None:
        requested_clock = _timestamp(as_of, "as_of")
    elif normalized_for_clock:
        candidates = [_bar_visible_at(staged, bar) for bar in normalized_for_clock]
        requested_clock = max(candidates)
    else:
        requested_clock = before_clock
    if requested_clock is None:
        raise _error("no_market_time", "advance_market needs bars or an explicit as_of timestamp.")
    clock = max(before_clock, requested_clock) if before_clock is not None else requested_clock
    new_ids = set(_ingest(staged, bars, clock))
    staged["current_time"] = _iso(clock)
    staged["as_of_time"] = _iso(clock)
    staged["current_date"] = _iso(clock)[:10]
    complete, _ = _effective_bars(staged, clock)
    _expire_positions(staged, clock)

    live = staged["config"]["market_mode"] == "live"
    if live:
        if live_fill_event_ids is None:
            latest_new_end = max(
                (_timestamp(bar["bar_end"], "bar_end") for bar in staged["bar_events"] if bar["event_id"] in new_ids),
                default=None,
            )
            eligible_live_fill_ids = {
                bar["event_id"]
                for bar in staged["bar_events"]
                if latest_new_end is not None
                and bar["event_id"] in new_ids
                and _timestamp(bar["bar_end"], "bar_end") == latest_new_end
            }
        else:
            eligible_live_fill_ids = set(live_fill_event_ids)
            unknown_ids = eligible_live_fill_ids - set(staged.get("_seen_bar_events", {}))
            if unknown_ids:
                raise _error("unknown_bar_event_id", "Every live_fill_event_id must already be visible to this experiment.")
    else:
        eligible_live_fill_ids = set()
    groups = _candidate_groups(staged, clock, new_ids, live=live, trigger_event_ids=eligible_live_fill_ids)
    if live:
        max_age = staged["config"]["max_live_data_age_seconds"]
    for group in groups:
        group_start = _timestamp(group[0]["bar_start"], "bar_start")
        group_end = _timestamp(group[0]["bar_end"], "bar_end")
        group_observed = max(_bar_visible_at(staged, bar) for bar in group)
        assert group_start is not None and group_end is not None
        boundary_key = f"{group[0]['bar_start']}|{group[0]['bar_end']}"
        boundary_already_consumed = live and boundary_key in staged["_consumed_fill_boundaries"]
        group_fresh_for_fill = not live or not (
            (clock - group_observed).total_seconds() > max_age
            or any((clock - (_timestamp(bar["bar_end"], "bar_end") or clock)).total_seconds() > max_age for bar in group)
        )
        if live and not group_fresh_for_fill:
            _event(staged, "stale_bar_skipped_for_fill", {"bar_start": group[0]["bar_start"], "bar_end": group[0]["bar_end"], "max_age_seconds": max_age})
        for order in _open_orders(staged):
            executable_at = _timestamp(order["executable_at"], "executable_at")
            submitted_at = _timestamp(order["submitted_at"], "submitted_at")
            assert executable_at is not None and submitted_at is not None
            if live:
                by_symbol = {bar["symbol"]: bar for bar in group}
                expiry_order = order.get("source") == "system_hold_expiry"
                needed = (
                    list(order.get("execution_scope_symbols") or [])
                    if expiry_order
                    else [symbol for symbol in staged["config"]["symbols"] if order["target_weights"].get(symbol, 0.0) > EPSILON or float(staged["positions"].get(symbol, {}).get("quantity", 0.0)) > EPSILON]
                )
                needed_bars = [by_symbol[symbol] for symbol in needed if symbol in by_symbol]
                fresh_needed_bars = [
                    bar
                    for bar in needed_bars
                    if (clock - _bar_visible_at(staged, bar)).total_seconds() <= max_age
                    and (clock - (_timestamp(bar["bar_end"], "bar_end") or clock)).total_seconds() <= max_age
                ]
                fill_boundary_is_eligible = bool(eligible_live_fill_ids) and any(
                    bar["event_id"] in eligible_live_fill_ids for bar in group
                )
                if expiry_order:
                    has_executable_exit_quote = any(
                        (_timestamp(bar["bar_end"], "bar_end") or datetime.min.replace(tzinfo=UTC)) >= submitted_at
                        and _bar_visible_at(staged, bar) >= executable_at
                        for bar in fresh_needed_bars
                    )
                    quote_set_complete = has_executable_exit_quote
                else:
                    quote_set_complete = (
                        len(fresh_needed_bars) == len(needed)
                        and all((_timestamp(bar["bar_end"], "bar_end") or datetime.min.replace(tzinfo=UTC)) >= submitted_at for bar in fresh_needed_bars)
                        and all(_bar_visible_at(staged, bar) >= executable_at for bar in fresh_needed_bars)
                    )
                eligible = (
                    group_fresh_for_fill
                    and not boundary_already_consumed
                    and fill_boundary_is_eligible
                    and group_end >= submitted_at
                    and bool(needed)
                    and quote_set_complete
                )
                fill_at = clock
                field = "close"
                rule = "next_observed_close"
            else:
                eligible = group_start >= executable_at
                fill_at = group_start
                field = "open"
                rule = "next_eligible_open"
            if not eligible:
                continue
            if order.get("source") == "system_hold_expiry":
                filled = _execute_system_expiry_order(staged, order, group, fill_at=fill_at, price_field=field, price_rule=rule)
            else:
                filled = _execute_order(staged, order, group, fill_at=fill_at, price_field=field, price_rule=rule)
            if filled:
                if live:
                    staged["_consumed_fill_boundaries"].append(boundary_key)
                order_event_type = "order_partially_filled" if order.get("status") == "partially_filled" else "order_filled"
                _event(staged, order_event_type, {"order_id": order["id"], "source": order["source"], "fill_at": order["filled_at"], "price_time": order.get("price_time"), "source_bar_start": order.get("source_bar_start"), "source_bar_end": order.get("source_bar_end"), "bar_observed_at": order.get("fills", [{}])[-1].get("bar_observed_at") if order.get("fills") else None, "bar_received_at": order.get("fills", [{}])[-1].get("bar_received_at") if order.get("fills") else None, "execution_price_rule": rule, "pending_symbols": order.get("pending_symbols", [])}, at=order["filled_at"])
                if order.get("source") == "system_hold_expiry":
                    staged["decision_block_until"] = group[0]["bar_end"]
                    _refresh_holding_expiry(staged)
                    exit_event_type = "holding_horizon_exit_partially_filled" if order.get("status") == "partially_filled" else "holding_horizon_exit_filled"
                    exit_details = {
                        "order_id": order["id"],
                        "symbols": [fill["symbol"] for fill in order.get("fills", [])],
                        "pending_symbols": order.get("pending_symbols", []),
                        "decision_block_until": staged["decision_block_until"],
                    }
                    _event(staged, exit_event_type, exit_details, at=order["filled_at"])
                else:
                    # Recompute the active expiry from positions; each changed
                    # position got its own expiry at fill time.
                    _refresh_holding_expiry(staged)

        # Revalue immediately after the boundary's fills. Historical state may
        # contain a whole replay page, so filter to the group's observation
        # clock before recording its bar point; later page rows cannot leak.
        boundary_clock = clock if live and any(bar["event_id"] in eligible_live_fill_ids for bar in group) else group_observed
        boundary_bars, _ = _effective_bars(staged, boundary_clock)
        boundary_new_ids = {bar["event_id"] for bar in group if bar["event_id"] in new_ids or bar["event_id"] in eligible_live_fill_ids}
        _mark(staged, boundary_bars, boundary_clock, boundary_new_ids)

    # A final historical event does not invent a fill beyond available data.
    if final and not live:
        staged["is_final"] = True
        if not any(decision.get("status") == "awaiting_review" for decision in staged["decisions"]):
            staged["status"] = "completed"
        pending = [order["id"] for order in staged["orders"] if order.get("status") in ("queued", "partially_filled")]
        for order in staged["orders"]:
            if order.get("status") in ("queued", "partially_filled"):
                order["status"] = "pending_final"
        if pending:
            _event(staged, "final_orders_pending", {"order_ids": pending, "reason": "no_later_bar_within_replay"})
    elif staged.get("status") == "ready":
        staged["status"] = "ready"
    _commit(state, staged)
    return copy.deepcopy(state)


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def record_decision(
    state: dict[str, Any],
    proposal: dict[str, Any],
    *,
    decision_started_at: str | None = None,
    decision_completed_at: str | None = None,
    latency_ms: float | None = None,
) -> dict[str, Any]:
    """Record an immutable proposal snapshot and queue/hold/review its order."""
    if not isinstance(state, dict) or state.get("schema_version") != 2:
        raise _error("invalid_state", "Intraday state must use schema_version 2.")
    staged = copy.deepcopy(state)
    if staged.get("status") in ("paused", "failed", "completed"):
        raise _error("runtime_not_active", "A paused, failed, or completed experiment cannot record a decision.")
    if staged.get("is_final"):
        raise _error("experiment_final", "A final replay cannot record a new decision.")
    if staged.get("status") == "awaiting_review":
        raise _error("review_pending", "Resolve the pending human review before recording another decision.")
    if any(
        order.get("source") == "system_hold_expiry" and order.get("status") in ("queued", "partially_filled")
        for order in staged.get("orders", [])
    ):
        raise _error("holding_exit_pending", "Wait for the system holding-horizon exit to fill before recording another decision.")
    inflight = staged.get("decision_in_flight")
    started = _timestamp(decision_started_at, "decision_started_at") if decision_started_at else (_timestamp(inflight.get("started_at"), "decision_started_at") if inflight else _timestamp(staged.get("current_time"), "current_time"))
    if started is None:
        raise _error("no_current_time", "Advance market data before recording a decision.")
    if inflight and started.isoformat() != (_timestamp(inflight["started_at"], "decision_started_at") or started).isoformat():
        raise _error("decision_start_mismatch", "Decision start time does not match the reserved snapshot.")
    snapshot = copy.deepcopy(inflight["snapshot"]) if inflight else visible_snapshot(staged, as_of=started)
    if not snapshot.get("bars"):
        raise _error("no_visible_bars", "A decision requires at least one completed bar visible at its start time.")
    completed = _timestamp(decision_completed_at, "decision_completed_at") if decision_completed_at else None
    if completed is None:
        latency = staged["config"]["latency_assumptions"]["simulated_latency_ms"] if latency_ms is None else _finite(latency_ms, "latency_ms", minimum=0)
        completed = started + timedelta(milliseconds=latency)
    if completed < started:
        raise _error("invalid_decision_time", "decision_completed_at cannot precede decision_started_at.")
    if staged["config"]["market_mode"] == "live" and decision_completed_at is None:
        raise _error("missing_live_completion_time", "Live decisions must provide their actual decision_completed_at timestamp.")
    original, action, targets = _proposal(staged, proposal)
    input_hash = _hash(snapshot)
    for prior in staged["decisions"]:
        if prior.get("decision_started_at") == _iso(started):
            if prior.get("input_snapshot_sha256") == input_hash and prior.get("original_proposal") == original:
                return copy.deepcopy(prior)
            raise _error("duplicate_decision_conflict", "A different decision is already recorded for this decision boundary.")
    if inflight:
        decision_id = inflight["id"]
        staged["decision_in_flight"] = None
    else:
        decision_id = _next_id(staged, "decision")
    _activate_team(staged)
    mode = staged["config"]["mode"]
    status = "awaiting_review" if mode == "human_review" else "approved"
    final_proposal = copy.deepcopy(original)
    if action == "rebalance":
        final_proposal["targets"] = copy.deepcopy(targets)
    decision = {
        "id": decision_id,
        "as_of_time": snapshot["as_of_time"],
        "market_as_of_time": snapshot["as_of_time"],
        "current_date": snapshot["current_date"],
        "decision_started_at": _iso(started),
        "decision_completed_at": _iso(completed),
        "latency_ms": round((completed - started).total_seconds() * 1000, 3),
        "input_event_ids": list(snapshot.get("input_event_ids", [])),
        "input_snapshot_sha256": input_hash,
        "input_snapshot": snapshot,
        "team_snapshot": copy.deepcopy(staged["active_team"]),
        "strategy": original.get("strategy"),
        "action": action,
        "status": status,
        "original_proposal": original,
        "final_proposal": final_proposal,
        "review": None,
        "review_request": None,
        "order_id": None,
        "stale": False,
    }
    staged["decisions"].append(decision)
    staged["last_decision_at"] = _iso(started)
    if snapshot.get("bars"):
        staged["last_decision_bar_end"] = _iso(max(_timestamp(bar["bar_end"], "bar_end") for bar in snapshot["bars"]))
    next_due = started + timedelta(seconds=staged["config"]["decision_interval_seconds"])
    staged["next_decision_at"] = _iso(next_due)
    staged["current_time"] = _later_timestamp_iso(staged.get("current_time"), completed, "current_time")
    staged["as_of_time"] = staged["current_time"]
    staged["current_date"] = staged["current_time"][:10]
    if status == "awaiting_review":
        staged["status"] = "awaiting_review"
        _event(staged, "decision_awaiting_review", {"decision_id": decision_id, "action": action}, at=_iso(completed))
    else:
        _event(staged, "decision_auto_approved", {"decision_id": decision_id, "action": action}, at=_iso(completed))
        if action == "rebalance":
            _cancel_orders(staged, "superseded_by_new_decision")
            order = _make_order(staged, targets or {}, decision_id=decision_id, source="model_decision", submitted_at=completed, executable_at=completed, reason=None, preserve_symbols=original.get('preserve_symbols',[]))
            decision["order_id"] = order["id"]
    _commit(state, staged)
    return copy.deepcopy(state["decisions"][-1])


def _decision_by_id(state: dict[str, Any], decision_id: str) -> dict[str, Any]:
    if not isinstance(decision_id, str):
        raise _error("decision_not_found", "Decision id must be a string.")
    for decision in state["decisions"]:
        if decision["id"] == decision_id:
            return decision
    raise _error("decision_not_found", f"Decision {decision_id} was not found.")


def review_decision(
    state: dict[str, Any],
    decision_id: str,
    action: str,
    reason: str = "",
    targets: dict[str, float] | None = None,
    *,
    reviewed_at: str | None = None,
) -> dict[str, Any]:
    """Apply an auditable, retry-safe human review to a pending proposal."""
    if not isinstance(state, dict) or state.get("schema_version") != 2:
        raise _error("invalid_state", "Intraday state must use schema_version 2.")
    if action not in ("approve", "modify", "reject"):
        raise _error("invalid_review", "Review action must be approve, modify, or reject.")
    if not isinstance(reason, str):
        raise _error("invalid_review", "Review reason must be text.")
    reason = reason.strip()
    if action in ("modify", "reject") and not reason:
        raise _error("reason_required", f"A reason is required to {action} a proposal.")
    staged = copy.deepcopy(state)
    decision = _decision_by_id(staged, decision_id)
    normalized_targets = _normal_targets(staged, targets) if action == "modify" else None
    if action != "modify" and targets is not None:
        raise _error("invalid_review", "targets are accepted only for a modify review.")
    request = {"action": action, "reason": reason, "targets": copy.deepcopy(normalized_targets)}
    if decision.get("review_request") is not None:
        if decision["review_request"] == request:
            return copy.deepcopy(decision)
        raise _error("decision_already_reviewed", "This decision already has a different review result.")
    if decision.get("status") != "awaiting_review":
        raise _error("decision_not_reviewable", "Only a decision awaiting review can be reviewed.")
    if decision.get("stale") and action in ("approve", "modify"):
        raise _error("stale_decision", "This proposal is stale after a holding-horizon exit; reject it and wait for a fresh decision.")
    clock = _timestamp(reviewed_at, "reviewed_at") if reviewed_at else _timestamp(staged.get("current_time"), "current_time")
    if clock is None:
        raise _error("no_current_time", "A market time is required to review a decision.")
    completed_at = _timestamp(decision["decision_completed_at"], "decision_completed_at")
    assert completed_at is not None
    if clock < completed_at:
        raise _error("invalid_review_time", "A decision cannot be reviewed before model completion.")
    decision["review_request"] = request
    decision["review"] = {"action": action, "reason": reason, "reviewed_at": _iso(clock)}
    if action == "reject":
        decision["status"] = "rejected"
        decision["final_proposal"] = None
        _event(staged, "decision_rejected", {"decision_id": decision_id, "reason": reason}, at=_iso(clock))
    else:
        decision["status"] = "approved"
        if action == "modify":
            modified = _safe_copy(decision["original_proposal"])
            modified.pop('preserve_symbols',None)
            modified.update({"action": "rebalance", "targets": copy.deepcopy(normalized_targets)})
            decision["final_proposal"] = modified
        else:
            decision["final_proposal"] = _safe_copy(decision["original_proposal"])
            if decision["action"] == "rebalance":
                decision["final_proposal"]["targets"] = _normal_targets(staged, decision["original_proposal"].get("targets"))
        _event(staged, "decision_approved" if action == "approve" else "decision_modified", {"decision_id": decision_id, "reason": reason}, at=_iso(clock))
        if decision["final_proposal"].get("action") == "rebalance":
            _cancel_orders(staged, "superseded_by_reviewed_decision")
            order = _make_order(staged, decision["final_proposal"]["targets"], decision_id=decision_id, source="human_review", submitted_at=clock, executable_at=clock, reason=None, preserve_symbols=decision['final_proposal'].get('preserve_symbols',[]))
            decision["order_id"] = order["id"]
    staged["current_time"] = _later_timestamp_iso(staged.get("current_time"), clock, "current_time")
    staged["as_of_time"] = staged["current_time"]
    staged["current_date"] = staged["current_time"][:10]
    if not any(item.get("status") == "awaiting_review" for item in staged["decisions"]):
        staged["status"] = "completed" if staged.get("is_final") else "ready"
    _commit(state, staged)
    return copy.deepcopy(_decision_by_id(state, decision_id))


def schedule_team(state: dict[str, Any], team: list[dict[str, Any]], pending_policy: str = "keep") -> dict[str, Any]:
    if not isinstance(state, dict) or state.get("schema_version") != 2:
        raise _error("invalid_state", "Intraday state must use schema_version 2.")
    if pending_policy not in ("keep", "discard"):
        raise _error("invalid_pending_policy", "pending_policy must be keep or discard.")
    staged = copy.deepcopy(state)
    if staged.get("status") == "completed":
        raise _error("experiment_completed", "A completed experiment cannot schedule a team change.")
    normalized = _normalize_team(team)
    discarded: list[str] = []
    if pending_policy == "discard":
        for decision in staged["decisions"]:
            if decision.get("status") == "awaiting_review":
                decision["status"] = "superseded"
                decision["review"] = {"action": "superseded", "reason": "Discarded by team-change request", "reviewed_at": staged.get("current_time")}
                discarded.append(decision["id"])
        _cancel_orders(staged, "discarded_by_team_change")
        if not any(decision.get("status") == "awaiting_review" for decision in staged["decisions"]):
            staged["status"] = "ready"
    if staged.get("pending_team") is not None:
        _event(staged, "team_change_replaced", {"previous_request": staged["pending_team"]})
    staged["pending_team"] = {"team": normalized, "pending_policy": pending_policy, "requested_at": staged.get("current_time")}
    _event(staged, "team_change_scheduled", {"team": normalized, "pending_policy": pending_policy, "discarded_decisions": discarded})
    _commit(state, staged)
    return copy.deepcopy(state["events"][-1])


def _allocate_equal(symbols: list[str], max_weight: float) -> dict[str, float]:
    if not symbols:
        return {}
    weight = min(max_weight, 1.0 / len(symbols))
    return {symbol: weight for symbol in symbols}


def baseline_proposal(state: dict[str, Any], snapshot: dict[str, Any], strategy: str) -> dict[str, Any]:
    if not isinstance(state, dict) or not isinstance(snapshot, dict):
        raise _error("invalid_snapshot", "State and point-in-time snapshot must be objects.")
    if strategy not in ("buy_hold", "momentum"):
        raise _error("unsupported_strategy", "Only buy_hold and momentum have deterministic baseline proposals.")
    clock = _timestamp(state.get("current_time"), "current_time", optional=True)
    snapshot_clock = _timestamp(snapshot.get("as_of_time"), "snapshot as_of_time", optional=True)
    if clock is None or snapshot_clock is None or snapshot_clock > clock:
        raise _error("invalid_snapshot", "Snapshot must use a point-in-time at or before the runtime clock.")
    snapshot_bars = snapshot.get("bars")
    if not isinstance(snapshot_bars, list):
        raise _error("invalid_snapshot", "Snapshot bars must be a list.")
    for bar in snapshot_bars:
        end = _timestamp(bar.get("bar_end"), "snapshot bar_end")
        available = _timestamp(bar.get("available_at"), "snapshot available_at")
        if end is None or available is None or end > snapshot_clock or available > snapshot_clock or not bar.get("is_complete", True):
            raise _error("future_data", "Snapshot contains a bar that was incomplete or unavailable at its as-of time.")
    max_weight = state["config"]["max_position_weight"]
    if strategy == "buy_hold":
        if any(item.get("strategy") == "buy_hold" for item in state["decisions"]):
            return {"action": "hold", "strategy": "buy_hold", "source": "deterministic_baseline", "rationale": "Keep the initial allocation."}
        available = sorted({bar["symbol"] for bar in snapshot_bars if bar["symbol"] in state["config"]["symbols"]})
        return {"action": "rebalance", "targets": _allocate_equal(available, max_weight), "strategy": "buy_hold", "source": "deterministic_baseline", "rationale": "Start an equal allocation in symbols with visible completed bars, subject to the per-position cap."}
    by_symbol: dict[str, list[dict[str, Any]]] = {}
    for bar in snapshot_bars:
        by_symbol.setdefault(bar["symbol"], []).append(bar)
    lookback = state["config"]["momentum_lookback"]
    scores: list[tuple[float, str]] = []
    for symbol in state["config"]["symbols"]:
        observations = sorted(by_symbol.get(symbol, []), key=lambda item: _timestamp(item["bar_end"], "bar_end"))
        if len(observations) < 2:
            continue
        window = observations[-(lookback + 1):]
        start_close, end_close = float(window[0]["close"]), float(window[-1]["close"])
        score = end_close / start_close - 1.0
        if score > 0:
            scores.append((score, symbol))
    scores.sort(key=lambda item: (-item[0], item[1]))
    selected = [symbol for _, symbol in scores]
    return {
        "action": "rebalance",
        "targets": _allocate_equal(selected, max_weight),
        "strategy": "momentum",
        "source": "deterministic_baseline",
        "rationale": f"Allocate equally among symbols with positive trailing momentum across up to {lookback} visible bar intervals.",
        "momentum_scores": {symbol: score for score, symbol in scores},
    }


def performance_metrics(state: dict[str, Any]) -> dict[str, Any]:
    """Compute risk from one latest equity observation per UTC calendar day."""
    if not isinstance(state, dict) or state.get("schema_version") != 2:
        raise _error("invalid_state", "Intraday state must use schema_version 2.")
    initial = float(state["config"]["initial_capital"])
    latest_by_date: dict[str, dict[str, Any]] = {}
    for point in state.get("history", []):
        day = str(point.get("date") or str(point.get("bar_end", ""))[:10])
        prior = latest_by_date.get(day)
        point_key = (
            _timestamp(point.get("bar_end", point.get("timestamp")), "history bar_end", optional=True) or datetime.min.replace(tzinfo=UTC),
            _timestamp(point.get("as_of_time"), "history as_of_time", optional=True) or datetime.min.replace(tzinfo=UTC),
        )
        prior_key = (
            _timestamp(prior.get("bar_end", prior.get("timestamp")), "history bar_end", optional=True) or datetime.min.replace(tzinfo=UTC),
            _timestamp(prior.get("as_of_time"), "history as_of_time", optional=True) or datetime.min.replace(tzinfo=UTC),
        ) if prior is not None else None
        if prior is None or point_key >= prior_key:
            latest_by_date[day] = point
    daily_points = [copy.deepcopy(latest_by_date[key]) for key in sorted(latest_by_date)]
    final = float(state.get("equity", initial))
    daily_returns: list[float] = []
    prior_equity = initial
    for item in daily_points:
        equity = float(item["equity"])
        daily_returns.append(equity / prior_equity - 1.0 if prior_equity > 0 else 0.0)
        prior_equity = equity
    if len(daily_returns) >= 2:
        mean = sum(daily_returns) / len(daily_returns)
        variance = sum((value - mean) ** 2 for value in daily_returns) / (len(daily_returns) - 1)
        daily_vol = math.sqrt(max(0.0, variance))
    else:
        mean = daily_returns[0] if daily_returns else 0.0
        daily_vol = 0.0
    peak = initial
    max_drawdown = 0.0
    for item in daily_points:
        equity = float(item["equity"])
        peak = max(peak, equity)
        if peak > 0:
            max_drawdown = min(max_drawdown, equity / peak - 1.0)
    return {
        "initial_capital": initial,
        "final_equity": final,
        "total_return": final / initial - 1.0,
        "annualized_volatility": daily_vol * math.sqrt(252.0),
        "sharpe_ratio": mean / daily_vol * math.sqrt(252.0) if daily_vol > 0 else None,
        "max_drawdown": max_drawdown,
        "fees_paid": float(state.get("fees_paid", 0.0)),
        "slippage_paid": float(state.get("slippage_paid", 0.0)),
        "sessions": len(daily_points),
        "intraday_observations": len(state.get("history", [])),
        "risk_observations": len(daily_returns),
        "return_convention": "latest completed-bar portfolio valuation per UTC calendar date; close-to-close daily returns; 252 trading days/year; sample standard deviation; zero risk-free rate; Sharpe is null when volatility is zero or unavailable",
        "equity_curve": daily_points,
    }


def benchmark_report(state: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
    """Return an explicit unsupported placeholder until paired bar replay is wired."""
    if not isinstance(state, dict) or state.get("schema_version") != 2:
        raise _error("invalid_state", "Intraday state must use schema_version 2.")
    return {
        "strategy": "buy_hold",
        "as_of_time": state.get("current_time"),
        "available": False,
        "reason": "Intraday benchmark replay is not yet implemented.",
        "history": [],
        "metrics": None,
        "pending_orders": [],
    }


__all__ = [
    "IntradayEngineError",
    "advance_market",
    "baseline_proposal",
    "benchmark_report",
    "create_state",
    "needs_decision",
    "performance_metrics",
    "prepare_decision",
    "record_decision",
    "record_skipped_decision_boundaries",
    "review_decision",
    "schedule_team",
    "unseen_bar_event_ids",
    "visible_snapshot",
]
