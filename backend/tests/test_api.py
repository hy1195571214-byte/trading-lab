import csv
import asyncio
import io
import json
import stat
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import main


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', tmp_path / 'api.sqlite3')
    monkeypatch.setattr(main, 'SECRET_PATH', tmp_path / 'data' / 'secret.json')
    main._init()
    with main._db_lock, main._connect() as c:
        c.execute('DELETE FROM experiments'); c.execute('DELETE FROM events')
        c.execute('DELETE FROM datasets'); c.execute('DELETE FROM experts')
        main._seed(c); main._seed_experts(c)
        c.execute('UPDATE settings SET body=? WHERE id=1',(json.dumps({'base_url':'','model':'','max_calls':20,'budget_usd':20,'input_cost_per_million':None,'output_cost_per_million':None}),))
    main._tasks.clear(); main._experiment_locks.clear()
    with TestClient(main.app) as client:
        yield client


def base_payload(client, **overrides):
    ds=client.get('/api/datasets').json()[0]
    experts=client.get('/api/experts').json()
    payload={'name':'integration','dataset_id':ds['id'],'start_date':ds['start_date'],'end_date':ds['end_date'],'initial_capital':10000,'fee_bps':1,'slippage_bps':2,'max_position_weight':0.5,'mode':'ai_only','strategy':'agent','team':[{'expert_id':'momentum','role':'trader','enabled':True},{'expert_id':'risk','role':'advisor','enabled':True}],'provider_mode':'demo'}
    payload.update(overrides)
    return payload


def test_seeded_demo_step_and_review_are_persisted(api):
    created=api.post('/api/experiments',json=base_payload(api)).json()
    assert created['config']['dataset_synthetic'] is True
    assert 'SYNTHETIC' in api.get('/api/datasets').text
    stepped=api.post(f"/api/experiments/{created['id']}/step").json()
    assert stepped['state']['current_date']
    assert stepped['decisions'][0]['original_proposal']['provider']=='deterministic_demo'
    assert len(stepped['expert_opinions'])==2
    assert api.get('/api/experiments').json()[0]['id']==created['id']


def test_human_review_reject_requires_reason_and_does_not_fill(api):
    created=api.post('/api/experiments',json=base_payload(api,mode='human_review')).json()
    state=api.post(f"/api/experiments/{created['id']}/step").json()
    decision=state['decisions'][0]
    assert decision['status']=='awaiting_review'
    rejected=api.post(f"/api/experiments/{created['id']}/review",json={'decision_id':decision['id'],'action':'reject','reason':''})
    assert rejected.status_code==422
    rejected=api.post(f"/api/experiments/{created['id']}/review",json={'decision_id':decision['id'],'action':'reject','reason':'Not enough evidence'}).json()
    assert rejected['orders']==[]
    assert rejected['decisions'][0]['status']=='rejected'


def test_csv_export_handles_pending_and_all_review_actions(api):
    created=api.post('/api/experiments',json=base_payload(api,mode='human_review')).json(); eid=created['id']
    for action,reason,targets in [('approve','',None),('modify','Reduce exposure',{'DEMO-A':0.2}),('reject','Keep current allocation',None)]:
        detail=api.post(f'/api/experiments/{eid}/step').json()
        decision=detail['decisions'][-1]
        body={'decision_id':decision['id'],'action':action,'reason':reason}
        if targets is not None:body['targets']=targets
        reviewed=api.post(f'/api/experiments/{eid}/review',json=body)
        assert reviewed.status_code==200
    pending=api.post(f'/api/experiments/{eid}/step').json()
    assert pending['decisions'][-1]['status']=='awaiting_review'

    response=api.get(f'/api/experiments/{eid}/export?format=csv')
    assert response.status_code==200 and response.text.strip()
    rows=list(csv.DictReader(io.StringIO(response.text)))
    assert {'record_type','as_of_date','id','status','action','target_weights','reason','detail'} <= set(rows[0])
    decisions=[row for row in rows if row['record_type']=='decision']
    assert [row['status'] for row in decisions]==['approved','approved','rejected','awaiting_review']
    assert all(row['as_of_date'] for row in decisions)
    assert decisions[1]['reason']=='Reduce exposure'
    assert decisions[2]['reason']=='Keep current allocation'
    assert json.loads(decisions[1]['target_weights'])['DEMO-A']==0.2
    assert decisions[2]['target_weights']
    order_rows=[row for row in rows if row['record_type']=='order']
    assert order_rows and all(row['target_weights'] for row in order_rows)
    assert json.loads(order_rows[0]['detail'])['target_weights']==json.loads(order_rows[0]['target_weights'])


