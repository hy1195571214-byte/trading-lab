import json
import sys
import asyncio
import httpx
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import main, market_data


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', tmp_path / 'market.sqlite3')
    monkeypatch.setattr(main, 'MARKET_KEY_PATH', tmp_path / 'market-data.key')
    monkeypatch.setattr(main, 'SECRET_PATH', tmp_path / 'unused-llm-secret.json')
    main._collector_sessions.clear(); main._collector_tasks.clear(); main._collector_stop.clear()
    main._init()
    with TestClient(main.app) as client:
        yield client


def test_historical_normalization_uses_bar_close_as_availability():
    bar = market_data.normalize_bar({'t': '2025-01-02T14:30:00Z', 'o': 10, 'h': 11, 'l': 9, 'c': 10.5, 'v': 20}, 'AAPL', '1Min', 'iex', received_at='2025-01-02T14:30:04Z')
    assert bar['bar_end'] == '2025-01-02T14:31:00Z'
    assert bar['available_at'] == bar['received_at']


def test_alpaca_rest_pagination_and_safe_error():
    pages=[{'bars':{'AAPL':[{'t':'2025-01-02T14:30:00Z','o':10,'h':11,'l':9,'c':10,'v':20}]},'next_page_token':'next'},
           {'bars':{'AAPL':[{'t':'2025-01-02T14:31:00Z','o':10,'h':11,'l':9,'c':10.1,'v':21}]},'next_page_token':None}]
    class Response:
        status_code=200; url=httpx.URL(market_data.DATA_HOST+'/v2/stocks/bars')
        def __init__(self,payload):self.payload=payload
        def json(self):return self.payload
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def get(self,url,*,params,headers):
            assert url==market_data.DATA_HOST+'/v2/stocks/bars' and params['feed']=='iex'
            assert headers['APCA-API-KEY-ID']=='id' and headers['APCA-API-SECRET-KEY']=='secret'
            return Response(pages.pop(0))
    bars=market_data.fetch_bars(['AAPL'],'1Min','2025-01-02T14:30:00Z','2025-01-02T14:32:00Z','id','secret',client_factory=Client)
    assert len(bars)==2 and bars[0]['available_at']=='2025-01-02T14:31:00Z' and bars[0]['fetched_at']
    class ErrorResponse:
        status_code=401; url=httpx.URL(market_data.DATA_HOST+'/v2/stocks/bars')
        def json(self):return {'message':'secret provider details'}
    class ErrorClient(Client):
        def get(self,*args,**kwargs):return ErrorResponse()
    with pytest.raises(market_data.MarketDataError,match='check account access'):
        market_data.fetch_bars(['AAPL'],'1Min','2025-01-02T14:30:00Z','2025-01-02T14:32:00Z','id','secret',client_factory=ErrorClient)


def test_timestamp_csv_keeps_intraday_rows_and_rejects_naive_time(api):
    csv = ('timestamp,symbol,open,high,low,close,volume,bar_interval\n'
           '2025-01-02T14:30:00Z,AAPL,10,11,9,10,20,1m\n'
           '2025-01-02T14:31:00Z,AAPL,10,11,9,10.1,21,1m\n')
    imported = api.post('/api/datasets/import', files={'file': ('bars.csv', csv, 'text/csv')})
    assert imported.status_code == 200, imported.text
    data = api.get('/api/market/data', params={'dataset_id': imported.json()['id']}).json()
    assert data['schema_version'] == 2 and len(data['bars']) == 2
    assert data['bars'][0]['bar_start'] != data['bars'][1]['bar_start']
    naive = 'timestamp,symbol,open,high,low,close,volume\n2025-01-02T14:30:00,AAPL,10,11,9,10,20\n'
    rejected = api.post('/api/datasets/import', files={'file': ('naive.csv', naive, 'text/csv')})
    assert rejected.status_code == 422


def test_demo_dataset_and_timestamp_cutoff_are_deterministic_and_synthetic(api):
    result = api.post('/api/market/demo', json={'symbols': ['DEMO-A'], 'timeframe': '1Min', 'days': 7, 'bars_per_day': 2})
    assert result.status_code == 200, result.text
    payload = result.json()
    assert payload['synthetic'] is True and payload['schema_version'] == 2
    full = api.get('/api/market/data', params={'dataset_id': payload['id']}).json()['bars']
    assert len(full) == 14
    dates = sorted({bar['bar_start'][:10] for bar in full})
    assert len(dates) == 7
    capped = api.get('/api/market/data', params={'dataset_id': payload['id'], 'timestamp': full[0]['available_at']}).json()['bars']
    assert len(capped) == 1


