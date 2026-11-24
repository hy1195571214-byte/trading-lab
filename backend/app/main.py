"""Local-first Trading Lab API. All trading execution is paper/backtest only."""
from __future__ import annotations

import asyncio, csv, hashlib, io, json, os, sqlite3, threading, uuid, math, hmac, time, base64
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from . import engine

DB_PATH = Path(os.environ.get("TRADING_LAB_DB", Path(__file__).resolve().parents[1] / "trading_lab.sqlite3"))
DATABASE_URL = os.environ.get('DATABASE_URL')
SECRET_PATH = Path(os.environ.get("TRADING_LAB_SECRET_FILE", Path(__file__).resolve().parents[1] / "data" / "secrets.json"))
@asynccontextmanager
async def lifespan(_app):
    if os.getenv('TRADING_LAB_ENV','').lower()=='production':
        required=('DATABASE_URL','TRADING_LAB_SESSION_SECRET','TRADING_LAB_ORIGIN_TOKEN','TRADING_LAB_ENCRYPTION_KEY')
        if not _public_workspace(): required+=('TRADING_LAB_WORKSPACE_PASSWORD',)
        missing=[name for name in required if not os.getenv(name)]
        if missing: raise RuntimeError('Missing required production configuration: '+', '.join(missing))
        _validate_production_config()
    _init()
    yield

app = FastAPI(title="Trading Lab", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in os.getenv('TRADING_LAB_ALLOWED_ORIGINS','http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000').split(',') if x.strip()], allow_credentials=True, allow_methods=["GET", "POST", "PUT"], allow_headers=["Content-Type", "Authorization", "X-Trading-Lab-Origin-Token"])
_db_lock = threading.RLock()
_locks_guard = threading.Lock()
_experiment_locks: dict[str, asyncio.Lock] = {}
_tasks: dict[str, asyncio.Task] = {}
_benchmark_cache: dict[tuple, dict] = {}
_login_attempts: dict[str, list[float]] = {}

def _constant_time_equal(left,right):
    if not isinstance(left,str) or not isinstance(right,str): return False
    return hmac.compare_digest(left.encode('utf-8'),right.encode('utf-8'))

def _validate_production_config():
    if not (os.getenv('DATABASE_URL','').startswith('postgres://') or os.getenv('DATABASE_URL','').startswith('postgresql://')):
        raise RuntimeError('DATABASE_URL must use a PostgreSQL connection URL')
    if not _public_workspace() and len(os.getenv('TRADING_LAB_WORKSPACE_PASSWORD',''))<12:
        raise RuntimeError('TRADING_LAB_WORKSPACE_PASSWORD must be at least 12 characters')
    for key in ('TRADING_LAB_SESSION_SECRET','TRADING_LAB_ORIGIN_TOKEN'):
        if len(os.getenv(key,'').encode('utf-8'))<32: raise RuntimeError(key+' must be at least 32 bytes')
    try:
        from cryptography.fernet import Fernet
        Fernet(os.getenv('TRADING_LAB_ENCRYPTION_KEY','').encode())
    except Exception as exc: raise RuntimeError('TRADING_LAB_ENCRYPTION_KEY must be a valid Fernet key') from exc