def test_modify_review_queues_order_and_team_change_waits_for_boundary(api):
    created=api.post('/api/experiments',json=base_payload(api,mode='human_review')).json()
    eid=created['id']; state=api.post(f'/api/experiments/{eid}/step').json(); decision=state['decisions'][0]
    response=api.post(f'/api/experiments/{eid}/review',json={'decision_id':decision['id'],'action':'modify','reason':'Reduce exposure','targets':{'DEMO-A':0.2}})
    assert response.status_code==200
    detail=response.json(); assert detail['decisions'][0]['final_proposal']['targets']['DEMO-A']==0.2
    assert detail['orders'][0]['status']=='queued'
    original_team=detail['config']['team']
    changed=api.post(f'/api/experiments/{eid}/team',json={'team':[{'expert_id':'momentum','role':'trader','enabled':True}],'pending_policy':'keep'}).json()
    assert changed['config']['team']==original_team
    assert changed['state']['pending_team'] is not None
    next_day=api.post(f'/api/experiments/{eid}/step').json()
    assert next_day['state']['pending_team'] is None
    assert next_day['state']['active_team'][0]['expert_id']=='momentum'


def test_rejecting_later_proposal_preserves_earlier_approved_order(api):
    created=api.post('/api/experiments',json=base_payload(api,mode='human_review')).json(); eid=created['id']
    first=api.post(f'/api/experiments/{eid}/step').json(); first_decision=first['decisions'][0]
    approved=api.post(f'/api/experiments/{eid}/review',json={'decision_id':first_decision['id'],'action':'approve','reason':''}).json()
    order_id=approved['orders'][0]['id']; assert approved['orders'][0]['status']=='queued'
    second=api.post(f'/api/experiments/{eid}/step').json()
    assert second['orders'][0]['status']=='filled'
    second_decision=second['decisions'][1]
    rejected=api.post(f'/api/experiments/{eid}/review',json={'decision_id':second_decision['id'],'action':'reject','reason':'Keep current holding'}).json()
    assert len(rejected['orders'])==1
    assert rejected['orders'][0]['id']==order_id and rejected['orders'][0]['status']=='filled'
    assert rejected['decisions'][1]['status']=='rejected'


def test_run_pause_and_review_mutations_are_serialized(api, monkeypatch):
    import httpx
    started=asyncio.Event(); release=asyncio.Event()
    async def slow_proposal(cfg,state,bars):
        started.set(); await release.wait()
        snap=main.engine.visible_snapshot(state,bars)
        return main.engine.baseline_proposal(state,snap,'momentum'),None
    monkeypatch.setattr(main,'_proposal',slow_proposal)
    async def scenario():
        transport=httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport,base_url='http://test') as client:
            created=(await client.post('/api/experiments',json=base_payload(api))).json(); eid=created['id']
            run=await client.post(f'/api/experiments/{eid}/run')
            assert run.json()['status']=='running'
            await asyncio.wait_for(started.wait(),2)
            manual_step=await client.post(f'/api/experiments/{eid}/step')
            assert manual_step.status_code==409
            pause=asyncio.create_task(client.post(f'/api/experiments/{eid}/pause'))
            await asyncio.sleep(0.01)
            assert not pause.done()
            release.set(); paused=await asyncio.wait_for(pause,2)
            assert paused.json()['status']=='paused'
            assert len(paused.json()['decisions'])==1

            reviewed=(await client.post('/api/experiments',json=base_payload(api,mode='human_review'))).json(); rid=reviewed['id']
            pending=(await client.post(f'/api/experiments/{rid}/step')).json(); did=pending['decisions'][0]['id']
            body={'decision_id':did,'action':'approve','reason':''}
            outcomes=await asyncio.gather(client.post(f'/api/experiments/{rid}/review',json=body),client.post(f'/api/experiments/{rid}/review',json=body))
            assert all(x.status_code==200 for x in outcomes)
            final=(await client.get(f'/api/experiments/{rid}')).json()
            assert len(final['decisions'])==1 and len(final['orders'])==1
    asyncio.run(scenario())