def test_market_credentials_are_encrypted_write_only(api, tmp_path):
    response = api.put('/api/market/settings', json={'key_id': 'sample-id-1234', 'secret': 'never-return-this-secret'})
    assert response.status_code == 200
    assert response.json()['configured'] is True and response.json()['key_hint'] == '••••1234'
    assert 'never-return-this-secret' not in response.text
    assert main.MARKET_KEY_PATH.exists()
    with main._db_lock, main._connect() as conn:
        encrypted = conn.execute("SELECT ciphertext FROM app_secrets WHERE id='alpaca_secret'").fetchone()[0]
    assert encrypted != 'never-return-this-secret'


def test_collector_demo_lifecycle_and_bar_recording(api):
    started = api.post('/api/market/collector/start', json={'source': 'demo', 'symbols': ['DEMO-A'], 'timeframe': '1Min'})
    assert started.status_code == 200, started.text
    session = started.json()['session_id']
    main._collector_tasks[session].get_loop if False else None
    status = api.get('/api/market/collector').json()['sessions'][0]
    assert status['synthetic'] is True and status['source'] == 'demo'
    stopped = api.post('/api/market/collector/stop', json={'session_id': session})
    assert stopped.status_code == 200 and stopped.json()['status'] == 'stopped'
    data = api.get('/api/market/data', params={'collector_id': session}).json()
    assert data['synthetic'] is True and len(data['bars']) >= 1


def test_schema_v2_historical_experiment_steps_without_touching_v1(api):
    dataset=api.post('/api/market/demo',json={'symbols':['DEMO-A'],'timeframe':'1Min','days':1,'bars_per_day':20}).json()
    trader=next(x for x in api.get('/api/experts').json() if x['role']=='trader')
    body={'name':'intraday-demo','dataset_id':dataset['id'],'start_date':dataset['start_date'],'end_date':dataset['end_date'],
          'start_at':dataset['range']['start'],'end_at':dataset['range']['end'],'initial_capital':10000,
          'fee_bps':1,'slippage_bps':2,'max_position_weight':0.5,'mode':'ai_only','strategy':'agent',
          'team':[{'expert_id':trader['id'],'role':'trader','enabled':True}],'provider_mode':'demo',
          'schema_version':2,'market_mode':'historical','bar_interval':'1m','decision_interval':'5m',
          'holding_horizon':'60m','latency_assumptions':{'simulated_latency_ms':100}}
    created=api.post('/api/experiments',json=body)
    assert created.status_code==200,created.text
    detail=api.post(f"/api/experiments/{created.json()['id']}/step").json()
    assert detail['config']['schema_version']==2
    assert detail['decisions'] and detail['decisions'][0]['decision_started_at']
    assert market_data.parse_timestamp(detail['decisions'][0]['decision_completed_at'],'completed')>market_data.parse_timestamp(detail['decisions'][0]['decision_started_at'],'started')
    assert detail['decisions'][0]['original_proposal']['provider']=='deterministic_demo'
    snapshot=api.get(f"/api/experiments/{created.json()['id']}/market",params={'as_of':detail['decisions'][0]['as_of_time']}).json()
    assert snapshot['schema_version']==2 and snapshot['bars']


def test_historical_latency_keeps_all_available_bars_and_audits_skipped_boundaries(api):
    dataset=api.post('/api/market/demo',json={'symbols':['DEMO-A'],'timeframe':'1Min','days':1,'bars_per_day':10}).json()
    trader=next(x for x in api.get('/api/experts').json() if x['role']=='trader')
    body={'name':'latency-cursor','dataset_id':dataset['id'],'start_date':dataset['start_date'],'end_date':dataset['end_date'],
          'start_at':dataset['range']['start'],'end_at':dataset['range']['end'],'initial_capital':10000,
          'fee_bps':1,'slippage_bps':2,'max_position_weight':0.5,'mode':'ai_only','strategy':'agent',
          'team':[{'expert_id':trader['id'],'role':'trader','enabled':True}],'provider_mode':'demo',
          'schema_version':2,'market_mode':'historical','bar_interval':'1m','decision_interval':'1m',
          'holding_horizon':'60m','latency_assumptions':{'simulated_latency_ms':180000}}
    created=api.post('/api/experiments',json=body)
    assert created.status_code==200,created.text
    eid=created.json()['id']
    first=api.post(f'/api/experiments/{eid}/step').json()
    completed=first['decisions'][0]['decision_completed_at']
    pinned=api.get('/api/market/data',params={'dataset_id':dataset['id']}).json()['bars']
    due_ids={bar['event_id'] for bar in pinned if market_data.parse_timestamp(bar['available_at'],'available_at')<=market_data.parse_timestamp(completed,'completed')}
    assert due_ids.issubset({bar['event_id'] for bar in first['state']['bar_events']})
    first_start=market_data.parse_timestamp(first['decisions'][0]['decision_started_at'],'started')
    assert all(market_data.parse_timestamp(bar['available_at'],'available_at')<=first_start for bar in first['decisions'][0]['input_snapshot']['bars'])
    second=api.post(f'/api/experiments/{eid}/step').json()
    seen={bar['event_id'] for bar in second['state']['bar_events']}
    assert due_ids.issubset(seen)
    assert len(second['decisions'])==2
    assert market_data.parse_timestamp(second['decisions'][1]['decision_started_at'],'started')>=market_data.parse_timestamp(completed,'completed')
    assert second['state']['decision_skips']
    assert any(event['type']=='decision_boundary_skipped' for event in second['state']['events'])
    second_snapshot=second['decisions'][1]['input_snapshot']
    assert due_ids.issubset({bar['event_id'] for bar in second_snapshot['bars']})


