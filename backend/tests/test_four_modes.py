import json
import pytest
from fastapi.testclient import TestClient
from app import main, score_fusion

@pytest.fixture
def api(tmp_path,monkeypatch):
    monkeypatch.setattr(main,'DB_PATH',tmp_path/'four.sqlite3');monkeypatch.setattr(main,'SECRET_PATH',tmp_path/'secret.json');main._init()
    with TestClient(main.app) as client:yield client

def payload(**kw):
    return {'name':'four modes','dataset_id':'demo-synthetic-v1','start_date':'2023-01-03','end_date':'2023-01-10','initial_capital':10000,'max_position_weight':.4,'provider_mode':'demo',**kw}

def create(api,**kw):
    r=api.post('/api/experiments',json=payload(**kw));assert r.status_code==200,r.text
    return r.json()['id']

def record(id,kind,symbol,available='2023-01-02T00:00:00Z',synthetic=True):
    return {'id':id,'kind':kind,'symbols':[symbol],'title':'Fixture','source':'synthetic','url':'','event_at':None,'published_at':None,'available_at':available,'content':'Synthetic record','provenance':{'synthetic':synthetic,'demo_score':.8}}

def test_mode_creation_legacy_and_missing_coverage(api):
    old=create(api,strategy='buy_hold')
    assert api.get(f'/api/experiments/{old}/analysis').json()['lab_mode'] is None
    for mode in ['market_agent','multisource_agent','human_supervised']:
        eid=create(api,lab_mode=mode);info=api.get(f'/api/experiments/{eid}').json()
        assert info['config']['harness_version']=='research-v1' and info['config']['workflow_version']=='score-fusion-v1'
        detail=api.post(f'/api/experiments/{eid}/step').json();run=api.get(f'/api/experiments/{eid}/analysis').json()['analysis_runs'][0]
        assert run['status']=='succeeded' and run['decision_id']==detail['decisions'][0]['id']
        assert run['available_at']==run['completed_at']==run['as_of'] and run['wall_completed_at']
        if mode!='market_agent':
            assert all(x['status']=='unavailable' for x in run['fusion'].values()) and not detail['orders']
        assert detail['status']==('awaiting_review' if mode=='human_supervised' else 'ready')

def test_weight_change_boundary_and_review_audit(api):
    eid=create(api,lab_mode='human_supervised')
    first=api.post(f'/api/experiments/{eid}/step').json();decision=first['decisions'][0]; original=first['config']['fusion_weights'];new={'market':1,'news':0,'fundamentals':0}
    assert api.post(f'/api/experiments/{eid}/weights',json={'weights':new,'reason':'adjust'}).status_code==200
    assert api.post(f'/api/experiments/{eid}/weights',json={'weights':new,'reason':'duplicate'}).status_code==409
    review=api.post(f'/api/experiments/{eid}/review',json={'decision_id':decision['id'],'action':'approve'});assert review.status_code==200,review.text
    second=api.post(f'/api/experiments/{eid}/step').json();analysis=api.get(f'/api/experiments/{eid}/analysis').json()
    assert [x['weight_version'] for x in analysis['analysis_runs']]==[1,2]
    assert analysis['active_weights']['weights']==new and analysis['pending_weights'] is None
    assert analysis['intervention_summary']=={'weight_changes':1,'weight_changes_effective':1,'weight_changes_pending':0,'trade_reviews':1}
    assert second['config']['fusion_weights']==original and analysis['weight_history'][0]['requested_as_of']
    assert 'weight_change' in api.get(f'/api/experiments/{eid}/export?format=csv').text
    assert 'intervention_summary' in api.get(f'/api/experiments/{eid}/export?format=csv').text
    assert api.get(f'/api/experiments/{eid}/export').json()['intervention_summary']==analysis['intervention_summary']
    ai=create(api,lab_mode='market_agent')
    assert api.post(f'/api/experiments/{ai}/weights',json={'weights':new,'reason':'x'}).status_code==409
    branch=api.post(f'/api/experiments/{ai}/branch',json={'name':'branch','lab_mode':'human_supervised','fusion_weights':new})
    assert branch.status_code==200 and branch.json()['state']['decisions']==[]
    assert 'lab_mode' in api.get(f'/api/compare?ids={ai},{eid}').json()['differences']

