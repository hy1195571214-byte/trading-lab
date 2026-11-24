"""Point-in-time target adapters for the vendored bt strategy components.

No orders, fills, or account state are produced here.  See vendor/README.md.
"""
from datetime import datetime, timezone
import math
from types import SimpleNamespace

import pandas as pd

from .vendor import bt_algos

BT_COMMIT = '0c8f521fa19704392ee182bf838b42607e236c5e'
WINDOW = 50


def _instant(value):
    if not isinstance(value, str):
        raise ValueError('Snapshot and bar timestamps must be strings')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Invalid snapshot or bar timestamp') from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _positive_price(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return float('nan')
    number = float(value)
    return number if math.isfinite(number) and number > 0 else float('nan')


def _price_frame(snapshot, symbols):
    """Reject future/incomplete data; preserve missing values at each bar time."""
    intraday = bool(snapshot.get('as_of_time'))
    clock = _instant(snapshot.get('as_of_time') if intraday else snapshot.get('as_of_date'))
    bars = snapshot.get('bars')
    if not isinstance(bars, list):
        raise ValueError('Snapshot bars must be a list')
    values = {}
    for bar in bars:
        symbol = bar.get('symbol')
        if symbol not in symbols:
            continue
        when = _instant(bar.get('bar_end') if intraday else bar.get('date'))
        if when > clock or (intraday and (not bar.get('is_complete', True) or
                _instant(bar.get('available_at')) > clock)):
            raise ValueError('Snapshot contains future, unavailable, or incomplete bars')
        key = (when, symbol)
        if key in values:
            raise ValueError('Duplicate bars for a symbol and bar time')
        values[key] = _positive_price(bar.get('close'))
    # On daily data the current session is explicit, including a completely
    # missing session. Intraday decisions use the latest completed bar time.
    now = max((key[0] for key in values), default=clock) if intraday else clock
    times = sorted({key[0] for key in values} | {now})
    frame = pd.DataFrame(index=pd.DatetimeIndex(times), columns=symbols, dtype=float)
    for (when, symbol), price in values.items():
        frame.loc[when, symbol] = price
    return frame, now


def _prior_buy_hold(state):
    return any((d.get('original_proposal') or {}).get('quant_strategy') == 'bt_buy_hold'
               for d in state.get('decisions', []))


def propose(state: dict, snapshot: dict, cfg: dict) -> dict:
    """Return a complete desired allocation or HOLD from visible bars only.

    The caller persists a successful decision before the next invocation.  It
    also enforces all hard risk limits and schedules next-eligible-open fills.
    """
    strategy = cfg.get('quant_strategy', 'bt_sma50')
    if strategy not in ('bt_sma50', 'bt_buy_hold'):
        raise ValueError('Unsupported bt baseline')
    symbols = list(cfg['symbols'])
    if not symbols or len(set(symbols)) != len(symbols):
        raise ValueError('Symbols must be unique and nonempty')
    risk = cfg.get('harness_risk') or {}
    limit_values = (cfg.get('max_position_weight', 1.0), risk.get('max_gross_weight', 1.0),
                    risk.get('min_cash_weight', 0.0))
    if any(isinstance(x, bool) or not isinstance(x, (float, int)) or
           not math.isfinite(x) or not 0 <= x <= 1 for x in limit_values):
        raise ValueError('Invalid exposure limits')
    cap, max_gross, min_cash = map(float, limit_values)
    base = {'strategy': strategy, 'quant_strategy': strategy,
            'source': 'deterministic_baseline', 'provider': 'deterministic_baseline',
            'label': 'DETERMINISTIC BT BASELINE — not an LLM result',
            'upstream': {'project': 'bt', 'commit': BT_COMMIT, 'license': 'MIT'},
            'risks': ['Targets are not fills; market availability and execution costs are handled by the Lab.']}
    # Validate snapshot on every call, including HOLD.
    prices, now = _price_frame(snapshot, symbols)
    if strategy == 'bt_buy_hold' and _prior_buy_hold(state):
        return {**base, 'action': 'hold', 'targets': {},
                'rationale': 'RunOnce already generated its initial target; preserve actual shares without rebalancing or retrying.'}

    target = SimpleNamespace(now=now, universe=prices, temp={})
    if strategy == 'bt_buy_hold':
        # Persistence of the upstream RunOnce flag is represented by the
        # previously recorded original_proposal check above, not mutable state.
        assert bt_algos.RunOnce()(target)
        bt_algos.SelectAll()(target)
        reason = 'RunOnce: equal-weight the currently priced securities; no later retry, including an empty first selection.'
    else:
        # Each series uses its latest 50 valid completed observations. A
        # current missing price still yields a False signal and zero target.
        averages = pd.DataFrame(index=prices.index, columns=symbols, dtype=float)
        for symbol in symbols:
            valid = prices[symbol].dropna()
            averages.loc[valid.index, symbol] = valid.rolling(WINDOW).mean()
        signal = prices > averages
        bt_algos.SelectWhere(signal)(target)
        reason = 'Select prices above the 50-observation SMA and weight selected securities equally; the observation unit is one complete input bar.'
    bt_algos.WeighEqually()(target)
    raw = target.temp['weights']
    # Equal allocation is clipped, without redistributing cap-constrained
    # surplus; gross and minimum-cash limits scale the common weight equally.
    weight = min(1.0 / len(raw), cap, min(max_gross, 1.0 - min_cash) / len(raw)) if raw else 0.0
    weights = {symbol: weight for symbol in raw if weight > 0}
    return {**base, 'action': 'rebalance', 'targets': weights, 'rationale': reason,
            'selected_symbols': list(raw), 'window_bars': WINDOW if strategy == 'bt_sma50' else None,
            'cash_weight_before_costs': 1.0 - sum(weights.values())}