def test_human_review_latency_catchup_keeps_frozen_input_and_applies_market_data(api):
    dataset=api.post('/api/market/demo',json={'symbols':['DEMO-A'],'timeframe':'1Min','days':1,'bars_per_day':8}).json()
    trader=next(x for x in api.get('/api/experts').json() if x['role']=='trader')
    body={'name':'review-latency-catchup','dataset_id':dataset['id'],'start_date':dataset['start_date'],'end_date':dataset['end_date'],
          'start_at':dataset['range']['start'],'end_at':dataset['range']['end'],'initial_capital':10000,
          'fee_bps':0,'slippage_bps':0,'max_position_weight':0.5,'mode':'human_review','strategy':'agent',
          'team':[{'expert_id':trader['id'],'role':'trader','enabled':True}],'provider_mode':'demo',
          'schema_version':2,'market_mode':'historical','bar_interval':'1m','decision_interval':'1m',
          'holding_horizon':'60m','latency_assumptions':{'simulated_latency_ms':180000}}
    created=api.post('/api/experiments',json=body)
    assert created.status_code==200,created.text
    detail=api.post(f"/api/experiments/{created.json()['id']}/step").json()
    decision=detail['decisions'][0]
    assert detail['status']=='awaiting_review'
    assert market_data.parse_timestamp(detail['state']['current_time'],'current_time')>=market_data.parse_timestamp(decision['decision_completed_at'],'completed')
    assert len(detail['state']['bar_events'])>len(decision['input_snapshot']['bars'])
    assert decision['status']=='awaiting_review'


def test_live_consumer_recovers_all_durable_bars_after_coalesced_wakeup(api,monkeypatch):
    dataset=api.post('/api/market/demo',json={'symbols':['DEMO-A'],'timeframe':'1Min','days':1,'bars_per_day':4}).json()
    trader=next(x for x in api.get('/api/experts').json() if x['role']=='trader')
    body={'name':'live-backlog-demo','dataset_id':dataset['id'],'start_date':dataset['start_date'],'end_date':dataset['end_date'],
          'start_at':dataset['range']['start'],'end_at':dataset['range']['end'],'initial_capital':10000,
          'fee_bps':0,'slippage_bps':0,'max_position_weight':0.5,'mode':'ai_only','strategy':'agent',
          'team':[{'expert_id':trader['id'],'role':'trader','enabled':True}],'provider_mode':'demo',
          'schema_version':2,'market_mode':'live','bar_interval':'1m','decision_interval':'1m',
          'holding_horizon':'60m','latency_assumptions':{'simulated_latency_ms':0}}
    created=api.post('/api/experiments',json=body)
    assert created.status_code==200,created.text
    eid=created.json()['id']; cid='live-backlog-test'
    session={'id':cid,'session_id':cid,'status':'running','source':'demo','synthetic':True,'symbols':['DEMO-A'],
             'timeframe':'1Min','feed':'synthetic-demo','last_bar_at':None,'bars_received':0}
    main._collector_sessions[cid]=session
    started=api.post(f'/api/experiments/{eid}/live/start',json={'collector_id':cid})
    assert started.status_code==200,started.text
    main._live_queues.clear(); main._live_dispatch_tasks.clear()
    base=datetime.now(timezone.utc).replace(second=0,microsecond=0)+timedelta(minutes=1)
    bars=[]
    for index in range(3):
        stamp=base+timedelta(minutes=index); end=stamp+timedelta(minutes=1)
        iso=lambda value:value.isoformat().replace('+00:00','Z')
        bar={'symbol':'DEMO-A','bar_start':iso(stamp),'bar_end':iso(end),'available_at':iso(end),'received_at':iso(end),
             'timeframe':'1m','source_feed':'synthetic-demo','open':100+index,'high':101+index,'low':99+index,
             'close':100.5+index,'volume':1000,'is_complete':True,'event_id':f'backlog-{index}','revision':0}
        bars.append(bar)
    original_apply=main._apply_live_bars; first_started=asyncio.Event(); release=asyncio.Event(); second_done=asyncio.Event(); calls=0
    async def blocked_consumer(experiment_id,collector,watermark):
        nonlocal calls
        calls+=1
        if calls==1:
            first_started.set(); await release.wait()
        await original_apply(experiment_id,collector,watermark)
        if calls==2:second_done.set()
    monkeypatch.setattr(main,'_apply_live_bars',blocked_consumer)
    async def dispatch_with_coalescing():
        try:
            for index,bar in enumerate(bars):
                with main._db_lock,main._connect() as connection:
                    connection.execute('INSERT INTO market_events(session_id,event_id,bar,received_at) VALUES(?,?,?,?)',
                                       (cid,bar['event_id'],json.dumps(bar),bar['received_at']))
                session['last_bar_at']=bar['bar_start']
                await main._dispatch_live_bars(session,[bar])
                if index==0:await asyncio.wait_for(first_started.wait(),1)
            assert main._live_queues[eid]._queue[0][1]==bars[-1]['available_at']
            release.set(); await asyncio.wait_for(second_done.wait(),3)
        finally:
            task=main._live_dispatch_tasks.get(eid)
            if task and not task.done():task.cancel()
            if task:
                try:await task
                except asyncio.CancelledError:pass
    asyncio.run(dispatch_with_coalescing())
    detail=api.get(f'/api/experiments/{eid}').json()
    applied={bar['event_id'] for bar in detail['state']['bar_events']}
    assert {bar['event_id'] for bar in bars}.issubset(applied)
    assert detail['decisions'] and detail['decisions'][-1]['input_snapshot']['input_event_ids']