def test_invalid_weights_and_policy(api):
    for value in [True,'0.5',float('nan'),float('inf')]:
        with pytest.raises(ValueError):score_fusion.weights({'market':value,'news':0,'fundamentals':.5})
    for weights in [{'market':.5,'news':.3,'fundamentals':.3},{'market':.5,'news':.5}]:
        assert api.post('/api/experiments',json=payload(lab_mode='human_supervised',fusion_weights=weights)).status_code==422
    assert api.post('/api/experiments',json=payload(lab_mode='market_agent',score_policy={'horizon_bars':True})).status_code==422

def test_fixture_asof_and_allocations(api):
    rows=[record('n1','news','DEMO-A'),record('f1','filing','DEMO-A'),record('later','news','DEMO-B','2023-01-04T00:00:00Z'),record('ordinary','fundamental','DEMO-B',synthetic=False)]
    pack=api.post('/api/harness/evidence-packs',json={'content':json.dumps(rows)}).json()
    eid=create(api,lab_mode='multisource_agent',evidence_pack_id=pack['id'],score_policy={'entry_threshold':-.1,'exit_threshold':-.5})
    api.post(f'/api/experiments/{eid}/step');detail=api.post(f'/api/experiments/{eid}/step').json()
    run=api.get(f'/api/experiments/{eid}/analysis').json()['analysis_runs'][-1]
    assert run['modules']['news']['DEMO-A']['source']=='synthetic_demo_fixture'
    assert run['modules']['fundamentals']['DEMO-B']['status']=='unavailable'
    assert run['fusion']['DEMO-B']['status']=='unavailable'
    assert sum(run['targets'].values())<=1 and all(v<=.4 for v in run['targets'].values())
    assert not any(o['status']=='filled' and o['created_date']==detail['state']['current_date'] for o in detail['orders'])

def test_llm_independence_and_invalid_citation_fails_closed(api,monkeypatch):
    rows=[record('n','news','DEMO-A'),record('f','filing','DEMO-A')]
    pack=api.post('/api/harness/evidence-packs',json={'content':json.dumps(rows)}).json()
    monkeypatch.setattr(main,'_secret',lambda:'key')
    monkeypatch.setattr(main,'_settings',lambda:{**main._default_settings(),'base_url':'http://mock.invalid','model':'fake','input_cost_per_million':1,'output_cost_per_million':1})
    calls=[]
    async def fake(messages,tools,settings=None):
        context=json.loads(messages[1]['content'])['snapshot'];calls.append(context);results=[]
        for s in context['symbols']:
            evidence=[x for x in context['evidence'] if not x['symbols'] or s in x['symbols']];ok=bool(evidence)
            results.append({'symbol':s,'status':'scored' if ok else 'abstain','score':.8 if ok else None,'rationale':'Visible facts' if ok else 'No facts','risks':[],'citation_ids':[evidence[0]['id']] if ok else [],'uncertainty':'Insufficient data'})
        if len(calls)==2:results[1].update(status='scored',score=.8,citation_ids=['n'])
        args={'as_of':context['as_of'],'horizon_bars':context['horizon_bars'],'results':results}
        return {'model':'fake','choices':[{'message':{'tool_calls':[{'function':{'name':'submit_analysis','arguments':json.dumps(args)}}]}}],'usage':{'prompt_tokens':10,'completion_tokens':10}}
    monkeypatch.setattr(main,'_llm_request',fake)
    eid=create(api,lab_mode='multisource_agent',provider_mode='llm',evidence_pack_id=pack['id'],budget_usd=10,max_calls=5)
    detail=api.post(f'/api/experiments/{eid}/step').json();a=api.get(f'/api/experiments/{eid}/analysis').json()
    assert detail['status']=='paused' and not detail['orders'] and a['analysis_runs'][-1]['status']=='failed'
    assert len(calls)==2 and {x['kind'] for x in calls[0]['evidence']}=={'price'} and {x['kind'] for x in calls[1]['evidence']}=={'news'}
    assert len(detail['llm_usage'])==2 and detail['llm_usage'][-1]['status']=='invalid_output'

