"""HTTP acceptance with generated synthetic bars and an in-process fake model."""
import copy
import csv
import io
import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from app import main


OLD = {'market': .5, 'news': .3, 'fundamentals': .2}
NEW = {'market': .2, 'news': .5, 'fundamentals': .3}


@pytest.fixture
def lab(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', tmp_path / 'acceptance.sqlite3')
    monkeypatch.setattr(main, 'SECRET_PATH', tmp_path / 'secret.json')
    monkeypatch.setattr(main, '_secret', lambda: 'offline-test-key')
    monkeypatch.setattr(main, '_settings', lambda: {**main._default_settings(),
        'base_url': 'http://mock.invalid', 'model': 'offline-mock',
        'input_cost_per_million': 1, 'output_cost_per_million': 1})
    main._tasks.clear(); main._experiment_locks.clear(); main._init()
    calls = []
    control = {'bad_citation': None, 'fail': False, 'gap_scenario': False}

    async def fake(messages, tools, settings=None):
        body = json.loads(messages[1]['content'])
        calls.append(copy.deepcopy(body))
        if control['fail']:
            raise RuntimeError('offline simulated model failure')
        snap = body['snapshot']; module = body['role'].removeprefix('analyst_')
        rows = []
        for symbol in snap['symbols']:
            evidence = [r for r in snap['evidence'] if not r.get('symbols') or symbol in r['symbols']]
            missing = control['gap_scenario'] and snap['as_of'][:10] >= '2023-01-04' and module == 'news' and symbol == 'AAA'
            scored = bool(evidence) and not missing
            value = .8
            if control['gap_scenario']:
                value = (.8 if symbol in ('AAA', 'BBB') else -.8) if snap['as_of'][:10] == '2023-01-03' else (.8 if symbol in ('AAA', 'CCC') else -.8)
            citation = evidence[0]['id'] if scored else None
            if control['bad_citation'] and symbol == 'AAA':
                citation = control['bad_citation']
            rows.append({'symbol': symbol, 'status': 'scored' if scored else 'abstain',
                'score': value if scored else None, 'rationale': 'Synthetic fixture', 'risks': [],
                'citation_ids': [citation] if citation else [], 'uncertainty': 'Synthetic fixture'})
        args = {'as_of': snap['as_of'], 'horizon_bars': snap['horizon_bars'], 'results': rows}
        return {'model': 'offline-mock', 'choices': [{'message': {'tool_calls': [
            {'function': {'name': 'submit_analysis', 'arguments': json.dumps(args)}}]}}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 10}}

    monkeypatch.setattr(main, '_llm_request', fake)
    with TestClient(main.app) as api:
        yield api, calls, control


def dataset(api):
    text = io.StringIO(); writer = csv.writer(text)
    writer.writerow(['date', 'symbol', 'open', 'high', 'low', 'close', 'volume'])
    for i in range(7):
        day = (date(2023, 1, 3) + timedelta(days=i)).isoformat()
        for symbol in ('AAA', 'BBB', 'CCC'):
            price = (100 if i == 0 else 110 if i == 1 else 200 if symbol == 'AAA' else 120 if symbol == 'BBB' else 100)
            writer.writerow([day, symbol, price, price + 1, price - 1, price, 1000])
    response = api.post('/api/datasets/import', files={'file': ('synthetic.csv', text.getvalue(), 'text/csv')}, data={'synthetic': 'true'})
    assert response.status_code == 200, response.text
    return response.json()['id']


def pack(api):
    records = []
    for kind, prefix in [('news', 'N'), ('fundamental', 'F')]:
        for symbol in ('AAA', 'BBB', 'CCC'):
            records.append({'id': prefix + symbol, 'kind': kind, 'symbols': [symbol],
                'title': 'Synthetic '+kind, 'source': 'fixture', 'url': 'https://example.org',
                'event_at': None, 'published_at': None, 'available_at': '2023-01-02T00:00:00Z',
                'content': 'Synthetic '+kind, 'provenance': {'synthetic': True, 'demo_score': .8}})
    response = api.post('/api/harness/evidence-packs', json={'content': json.dumps(records)})
    assert response.status_code == 200, response.text
    return response.json()['id']


def create(api, mode, **changes):
    body = {'name': 'synthetic acceptance', 'dataset_id': dataset(api), 'evidence_pack_id': pack(api),
        'start_date': '2023-01-03', 'end_date': '2023-01-09', 'initial_capital': 10000,
        'fee_bps': 0, 'slippage_bps': 0, 'max_position_weight': .5, 'lab_mode': mode,
        'provider_mode': 'llm', 'budget_usd': 10, 'max_calls': 30, **changes}
    response = api.post('/api/experiments', json=body)
    assert response.status_code == 200, response.text
    return response.json()


def step(api, eid):
    response = api.post(f'/api/experiments/{eid}/step')
    assert response.status_code == 200, response.text
    return response.json()


def review(api, eid, decision, action='approve', **extra):
    response = api.post(f'/api/experiments/{eid}/review', json={'decision_id': decision['id'],
        'action': action, 'reason': 'Synthetic acceptance review', **extra})
    assert response.status_code == 200, response.text
    return response.json()


def analysis(api, eid):
    return api.get(f'/api/experiments/{eid}/analysis').json()


@pytest.mark.parametrize('mode,expected_mode', [('quant_baseline','ai_only'), ('market_agent','ai_only'),
    ('multisource_agent','ai_only'), ('human_supervised','human_review')])
def test_four_templates_produce_real_decisions(lab, mode, expected_mode):
    api, calls, _ = lab
    initial = create(api, mode, quant_strategy='bt_buy_hold'); eid = initial['id']
    assert initial['config']['mode'] == expected_mode
    assert initial['config']['workflow_version'] == 'score-fusion-v1'
    assert initial['config']['dataset_synthetic'] is True
    first = step(api, eid); assert first['decisions'], first
    proposal = first['decisions'][0]['original_proposal']
    if mode == 'quant_baseline':
        assert proposal['provider'] == 'deterministic_baseline' and not calls
        assert proposal['targets'] == {'AAA': pytest.approx(1/3), 'BBB': pytest.approx(1/3), 'CCC': pytest.approx(1/3)}
        assert first['orders'][0]['status'] == 'queued' and not first['holdings']
        second = step(api, eid)
        assert second['orders'][0]['fills'] and all(f['open_price'] == 110 and f['date'] == '2023-01-04' for f in second['orders'][0]['fills'])
        assert second['decisions'][1]['original_proposal']['action'] == 'hold'
    else:
        assert proposal['provider'] == 'score_fusion'
        assert first['status'] == ('awaiting_review' if mode == 'human_supervised' else 'ready')
        assert len(calls) == (1 if mode == 'market_agent' else 3)


def test_three_analysts_receive_only_their_own_evidence(lab):
    api, calls, _ = lab
    eid = create(api, 'multisource_agent')['id']; result = step(api, eid)
    assert result['decisions'] and len(calls) == 3
    for call in calls:
        module = call['role'].removeprefix('analyst_'); snapshot = call['snapshot']
        assert set(snapshot) == {'as_of', 'horizon_bars', 'bar_interval', 'symbols', 'evidence'}
        assert snapshot['bar_interval'] == '1d'
        assert call['team_context'] is None
        assert {r['kind'] for r in snapshot['evidence']} == {{'market':'price','news':'news','fundamentals':'fundamental'}[module]}
        assert '"score":' not in json.dumps(snapshot) and '"fusion":' not in json.dumps(snapshot)
    run = analysis(api, eid)['analysis_runs'][0]
    assert set(run['modules']) == {'market','news','fundamentals'}
    assert run['fusion']['AAA']['score'] == pytest.approx(.8)


def test_sma50_warms_up_and_executes_only_on_following_open(lab):
    api, calls, _ = lab
    text = io.StringIO(); writer = csv.writer(text)
    writer.writerow(['date','symbol','open','high','low','close','volume'])
    start = date(2023, 1, 1)
    for i in range(51):
        day=(start+timedelta(days=i)).isoformat()
        for symbol,price in [('AAA', 100+i),('BBB', 200-i)]:
            writer.writerow([day,symbol,price,price+1,price-1,price,1000])
    imported=api.post('/api/datasets/import',files={'file':('sma-synthetic.csv',text.getvalue(),'text/csv')},data={'synthetic':'true'})
    assert imported.status_code == 200, imported.text
    response=api.post('/api/experiments',json={'name':'SMA acceptance','dataset_id':imported.json()['id'],
        'start_date':start.isoformat(),'end_date':(start+timedelta(days=50)).isoformat(),
        'initial_capital':10000,'fee_bps':0,'slippage_bps':0,'max_position_weight':.5,
        'lab_mode':'quant_baseline','quant_strategy':'bt_sma50','provider_mode':'demo'})
    assert response.status_code == 200, response.text
    eid=response.json()['id']
    for _ in range(49): result=step(api,eid)
    assert result['decisions'][-1]['original_proposal']['targets'] == {} and not result['holdings']
    result=step(api,eid); proposal=result['decisions'][-1]['original_proposal']
    assert proposal['targets'] == {'AAA':.5} and proposal['window_bars'] == 50
    order=result['orders'][-1]; assert order['status'] == 'queued' and not order['fills']
    result=step(api,eid); fill=result['orders'][-2]['fills'][0]
    assert fill['symbol']=='AAA' and fill['open_price']==150 and fill['date']==(start+timedelta(days=50)).isoformat()
    assert not calls


@pytest.mark.parametrize('mode', ['quant_baseline','market_agent','multisource_agent','human_supervised'])
def test_intraday_historical_modes_use_timestamped_execution(lab,mode):
    api, calls, _ = lab
    data=api.post('/api/market/demo',json={'symbols':['AAA','BBB'],'timeframe':'1Min','days':1,'bars_per_day':8})
    assert data.status_code==200, data.text
    ds=data.json(); body={'name':'synthetic minute acceptance','dataset_id':ds['id'],
        'start_date':ds['start_date'],'end_date':ds['end_date'],'start_at':ds['range']['start'],
        'end_at':ds['range']['end'],'initial_capital':10000,'fee_bps':0,'slippage_bps':0,
        'max_position_weight':.5,'lab_mode':mode,'quant_strategy':'bt_buy_hold',
        'provider_mode':'llm','budget_usd':10,'max_calls':30,'evidence_pack_id':pack(api),
        'schema_version':2,'market_mode':'historical','bar_interval':'1m',
        'decision_interval':'1m','holding_horizon':'60m'}
    created=api.post('/api/experiments',json=body); assert created.status_code==200,created.text
    eid=created.json()['id']; first=step(api,eid); assert first['decisions'],first
    decision=first['decisions'][0]
    assert decision['original_proposal']['provider']==('deterministic_baseline' if mode=='quant_baseline' else 'score_fusion')
    if mode=='human_supervised':
        assert first['status']=='awaiting_review'
        review(api,eid,decision)
    result=step(api,eid); assert result['orders'][0]['fills']
    fill=result['orders'][0]['fills'][0]
    assert fill['execution_price_rule']=='next_eligible_open'
    assert fill['source_bar_start']>=decision['decision_completed_at']
    assert len(calls) >= (0 if mode=='quant_baseline' else 1)
    assert all(call['snapshot']['bar_interval']=='1m' for call in calls)


@pytest.mark.parametrize('citation', ['unknown-id', 'price:BBB'])
def test_cross_symbol_or_unknown_citation_fails_closed(lab, citation):
    api, calls, control = lab; control['bad_citation'] = citation
    eid = create(api, 'multisource_agent')['id']; result = step(api, eid)
    assert result['status'] in ('paused', 'failed') and not result['decisions'] and not result['orders']
    assert result['llm_usage'][0]['status'] == 'invalid_output'
    run = analysis(api, eid)['analysis_runs'][0]
    assert run['status'] == 'failed' and 'citation' in run['error'].lower()


def test_missing_source_preserves_shares_across_gap_while_other_names_trade(lab):
    api, _, control = lab; control['gap_scenario'] = True
    eid = create(api, 'multisource_agent')['id']; first = step(api, eid)
    assert first['decisions'][0]['original_proposal']['targets'] == {'AAA': .5, 'BBB': .5}
    second = step(api, eid); quantities = {h['symbol']: h['quantity'] for h in second['holdings']}
    assert quantities['AAA'] > 0 and quantities['BBB'] > 0
    proposal = second['decisions'][-1]['original_proposal']
    assert proposal['action'] == 'rebalance' and 'AAA' in proposal['preserve_symbols']
    assert analysis(api, eid)['analysis_runs'][-1]['fusion']['AAA']['missing'] == ['news']
    third = step(api, eid); after = {h['symbol']: h['quantity'] for h in third['holdings']}
    assert after['AAA'] == pytest.approx(quantities['AAA'])
    assert after.get('BBB', 0) == pytest.approx(0) and after['CCC'] > 0
    fills = third['orders'][1]['fills']
    assert not any(f['symbol'] == 'AAA' for f in fills)
    assert {f['symbol'] for f in fills} == {'BBB', 'CCC'}


def test_weight_guards_and_immutable_pending_review(lab):
    api, _, _ = lab
    eid = create(api, 'human_supervised')['id']; first = step(api, eid)
    original_config = copy.deepcopy(first['config']); old_run = copy.deepcopy(analysis(api,eid)['analysis_runs'][0])
    endpoint = f'/api/experiments/{eid}/weights'
    assert api.post(endpoint,json={'weights': NEW, 'reason': ' '}).status_code == 422
    assert api.post(endpoint,json={'weights': {'market':.2,'news':.2,'fundamentals':.2}, 'reason':'bad sum'}).status_code == 422
    response = api.post(endpoint,json={'weights': NEW, 'reason':'new emphasis'}); assert response.status_code == 200
    assert api.post(endpoint,json={'weights': OLD, 'reason':'overwrite'}).status_code == 409
    pending = response.json(); assert pending['active_weights']['version'] == 1 and pending['pending_weights']['version'] == 2
    assert pending['intervention_summary']['weight_changes_pending'] == 1
    assert pending['intervention_summary']['weight_changes_effective'] == 0
    assert pending['analysis_runs'][0] == old_run
    assert api.get(f'/api/experiments/{eid}').json()['config'] == original_config
    review(api,eid,first['decisions'][0]); second=step(api,eid)
    run = analysis(api,eid); assert second['decisions'][-1]['original_proposal']['weight_version'] == 2
    assert run['analysis_runs'][0] == old_run and run['analysis_runs'][-1]['weights'] == NEW
    assert run['pending_weights'] is None and run['weight_history'][0]['reason'] == 'new emphasis'
    assert api.get(f'/api/experiments/{eid}').json()['config'] == original_config
    auto = create(api,'multisource_agent')['id']
    assert api.post(f'/api/experiments/{auto}/weights',json={'weights':NEW,'reason':'no'}).status_code == 409


def test_failed_same_asof_retry_keeps_original_weight(lab):
    api, _, control = lab; control['fail'] = True
    eid = create(api,'human_supervised')['id']; failed = step(api,eid)
    assert failed['status'] in ('paused','failed') and not failed['decisions']
    assert api.post(f'/api/experiments/{eid}/weights',json={'weights':NEW,'reason':'after failed attempt'}).status_code == 200
    control['fail'] = False; retried = step(api,eid)
    assert retried['decisions'] and retried['decisions'][0]['original_proposal']['weight_version'] == 1
    a = analysis(api,eid); assert a['pending_weights']['version'] == 2
    assert [x['weight_version'] for x in a['analysis_runs']] == [1,1]
    assert a['analysis_runs'][0]['as_of'] == a['analysis_runs'][1]['as_of']


def test_human_modify_replaces_preservation_and_executes_full_target(lab):
    api, _, control = lab; control['gap_scenario'] = True
    eid=create(api,'human_supervised')['id']; first=step(api,eid)
    review(api,eid,first['decisions'][0]); second=step(api,eid)
    assert 'AAA' in second['decisions'][-1]['original_proposal']['preserve_symbols']
    before = {h['symbol']:h['quantity'] for h in second['holdings']}; assert before['AAA'] > 0
    revised=review(api,eid,second['decisions'][-1],action='modify',targets={'CCC':.5})
    final=revised['decisions'][-1]['final_proposal']; assert not final.get('preserve_symbols')
    after=step(api,eid); holdings={h['symbol']:h['quantity'] for h in after['holdings']}
    assert holdings.get('AAA',0) == pytest.approx(0) and holdings.get('BBB',0) == pytest.approx(0)
    assert holdings['CCC'] > 0


def test_budget_fail_closed_and_legacy_compatible(lab):
    api,calls,_=lab
    eid=create(api,'multisource_agent',max_calls=0)['id']; failed=step(api,eid)
    assert failed['status'] in ('paused','failed') and not failed['orders'] and not failed['decisions'] and not calls
    eid=create(api,'multisource_agent',budget_usd=0)['id']; failed=step(api,eid)
    assert failed['status'] in ('paused','failed') and not failed['orders'] and not failed['decisions'] and not calls
    old=create(api,None,provider_mode='demo',strategy='buy_hold',team=[])
    assert old['config']['lab_mode'] is None and old['config']['harness_version']=='legacy-v1'
    legacy=step(api,old['id']); assert legacy['decisions'] and legacy['orders']


def test_intervention_counters_and_export_have_audit_times(lab):
    api,_,_=lab; eid=create(api,'human_supervised')['id']; first=step(api,eid)
    assert api.post(f'/api/experiments/{eid}/weights',json={'weights':NEW,'reason':'adjust source mix'}).status_code == 200
    review(api,eid,first['decisions'][0]); step(api,eid)
    data=analysis(api,eid); event=data['weight_history'][0]
    assert data['intervention_summary'] == {'weight_changes':1,'weight_changes_effective':1,'weight_changes_pending':0,'trade_reviews':1}
    assert all(event[k] for k in ('requested_at','requested_as_of','effective_at','effective_wall_at'))
    assert all(data['analysis_runs'][0][k] for k in ('as_of','started_at','completed_at','available_at','wall_started_at','wall_completed_at'))
    report=api.get(f'/api/experiments/{eid}/export').json()
    assert report['state']['weight_history'][0] == event and report['decisions'][0]['review']
    assert report['intervention_summary'] == data['intervention_summary']
    rows=list(csv.DictReader(io.StringIO(api.get(f'/api/experiments/{eid}/export?format=csv').text)))
    assert any(row['record_type']=='weight_change' and row['reason']=='adjust source mix' for row in rows)
    assert any(row['record_type']=='decision' and row['reason']=='Synthetic acceptance review' for row in rows)
    summary = next(row for row in rows if row['record_type']=='intervention_summary')
    assert json.loads(summary['detail']) == data['intervention_summary']