def _public_workspace(): return os.getenv('TRADING_LAB_PUBLIC_WORKSPACE','').strip().lower()=='true'
def _auth_required(): return not _public_workspace() and bool(os.getenv('TRADING_LAB_WORKSPACE_PASSWORD'))
def _session_secret(): return os.getenv('TRADING_LAB_SESSION_SECRET','')
def _origin_required(): return bool(os.getenv('TRADING_LAB_ORIGIN_TOKEN'))
def _session_token():
    secret=_session_secret()
    if not secret:return None
    payload=base64.urlsafe_b64encode(json.dumps({'exp':int(time.time())+7*86400},separators=(',',':')).encode()).decode().rstrip('=')
    sig=base64.urlsafe_b64encode(hmac.new(secret.encode(),payload.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    return payload+'.'+sig
def _valid_session(token):
    try:
        if not isinstance(token,str) or not token or len(token)>1024 or not _session_secret(): return False
        payload,sig=token.split('.',1)
        if not payload or not sig or len(sig)>128:return False
        expected=base64.urlsafe_b64encode(hmac.new(_session_secret().encode('utf-8'),payload.encode('ascii'),hashlib.sha256).digest()).decode().rstrip('=')
        if not _constant_time_equal(sig,expected):return False
        data=json.loads(base64.urlsafe_b64decode(payload+'='*((4-len(payload)%4)%4)))
        if not isinstance(data,dict):return False
        expires=data.get('exp')
        return isinstance(expires,int) and not isinstance(expires,bool) and expires>int(time.time())
    except Exception:return False

@app.middleware('http')
async def protect_api(request:Request, call_next):
    path=request.url.path
    if path.startswith('/api/') and path!='/api/health':
        expected=os.getenv('TRADING_LAB_ORIGIN_TOKEN')
        if expected and not _constant_time_equal(request.headers.get('X-Trading-Lab-Origin-Token',''),expected):
            return JSONResponse(status_code=403,content={'detail':'Origin gateway token required'})
        if _auth_required() and path not in ('/api/auth/status','/api/auth/login','/api/auth/logout') and not _valid_session(request.cookies.get('trading_lab_session','')):
            return JSONResponse(status_code=401,content={'detail':'Workspace login required'})
    return await call_next(request)

@app.get('/api/auth/status')
def auth_status(request:Request):
    return {'auth_required':_auth_required(),'authenticated':not _auth_required() or _valid_session(request.cookies.get('trading_lab_session',''))}

@app.post('/api/auth/login')
def auth_login(request:Request,body:dict):
    if not _auth_required():return {'authenticated':True}
    configured=os.getenv('TRADING_LAB_WORKSPACE_PASSWORD')
    ip=request.client.host if request.client else 'unknown'; now=time.time(); attempts=[x for x in _login_attempts.get(ip,[]) if now-x<300]
    if len(attempts)>=10:raise HTTPException(429,'Too many login attempts; try again in five minutes')
    attempts.append(now);_login_attempts[ip]=attempts
    supplied=body.get('password')
    if not _constant_time_equal(supplied,configured):raise HTTPException(401,'Invalid password')
    token=_session_token()
    if not token:raise HTTPException(503,'Workspace session signing is not configured')
    response=JSONResponse({'authenticated':True}); response.set_cookie('trading_lab_session',token,httponly=True,secure=os.getenv('TRADING_LAB_ENV','').lower()=='production',samesite='lax',max_age=7*86400,path='/')
    _login_attempts.pop(ip,None);return response

@app.post('/api/auth/logout')
def auth_logout():
    response=JSONResponse({'authenticated':not _auth_required()});response.delete_cookie('trading_lab_session',path='/');return response

def _connect():
    if DATABASE_URL:
        import psycopg
        from psycopg.rows import dict_row
        class PGConnection:
            def __init__(self): self.raw=psycopg.connect(DATABASE_URL, row_factory=dict_row)
            def __enter__(self): self.raw.__enter__(); return self
            def __exit__(self,*args): return self.raw.__exit__(*args)
            def execute(self,sql,args=()): return self.raw.execute(sql.replace('?','%s'),args)
            def commit(self): return self.raw.commit()
            def rollback(self): return self.raw.rollback()
        return PGConnection()
    c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    return c

def _init():
    if not DATABASE_URL: DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _db_lock, _connect() as c:
        schema='''
        CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY,name TEXT,checksum TEXT,synthetic INTEGER,metadata TEXT,bars TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS experts(id TEXT PRIMARY KEY,name TEXT,version INTEGER,body TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY,name TEXT,status TEXT,config TEXT,state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,experiment_id TEXT,event TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT);
        CREATE TABLE IF NOT EXISTS app_secrets(id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL);
        '''
        if DATABASE_URL:
            for statement in schema.split(';'):
                if statement.strip(): c.execute(statement.replace('INTEGER PRIMARY KEY AUTOINCREMENT','BIGSERIAL PRIMARY KEY').replace('INTEGER','BIGINT'))
        else: c.executescript(schema)
        settings_row=c.execute('SELECT body FROM settings WHERE id=1').fetchone()
        if not settings_row:
            c.execute('INSERT INTO settings VALUES(1,?)',(json.dumps(_default_settings()),))
        else:
            # Older builds stored the API key in the settings JSON. Move it to
            # the restricted local secret file before persisting sanitized settings.
            settings=json.loads(settings_row['body'])
            legacy_key=settings.pop('api_key',None)
            if isinstance(legacy_key,str) and legacy_key and not os.environ.get('TRADING_LAB_API_KEY') and not _secret_file_has_key():
                _write_secret(legacy_key,connection=c)
            known={k:v for k,v in settings.items() if k in _default_settings()}
            normalized={**_default_settings(),**known}
            if normalized != settings or legacy_key is not None:
                c.execute('UPDATE settings SET body=? WHERE id=1',(json.dumps(normalized),))
        if not c.execute('SELECT 1 FROM datasets').fetchone(): _seed(c)
        if not c.execute('SELECT 1 FROM experts').fetchone(): _seed_experts(c)
        # A process restart must preserve the unfinished run as a paused run with an audit event.
        for row in c.execute("SELECT id,name,config,state FROM experiments WHERE status='running'").fetchall():
            state=json.loads(row['state']); state['status']='paused'
            c.execute("UPDATE experiments SET status='paused',state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(json.dumps(state),row['id']))
            c.execute('INSERT INTO events(experiment_id,event) VALUES(?,?)',(row['id'],json.dumps({'type':'recovered_after_restart','message':'Run paused during service restart; resume to continue.'})))

def _seed(c):
    bars=[]; start=date(2023,1,3)
    for i in range(420):
        d=start+timedelta(days=i)
        if d.weekday()>4: continue
        for j,sym in enumerate(('DEMO-A','DEMO-B','DEMO-C')):
            close=100+j*35+i*(0.045+j*0.012)+((i*7+j*11)%17-8)*0.22
            bars.append({'date':d.isoformat(),'symbol':sym,'open':round(close*.998,4),'high':round(close*1.012,4),'low':round(close*.988,4),'close':round(close,4),'volume':1000000+i*13})
    data=json.dumps(bars,separators=(',',':')); checksum=hashlib.sha256(data.encode()).hexdigest()
    c.execute('INSERT INTO datasets(id,name,checksum,synthetic,metadata,bars) VALUES(?,?,?,?,?,?)',('demo-synthetic-v1','Synthetic demo market data',checksum,1,json.dumps({'symbols':['DEMO-A','DEMO-B','DEMO-C'],'rows':len(bars),'start_date':bars[0]['date'],'end_date':bars[-1]['date'],'label':'SYNTHETIC DEMO DATA — not real market history'}),data))

def _seed_experts(c):
    experts=[('momentum','Momentum','momentum','Trend-following demo strategy.','price','trader'),('value','Value','value','Requires supplied fundamentals; no financials are fabricated.','fundamentals','advisor'),('risk','Risk','risk','Advisory risk review; cannot place orders.','price','advisor')]
    for id,name,strategy,description,required,role in experts:
        body={'id':id,'name':name,'version':1,'strategy':strategy,'description':description,'objective':description,'horizon':'daily','required_data':[required],'instructions':'Use only the supplied, point-in-time dataset.','risk_notes':'Synthetic demo strategies are not investment advice.','role':role}
        c.execute('INSERT INTO experts(id,name,version,body) VALUES(?,?,1,?)',(id,name,json.dumps(body)))

def _rows(sql,args=()):
    with _db_lock, _connect() as c:return [dict(r) for r in c.execute(sql,args)]
def _row(sql,args=()):
    r=_rows(sql,args); return r[0] if r else None
def _save_experiment(eid,name,status,config,state):
    with _db_lock,_connect() as c:
        c.execute('INSERT INTO experiments(id,name,status,config,state,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,config=excluded.config,state=excluded.state,updated_at=CURRENT_TIMESTAMP',(eid,name,status,json.dumps(config),json.dumps(state)))
def _new_state(config,bars):
    try:state=engine.create_state(config,bars)
    except engine.EngineError as exc:raise HTTPException(422,exc.detail)
    state.update({'llm_calls':0,'llm_usage':[],'expert_opinions':[]})
    return state
def _event(eid,event):
    with _db_lock,_connect() as c:c.execute('INSERT INTO events(experiment_id,event) VALUES(?,?)',(eid,json.dumps(event)))
def _get_lock(eid):
    with _locks_guard:return _experiment_locks.setdefault(eid,asyncio.Lock())
def _experiment(eid):
    r=_row('SELECT * FROM experiments WHERE id=?',(eid,))
    if not r:raise HTTPException(404,'Experiment not found')
    return r
def _decode_exp(r):
    cfg=json.loads(r['config'])
    # Older experiment snapshots may have captured pre-migration settings.
    # Sanitize at the response boundary as well as during settings migration.
    snapshot=cfg.get('settings_snapshot')
    if isinstance(snapshot,dict):cfg['settings_snapshot']={k:v for k,v in snapshot.items() if k in _default_settings()}
    cfg.pop('api_key',None)
    state=json.loads(r['state'])
    metrics=engine.performance_metrics(state); metrics.update({'portfolio_value':state.get('equity',cfg.get('initial_capital')),'sharpe':metrics.get('sharpe_ratio'),'fees':state.get('fees_paid',0)})
    benchmark_history=[]; benchmark_metrics=None
    if state.get('current_date') is not None and hasattr(engine,'benchmark_report'):
        ds=_row('SELECT bars FROM datasets WHERE id=?',(cfg.get('dataset_id'),))
        if ds:
            bdata=[b for b in json.loads(ds['bars']) if cfg['start_date']<=b['date']<=cfg['end_date'] and b['symbol'] in cfg['symbols']]
            key=(cfg.get('dataset_id'),cfg.get('dataset_checksum'),state.get('current_date'),cfg.get('start_date'),cfg.get('end_date'),cfg.get('initial_capital'),cfg.get('fee_bps'),cfg.get('slippage_bps'),cfg.get('max_position_weight'),tuple(cfg.get('symbols',[])))
            report=_benchmark_cache.get(key)
            if report is None:
                report=engine.benchmark_report(state,bdata); _benchmark_cache[key]=report
                if len(_benchmark_cache)>128:_benchmark_cache.pop(next(iter(_benchmark_cache)))
            benchmark_history=report.get('history',[]); benchmark_metrics=report.get('metrics')
    holdings=[{'symbol':s,'quantity':p.get('quantity',0),'weight':p.get('quantity',0)*p.get('last_price',0)/state.get('equity',1) if state.get('equity') else 0,'market_value':p.get('quantity',0)*p.get('last_price',0),'price_date':p.get('last_price_date'),'is_stale':p.get('last_price_date')!=state.get('current_date')} for s,p in state.get('positions',{}).items()]
    state_events=state.get('events',[]); db_events=[{'id':x['id'],'created_at':x['created_at'],**json.loads(x['event'])} for x in _rows('SELECT * FROM events WHERE experiment_id=? ORDER BY id',(r['id'],))]
    return {'id':r['id'],'name':r['name'],'status':r['status'],'config':cfg,'state':state,'metrics':metrics,'history':state.get('history',[]),'benchmark_history':benchmark_history,'benchmark_metrics':benchmark_metrics,'decisions':state.get('decisions',[]),'orders':state.get('orders',[]),'events':state_events+db_events,'holdings':holdings,'expert_opinions':state.get('expert_opinions',[]),'coordination':state.get('coordination'),'llm_usage':state.get('llm_usage',[]),'decision_traces':state.get('decision_traces',[])}

@app.get('/api/health')
def health():return {'status':'ok','mode':'paper trading only'}
@app.get('/api/datasets')
def datasets():return [{k:r[k] for k in ('id','name','checksum','synthetic','created_at')}|json.loads(r['metadata']) for r in _rows('SELECT * FROM datasets ORDER BY created_at')]
@app.get('/api/datasets/{dataset_id}')
def dataset(dataset_id):
    r=_row('SELECT * FROM datasets WHERE id=?',(dataset_id,))
    if not r:raise HTTPException(404,'Dataset not found')
    return {'id':r['id'],'name':r['name'],'checksum':r['checksum'],'synthetic':bool(r['synthetic']),**json.loads(r['metadata'])}
@app.post('/api/datasets/import')
async def import_dataset(file:UploadFile=File(...),name:str|None=Form(None),adjustment_policy:str=Form('as_provided')):
    try:
        if adjustment_policy not in ('as_provided','unadjusted','split_adjusted','total_return_adjusted'):raise ValueError('Unsupported adjustment_policy')
        raw=await file.read(5*1024*1024+1)
        if len(raw)>5*1024*1024:raise ValueError('CSV exceeds 5 MiB import limit')
        text=raw.decode('utf-8-sig'); reader=csv.DictReader(io.StringIO(text)); required={'date','symbol','open','high','low','close','volume'}
        if not reader.fieldnames or not required.issubset({x.strip().lower() for x in reader.fieldnames}):raise ValueError('CSV needs date,symbol,open,high,low,close,volume columns')
        bars=[]; seen=set()
        for rownum,line in enumerate(reader,1):
            if rownum>500000:raise ValueError('CSV exceeds 500,000 row import limit')
            x={k.strip().lower():v for k,v in line.items()}; d=date.fromisoformat(x['date'][:10]).isoformat(); sym=x['symbol'].strip().upper()
            b={'date':d,'symbol':sym,'open':float(x['open']),'high':float(x['high']),'low':float(x['low']),'close':float(x['close']),'volume':float(x['volume'])}
            if any(not math.isfinite(b[k]) for k in ('open','high','low','close','volume')):raise ValueError('OHLCV values must be finite numbers')
            if not sym or min(b[k] for k in ('open','high','low','close'))<=0 or b['low']>min(b['open'],b['close']) or b['high']<max(b['open'],b['close']) or b['volume']<0:raise ValueError('Invalid OHLCV values')
            if (d,sym) in seen:raise ValueError(f'Duplicate date/symbol: {d} {sym}')
            seen.add((d,sym)); bars.append(b)
        if not bars:raise ValueError('CSV has no data rows')
    except (UnicodeDecodeError,ValueError,KeyError) as e:raise HTTPException(422,str(e))
    bars.sort(key=lambda x:(x['date'],x['symbol'])); payload=json.dumps(bars,separators=(',',':')); checksum=hashlib.sha256(raw).hexdigest(); did=str(uuid.uuid4()); symbols=sorted({b['symbol'] for b in bars}); meta={'symbols':symbols,'rows':len(bars),'start_date':bars[0]['date'],'end_date':bars[-1]['date'],'adjustment_policy':adjustment_policy,'label':'User-imported historical data'}
    with _db_lock,_connect() as c:c.execute('INSERT INTO datasets(id,name,checksum,synthetic,metadata,bars) VALUES(?,?,?,?,?,?)',(did,name or file.filename or did,checksum,0,json.dumps(meta),payload))
    _event('system',{'type':'dataset_imported','dataset_id':did,'checksum':checksum,'rows':len(bars)})
    return {'id':did,'name':name or file.filename,'checksum':checksum,'synthetic':False,**meta}

@app.get('/api/experts')
def experts():return [json.loads(r['body']) for r in _rows('SELECT body FROM experts ORDER BY name')]
@app.post('/api/experts')
def create_expert(body:dict):
    required=('name','strategy','description','objective','horizon','required_data','instructions','risk_notes','role')
    if any(k not in body for k in required):raise HTTPException(422,'Missing expert fields')
    if not isinstance(body['required_data'],list) or not all(isinstance(x,str) and x.strip() for x in body['required_data']):raise HTTPException(422,'required_data must be a list of named data requirements')
    body={**body,'required_data':['price' if x.strip().lower() in ('price','prices','ohlcv','price history','historical prices') else x.strip().lower() for x in body['required_data']]}
    if body['role'].lower() not in ('trader','advisor','trading strategy','strategy'):raise HTTPException(422,'role must be trader or advisor')
    eid=str(uuid.uuid4()); body={**body,'id':eid,'version':1}
    with _db_lock,_connect() as c:c.execute('INSERT INTO experts(id,name,version,body) VALUES(?,?,1,?)',(eid,body['name'],json.dumps(body)))
    _event('system',{'type':'expert_created','expert_id':eid,'name':body['name'],'version':1})
    return body
@app.get('/api/experts/{expert_id}')
def expert(expert_id):
    r=_row('SELECT body FROM experts WHERE id=?',(expert_id,))
    if not r:raise HTTPException(404,'Expert not found')
    return json.loads(r['body'])

def _default_settings():
    return {'base_url':'','model':'','max_calls':100,'budget_usd':10.0,'input_cost_per_million':None,'output_cost_per_million':None}

def _secret_file_has_key():
    try:
        key=json.loads(SECRET_PATH.read_text()).get('api_key')
        return isinstance(key,str) and bool(key)
    except (OSError,ValueError,AttributeError):
        return False

def _write_secret(key,connection=None):
    if DATABASE_URL:
        encrypted=_encrypt_secret(key)
        if connection is not None:
            connection.execute("INSERT INTO app_secrets(id,ciphertext) VALUES('llm_api_key',?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext",(encrypted,))
        else:
            with _db_lock,_connect() as c:
                c.execute("INSERT INTO app_secrets(id,ciphertext) VALUES('llm_api_key',?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext",(encrypted,))
        return
    SECRET_PATH.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(SECRET_PATH,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as stream:
        stream.write(json.dumps({'api_key':key}))
    SECRET_PATH.chmod(0o600)

def _secret():
    key=os.environ.get('TRADING_LAB_API_KEY')
    if key:return key
    if DATABASE_URL:
        row=_row("SELECT ciphertext FROM app_secrets WHERE id='llm_api_key'")
        return _decrypt_secret(row['ciphertext']) if row else None
    try:return json.loads(SECRET_PATH.read_text()).get('api_key')
    except (OSError,ValueError,AttributeError):return None

def _encrypt_secret(value):
    master=os.getenv('TRADING_LAB_ENCRYPTION_KEY')
    if not master: raise HTTPException(503,'Cloud API key storage is unavailable until encryption is configured')
    try:
        from cryptography.fernet import Fernet
        return Fernet(master.encode()).encrypt(value.encode()).decode()
    except Exception as exc: raise HTTPException(503,'Cloud API key encryption is not configured correctly') from exc
def _decrypt_secret(value):
    master=os.getenv('TRADING_LAB_ENCRYPTION_KEY')
    if not master: raise RuntimeError('Cloud API key encryption key is unavailable')
    from cryptography.fernet import Fernet
    return Fernet(master.encode()).decrypt(value.encode()).decode()
def _settings():
    row=_row('SELECT body FROM settings WHERE id=1')
    if not row:return _default_settings()
    # Defend API and snapshots even if called before lifespan migration.
    return _safe_settings(json.loads(row['body']))

def _safe_settings(settings):
    if not isinstance(settings,dict):return _default_settings()
    defaults=_default_settings()
    return {**defaults,**{k:v for k,v in settings.items() if k in defaults}}
def _public_settings():return {**_settings(),'api_key_configured':bool(_secret())}
@app.get('/api/settings')
def get_settings():return _public_settings()
@app.put('/api/settings')
def put_settings(body:dict):
    current=_settings(); allowed=('base_url','model','max_calls','budget_usd','input_cost_per_million','output_cost_per_million')
    for k in allowed:
        if k in body:current[k]=body[k]
    try:
        if isinstance(current.get('max_calls'),bool) or not isinstance(current.get('max_calls'),int) or int(current.get('max_calls',0))<0 or not math.isfinite(float(current.get('budget_usd',-1))) or float(current['budget_usd'])<0:raise ValueError()
        for k in ('input_cost_per_million','output_cost_per_million'):
            if current.get(k) is not None and (not math.isfinite(float(current[k])) or float(current[k])<0):raise ValueError()
        if current.get('base_url'):
            from urllib.parse import urlparse
            parsed=urlparse(current['base_url'])
            if parsed.scheme not in ('http','https') or not parsed.netloc:raise ValueError()
        if current.get('model') is not None and not isinstance(current['model'],str):raise ValueError()
    except (ValueError,TypeError,KeyError):raise HTTPException(422,'Invalid settings values or endpoint URL')
    if 'api_key' in body and body['api_key']:
        if not isinstance(body['api_key'],str) or len(body['api_key'])>4096:raise HTTPException(422,'Invalid API key value')
        _write_secret(body['api_key'])
    with _db_lock,_connect() as c:c.execute('UPDATE settings SET body=? WHERE id=1',(json.dumps(current),))
    _event('system',{'type':'settings_updated','fields':sorted(k for k in allowed if k in body),'api_key_configured':bool(_secret())})
    return _public_settings()

async def _llm_request(messages,tools=None,timeout=30,settings=None):
    s=settings or _settings(); key=_secret()
    if not key:raise RuntimeError('LLM API key is not configured')
    if not s.get('base_url') or not s.get('model'):raise RuntimeError('LLM base URL and model must be configured')
    url=s['base_url'].rstrip('/')+'/chat/completions'
    payload={'model':s['model'],'messages':messages,'temperature':0,'max_tokens':512}
    # DeepSeek's official API defaults to thinking mode, which does not support
    # named tool_choice. Disable it only for the exact official API hostname.
    from urllib.parse import urlparse
    if urlparse(s['base_url']).hostname == 'api.deepseek.com':
        payload['thinking']={'type':'disabled'}
    if tools:
        payload['tools']=tools
        fn=tools[0]['function']['name']
        payload['tool_choice']={'type':'function','function':{'name':fn}}
    local_host=s['base_url'].split('/')[2].split(':')[0] in ('localhost','127.0.0.1','::1')
    async with httpx.AsyncClient(timeout=timeout,trust_env=not local_host) as client:
        response=await client.post(url,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},json=payload)
    if response.status_code>=400:raise RuntimeError(f'LLM endpoint returned HTTP {response.status_code}')
    data=response.json()
    if not data.get('choices'):raise RuntimeError('LLM response has no choices')
    return data
@app.post('/api/settings/test')
async def test_settings():
    try:
        data=await _llm_request([{'role':'user','content':'Reply with the single word OK.'}])
        return {'ok':True,'model':data.get('model',_settings()['model']),'reply':data['choices'][0]['message'].get('content','')}
    except httpx.TimeoutException:raise HTTPException(502,'LLM request timed out')
    except httpx.RequestError:raise HTTPException(502,'Could not reach the configured LLM endpoint')
    except Exception as e:
        message=str(e); key=_secret()
        if key:message=message.replace(key,'[redacted]')
        endpoint=_settings().get('base_url')
        if endpoint:message=message.replace(endpoint,'[configured endpoint]')
        raise HTTPException(502,message or 'LLM connection test failed')

class ExperimentIn(BaseModel):
    name:str; dataset_id:str; start_date:str; end_date:str
    initial_capital:float=Field(gt=0); fee_bps:float=Field(default=0,ge=0,lt=10000); slippage_bps:float=Field(default=0,ge=0,lt=10000)
    max_position_weight:float=Field(default=1,gt=0,le=1); mode:str='ai_only'; strategy:str='agent'
    team:list[dict]=Field(default_factory=list); provider_mode:str='demo'; max_calls:int|None=None; budget_usd:float|None=None
def _config(body):
    cfg=body.model_dump(); ds=_row('SELECT * FROM datasets WHERE id=?',(cfg['dataset_id'],))
    for k in ('initial_capital','fee_bps','slippage_bps','max_position_weight','budget_usd'):
        if cfg.get(k) is not None and not math.isfinite(float(cfg[k])):raise HTTPException(422,f'{k} must be finite')
    if cfg.get('max_calls') is not None and (isinstance(cfg['max_calls'],bool) or not isinstance(cfg['max_calls'],int) or cfg['max_calls']<0):raise HTTPException(422,'max_calls must be a nonnegative integer')
    if not ds:raise HTTPException(404,'Dataset not found')
    bars=json.loads(ds['bars'])
    try:date.fromisoformat(cfg['start_date']); date.fromisoformat(cfg['end_date'])
    except ValueError:raise HTTPException(422,'Dates must use valid ISO YYYY-MM-DD values')
    if cfg['end_date']<cfg['start_date']:raise HTTPException(422,'end_date must be on or after start_date')
    chosen=[b for b in bars if cfg['start_date']<=b['date']<=cfg['end_date']]
    if not chosen:raise HTTPException(422,'No bars available in selected date range')
    snapshots=[]
    for item in cfg['team']:
        if not item.get('enabled',True):continue
        r=_row('SELECT body FROM experts WHERE id=?',(item.get('expert_id'),))
        if not r:raise HTTPException(422,'Unknown expert in team')
        e=json.loads(r['body']); role=item.get('role',e.get('role','trader'))
        if not isinstance(role,str) or role.lower() not in ('trader','advisor','trading strategy','strategy'):raise HTTPException(422,'Each team role must be trader or advisor')
        if any(x not in ('price','ohlcv') for x in e.get('required_data',[])):raise HTTPException(422,f"{e['name']} requires unavailable data: {', '.join(e.get('required_data',[]))}")
        role='trader' if role.lower() in ('trader','trading strategy','strategy') else 'advisor'
        snapshots.append({**e,'role':role})
    traders=[x for x in snapshots if x['role']=='trader']
    if snapshots and len(traders)!=1:raise HTTPException(422,'Select exactly one trading strategy expert; additional experts must be advisors')
    cfg['dataset_checksum']=ds['checksum']; cfg['dataset_version']=ds['id']; cfg['dataset_synthetic']=bool(ds['synthetic']); cfg['expert_snapshots']=snapshots; cfg['team']=[{'expert_id':x['id'],'role':x['role'],'enabled':True,**x} for x in snapshots]; cfg['prompt_version']='expert-team-v2-hold-target-contract'
    cfg['settings_snapshot']={k:v for k,v in _settings().items() if k!='api_key'}; cfg['max_calls']=cfg['max_calls'] if cfg['max_calls'] is not None else _settings()['max_calls']; cfg['budget_usd']=cfg['budget_usd'] if cfg['budget_usd'] is not None else _settings()['budget_usd']
    cfg['symbols']=sorted({b['symbol'] for b in chosen})
    if cfg['strategy']=='agent' and not snapshots:raise HTTPException(422,'Select one trader expert and any optional advisors')
    if cfg['strategy']=='agent' and cfg['provider_mode']=='llm' and (not _secret() or not cfg['settings_snapshot'].get('base_url') or not cfg['settings_snapshot'].get('model')):raise HTTPException(422,'LLM provider requires configured endpoint, model, and API key')
    if cfg['strategy']=='agent' and cfg['provider_mode']=='llm' and (cfg['settings_snapshot'].get('input_cost_per_million') is None or cfg['settings_snapshot'].get('output_cost_per_million') is None):raise HTTPException(422,'Set both token cost rates to enforce the experiment dollar budget')
    return cfg,chosen
@app.get('/api/experiments')
def list_experiments():
    result=[]
    for r in _rows('SELECT * FROM experiments ORDER BY created_at DESC'):
        cfg=json.loads(r['config']); state=json.loads(r['state']); metrics=engine.performance_metrics(state)
        result.append({'id':r['id'],'name':r['name'],'status':r['status'],'mode':cfg['mode'],'current_date':state.get('current_date'),'total_return':metrics.get('total_return',0),'dataset_id':cfg['dataset_id']})
    return result
@app.post('/api/experiments')
def create_experiment(body:ExperimentIn):
    cfg,bars=_config(body)
    if cfg['mode'] not in ('ai_only','human_review') or cfg['strategy'] not in ('agent','buy_hold','momentum') or cfg['provider_mode'] not in ('llm','demo'):raise HTTPException(422,'Invalid mode, strategy, or provider_mode')
    state=_new_state(cfg,bars); eid=str(uuid.uuid4()); _save_experiment(eid,cfg['name'],'ready',cfg,state); _event(eid,{'type':'experiment_created','provider_mode':cfg['provider_mode'],'dataset_synthetic':cfg['dataset_synthetic']})
    return _decode_exp(_experiment(eid))
@app.get('/api/experiments/{experiment_id}')
def get_experiment(experiment_id):return _decode_exp(_experiment(experiment_id))

@app.get('/api/experiments/{experiment_id}/market')
def experiment_market(experiment_id, as_of:str|None=None, symbol:str|None=None):
    """Return the immutable experiment market snapshot through its replay cursor."""
    r=_experiment(experiment_id); cfg=json.loads(r['config']); state=json.loads(r['state'])
    current=state.get('current_date')
    requested=current if as_of is None else as_of
    if requested is not None:
        try:
            parsed=date.fromisoformat(requested)
            if parsed.isoformat()!=requested: raise ValueError
        except (TypeError,ValueError):
            raise HTTPException(422,'as_of must use a valid ISO YYYY-MM-DD date')
        if current is not None and requested>current:
            raise HTTPException(422,'as_of cannot be later than the current replay date')
    symbols=cfg.get('symbols',[])
    if symbol is not None and symbol not in symbols:
        raise HTTPException(422,'symbol must be one of the experiment symbols')
    ds=_row('SELECT bars,checksum,synthetic FROM datasets WHERE id=?',(cfg.get('dataset_id'),))
    if not ds:raise HTTPException(409,'Pinned dataset is missing')
    if cfg.get('dataset_checksum') and ds['checksum']!=cfg['dataset_checksum']:
        raise HTTPException(409,'Pinned dataset checksum does not match the experiment snapshot')
    # Before the first replay step there is no point-in-time market snapshot,
    # even if the caller asks for a date that lies inside the pinned range.
    cutoff=min(x for x in (requested,current) if x is not None) if current is not None else None
    visible=[]
    if cutoff is not None and cutoff>=cfg['start_date']:
        visible=[b for b in json.loads(ds['bars']) if cfg['start_date']<=b['date']<=cfg['end_date'] and b['date']<=cutoff and b['symbol'] in symbols and (symbol is None or b['symbol']==symbol)]
    visible.sort(key=lambda b:(b['date'],b['symbol']))
    return {'experiment_id':experiment_id,'as_of':requested,'current_date':current,'symbols':symbols,'bars':visible,'synthetic':bool(ds['synthetic']),'dataset_id':cfg['dataset_id']}

def _record_error(eid, msg, live_state=None):
    r=_experiment(eid); state=live_state if live_state is not None else json.loads(r['state']); state['status']='paused'; state.setdefault('events',[]).append({'type':'error','message':msg}); _save_experiment(eid,r['name'],'paused',json.loads(r['config']),state); _event(eid,{'type':'error','message':msg})
def _tool_definition(symbols, hold_contract=False):
    description='Submit one full target portfolio. Use hold to keep current positions.'
    properties={'action':{'type':'string','enum':['rebalance','hold']},'targets':{'type':'object','additionalProperties':{'type':'number'}},'rationale':{'type':'string'},'risks':{'type':'array','items':{'type':'string'}}}
    if hold_contract:
        description='Submit one trade proposal. For hold, preserve current positions and set targets to exactly {}. Any non-empty desired target weights require action rebalance. Rebalance targets describe the complete desired allocation; omitted symbols target zero.'
        properties['action']['description']='Use hold only when preserving current positions with targets exactly {}. Use rebalance whenever specifying desired target weights.'
        properties['targets']['description']='Must be exactly {} when action is hold. For rebalance, provide the complete desired allocation; an empty object means cash only.'
    return [{'type':'function','function':{'name':'submit_trade_proposal','description':description,'parameters':{'type':'object','properties':properties,'required':['action','targets','rationale'],'additionalProperties':False}}}]
def _opinion_tool():
    return [{'type':'function','function':{'name':'submit_expert_opinion','description':'Return an evidence-based advisory opinion, not an order.','parameters':{'type':'object','properties':{'stance':{'type':'string','enum':['support','caution','oppose','neutral']},'rationale':{'type':'string'},'risks':{'type':'array','items':{'type':'string'}}},'required':['stance','rationale','risks'],'additionalProperties':False}}}]

def _redact_public(value, cfg):
    secrets=[_secret(),(cfg.get('settings_snapshot') or {}).get('base_url')]
    def redact(item):
        if isinstance(item,str):
            for secret in secrets:
                if isinstance(secret,str) and secret:item=item.replace(secret,'[redacted]')
            return item
        if isinstance(item,list):return [redact(x) for x in item]
        if isinstance(item,dict):return {k:redact(v) for k,v in item.items()}
        return item
    return redact(value)

def _public_input_context(snapshot, expert, role, team_context, cfg):
    dates=sorted({b.get('date') for b in snapshot.get('bars',[]) if isinstance(b,dict) and b.get('date')})[-90:]
    date_set=set(dates)
    public_snapshot={k:v for k,v in snapshot.items() if k in ('as_of_date','current_date','symbols','positions','holdings','cash','equity','portfolio_value','history','bars','context_window_sessions')}
    public_snapshot['bars']=[b for b in snapshot.get('bars',[]) if b.get('date') in date_set]
    if isinstance(public_snapshot.get('history'),list):public_snapshot['history']=public_snapshot['history'][-90:]
    public_snapshot['context_window_sessions']=90
    public_expert={k:expert.get(k) for k in ('expert_id','id','name','version','strategy','description','objective','horizon','required_data','risk_notes','role') if k in expert}
    context={'snapshot':public_snapshot,'expert_card':public_expert,'role':role,'team_context':team_context,'hard_constraints':{'max_position_weight':cfg.get('max_position_weight'),'symbols':cfg.get('symbols')}}
    return _redact_public(context,cfg)

async def _expert_call(cfg,state,expert,snapshot,role,context=None):
    import time
    settings=cfg['settings_snapshot']; usage=state.setdefault('llm_usage',[]); calls=int(state.get('llm_calls',0)); spend=sum(float(x.get('estimated_cost_usd') or 0) for x in usage)
    if calls>=int(cfg['max_calls']):raise RuntimeError('LLM call limit exhausted')
    if spend>=float(cfg['budget_usd']):raise RuntimeError('LLM budget exhausted')
    hold_contract=cfg.get('prompt_version')=='expert-team-v2-hold-target-contract'
    tool=_tool_definition(cfg['symbols'],hold_contract=hold_contract) if role=='trader' else _opinion_tool()
    expected='submit_trade_proposal' if role=='trader' else 'submit_expert_opinion'
    system_content=f"You are expert {expert['name']}. Follow this card's instructions: {expert.get('instructions','')}. Use only the point-in-time information supplied. Never invent unavailable data. Return one {expected} tool call; advisers must not issue orders."
    if role=='trader' and hold_contract:
        system_content += " Output contract: for a HOLD action, preserve the current allocation and set targets to exactly {}. If you specify any desired target weights, use REBALANCE; do not label weighted targets as HOLD. For REBALANCE, targets is the complete desired allocation, and an empty targets object means cash only."
    messages=[{'role':'system','content':system_content},{'role':'user','content':json.dumps({'snapshot':snapshot,'expert_card':expert,'role':role,'team_context':context,'hard_constraints':{'max_position_weight':cfg['max_position_weight'],'symbols':cfg['symbols']}})}]
    serialized_messages=json.dumps(messages,ensure_ascii=False)
    if len(serialized_messages)>200_000:raise RuntimeError('LLM context exceeds the 200,000 character safety limit')
    if settings.get('input_cost_per_million') is not None and settings.get('output_cost_per_million') is not None:
        conservative_input_tokens=len(serialized_messages.encode('utf-8'))+2048
        reserve=(conservative_input_tokens*settings['input_cost_per_million']+512*settings['output_cost_per_million'])/1_000_000
        if spend+reserve>float(cfg['budget_usd']):raise RuntimeError('Remaining LLM budget is below the conservative per-call reservation')
    state['llm_calls']=calls+1; started=time.monotonic()
    usage_entry={'expert_id':expert.get('expert_id',expert.get('id')),'expert_name':expert.get('name','Expert'),'role':role,'as_of_date':state.get('current_date'),'attempt_id':str(uuid.uuid4()),'step_attempt_id':state.get('_active_step_attempt_id'),'input_context':_public_input_context(snapshot,expert,role,context,cfg),'status':'running','estimated_cost_usd':None,'cost_basis':'unknown'}
    usage.append(usage_entry)
    try:data=await _llm_request(messages,tool,settings=settings)
    except Exception as e:
        usage_entry.update({'elapsed_seconds':round(time.monotonic()-started,3),'status':'failed','error':_redact_public(str(e),cfg)})
        raise
    try:
        msg=data['choices'][0]['message']; toolcalls=msg.get('tool_calls') or []
    except (KeyError,IndexError,TypeError,AttributeError) as e:
        entry=usage_entry; entry.update({'elapsed_seconds':round(time.monotonic()-started,3),'status':'failed','error':'Malformed LLM response structure'})
        raise RuntimeError('Malformed LLM response structure') from e
    tokens=data.get('usage') or {}; prompt=tokens.get('prompt_tokens'); completion=tokens.get('completion_tokens')
    if isinstance(prompt,bool) or not isinstance(prompt,int) or isinstance(completion,bool) or not isinstance(completion,int):prompt=None; completion=None; cost=None
    else:cost=None if settings.get('input_cost_per_million') is None or settings.get('output_cost_per_million') is None else (prompt*settings['input_cost_per_million']+completion*settings['output_cost_per_million'])/1_000_000
    entry=usage_entry; entry.update({'model':data.get('model',settings['model']),'prompt_tokens':prompt,'completion_tokens':completion,'elapsed_seconds':round(time.monotonic()-started,3),'estimated_cost_usd':cost,'cost_basis':'unknown' if cost is None else 'configured token rates','status':'received','raw_output':_redact_public(msg,cfg)})
    if cost is None:entry['status']='usage_unavailable'; raise RuntimeError('LLM response omitted token usage; dollar budget cannot be verified')
    if cost>max(0.0,float(cfg['budget_usd'])-spend):entry['status']='budget_exceeded'; raise RuntimeError('LLM response exceeded remaining experiment budget')
    try:
        call=next(c for c in toolcalls if c.get('function',{}).get('name')==expected); args=json.loads(call['function']['arguments'])
        if role=='trader':
            if args['action'] not in ('rebalance','hold') or not isinstance(args['targets'],dict):raise ValueError('Malformed proposal')
            if args['action']=='hold' and args['targets']:
                raise ValueError('A hold action must use an empty targets object; use rebalance to specify target weights.')
            if set(args['targets'])-set(cfg['symbols']):raise ValueError('Proposal contains unknown symbols')
            for k,v in args['targets'].items():
                if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 or v>cfg['max_position_weight']:raise ValueError('Proposal target violates position limits')
            if sum(args['targets'].values())>1.0000001:raise ValueError('Proposal target weights exceed 100%')
        elif args['stance'] not in ('support','caution','oppose','neutral') or not isinstance(args['risks'],list):raise ValueError('Malformed expert opinion')
    except (StopIteration,KeyError,TypeError,ValueError,json.JSONDecodeError) as e:
        entry['status']='invalid_output'; entry['error']=str(e)
        raise RuntimeError(f"Invalid structured output from {expert['name']}: {e}")
    entry['status']='succeeded'
    return args,entry
async def _proposal(cfg,state,bars):
    snap=engine.visible_snapshot(state,bars)
    team=state.get('active_team') if 'active_team' in state else cfg.get('expert_snapshots',[])
    opinions=[]; trade_proposal=None
    if cfg['strategy'] in ('buy_hold','momentum'):
        proposal=engine.baseline_proposal(state,snap,cfg['strategy'])
        proposal.update({'provider':'deterministic_baseline','label':f"DETERMINISTIC {cfg['strategy'].upper()} BASELINE — not an LLM result"})
        state['expert_opinions']=[]
        return proposal,None
    if cfg['provider_mode']=='demo':
        for ex in team:
            role=str(ex.get('role','advisor')).lower(); role='trader' if role in ('trader','trading strategy','strategy') else 'advisor'
            if role=='trader':
                strategy=ex.get('strategy') if ex.get('strategy') in ('momentum','buy_hold') else cfg['strategy']
                if strategy=='agent':strategy='momentum'
                trade_proposal=engine.baseline_proposal(state,snap,strategy)
                opinions.append({'expert_id':ex['expert_id'],'name':ex.get('name'),'role':role,'stance':'support','rationale':trade_proposal.get('rationale','Deterministic demo baseline proposal.'),'source':'deterministic_demo'})
            else:
                opinions.append({'expert_id':ex.get('expert_id',ex.get('id')),'name':ex.get('name'),'role':role,'stance':'caution','rationale':'Advisory demo card: reviews visible portfolio exposure; it cannot submit orders.','risks':['Synthetic or imported price history may not represent future conditions.'],'source':'deterministic_demo'})
        if trade_proposal is None:
            strategy=cfg['strategy'] if cfg['strategy'] in ('buy_hold','momentum') else 'momentum'; trade_proposal=engine.baseline_proposal(state,snap,strategy)
        trade_proposal.update({'provider':'deterministic_demo','label':'DETERMINISTIC DEMO STRATEGY — not an LLM result'})
        state['expert_opinions']=opinions
        return trade_proposal,None
    candidate=None
    if len(team)>0:
        visible_dates=sorted({b['date'] for b in snap['bars']})[-90:]
        visible_set=set(visible_dates)
        snap={**snap,'bars':[b for b in snap['bars'] if b['date'] in visible_set],'history':snap.get('history',[])[-90:],'context_window_sessions':90}
    for ex in team:
        role=str(ex.get('role','advisor')).lower(); role='trader' if role in ('trader','trading strategy','strategy') else 'advisor'
        result,_=await _expert_call(cfg,state,ex,snap,role)
        opinions.append({'expert_id':ex['expert_id'],'name':ex.get('name'),'role':role,**result})
        state['expert_opinions']=opinions.copy()
        if role=='trader':candidate=result
    if candidate is None:raise RuntimeError('Active expert team has no trading strategy expert')
    coordinator={'id':'team-coordinator','name':'Team Coordinator','instructions':'Synthesize the sole trading strategy candidate with independent adviser opinions. Produce exactly one final portfolio proposal. Adviser opinions are input only; do not let advisers place separate orders.'}
    trade_proposal,_=await _expert_call(cfg,state,coordinator,snap,'trader',{'trader_candidate':candidate,'independent_adviser_opinions':opinions})
    state['expert_opinions']=opinions
    state['coordination']={'coordinator':'team-coordinator','input_candidate':candidate,'adviser_opinions':opinions,'final_proposal':trade_proposal}
    return {**trade_proposal,'provider':'llm','model':cfg['settings_snapshot']['model']},None

async def _step_locked(eid):
    r=_experiment(eid); cfg=json.loads(r['config']); state=json.loads(r['state']); ds=_row('SELECT bars,checksum FROM datasets WHERE id=?',(cfg['dataset_id'],))
    if not ds:raise HTTPException(409,'Pinned dataset is missing')
    bars=[b for b in json.loads(ds['bars']) if cfg['start_date']<=b['date']<=cfg['end_date'] and b['symbol'] in cfg['symbols']]
    try:
        if state.get('status')=='awaiting_review':raise HTTPException(409,'Review the pending proposal before advancing')
        if not state.get('needs_decision') and state.get('session_index',-1)+1 >= len(sorted({b['date'] for b in bars})):return _decode_exp(r)
        state['status']='running'
        if not state.get('needs_decision'):
            engine.advance_market(state,bars)
            state['needs_decision']=True
        if hasattr(engine,'prepare_decision'):engine.prepare_decision(state)
        attempt_id=str(uuid.uuid4()); usage_start=len(state.setdefault('llm_usage',[]))
        state['_active_step_attempt_id']=attempt_id
        state['expert_opinions']=[]; state['coordination']=None
        p,_=await _proposal(cfg,state,bars)
        decision=engine.record_decision(state,p)
        state.setdefault('decision_traces',[]).append({'as_of_date':state.get('current_date'),'attempt_id':attempt_id,'decision_id':decision.get('id'),'status':'succeeded','expert_opinions':_redact_public(state.get('expert_opinions',[]),cfg),'coordination':_redact_public(state.get('coordination'),cfg),'error':None,'usage_indices':list(range(usage_start,len(state.get('llm_usage',[]))))})
        state.pop('_active_step_attempt_id',None)
        state['needs_decision']=False
        state['status']='awaiting_review' if cfg['mode']=='human_review' else ('completed' if state.get('status')=='completed' else 'ready')
        _save_experiment(eid,r['name'],state['status'],cfg,state); _event(eid,{'type':'decision_created','decision_id':decision.get('id'),'date':state.get('current_date'),'provider':p.get('provider')})
        return _decode_exp(_experiment(eid))
    except HTTPException:raise
    except Exception as e:
        active=state.pop('_active_step_attempt_id',None)
        if active is not None:
            message=_redact_public(str(e),cfg)
            state.setdefault('decision_traces',[]).append({'as_of_date':state.get('current_date'),'attempt_id':active,'decision_id':None,'status':'failed','expert_opinions':_redact_public(state.get('expert_opinions',[]),cfg),'coordination':_redact_public(state.get('coordination'),cfg),'error':message,'usage_indices':list(range(usage_start,len(state.get('llm_usage',[]))))})
        _record_error(eid,_redact_public(str(e),cfg),state); return _decode_exp(_experiment(eid))

@app.post('/api/experiments/{experiment_id}/step')
async def step(experiment_id):
    task=_tasks.get(experiment_id)
    if task is not None and not task.done():
        raise HTTPException(409,'Experiment is running; pause it before stepping manually')
    async with _get_lock(experiment_id):
        r=_experiment(experiment_id); task=_tasks.get(experiment_id)
        if task is not None and not task.done():
            raise HTTPException(409,'Experiment is running; pause it before stepping manually')
        return await _step_locked(experiment_id)
@app.post('/api/experiments/{experiment_id}/run')
async def run_experiment(experiment_id):
    async with _get_lock(experiment_id):
        r=_experiment(experiment_id)
        # A run request must never erase a pending human review or restart a
        # completed/error run. In particular, it must not mark these states
        # running before the runner has a chance to inspect them.
        if r['status'] in ('awaiting_review','completed','error'):
            return _decode_exp(r)
        task=_tasks.get(experiment_id)
        if task is not None and not task.done():
            return _decode_exp(r)
        if r['status']=='paused':
            state=json.loads(r['state']); state['status']='ready'
            _save_experiment(experiment_id,r['name'],'ready',json.loads(r['config']),state)
            _event(experiment_id,{'type':'resumed'})
        r=_experiment(experiment_id)
        if r['status']!='running':
            with _db_lock,_connect() as c:
                current=c.execute('SELECT * FROM experiments WHERE id=?',(experiment_id,)).fetchone()
                state=json.loads(current['state']); state['status']='running'
                c.execute("UPDATE experiments SET status='running',state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(json.dumps(state),experiment_id))
            _event(experiment_id,{'type':'run_started'})
        # If a process restarted while SQLite still said running, recover the
        # task from its persisted cursor without altering the experiment state.
        async def runner():
            while True:
                async with _get_lock(experiment_id):
                    r=_experiment(experiment_id)
                    if r['status'] in ('paused','completed','awaiting_review','error'):return
                    detail=await _step_locked(experiment_id)
                    if detail['status'] in ('paused','completed','awaiting_review','error'):return
                await asyncio.sleep(0)
        _tasks[experiment_id]=asyncio.create_task(runner())
        return _decode_exp(_experiment(experiment_id))
@app.post('/api/experiments/{experiment_id}/pause')
async def pause(experiment_id):
    async with _get_lock(experiment_id):
        r=_experiment(experiment_id); state=json.loads(r['state']); state['status']='paused'; _save_experiment(experiment_id,r['name'],'paused',json.loads(r['config']),state); _event(experiment_id,{'type':'paused'}); return _decode_exp(_experiment(experiment_id))

@app.post('/api/experiments/{experiment_id}/review')
async def review(experiment_id,body:dict):
    async with _get_lock(experiment_id):
        r=_experiment(experiment_id); cfg=json.loads(r['config']); state=json.loads(r['state'])
        try:decision=engine.review_decision(state,body['decision_id'],body['action'],body.get('reason',''),body.get('targets'))
        except Exception as e:raise HTTPException(422,str(e))
        if state.get('status')!='completed':state['status']='ready'
        _save_experiment(experiment_id,r['name'],state['status'],cfg,state); _event(experiment_id,{'type':'decision_reviewed','decision_id':body['decision_id'],'action':body['action'],'reason':body.get('reason','')}); return _decode_exp(_experiment(experiment_id))
@app.post('/api/experiments/{experiment_id}/team')
async def change_team(experiment_id,body:dict):
    async with _get_lock(experiment_id):
        r=_experiment(experiment_id); cfg=json.loads(r['config']); state=json.loads(r['state']); snapshots=[]
        for x in body.get('team',[]):
            er=_row('SELECT body FROM experts WHERE id=?',(x.get('expert_id'),))
            if not er:raise HTTPException(422,'Unknown expert in team')
            ex=json.loads(er['body']); role=x.get('role',ex['role'])
            if not isinstance(role,str) or role.lower() not in ('trader','advisor','trading strategy','strategy'):raise HTTPException(422,'Each team role must be trader or advisor')
            if any(v not in ('price','ohlcv') for v in ex.get('required_data',[])):raise HTTPException(422,f"{ex['name']} requires unavailable data: {', '.join(ex.get('required_data',[]))}")
            role='trader' if role.lower() in ('trader','trading strategy','strategy') else 'advisor'
            if x.get('enabled',True):snapshots.append({**ex,'role':role})
        if snapshots and sum(1 for x in snapshots if x['role']=='trader')!=1:raise HTTPException(422,'Select exactly one trading strategy expert; additional experts must be advisors')
        try:ev=engine.schedule_team(state,snapshots,body.get('pending_policy','keep'))
        except Exception as e:raise HTTPException(422,str(e))
        _save_experiment(experiment_id,r['name'],state.get('status',r['status']),cfg,state); _event(experiment_id,{'type':'team_scheduled',**ev}); return _decode_exp(_experiment(experiment_id))

@app.post('/api/experiments/{experiment_id}/branch')
def branch(experiment_id,body:dict):
    parent=_experiment(experiment_id); old=json.loads(parent['config']); merged={k:v for k,v in old.items() if k in ExperimentIn.model_fields}; merged.update(body); merged['name']=merged.get('name',old['name']+' (branch)')
    try:request=ExperimentIn(**merged)
    except Exception as e:raise HTTPException(422,str(e))
    cfg,bars=_config(request); cfg['branched_from']=experiment_id; state=_new_state(cfg,bars); eid=str(uuid.uuid4()); _save_experiment(eid,cfg['name'],'ready',cfg,state); _event(eid,{'type':'experiment_branched','parent_id':experiment_id}); return _decode_exp(_experiment(eid))
@app.get('/api/reviews')
def pending_reviews():
    out=[]
    for r in _rows('SELECT * FROM experiments ORDER BY created_at DESC'):
        state=json.loads(r['state'])
        for d in state.get('decisions',[]):
            if d.get('status')=='awaiting_review':out.append({'experiment_id':r['id'],'experiment_name':r['name'],'id':d.get('id'),'decision_id':d.get('id'),'date':d.get('as_of_date'),'status':d.get('status'),'proposal':d.get('original_proposal'),'rationale':d.get('original_proposal',{}).get('rationale'),'decision':d})
    return out
@app.get('/api/activity')
def activity():
    events=[{'experiment_id':r['experiment_id'],**json.loads(r['event']),'created_at':r['created_at']} for r in _rows('SELECT * FROM events ORDER BY id DESC LIMIT 500')]
    for r in _rows('SELECT id,name,state FROM experiments'):
        for event in json.loads(r['state']).get('events',[]):events.append({'experiment_id':r['id'],'experiment_name':r['name'],'event_id':event.get('id'),'date':event.get('date'),'type':event.get('type'),'details':event.get('details',{})})
    return events[-1000:]
@app.get('/api/compare')
def compare(ids:str):
    idlist=[x for x in ids.split(',') if x]
    if len(idlist)<2:raise HTTPException(422,'Provide at least two comma-separated experiment ids')
    result=[]
    for eid in idlist:
        r=_experiment(eid); e=_decode_exp(r); result.append({'id':eid,'name':r['name'],'status':r['status'],'as_of_date':e['state'].get('current_date'),'metrics':e['metrics'],'config':e['config']})
    keys=('dataset_id','dataset_checksum','start_date','end_date','initial_capital','fee_bps','slippage_bps','max_position_weight','strategy','provider_mode','expert_snapshots','settings_snapshot','max_calls','budget_usd','prompt_version')
    differences={k:[x['config'].get(k) for x in result] for k in keys if len({json.dumps(x['config'].get(k),sort_keys=True) for x in result})>1}
    dates=[x.get('as_of_date') for x in result]
    if len(set(dates))>1:differences['as_of_date']=dates
    return {'experiments':result,'comparable':not differences,'differences':differences,'treatment_modes':[x['config'].get('mode') for x in result],'notice':None if not differences else 'Configuration or replay cutoffs differ; outcome differences cannot be attributed to human oversight alone.'}
@app.get('/api/experiments/{experiment_id}/export')
def export_experiment(experiment_id,format:str='json'):
    r=_experiment(experiment_id); report=_decode_exp(r)
    # Reports expose the pinned config and audit trail but never local credentials.
    if format=='json':return Response(json.dumps(report,indent=2),media_type='application/json',headers={'Content-Disposition':f'attachment; filename="trading-lab-{experiment_id}.json"'})
    if format=='csv':
        output=io.StringIO(); writer=csv.writer(output); writer.writerow(['record_type','as_of_date','id','status','action','target_weights','reason','detail'])
        for point in report['history']:writer.writerow(['equity',point.get('date'),'','','','','',json.dumps(point)])
        for d in report['decisions']:
            original=d.get('original_proposal') or {}
            final=d.get('final_proposal') or {}
            proposal=final or original
            review=d.get('review') or {}
            writer.writerow(['decision',d.get('as_of_date'),d.get('id'),d.get('status'),proposal.get('action'),json.dumps(proposal.get('targets',{})),review.get('reason',''),json.dumps(d)])
        for o in report['orders']:writer.writerow(['order',o.get('created_date'),o.get('id'),o.get('status'),o.get('side'),json.dumps(o.get('target_weights',{})),'',json.dumps(o)])
        return Response(output.getvalue(),media_type='text/csv',headers={'Content-Disposition':f'attachment; filename="trading-lab-{experiment_id}.csv"'})
    raise HTTPException(422,'format must be json or csv')