def test_programmatic_missing_preserves_and_risk_budget():
    cfg={'symbols':['A','B','C'],'score_policy':{'entry_threshold':.25,'exit_threshold':-.25},'harness_risk':{'max_gross_weight':.8,'min_cash_weight':.3},'max_position_weight':.4}
    def item(score):return {'status':'scored','score':score} if score is not None else {'status':'unavailable','score':None}
    modules={'market':{'A':item(.8),'B':item(-.8),'C':item(.8)},'news':{'A':item(.8),'B':item(-.8),'C':item(None)},'fundamentals':{s:item(None) for s in cfg['symbols']}}
    fusion,targets,proposal=score_fusion.fuse(cfg,{'A':0,'B':.2,'C':.25},modules,{'market':.5,'news':.5,'fundamentals':0})
    assert targets=={'C':.25,'A':.4} and fusion['C']['missing']==['news'] and proposal['action']=='rebalance'

def test_quant_real_entry_uses_unified_executor(api):
    eid=create(api,lab_mode='quant_baseline',quant_strategy='bt_buy_hold')
    first=api.post(f'/api/experiments/{eid}/step').json();assert first['decisions'],first['events'];proposal=first['decisions'][0]['original_proposal']
    assert proposal['quant_strategy']=='bt_buy_hold' and proposal['provider']=='deterministic_baseline'
    assert first['orders'] and first['orders'][0]['status']=='queued'
    second=api.post(f'/api/experiments/{eid}/step').json()
    assert second['orders'][0]['filled_date']>first['decisions'][0]['as_of_date']

def intraday_body(api,mode,market_mode='historical'):
    dataset=api.post('/api/market/demo',json={'symbols':['DEMO-A'],'timeframe':'1Min','days':1,'bars_per_day':8}).json()
    return {'name':'intraday four mode','dataset_id':dataset['id'],'start_date':dataset['start_date'],'end_date':dataset['end_date'],'start_at':dataset['range']['start'],'end_at':dataset['range']['end'],'initial_capital':10000,'max_position_weight':.5,'provider_mode':'demo','schema_version':2,'market_mode':market_mode,'bar_interval':'1m','decision_interval':'1m','holding_horizon':'60m','lab_mode':mode}

def test_intraday_real_mode_entry_and_next_bar_review(api):
    body=intraday_body(api,'human_supervised');body['fusion_weights']={'market':1,'news':0,'fundamentals':0};body['score_policy']={'entry_threshold':-.01,'exit_threshold':-.5}
    r=api.post('/api/experiments',json=body);assert r.status_code==200,r.text
    eid=r.json()['id'];first=api.post(f'/api/experiments/{eid}/step').json();decision=first['decisions'][0]
    a=api.get(f'/api/experiments/{eid}/analysis').json()['analysis_runs'][0]
    assert first['status']=='awaiting_review' and a['as_of']==decision['decision_started_at'] and a['available_at']==decision['decision_completed_at']
    assert api.post(f'/api/experiments/{eid}/review',json={'decision_id':decision['id'],'action':'approve'}).status_code==200
    second=api.post(f'/api/experiments/{eid}/step').json();assert len(second['decisions'])==2

