from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pandas as pd
import pytest

from app import quant_baselines as quant
from app.vendor import bt_algos


def config(strategy='bt_sma50', **overrides):
    return {'symbols': ['AAA', 'BBB', 'CCC'], 'quant_strategy': strategy,
            'max_position_weight': 1.0, 'harness_risk': {}, **overrides}


def daily(rows=50, symbols=('AAA', 'BBB'), as_of=None):
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    bars = [{'date': (start + timedelta(days=i)).date().isoformat(),
             'symbol': symbol, 'close': (i + 1 if symbol == 'AAA' else 100 - i)}
            for i in range(rows) for symbol in symbols]
    return {'as_of_date': as_of or (start + timedelta(days=rows - 1)).date().isoformat(), 'bars': bars}


def test_upstream_copied_components_are_called(monkeypatch):
    calls = []
    for cls in (bt_algos.SelectWhere, bt_algos.WeighEqually):
        original = cls.__call__
        def traced(self, target, *, original=original, name=cls.__name__):
            calls.append(name)
            return original(self, target)
        monkeypatch.setattr(cls, '__call__', traced)
    result = quant.propose({'decisions': []}, daily(), config())
    assert calls == ['SelectWhere', 'WeighEqually']
    assert result['targets'] == {'AAA': 1.0}
    assert result['upstream']['commit'] == quant.BT_COMMIT


def test_vendored_runonce_selectall_and_equalweights():
    frame = pd.DataFrame({'AAA': [10.0], 'BBB': [float('nan')], 'CCC': [-1.0]})
    target = SimpleNamespace(universe=frame, now=0, temp={})
    once = bt_algos.RunOnce()
    assert once(target) and not once(target)
    assert bt_algos.SelectAll()(target) and bt_algos.WeighEqually()(target)
    assert target.temp['weights'] == {'AAA': 1.0}


def test_matches_bt_example_pandas_signal_on_complete_data():
    snapshot = daily(rows=55)
    frame = pd.DataFrame(snapshot['bars']).pivot(index='date', columns='symbol', values='close')
    signals = frame > frame.rolling(50).mean()
    expected = list(signals.columns[signals.iloc[-1]])
    result = quant.propose({}, snapshot, config())
    assert result['selected_symbols'] == expected
    assert result['targets'] == {s: 1 / len(expected) for s in expected}


def test_adapter_calls_upstream_once_and_selectall(monkeypatch):
    calls = []
    for cls in (bt_algos.RunOnce, bt_algos.SelectAll, bt_algos.WeighEqually):
        original = cls.__call__
        def traced(self, target, *, original=original, name=cls.__name__):
            calls.append(name)
            return original(self, target)
        monkeypatch.setattr(cls, '__call__', traced)
    quant.propose({'decisions': []}, daily(), config('bt_buy_hold'))
    assert calls == ['RunOnce', 'SelectAll', 'WeighEqually']


def test_warmup_missing_and_held_exit():
    state = {'decisions': [], 'positions': {'BBB': {'quantity': 3}}}
    assert quant.propose(state, daily(rows=49), config())['targets'] == {}
    snap = daily(rows=50)
    snap['bars'][-2]['close'] = float('nan')
    assert quant.propose(state, snap, config())['targets'] == {}
    # BBB is not selected, so the full target map implies exiting it; no fill is asserted.
    assert quant.propose(state, daily(), config())['targets'] == {'AAA': 1.0}


def test_valid_observation_window_and_missing_current_bar():
    snap = daily(rows=51)
    snap['bars'][20]['close'] = None
    assert quant.propose({}, snap, config())['targets'] == {'AAA': 1.0}
    snap['bars'] = [b for b in snap['bars'] if not (b['symbol'] == 'AAA' and b['date'] == snap['as_of_date'])]
    assert quant.propose({}, snap, config())['targets'] == {}


def test_caps_cash_and_first_empty_hold():
    snap = daily(rows=50, symbols=('AAA',))
    snap['bars'] += [dict(b, symbol='BBB') for b in snap['bars']]
    result = quant.propose({}, snap, config(max_position_weight=.25, harness_risk={'max_gross_weight': .8, 'min_cash_weight': .3}))
    assert result['targets'] == {'AAA': .25, 'BBB': .25}
    assert result['cash_weight_before_costs'] == .5
    empty = {'as_of_date': '2024-03-01', 'bars': []}
    first = quant.propose({'decisions': []}, empty, config('bt_buy_hold'))
    assert first['action'] == 'rebalance' and first['targets'] == {}
    state = {'decisions': [{'original_proposal': first}]}
    later = quant.propose(state, daily(), config('bt_buy_hold'))
    assert later['action'] == 'hold' and later['targets'] == {}


def test_first_equal_buy_and_hold_does_not_reweight():
    first = quant.propose({'decisions': []}, daily(), config('bt_buy_hold', harness_risk={'max_gross_weight': .6}))
    assert first['targets'] == {'AAA': .3, 'BBB': .3}
    later = quant.propose({'decisions': [{'original_proposal': first}]}, daily(rows=51), config('bt_buy_hold'))
    assert later['action'] == 'hold' and later['targets'] == {}


def test_future_incomplete_duplicate_bars_are_rejected():
    snap = daily()
    snap['bars'].append({'date': '2025-01-01', 'symbol': 'AAA', 'close': 100})
    with pytest.raises(ValueError, match='future'):
        quant.propose({}, snap, config())
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    bars = [{'symbol': 'AAA', 'bar_end': (start + timedelta(minutes=i)).isoformat(),
             'available_at': (start + timedelta(minutes=i)).isoformat(), 'is_complete': True, 'close': i + 1} for i in range(50)]
    snap = {'as_of_time': bars[-1]['bar_end'], 'bars': bars}
    assert quant.propose({}, snap, config())['targets'] == {'AAA': 1.0}
    snap['bars'][-1]['is_complete'] = False
    with pytest.raises(ValueError, match='incomplete'):
        quant.propose({}, snap, config())
    snap['bars'][-1]['is_complete'] = True
    snap['bars'].append(dict(snap['bars'][-1]))
    with pytest.raises(ValueError, match='Duplicate'):
        quant.propose({}, snap, config())
