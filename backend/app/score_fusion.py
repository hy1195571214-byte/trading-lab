"""Pure validation and allocation primitives for the score-fusion workflow."""
from __future__ import annotations

import math

MODES = {'quant_baseline', 'market_agent', 'multisource_agent', 'human_supervised'}
MODULES = ('market', 'news', 'fundamentals')
ANALYSIS_PROMPT_VERSION = 'directional-evidence-v1'
SCORE_SEMANTICS = (
    'Signed directional evidence strength for price direction over horizon_bars future complete bars '
    'at bar_interval: -1 strong negative, 0 materially balanced evidence, +1 strong positive; '
    'not a probability or confidence. Insufficient evidence requires abstain or unavailable with null score.'
)
ANALYST_INSTRUCTIONS = {
    'market': 'Use only supplied point-in-time OHLCV and deterministic price indicators.',
    'news': 'Use only supplied news and events; explain the event impact pathway, timeliness, and counterevidence.',
    'fundamentals': 'Use only supplied fundamental facts and filings; check units, reporting periods, and disclosure timing. Do not invent valuations from missing fields.',
}


def number(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def validated_preserve(state, proposal):
    value = proposal.get('preserve_symbols', [])
    if (not isinstance(value, list) or any(not isinstance(x, str) for x in value)
            or len(value) != len(set(value)) or set(value) - set(state['config']['symbols'])):
        raise ValueError('Invalid preserve_symbols')
    if value and (proposal.get('provider') != 'score_fusion'
                  or state['config'].get('workflow_version') != 'score-fusion-v1'):
        raise ValueError('Only programmatic score fusion can preserve symbols')
    return value


def execution_targets(state, targets, preserve, prices, equity):
    """Reserve exposure for preserved quantities using execution-time prices."""
    if not preserve:
        return targets
    limits = state['config'].get('harness_risk') or {}
    budget = min(1.0, limits.get('max_gross_weight', 1.0), 1 - limits.get('min_cash_weight', 0.0))
    retained_value = sum(
        state['positions'].get(s, {}).get('quantity', 0)
        * prices.get(s, state['positions'].get(s, {}).get('last_price', 0))
        for s in preserve
    )
    retained = retained_value / equity if equity > 0 else 1
    total = sum(v for s, v in targets.items() if s not in preserve)
    scale = min(1.0, max(0.0, budget - retained) / total) if total else 1.0
    return {s: (v * scale if s not in preserve else 0.0) for s, v in targets.items()}


def weights(raw):
    if not isinstance(raw, dict) or set(raw) != set(MODULES):
        raise ValueError('weights must contain market, news and fundamentals')
    if (any(not number(v) or not 0 <= v <= 1 for v in raw.values())
            or not math.isclose(sum(raw.values()), 1, rel_tol=0, abs_tol=1e-9)):
        raise ValueError('weights must be finite numbers in [0,1] summing to 1')
    return {k: float(raw[k]) for k in MODULES}


def configure(cfg):
    mode = cfg['lab_mode']
    if mode not in MODES:
        raise ValueError('Unknown lab_mode')
    cfg['workflow_version'] = 'score-fusion-v1'
    cfg['analysis_prompt_version'] = ANALYSIS_PROMPT_VERSION
    cfg['score_semantics'] = SCORE_SEMANTICS
    cfg['harness_version'] = 'research-v1'
    cfg['mode'] = 'human_review' if mode == 'human_supervised' else 'ai_only'
    cfg['strategy'] = 'buy_hold' if mode == 'quant_baseline' else 'agent'
    if mode == 'quant_baseline':
        cfg['quant_strategy'] = cfg.get('quant_strategy') or 'bt_sma50'
        if cfg['quant_strategy'] not in ('bt_sma50', 'bt_buy_hold'):
            raise ValueError('Unknown quant_strategy')
    else:
        cfg['quant_strategy'] = None
    if mode in ('market_agent', 'quant_baseline'):
        default = {'market': 1, 'news': 0, 'fundamentals': 0}
    else:
        default = {'market': .5, 'news': .3, 'fundamentals': .2}
    supplied = cfg.get('fusion_weights')
    cfg['fusion_weights'] = weights(default if supplied is None else supplied)
    if mode == 'market_agent' and cfg['fusion_weights'] != weights(default):
        raise ValueError('market_agent requires market-only weights')
    raw = cfg.get('score_policy')
    if raw is None:
        raw = {}
    allowed = {'entry_threshold', 'exit_threshold', 'horizon_bars', 'rule_version'}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise ValueError('Invalid score_policy')
    policy = {'entry_threshold': .25, 'exit_threshold': -.25, 'horizon_bars': 5,
              'rule_version': 'threshold-equal-weight-v1', **raw}
    thresholds_valid = all(number(policy[k]) and -1 <= policy[k] <= 1
                           for k in ('entry_threshold', 'exit_threshold'))
    horizon = policy['horizon_bars']
    if (policy['rule_version'] != 'threshold-equal-weight-v1' or not thresholds_valid
            or policy['exit_threshold'] >= policy['entry_threshold']
            or isinstance(horizon, bool) or not isinstance(horizon, int) or horizon < 1):
        raise ValueError('Invalid score thresholds or horizon')
    cfg['score_policy'] = policy


def analyst_tool():
    item = {
        'type': 'object',
        'properties': {
            'symbol': {'type': 'string'},
            'status': {'type': 'string', 'enum': ['scored', 'abstain', 'unavailable']},
            'score': {'type': ['number', 'null']},
            'rationale': {'type': 'string'},
            'risks': {'type': 'array', 'items': {'type': 'string'}},
            'citation_ids': {'type': 'array', 'items': {'type': 'string'}},
            'uncertainty': {'type': 'string'},
        },
        'required': ['symbol', 'status', 'score', 'rationale', 'risks', 'citation_ids', 'uncertainty'],
        'additionalProperties': False,
    }
    return [{'type': 'function', 'function': {
        'name': 'submit_analysis',
        'description': SCORE_SEMANTICS + ' Analyze each symbol using only supplied evidence, or abstain.',
        'parameters': {
            'type': 'object',
            'properties': {'as_of': {'type': 'string'}, 'horizon_bars': {'type': 'integer'},
                           'results': {'type': 'array', 'items': item}},
            'required': ['as_of', 'horizon_bars', 'results'], 'additionalProperties': False,
        },
    }}]


def validate_analysis(args, snapshot):
    if (not isinstance(args, dict) or set(args) != {'as_of', 'horizon_bars', 'results'}
            or args['as_of'] != snapshot['as_of'] or type(args['horizon_bars']) is not int
            or args['horizon_bars'] != snapshot['horizon_bars'] or not isinstance(args['results'], list)):
        raise ValueError('Invalid analysis as-of, horizon or results')
    symbols = snapshot['symbols']
    evidence = snapshot['evidence']
    out = {}
    fields = {'symbol', 'status', 'score', 'rationale', 'risks', 'citation_ids', 'uncertainty'}
    for row in args['results']:
        if not isinstance(row, dict) or set(row) != fields or row['symbol'] not in symbols or row['symbol'] in out:
            raise ValueError('Invalid or duplicate analysis symbol')
        scored = row['status'] == 'scored'
        if (row['status'] not in ('scored', 'abstain', 'unavailable')
                or (scored and (not number(row['score']) or not -1 <= row['score'] <= 1))
                or (not scored and row['score'] is not None)):
            raise ValueError('Invalid score or abstention')
        if (any(not isinstance(row[k], str) or not row[k].strip() for k in ('rationale', 'uncertainty'))
                or not isinstance(row['risks'], list) or not all(isinstance(v, str) for v in row['risks'])):
            raise ValueError('Invalid analysis explanation')
        ids = row['citation_ids']
        eligible = {x['id'] for x in evidence if not x.get('symbols') or row['symbol'] in x['symbols']}
        if (not isinstance(ids, list) or not all(isinstance(v, str) for v in ids)
                or len(ids) != len(set(ids)) or set(ids) - eligible or (scored and not ids)):
            raise ValueError('Invalid, missing or cross-symbol citation')
        out[row['symbol']] = {**row, 'source': 'llm'}
    if set(out) != set(symbols):
        raise ValueError('Analysis must cover each symbol exactly once')
    return out


def fuse(cfg, current, modules, active_weights):
    policy = cfg['score_policy']
    fusion, candidates, retained = {}, [], {}
    for symbol in cfg['symbols']:
        scores = {k: modules[k][symbol] for k in MODULES}
        missing = [k for k in MODULES if active_weights[k] > 0 and scores[k]['status'] != 'scored']
        if missing:
            fusion[symbol] = {'status': 'unavailable', 'score': None, 'contributions': {}, 'missing': missing}
            retained[symbol] = current.get(symbol, 0)
            continue
        contributions = {k: active_weights[k] * (scores[k]['score'] or 0) for k in MODULES}
        score = sum(contributions.values())
        fusion[symbol] = {'status': 'scored', 'score': score, 'contributions': contributions, 'missing': []}
        if score >= policy['entry_threshold']:
            candidates.append(symbol)
        elif score > policy['exit_threshold']:
            retained[symbol] = current.get(symbol, 0)
    risk = cfg['harness_risk']
    budget = min(1.0, risk['max_gross_weight'], 1 - risk['min_cash_weight'])
    available = max(0, budget - sum(retained.values()))
    allocation = min(cfg['max_position_weight'], available / len(candidates)) if candidates else 0
    targets = {s: v for s, v in retained.items() if v > 0}
    targets.update({s: allocation for s in candidates if allocation > 0})
    same = all(abs(targets.get(s, 0) - current.get(s, 0)) < 1e-10 for s in cfg['symbols'])
    preserve = sorted(retained)
    trade_targets = {s: v for s, v in targets.items() if s not in preserve}
    proposal = {
        'action': 'hold' if same else 'rebalance', 'targets': {} if same else trade_targets,
        'preserve_symbols': preserve,
        'rationale': 'Threshold and equal-weight allocation from independently scored, point-in-time sources.',
        'risks': ['Scores are not forecasts; missing weighted sources preserve current quantities.'],
        'provider': 'score_fusion', 'label': 'Programmatic score fusion; demo scores are explicitly labelled',
        'strategy': 'threshold-equal-weight-v1',
    }
    return fusion, targets, proposal