def test_live_real_mode_entry(api,monkeypatch):
    import asyncio
    from datetime import datetime,timedelta,timezone
    body=intraday_body(api,'market_agent','live');created=api.post('/api/experiments',json=body);assert created.status_code==200,created.text
    eid=created.json()['id'];cid='four-live';session={'id':cid,'status':'running','source':'demo','symbols':['DEMO-A'],'timeframe':'1Min'}
    monkeypatch.setitem(main._collector_sessions,cid,session)
    started=api.post(f'/api/experiments/{eid}/live/start',json={'collector_id':cid});assert started.status_code==200,started.text
    now=datetime.now(timezone.utc).replace(second=0,microsecond=0)+timedelta(minutes=1);end=now+timedelta(minutes=1)
    iso=lambda t:t.isoformat().replace('+00:00','Z')
    bar={'symbol':'DEMO-A','bar_start':iso(now),'bar_end':iso(end),'available_at':iso(end),'received_at':iso(end),'timeframe':'1m','source_feed':'synthetic-demo','open':100,'high':101,'low':99,'close':100,'volume':1000,'is_complete':True,'event_id':'four-live-1','revision':0}
    with main._db_lock,main._connect() as connection:connection.execute('INSERT INTO market_events(session_id,event_id,bar,received_at) VALUES(?,?,?,?)',(cid,bar['event_id'],json.dumps(bar),bar['received_at']))
    asyncio.run(main._apply_live_bars(eid,session,bar['available_at']))
    detail=api.get(f'/api/experiments/{eid}').json();a=api.get(f'/api/experiments/{eid}/analysis').json()['analysis_runs']
    assert len(detail['decisions'])==1 and len(a)==1 and a[0]['as_of']==detail['decisions'][0]['decision_started_at']

def test_daily_preserve_quantities_with_gap_missing_and_modify():
    from app import engine
    def bar(day,symbol,price):return {'date':f'2023-01-0{day}','symbol':symbol,'open':price,'high':price*1.01,'low':price*.99,'close':price,'volume':1000}
    bars=[bar(1,'AAA',100),bar(1,'BBB',100),bar(2,'BBB',100),bar(3,'AAA',250),bar(3,'BBB',100),bar(4,'AAA',250),bar(4,'BBB',100)]
    cfg={'start_date':'2023-01-01','end_date':'2023-01-04','symbols':['AAA','BBB'],'initial_capital':1000,'fee_bps':10,'slippage_bps':10,'max_position_weight':.5,'mode':'human_review','workflow_version':'score-fusion-v1','harness_risk':{'min_cash_weight':.2,'max_gross_weight':.8}}
    state=engine.create_state(cfg,bars);engine.advance_market(state,bars)
    state['positions']['AAA']={'quantity':3.,'average_cost':100.,'last_price':100.,'last_price_date':'2023-01-01'};state['cash']=700.;state['equity']=1000.
    proposal={'action':'rebalance','targets':{'BBB':.5},'preserve_symbols':['AAA'],'provider':'score_fusion'}
    d=engine.record_decision(state,proposal);engine.review_decision(state,d['id'],'approve')
    engine.advance_market(state,bars);assert state['orders'][0]['status']=='queued' and not state['orders'][0]['fills']
    engine.advance_market(state,bars);order=state['orders'][0]
    assert state['positions']['AAA']['quantity']==3 and all(x['symbol']!='AAA' for x in order['fills'])
    assert any(x['symbol']=='BBB' and x['side']=='buy' for x in order['fills'])
    assert state['cash']>=0 and state['equity']==pytest.approx(state['cash']+sum(p['quantity']*p['last_price'] for p in state['positions'].values()))
    assert state['fees_paid']>0 and state['slippage_paid']>0
    assert any(e['type']=='preserved_position_limit_exceeded' for e in state['events'])
    d=engine.record_decision(state,proposal);engine.review_decision(state,d['id'],'modify','Reduce exposure',{'AAA':0.1,'BBB':0})
    assert 'preserve_symbols' not in state['decisions'][-1]['final_proposal'] and state['decisions'][-1]['original_proposal']['preserve_symbols']==['AAA']
    engine.advance_market(state,bars)
    assert state['positions']['AAA']['quantity']<3

