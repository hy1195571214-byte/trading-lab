"""Read-only, fixed-host Alpaca market data adapters.

This module intentionally has no trading or brokerage-order API. Inputs are
validated before network access and provider errors are reduced to safe text.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx

DATA_HOST = "https://data.alpaca.markets"
STREAM_URL = "wss://stream.data.alpaca.markets/v2/iex"
TIMEFRAMES = {"1Min": "1m", "1Hour": "1h"}
MAX_SYMBOLS = 30
MAX_PAGES = 100
MAX_RANGE_DAYS = 3650


class MarketDataError(ValueError):
    pass


def validate_symbols(symbols: list[str]) -> list[str]:
    if not isinstance(symbols, list) or not symbols or len(symbols) > MAX_SYMBOLS:
        raise MarketDataError("symbols must contain between 1 and 30 tickers")
    cleaned = []
    for symbol in symbols:
        value = str(symbol).strip().upper()
        if not value or len(value) > 16 or not all(ch.isalnum() or ch in ".-" for ch in value):
            raise MarketDataError("Invalid ticker symbol")
        if value not in cleaned:
            cleaned.append(value)
    return cleaned


def parse_timestamp(value: str, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError, AttributeError):
        raise MarketDataError(f"{field} must be an ISO timestamp with timezone") from None
    if parsed.tzinfo is None:
        raise MarketDataError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def validate_range(start: str, end: str) -> tuple[str, str]:
    a, b = parse_timestamp(start, "start"), parse_timestamp(end, "end")
    if b <= a:
        raise MarketDataError("end must be later than start")
    if (b - a).days > MAX_RANGE_DAYS:
        raise MarketDataError("Requested range exceeds the supported maximum")
    return a.isoformat().replace("+00:00", "Z"), b.isoformat().replace("+00:00", "Z")


def normalize_bar(raw: dict[str, Any], symbol: str, timeframe: str, feed: str, *, received_at: str | None = None, complete: bool = True) -> dict[str, Any]:
    if timeframe not in TIMEFRAMES or feed != "iex":
        raise MarketDataError("Unsupported timeframe or feed")
    stamp = raw.get("t") or raw.get("timestamp") or raw.get("bar_start")
    start = parse_timestamp(stamp, "bar timestamp")
    duration = 60 if timeframe == "1Min" else 3600
    end = datetime.fromtimestamp(start.timestamp() + duration, timezone.utc)
    try:
        values = {"open": float(raw.get("o", raw.get("open"))), "high": float(raw.get("h", raw.get("high"))),
                  "low": float(raw.get("l", raw.get("low"))), "close": float(raw.get("c", raw.get("close"))),
                  "volume": float(raw.get("v", raw.get("volume")))}
    except (TypeError, ValueError):
        raise MarketDataError("Provider returned an invalid bar") from None
    import math
    if any(not math.isfinite(x) for x in values.values()) or min(values[k] for k in ("open", "high", "low", "close")) <= 0 or values["volume"] < 0 or values["low"] > min(values["open"], values["close"]) or values["high"] < max(values["open"], values["close"]):
        raise MarketDataError("Provider returned an invalid bar")
    received = received_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    available = received
    event_key = f"{symbol}|{timeframe}|{start.isoformat()}|{raw.get('revision', raw.get('r', 0))}"
    return {"symbol": symbol, "bar_start": start.isoformat().replace("+00:00", "Z"),
            "bar_end": end.isoformat().replace("+00:00", "Z"), "received_at": received,
            "available_at": available, "timeframe": TIMEFRAMES[timeframe], "source_feed": feed,
            **values, "is_complete": bool(complete), "event_id": event_key,
            "revision": int(raw.get("revision", raw.get("r", 0)) or 0),
            "vwap": raw.get("vw"), "trade_count": raw.get("n")}


def fetch_bars(symbols: list[str], timeframe: str, start: str, end: str, key_id: str, secret: str,
               *, client_factory=httpx.Client, max_pages: int = MAX_PAGES) -> list[dict[str, Any]]:
    """Fetch all pages from the immutable allowlisted data host, feed=iex only."""
    symbols = validate_symbols(symbols)
    if timeframe not in TIMEFRAMES:
        raise MarketDataError("timeframe must be 1Min or 1Hour")
    start, end = validate_range(start, end)
    if not key_id or not secret:
        raise MarketDataError("Alpaca market data credentials are not configured")
    params: dict[str, Any] = {"symbols": ",".join(symbols), "timeframe": timeframe,
                             "start": start, "end": end, "feed": "iex", "limit": 10000,
                             "adjustment": "raw", "sort": "asc"}
    headers = {"APCA-API-KEY-ID": key_id, "APCA-API-SECRET-KEY": secret}
    result: list[dict[str, Any]] = []
    token = None
    try:
        with client_factory(timeout=30.0, follow_redirects=False) as client:
            for _ in range(max_pages):
                if token:
                    params["page_token"] = token
                response = client.get(DATA_HOST + "/v2/stocks/bars", params=params, headers=headers)
                if response.url.host != "data.alpaca.markets":
                    raise MarketDataError("Market data request was redirected outside the approved host")
                if response.status_code >= 400:
                    raise MarketDataError("Alpaca market data request failed; check account access and date range")
                payload = response.json()
                if not isinstance(payload, dict) or not isinstance(payload.get("bars", {}), dict):
                    raise MarketDataError("Alpaca returned an invalid market data response")
                for symbol, bars in payload["bars"].items():
                    if symbol not in symbols or not isinstance(bars, list):
                        raise MarketDataError("Alpaca returned an unexpected symbol")
                    for bar in bars:
                        result.append(normalize_bar(bar, symbol, timeframe, "iex"))
                token = payload.get("next_page_token")
                if not token:
                    # Historical data is available at bar close under the
                    # conservative replay model. Fetch time is metadata only.
                    begin, finish = parse_timestamp(start, "start"), parse_timestamp(end, "end")
                    now = datetime.now(timezone.utc)
                    result = [b for b in result if parse_timestamp(b["bar_start"], "bar_start") >= begin
                              and parse_timestamp(b["bar_end"], "bar_end") <= finish
                              and parse_timestamp(b["bar_end"], "bar_end") <= now]
                    for bar in result:
                        bar["available_at"] = bar["bar_end"]
                        bar["fetched_at"] = bar["received_at"]
                    return sorted(result, key=lambda b: (b["bar_start"], b["symbol"]))
            raise MarketDataError("Market data pagination exceeded the safe page limit")
    except MarketDataError:
        raise
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise MarketDataError("Could not retrieve Alpaca market data") from None


def stream_endpoint() -> str:
    """Return the fixed IEX stream endpoint; no caller-controlled URL."""
    assert urlparse(STREAM_URL).hostname == "stream.data.alpaca.markets"
    return STREAM_URL