def test_intraday_llm_context_cap_is_bounded_and_auditable():
    bars=[{'symbol':symbol,'bar_start':f'2025-01-02T14:{minute:02d}:00Z','bar_end':f'2025-01-02T14:{minute+1:02d}:00Z'} for symbol in ('AAPL','MSFT') for minute in range(60)]
    cfg={'context_window_bars_per_symbol':20,'context_window_max_chars':10000,'context_window_history_points':5}
    bounded=main._bounded_intraday_snapshot({'as_of_time':'2025-01-02T15:00:00Z','bars':bars,'history':[{'i':i} for i in range(20)]},cfg)
    audit=main._public_input_context(bounded,{'id':'expert','name':'Expert'},'trader',None,cfg)
    assert len(bounded['bars'])<=40 and len(bounded['history'])==5
    assert len(json.dumps(bounded,separators=(',',':')))<=10000
    assert len(audit['snapshot']['bars'])==len(bounded['bars'])
    assert audit['snapshot']['context_window']['bars_per_symbol']==20


def test_alpaca_stream_welcome_auth_and_revision_storage(api,monkeypatch):
    api.put('/api/market/settings',json={'key_id':'mock-id','secret':'private-mock-secret'})
    sent=[]; stop=asyncio.Event()
    base={'T':'b','S':'AAPL','t':'2025-01-02T14:30:00Z','o':10,'h':11,'l':9,'c':10,'v':20}
    revised={**base,'T':'u','c':10.2,'v':25}
    class FakeWS:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def send(self,message):sent.append(json.loads(message))
        async def recv(self):
            self.recv_count=getattr(self,'recv_count',0)+1
            replies=[{'T':'success','msg':'connected'},{'T':'success','msg':'authenticated'}]
            return json.dumps(replies[min(self.recv_count-1,1)])
        def __aiter__(self):self.sent=False;return self
        async def __anext__(self):
            if self.sent:stop.set();raise StopAsyncIteration
            self.sent=True;return json.dumps([base,base,revised])
    class FakeWebsockets:
        def connect(self,url,**kwargs):assert url==market_data.STREAM_URL;return FakeWS()
    monkeypatch.setitem(sys.modules,'websockets',FakeWebsockets())
    session={'id':'stream-mock','source':'alpaca','symbols':['AAPL'],'timeframe':'1Min','feed':'iex','status':'starting','bars_received':0,'last_bar_at':None}
    main._collector_stop[session['id']]=stop
    asyncio.run(main._collector_worker(session))
    stored=main._rows('SELECT event_id,bar FROM market_events WHERE session_id=?',(session['id'],))
    assert any(x.get('action')=='auth' for x in sent) and any(x.get('action')=='subscribe' for x in sent)
    payloads=[json.loads(x['bar']) for x in stored]
    assert len(payloads)==2 and sorted(x['revision'] for x in payloads)==[0,1]