def test_intraday_preserve_gap_accounting_and_missing_price(api):
    from app import intraday_engine as engine
    from datetime import datetime,timezone
    created=api.post('/api/experiments',json=intraday_body(api,'human_supervised')).json();cfg=created['state']['config'];cfg.update(symbols=['AAA','BBB'],max_position_weight=.5,fee_bps=10,slippage_bps=10,harness_risk={'max_gross_weight':.8,'min_cash_weight':.2})
    state=engine.create_state({**cfg,'market_mode':'live'},[]);state['cash']=700.;state['equity']=1000.;state['positions']={'AAA':{'quantity':3.,'average_cost':100.,'last_price':100.,'last_price_at':'2023-01-01T00:00:00Z','opened_at':'2023-01-01T00:00:00Z','expires_at':None}}
    now=datetime(2023,1,1,0,1,tzinfo=timezone.utc);t='2023-01-01T00:01:00Z'
    def bar(sym,p):return {'symbol':sym,'bar_start':'2023-01-01T00:00:00Z','bar_end':t,'available_at':t,'received_at':t,'timeframe':'1m','source_feed':'demo','event_id':sym,'open':p,'close':p}
    order=engine._make_order(state,{'AAA':0,'BBB':.5},decision_id='d',source='model_decision',submitted_at=now,executable_at=now,preserve_symbols=['AAA'])
    assert engine._execute_order(state,order,[bar('BBB',100)],fill_at=now,price_field='open',price_rule='next_eligible_open') is False
    assert not order['fills'] and state['cash']==700
    assert engine._execute_order(state,order,[bar('AAA',250),bar('BBB',100)],fill_at=now,price_field='open',price_rule='next_eligible_open') is True
    assert state['positions']['AAA']['quantity']==3 and all(x['symbol']!='AAA' for x in order['fills'])
    assert any(x['symbol']=='BBB' for x in order['fills']) and state['cash']>=0
    assert state['equity']==pytest.approx(state['cash']+sum(p['quantity']*p['last_price'] for p in state['positions'].values()))
    assert state['fees_paid']>0 and state['slippage_paid']>0

def test_preserved_positions_count_in_risk_gross_sector_and_turnover():
    from app import research_harness
    risk=research_harness.config_options({'max_gross_weight':.7,'max_sector_weight':.5,'sectors':{'A':'tech','B':'tech'}})
    cfg={'symbols':['A','B'],'max_position_weight':.6,'harness_risk':risk}
    state={'config':{'symbols':['A','B'],'workflow_version':'score-fusion-v1'},'equity':1000,'positions':{'A':{'quantity':4,'last_price':100}}}
    proposal={'action':'rebalance','targets':{'B':.4},'provider':'score_fusion','preserve_symbols':['A']}
    result=research_harness.risk_check(cfg,state,proposal)
    assert result['gross_weight']==pytest.approx(.8) and result['turnover_l1']==pytest.approx(.4)
    assert set(result['failures'])=={'gross exposure','sector concentration'}
    assert result['sector_weights']['tech']==pytest.approx(.8)

def test_pending_weights_do_not_apply_to_failed_same_boundary(api,monkeypatch):
    monkeypatch.setattr(main,'_secret',lambda:'key')
    monkeypatch.setattr(main,'_settings',lambda:{**main._default_settings(),'base_url':'http://mock.invalid','model':'fake','input_cost_per_million':1,'output_cost_per_million':1})
    async def fail(*args,**kwargs):raise RuntimeError('mock outage')
    monkeypatch.setattr(main,'_llm_request',fail)
    eid=create(api,lab_mode='human_supervised',provider_mode='llm',budget_usd=10,max_calls=3)
    failed=api.post(f'/api/experiments/{eid}/step').json();assert failed['status']=='paused' and not failed['decisions']
    weights={'market':1,'news':0,'fundamentals':0}
    assert api.post(f'/api/experiments/{eid}/weights',json={'weights':weights,'reason':'Change next new decision'}).status_code==200
    retry=api.post(f'/api/experiments/{eid}/step').json();analysis=api.get(f'/api/experiments/{eid}/analysis').json()
    assert retry['status']=='paused' and [r['weight_version'] for r in analysis['analysis_runs']]==[1,1]
    assert analysis['active_weights']['version']==1 and analysis['pending_weights']['version']==2