def test_run_preserves_awaiting_review_and_completed_states(api):
    pending=api.post('/api/experiments',json=base_payload(api,mode='human_review')).json()
    pending=api.post(f"/api/experiments/{pending['id']}/step").json()
    assert pending['status']=='awaiting_review'
    resumed=api.post(f"/api/experiments/{pending['id']}/run").json()
    assert resumed['status']=='awaiting_review'
    assert pending['id'] not in main._tasks

    ds=api.get('/api/datasets').json()[0]
    completed=api.post('/api/experiments',json=base_payload(api,name='single-session',dataset_id=ds['id'],start_date=ds['start_date'],end_date=ds['start_date'],strategy='buy_hold',team=[])).json()
    completed=api.post(f"/api/experiments/{completed['id']}/step").json()
    assert completed['status']=='completed'
    again=api.post(f"/api/experiments/{completed['id']}/run").json()
    assert again['status']=='completed'
    assert completed['id'] not in main._tasks


def test_import_rejects_nonfinite_ohlcv(api):
    csvdata='date,symbol,open,high,low,close,volume\n2024-01-02,XYZ,NaN,3,1,2,10\n'
    response=api.post('/api/datasets/import',files={'file':('prices.csv',csvdata,'text/csv')},data={'adjustment_policy':'as_provided'})
    assert response.status_code==422


def test_baseline_strategy_uses_deterministic_engine_even_when_llm_mode_selected(api):
    body=base_payload(api,provider_mode='llm',strategy='buy_hold',team=[])
    created=api.post('/api/experiments',json=body)
    assert created.status_code==200
    result=api.post(f"/api/experiments/{created.json()['id']}/step").json()
    assert result['decisions'][0]['original_proposal']['provider']=='deterministic_baseline'
    assert result['llm_usage']==[]


def test_execution_cost_bounds_and_engine_errors_are_client_errors(api, monkeypatch):
    payload=base_payload(api)
    for field in ('fee_bps','slippage_bps'):
        invalid=api.post('/api/experiments',json={**payload,field:10000})
        assert invalid.status_code==422
    parent=api.post('/api/experiments',json=payload).json()
    def invalid_engine_config(*args,**kwargs):raise main.engine.EngineError('invalid_config','Invalid engine configuration')
    monkeypatch.setattr(main.engine,'create_state',invalid_engine_config)
    created=api.post('/api/experiments',json=payload)
    assert created.status_code==422 and created.json()['detail']=='Invalid engine configuration'
    branch=api.post(f"/api/experiments/{parent['id']}/branch",json={'name':'Bad branch'})
    assert branch.status_code==422 and branch.json()['detail']=='Invalid engine configuration'


def test_workspace_auth_origin_gate_cookie_and_logout(api, monkeypatch):
    monkeypatch.setenv('TRADING_LAB_WORKSPACE_PASSWORD','strong test passphrase')
    monkeypatch.setenv('TRADING_LAB_SESSION_SECRET','local-test-session-secret')
    monkeypatch.setenv('TRADING_LAB_ORIGIN_TOKEN','origin-secret-for-test')
    assert api.get('/api/health').status_code==200
    assert api.get('/api/auth/status').status_code==403
    headers={'X-Trading-Lab-Origin-Token':'origin-secret-for-test'}
    status=api.get('/api/auth/status',headers=headers)
    assert status.json()=={'auth_required':True,'authenticated':False}
    assert api.get('/api/datasets',headers=headers).status_code==401
    assert api.post('/api/auth/login',headers=headers,json={'password':'incorrect'}).status_code==401
    login=api.post('/api/auth/login',headers=headers,json={'password':'strong test passphrase'})
    assert login.status_code==200 and 'httponly' in login.headers['set-cookie'].lower()
    assert api.get('/api/datasets',headers=headers).status_code==200
    assert api.get('/api/auth/status',headers=headers).json()['authenticated'] is True
    assert api.post('/api/auth/logout',headers=headers).status_code==200
    assert api.get('/api/datasets',headers=headers).status_code==401