def test_interrupted_inflight_retains_original_weight_snapshot(api,monkeypatch):
    import asyncio
    monkeypatch.setattr(main,'_secret',lambda:'key')
    monkeypatch.setattr(main,'_settings',lambda:{**main._default_settings(),'base_url':'http://mock.invalid','model':'fake','input_cost_per_million':1,'output_cost_per_million':1})
    async def interrupt(*args,**kwargs):raise asyncio.CancelledError()
    monkeypatch.setattr(main,'_llm_request',interrupt)
    eid=create(api,lab_mode='human_supervised',provider_mode='llm',budget_usd=10,max_calls=5)
    with pytest.raises(asyncio.CancelledError):asyncio.run(main._step_locked(eid))
    main._init()
    recovered=api.get(f'/api/experiments/{eid}/analysis').json()
    assert recovered['analysis_runs'][0]['status']=='interrupted' and recovered['analysis_runs'][0]['available_at']
    new={'market':1,'news':0,'fundamentals':0}
    assert api.post(f'/api/experiments/{eid}/weights',json={'weights':new,'reason':'next decision'}).status_code==200
    async def success(messages,tools,settings=None):
        snap=json.loads(messages[1]['content'])['snapshot'];results=[]
        for symbol in snap['symbols']:
            results.append({'symbol':symbol,'status':'abstain','score':None,'rationale':'Insufficient history','risks':[],'citation_ids':[],'uncertainty':'Insufficient history'})
        result={'as_of':snap['as_of'],'horizon_bars':snap['horizon_bars'],'results':results}
        return {'model':'mock','choices':[{'message':{'tool_calls':[{'function':{'name':'submit_analysis','arguments':json.dumps(result)}}]}}],'usage':{'prompt_tokens':10,'completion_tokens':10}}
    monkeypatch.setattr(main,'_llm_request',success)
    retried=api.post(f'/api/experiments/{eid}/step').json();analysis=api.get(f'/api/experiments/{eid}/analysis').json()
    assert retried['status']=='awaiting_review' and [x['weight_version'] for x in analysis['analysis_runs']]==[1,1]
    assert analysis['pending_weights']['version']==2
    assert api.post(f'/api/experiments/{eid}/review',json={'decision_id':retried['decisions'][0]['id'],'action':'approve'}).status_code==200
    api.post(f'/api/experiments/{eid}/step')
    assert api.get(f'/api/experiments/{eid}/analysis').json()['active_weights']['version']==2

def test_intraday_modify_clears_preserve_but_keeps_original_audit(api):
    body=intraday_body(api,'human_supervised');created=api.post('/api/experiments',json=body);assert created.status_code==200
    eid=created.json()['id'];first=api.post(f'/api/experiments/{eid}/step').json();decision=first['decisions'][0]
    assert decision['original_proposal']['preserve_symbols']==['DEMO-A']
    response=api.post(f'/api/experiments/{eid}/review',json={'decision_id':decision['id'],'action':'modify','reason':'User selects a complete new allocation','targets':{'DEMO-A':.3}})
    assert response.status_code==200,response.text
    updated=response.json();saved=updated['decisions'][0]
    assert saved['original_proposal']['preserve_symbols']==['DEMO-A']
    assert 'preserve_symbols' not in saved['final_proposal'] and updated['orders'][0]['preserve_symbols']==[]

def test_analyst_explicit_unavailable_requires_null_and_explanation():
    snapshot={'as_of':'2023-01-01T00:00:00Z','horizon_bars':5,'symbols':['A'],'evidence':[]}
    row={'symbol':'A','status':'unavailable','score':None,'rationale':'No evidence','risks':[],'citation_ids':[],'uncertainty':'Unknown'}
    args={'as_of':snapshot['as_of'],'horizon_bars':5,'results':[row]}
    assert score_fusion.validate_analysis(args,snapshot)['A']['status']=='unavailable'
    row['score']=0
    with pytest.raises(ValueError):score_fusion.validate_analysis(args,snapshot)

def test_analysis_usage_preserves_isolated_asof_inputs_with_redaction(api,monkeypatch):
    rows=[record('news-visible','news','DEMO-A'),record('fund-visible','fundamental','DEMO-A'),
          record('news-future','news','DEMO-A','2023-01-04T00:00:00Z')]
    rows[0]['content']='Synthetic fact with test-only SECRET_TOKEN'
    pack=api.post('/api/harness/evidence-packs',json={'content':json.dumps(rows)}).json()
    monkeypatch.setattr(main,'_secret',lambda:'SECRET_TOKEN')
    monkeypatch.setattr(main,'_settings',lambda:{**main._default_settings(),'base_url':'http://mock.invalid','model':'offline','input_cost_per_million':1,'output_cost_per_million':1})
    sent=[]
    async def fake(messages,tools,settings=None):
        request=json.loads(messages[1]['content']);snapshot=request['snapshot'];sent.append((request['role'],snapshot))
        results=[{'symbol':symbol,'status':'abstain','score':None,'rationale':'Not enough evidence','risks':[],
                  'citation_ids':[],'uncertainty':'No conclusion'} for symbol in snapshot['symbols']]
        args={'as_of':snapshot['as_of'],'horizon_bars':snapshot['horizon_bars'],'results':results}
        return {'model':'offline','choices':[{'message':{'tool_calls':[{'function':{'name':'submit_analysis','arguments':json.dumps(args)}}]}}],
                'usage':{'prompt_tokens':10,'completion_tokens':10}}
    monkeypatch.setattr(main,'_llm_request',fake)
    eid=create(api,lab_mode='multisource_agent',provider_mode='llm',evidence_pack_id=pack['id'],budget_usd=10,max_calls=5)
    detail=api.post(f'/api/experiments/{eid}/step').json()
    assert detail['decisions'] and len(sent)==len(detail['llm_usage'])==3
    expected_kinds={'analyst_market':{'price'},'analyst_news':{'news'},'analyst_fundamentals':{'fundamental'}}
    for (role,snapshot),usage in zip(sent,detail['llm_usage']):
        stored=usage['input_context']
        assert usage['role']==role and stored==main._redact_public(snapshot,detail['config'])
        assert stored['as_of']=='2023-01-03T21:00:00Z' and stored['horizon_bars']==5
        assert {row['kind'] for row in stored['evidence']}==expected_kinds[role]
        assert 'news-future' not in {row['id'] for row in stored['evidence']}
        assert 'SECRET_TOKEN' not in json.dumps(stored)
    assert '[redacted]' in json.dumps(detail['llm_usage'][1]['input_context'])

def test_compare_separates_supervision_treatment_from_controls(api):
    ai=create(api,lab_mode='multisource_agent')
    human=create(api,lab_mode='human_supervised')
    compared=api.get('/api/compare',params={'ids':f'{ai},{human}'}).json()
    assert compared['comparable'] is True
    assert 'lab_mode' in compared['differences'] and 'lab_mode' in compared['treatment_differences']
    assert compared['control_differences']=={} and 'does not establish causation' in compared['notice']
    changed={'market':1,'news':0,'fundamentals':0}
    assert api.post(f'/api/experiments/{human}/weights',json={'weights':changed,'reason':'Explore oversight'}).status_code==200
    compared=api.get('/api/compare',params={'ids':f'{ai},{human}'}).json()
    assert compared['comparable'] is True and 'weight_trajectory' in compared['treatment_differences']
    assert 'weight_trajectory' in compared['differences'] and compared['control_differences']=={}
    different=create(api,lab_mode='human_supervised',fee_bps=5,fusion_weights=changed)
    mismatched=api.get('/api/compare',params={'ids':f'{ai},{different}'}).json()
    assert mismatched['comparable'] is False
    assert {'fee_bps','fusion_weights'}.issubset(mismatched['control_differences'])
    other=create(api,lab_mode='market_agent')
    comparison=api.get('/api/compare',params={'ids':f'{ai},{other}'}).json()
    assert comparison['comparable'] is False and comparison['treatment_differences']=={}
    assert comparison['control_differences']==comparison['differences']