def test_failed_experiment_restart_recovery_is_audited(api):
    detail=api.post('/api/experiments',json=base_payload(api)).json(); eid=detail['id']
    with main._db_lock,main._connect() as c:
        state=json.loads(main._experiment(eid)['state']); state['status']='running'
        c.execute("UPDATE experiments SET status='running',state=? WHERE id=?",(json.dumps(state),eid))
    main._init()
    recovered=main._experiment(eid)
    assert recovered['status']=='paused'
    assert json.loads(recovered['state'])['status']=='paused'
    assert any(json.loads(row['event'])['type']=='recovered_after_restart' for row in main._rows('SELECT * FROM events WHERE experiment_id=?',(eid,)))


def test_cloud_secret_encryption_roundtrip_and_fail_closed(monkeypatch):
    from cryptography.fernet import Fernet
    monkeypatch.setenv('TRADING_LAB_ENCRYPTION_KEY',Fernet.generate_key().decode())
    cipher=main._encrypt_secret('provider-key-never-store-in-plaintext')
    assert 'provider-key-never-store-in-plaintext' not in cipher
    assert main._decrypt_secret(cipher)=='provider-key-never-store-in-plaintext'
    monkeypatch.delenv('TRADING_LAB_ENCRYPTION_KEY')
    with pytest.raises(Exception,match='encryption is configured'):
        main._encrypt_secret('secret')