def test_supervision_compare_discloses_evidence_and_risk_controls(api):
    pack=api.post('/api/harness/evidence-packs',json={'content':json.dumps([record('e','news','DEMO-A')])}).json()
    ai=create(api,lab_mode='multisource_agent')
    human=create(api,lab_mode='human_supervised',evidence_pack_id=pack['id'],harness_risk={'min_cash_weight':.1})
    comparison=api.get('/api/compare',params={'ids':f'{ai},{human}'}).json()
    assert comparison['comparable'] is False
    assert {'evidence_pack_id','evidence_pack_checksum','harness_risk'}.issubset(comparison['control_differences'])

@pytest.mark.parametrize('interval',['1d','1m'])
def test_analyst_prompts_share_direction_rubric_and_role_specific_evidence(api,monkeypatch,interval):
    from app import research_harness
    rows=[record('news-rubric','news','DEMO-A'),record('fund-rubric','filing','DEMO-A')]
    pack=api.post('/api/harness/evidence-packs',json={'content':json.dumps(rows)}).json()
    monkeypatch.setattr(main,'_secret',lambda:'test-secret')
    monkeypatch.setattr(main,'_settings',lambda:{**main._default_settings(),'base_url':'http://mock.invalid','model':'offline','input_cost_per_million':1,'output_cost_per_million':1})
    sent=[]
    async def fake(messages,tools,settings=None):
        request=json.loads(messages[1]['content']);snap=request['snapshot']
        sent.append({'role':request['role'],'system':messages[0]['content'],'snapshot':snap,'tool':tools[0]})
        results=[{'symbol':symbol,'status':'abstain','score':None,'rationale':'Insufficient evidence','risks':[],
                  'citation_ids':[],'uncertainty':'Unknown'} for symbol in snap['symbols']]
        args={'as_of':snap['as_of'],'horizon_bars':snap['horizon_bars'],'results':results}
        return {'model':'offline','choices':[{'message':{'tool_calls':[{'function':{'name':'submit_analysis','arguments':json.dumps(args)}}]}}],
                'usage':{'prompt_tokens':10,'completion_tokens':10}}
    monkeypatch.setattr(main,'_llm_request',fake)
    if interval=='1d':
        eid=create(api,lab_mode='multisource_agent',provider_mode='llm',evidence_pack_id=pack['id'],budget_usd=10,max_calls=5)
    else:
        body=intraday_body(api,'multisource_agent');body.update(provider_mode='llm',evidence_pack_id=pack['id'],budget_usd=10,max_calls=5)
        created=api.post('/api/experiments',json=body);assert created.status_code==200,created.text
        eid=created.json()['id']
    detail=api.post(f'/api/experiments/{eid}/step').json()
    assert detail['decisions'] and len(sent)==3
    assert detail['config']['analysis_prompt_version']==score_fusion.ANALYSIS_PROMPT_VERSION
    assert detail['config']['score_semantics']==score_fusion.SCORE_SEMANTICS
    run=api.get(f'/api/experiments/{eid}/analysis').json()['analysis_runs'][0]
    assert run['analysis_prompt_version']==score_fusion.ANALYSIS_PROMPT_VERSION and run['score_semantics']==score_fusion.SCORE_SEMANTICS
    for call in sent:
        assert score_fusion.SCORE_SEMANTICS in call['system']
        assert call['snapshot']['bar_interval']==interval and call['snapshot']['horizon_bars']==5
        assert score_fusion.SCORE_SEMANTICS in call['tool']['function']['description']
    by_role={item['role']:item for item in sent}
    assert 'OHLCV' in by_role['analyst_market']['system']
    assert all(word in by_role['analyst_news']['system'] for word in ('impact pathway','timeliness','counterevidence'))
    assert all(word in by_role['analyst_fundamentals']['system'] for word in ('units','reporting periods','disclosure timing','Do not invent valuations'))
    evidence=by_role['analyst_market']['snapshot']['evidence']
    for item in evidence:
        assert item['indicators']==research_harness.summarize_prices({'bars':item['bars']})[item['symbols'][0]]