def test_malformed_and_non_object_session_payloads_are_rejected(monkeypatch):
    import base64,hashlib,hmac,time
    monkeypatch.setenv('TRADING_LAB_SESSION_SECRET','session-signing-key-with-at-least-32-bytes')
    assert not main._valid_session('x'*1025)
    assert not main._valid_session('☃.invalid')
    payload=base64.urlsafe_b64encode(b'[1,2,3]').decode().rstrip('=')
    signature=base64.urlsafe_b64encode(hmac.new(main._session_secret().encode(),payload.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    assert not main._valid_session(payload+'.'+signature)
    expired=base64.urlsafe_b64encode(json.dumps({'exp':int(time.time())-1}).encode()).decode().rstrip('=')
    sig=base64.urlsafe_b64encode(hmac.new(main._session_secret().encode(),expired.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    assert not main._valid_session(expired+'.'+sig)


def test_unicode_password_and_gateway_tokens_are_safe_and_cookie_is_secure(api,monkeypatch):
    monkeypatch.setenv('TRADING_LAB_WORKSPACE_PASSWORD','påssword 🔐 with length')
    monkeypatch.setenv('TRADING_LAB_SESSION_SECRET','session-signing-key-with-at-least-32-bytes')
    monkeypatch.setenv('TRADING_LAB_ORIGIN_TOKEN','a-long-origin-token-value-at-least-32')
    monkeypatch.setenv('TRADING_LAB_ENV','production')
    headers={'X-Trading-Lab-Origin-Token':'a-long-origin-token-value-at-least-32'}
    assert not main._constant_time_equal('☃','different token')
    assert api.get('/api/auth/status',headers={**headers,'X-Trading-Lab-Origin-Token':'wrong'}).status_code==403
    assert api.post('/api/auth/login',headers=headers,json={'password':'☃'}).status_code==401
    login=api.post('/api/auth/login',headers=headers,json={'password':'påssword 🔐 with length'})
    assert login.status_code==200
    set_cookie=login.headers['set-cookie'].lower()
    assert 'secure' in set_cookie and 'httponly' in set_cookie and 'samesite=lax' in set_cookie


def test_login_rate_limit_and_upload_limit(api,monkeypatch):
    monkeypatch.setenv('TRADING_LAB_WORKSPACE_PASSWORD','a sufficiently long test password')
    monkeypatch.setenv('TRADING_LAB_SESSION_SECRET','session-signing-key-with-at-least-32-bytes')
    main._login_attempts.clear()
    for _ in range(10):
        assert api.post('/api/auth/login',json={'password':'wrong'}).status_code==401
    assert api.post('/api/auth/login',json={'password':'wrong'}).status_code==429
    monkeypatch.delenv('TRADING_LAB_WORKSPACE_PASSWORD')
    oversized=api.post('/api/datasets/import',files={'file':('big.csv',b'x'*(5*1024*1024+1),'text/csv')})
    assert oversized.status_code==422 and '5 MiB' in oversized.json()['detail']


def test_production_configuration_fails_closed_without_printing_values(monkeypatch):
    import os
    from cryptography.fernet import Fernet
    monkeypatch.setenv('DATABASE_URL','sqlite:///not-allowed')
    monkeypatch.setenv('TRADING_LAB_WORKSPACE_PASSWORD','short')
    monkeypatch.setenv('TRADING_LAB_SESSION_SECRET','x'*32)
    monkeypatch.setenv('TRADING_LAB_ORIGIN_TOKEN','y'*32)
    monkeypatch.setenv('TRADING_LAB_ENCRYPTION_KEY',Fernet.generate_key().decode())
    with pytest.raises(RuntimeError,match='PostgreSQL'):
        main._validate_production_config()
    monkeypatch.setenv('DATABASE_URL','postgresql://sample')
    with pytest.raises(RuntimeError,match='12 characters'):
        main._validate_production_config()
    monkeypatch.setenv('TRADING_LAB_WORKSPACE_PASSWORD','long-enough-test-password')
    monkeypatch.setenv('TRADING_LAB_SESSION_SECRET','short')
    with pytest.raises(RuntimeError,match='TRADING_LAB_SESSION_SECRET'):
        main._validate_production_config()


def test_settings_secret_write_only_and_local_compatible_llm(api):
    calls=[]
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            n=int(self.headers['Content-Length']); payload=json.loads(self.rfile.read(n)); calls.append((self.path,self.headers.get('Authorization'),payload))
            function=payload.get('tool_choice',{}).get('function',{}).get('name','submit_trade_proposal')
            args={'action':'rebalance','targets':{'DEMO-A':0.25},'rationale':'Mock server response','risks':[]} if function=='submit_trade_proposal' else {'stance':'support','rationale':'Mock adviser opinion','risks':[]}
            body={'model':'mock-model','choices':[{'message':{'tool_calls':[{'function':{'name':function,'arguments':json.dumps(args)}}]}}],'usage':{'prompt_tokens':120,'completion_tokens':40}}
            encoded=json.dumps(body).encode(); self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(encoded))); self.end_headers(); self.wfile.write(encoded)
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler); thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
    try:
        secret='mock-secret-never-return-this'
        saved=api.put('/api/settings',json={'base_url':f'http://127.0.0.1:{server.server_port}/v1','model':'mock-model','api_key':secret,'input_cost_per_million':1.0,'output_cost_per_million':2.0})
        assert saved.status_code==200 and secret not in saved.text
        assert stat.S_IMODE(main.SECRET_PATH.stat().st_mode)==0o600
        assert api.get('/api/settings').json()['api_key_configured'] is True
        assert api.post('/api/settings/test').json()['ok'] is True
        body=base_payload(api,provider_mode='llm',team=[{'expert_id':'momentum','role':'trader','enabled':True},{'expert_id':'risk','role':'advisor','enabled':True}])
        created=api.post('/api/experiments',json=body).json()
        api.put('/api/settings',json={'model':'changed-after-freeze'})
        detail=api.post(f"/api/experiments/{created['id']}/step").json()
        assert detail['decisions'], detail
        assert detail['decisions'][0]['original_proposal']['rationale']=='Mock server response'
        assert detail['llm_usage'][0]['prompt_tokens']==120
        assert len(detail['expert_opinions'])==2 and detail['expert_opinions'][1]['rationale']=='Mock adviser opinion'
        assert detail['coordination']['final_proposal']['rationale']=='Mock server response'
        assert detail['config']['settings_snapshot']['model']=='mock-model'
        assert all(call[2]['model']=='mock-model' for call in calls if call[2].get('tool_choice'))
        assert calls and calls[0][0]=='/v1/chat/completions' and calls[0][1]=='Bearer '+secret
        assert secret not in api.get(f"/api/experiments/{created['id']}").text
        assert secret not in api.get(f"/api/experiments/{created['id']}/export?format=json").text
        limited=api.post('/api/experiments',json=base_payload(api,provider_mode='llm',max_calls=1,team=[{'expert_id':'momentum','role':'trader','enabled':True},{'expert_id':'risk','role':'advisor','enabled':True}])).json()
        failed=api.post(f"/api/experiments/{limited['id']}/step").json()
        date_after_failure=failed['state']['current_date']
        assert failed['status']=='paused' and failed['state']['needs_decision'] is True
        assert failed['state']['llm_calls']==1 and failed['decisions']==[]
        retry=api.post(f"/api/experiments/{limited['id']}/step").json()
        assert retry['state']['current_date']==date_after_failure
        assert retry['decisions']==[] and retry['status']=='paused'
    finally:
        server.shutdown(); thread.join(timeout=2); server.server_close()


def test_legacy_settings_migrate_key_and_backfill_new_defaults(tmp_path, monkeypatch):
    monkeypatch.setattr(main,'DB_PATH',tmp_path/'legacy.sqlite3')
    monkeypatch.setattr(main,'SECRET_PATH',tmp_path/'data'/'secret.json')
    main.DB_PATH.parent.mkdir(parents=True,exist_ok=True)
    import sqlite3
    with sqlite3.connect(main.DB_PATH) as conn:
        conn.execute('CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT)')
        conn.execute('INSERT INTO settings VALUES(1,?)',(json.dumps({'base_url':'http://example.test/v1','model':'old-model','api_key':'old-secret','max_calls':7,'budget_usd':3}),))
    main._init()
    assert main._settings()=={'base_url':'http://example.test/v1','model':'old-model','max_calls':7,'budget_usd':3,'input_cost_per_million':None,'output_cost_per_million':None}
    assert main._secret()=='old-secret'
    assert stat.S_IMODE(main.SECRET_PATH.stat().st_mode)==0o600
    with sqlite3.connect(main.DB_PATH) as conn:
        conn.execute('INSERT INTO experiments(id,name,status,config,state) VALUES(?,?,?,?,?)',('legacy-exp','Legacy','ready',json.dumps({'name':'Legacy','api_key':'old-secret','settings_snapshot':{'model':'old-model','api_key':'old-secret'}}),'{}'))
    monkeypatch.setattr(main.engine,'performance_metrics',lambda state:{})
    with TestClient(main.app) as client:
        settings=client.get('/api/settings')
        assert settings.status_code==200 and 'old-secret' not in settings.text
        assert settings.json()['api_key_configured'] is True
        assert 'old-secret' not in client.get('/api/experiments/legacy-exp').text
        assert 'old-secret' not in client.get('/api/experiments/legacy-exp/export?format=json').text
    stored=json.loads(sqlite3.connect(main.DB_PATH).execute('SELECT body FROM settings WHERE id=1').fetchone()[0])
    assert 'api_key' not in stored


def test_invalid_llm_output_counts_attempt_and_retry_keeps_same_date(api, monkeypatch):
    configured=api.put('/api/settings',json={'base_url':'http://127.0.0.1:1/v1','model':'mock-model','api_key':'mock-key','input_cost_per_million':1,'output_cost_per_million':1})
    assert configured.status_code==200
    async def bad_output(*args,**kwargs):
        return {'model':'mock-model','choices':[{'message':{'content':'not structured','tool_calls':[]}}],'usage':{'prompt_tokens':100,'completion_tokens':40}}
    monkeypatch.setattr(main,'_llm_request',bad_output)
    body=base_payload(api,provider_mode='llm',max_calls=3,team=[{'expert_id':'momentum','role':'trader','enabled':True}])
    created=api.post('/api/experiments',json=body).json(); eid=created['id']
    first=api.post(f'/api/experiments/{eid}/step').json(); date1=first['state']['current_date']
    assert first['status']=='paused' and first['state']['llm_calls']==1
    assert first['llm_usage'][0]['status']=='invalid_output'
    second=api.post(f'/api/experiments/{eid}/step').json()
    assert second['state']['current_date']==date1
    assert second['state']['llm_calls']==2 and second['decisions']==[]


def test_low_dollar_budget_stops_before_call_and_holds_current_date(api, monkeypatch):
    api.put('/api/settings',json={'base_url':'http://127.0.0.1:1/v1','model':'mock-model','api_key':'mock-key','input_cost_per_million':1,'output_cost_per_million':1})
    async def unexpected_call(*args,**kwargs):raise AssertionError('budget preflight should stop before sending')
    monkeypatch.setattr(main,'_llm_request',unexpected_call)
    body=base_payload(api,provider_mode='llm',budget_usd=0.0001,team=[{'expert_id':'momentum','role':'trader','enabled':True}])
    created=api.post('/api/experiments',json=body).json(); eid=created['id']
    detail=api.post(f'/api/experiments/{eid}/step').json()
    assert detail['status']=='paused' and detail['state']['needs_decision'] is True
    assert detail['state']['llm_calls']==0 and detail['decisions']==[]
