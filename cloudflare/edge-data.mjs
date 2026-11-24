import { neon } from '@neondatabase/serverless';

const defaults = {base_url:'',model:'',max_calls:100,budget_usd:10,input_cost_per_million:null,output_cost_per_million:null};
const tokenMatch = "m.source_token=md5(e.config || chr(31) || e.state || chr(31) || e.status || chr(31) || e.name)";
const fail = (status, detail) => { const error = new Error(detail); error.httpStatus=status; throw error; };
const parse = value => typeof value==='string' ? JSON.parse(value) : value;
async function jsonBody(request) {let value;try{value=await request.json();}catch{fail(422,'Invalid JSON body');}if(!value||typeof value!=='object'||Array.isArray(value))fail(422,'Invalid JSON body');return value;}
const safeSettings = body => Object.fromEntries(Object.keys(defaults).map(k=>[k,body?.[k]===undefined?defaults[k]:body[k]]));
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');
const unb64 = text => Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const concat = (...arrays) => {const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let p=0;for(const a of arrays){out.set(a,p);p+=a.length;}return out;};

// Interoperable with the existing Python cryptography.Fernet storage. Keys and
// plaintext stay in Worker memory/secrets; only authenticated ciphertext is SQL.
export async function fernetEncrypt(text, master) {
  const key=unb64(master||'');if(key.length!==32)fail(503,'Credential encryption is not configured.');
  const iv=crypto.getRandomValues(new Uint8Array(16)),stamp=new Uint8Array(8);new DataView(stamp.buffer).setBigUint64(0,BigInt(Math.floor(Date.now()/1000)));
  const aes=await crypto.subtle.importKey('raw',key.slice(16),'AES-CBC',false,['encrypt']);
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv},aes,new TextEncoder().encode(text)));
  const body=concat(new Uint8Array([128]),stamp,iv,encrypted);
  const hmac=await crypto.subtle.importKey('raw',key.slice(0,16),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return b64(concat(body,new Uint8Array(await crypto.subtle.sign('HMAC',hmac,body))));
}
export async function fernetDecrypt(token, master) {
  const key=unb64(master||''),all=unb64(token||'');if(key.length!==32||all.length<73||all[0]!==128)fail(503,'Saved credentials are unavailable.');
  const hmac=await crypto.subtle.importKey('raw',key.slice(0,16),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('HMAC',hmac,all.slice(-32),all.slice(0,-32)))fail(503,'Saved credentials are unavailable.');
  const aes=await crypto.subtle.importKey('raw',key.slice(16),'AES-CBC',false,['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-CBC',iv:all.slice(9,25)},aes,all.slice(25,-32)));
}
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
function analysis(view) {
 const state=view.state,cfg=view.config;
 return {lab_mode:cfg.lab_mode??null,workflow_version:cfg.workflow_version??null,active_weights:state.active_weights??null,pending_weights:state.pending_weights??null,weight_history:state.weight_history||[],analysis_runs:state.analysis_runs||[],intervention_summary:{weight_changes:(state.weight_history||[]).length+Number(Boolean(state.pending_weights)),weight_changes_effective:(state.weight_history||[]).length,weight_changes_pending:Number(Boolean(state.pending_weights)),trade_reviews:(state.decisions||[]).filter(d=>d.review).length}};
}
function csvRows(text) {
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"'&&!cell)quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)fail(422,'CSV contains an unclosed quoted field.');if(cell||row.length){row.push(cell);if(row.some(x=>x.trim()))rows.push(row);}return rows;
}

export async function edgeData(request, env, dependencies={}) {
 if(env.EDGE_DATA_ENABLED!=='true'||env.EDGE_PUBLIC_WORKSPACE!=='true')return null;
 const url=new URL(request.url),path=url.pathname,method=request.method;
 const output=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Trading-Lab-Storage':'serverless-sql',...headers}});
 if(path==='/api/auth/status'&&method==='GET')return output({auth_required:false,authenticated:true});
 if(path==='/api/auth/logout'&&method==='POST')return output({authenticated:true},200,{'Set-Cookie':'trading_lab_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'});
 const simpleReads=new Set(['/api/health','/api/experts','/api/datasets','/api/experiments','/api/reviews','/api/activity','/api/settings','/api/harness','/api/harness/evidence-packs','/api/market/settings']);
 const single=/^\/api\/(experts|datasets|experiments)\/([^/]+)(?:\/(analysis|export))?$/.exec(path);
 if(method==='GET'&&single?.[1]==='experiments'&&!single[3]&&url.searchParams.get('live')==='1')return null;
 const read=method==='GET'&&(simpleReads.has(path)||single&&(!single[3]||single[1]==='experiments'));
 const write=(path==='/api/experts'&&method==='POST')||(path==='/api/settings'&&method==='PUT')||(path==='/api/market/settings'&&method==='PUT')||(path==='/api/datasets/import'&&method==='POST');
 if(!read&&!write)return null; // Engine, review/risk, collector and LLM work remain on the compute service.
 try {
  if(!env.DATABASE_URL&&!dependencies.sql)fail(503,'Serverless data storage is not configured.');
  const sql=dependencies.sql||neon(env.DATABASE_URL,{fetchOptions:{signal:AbortSignal.timeout(15000)}}),q=(text,params=[])=>sql.query(text,params);
  const audit=(type,fields={})=>q('INSERT INTO events(experiment_id,event) VALUES($1,$2)',['system',JSON.stringify({type,...fields})]);
  const getSettings=async()=>{const [rows,keys]=await sql.transaction([q('SELECT body FROM settings WHERE id=1'),q("SELECT ciphertext FROM app_secrets WHERE id='llm_api_key'")],{readOnly:true});let configured=false;if(keys[0])configured=Boolean(await fernetDecrypt(keys[0].ciphertext,env.TRADING_LAB_ENCRYPTION_KEY));return {...safeSettings(rows[0]?parse(rows[0].body):{}),api_key_configured:configured};};
  const getMarket=async()=>{const rows=await q("SELECT id,ciphertext FROM app_secrets WHERE id IN ('alpaca_key_id','alpaca_secret')");const keys=Object.fromEntries(rows.map(r=>[r.id,r.ciphertext]));const key=keys.alpaca_key_id?await fernetDecrypt(keys.alpaca_key_id,env.TRADING_LAB_ENCRYPTION_KEY):'';const secret=keys.alpaca_secret?await fernetDecrypt(keys.alpaca_secret,env.TRADING_LAB_ENCRYPTION_KEY):'';return {provider:'alpaca',feed:'iex',configured:Boolean(key&&secret),key_id_configured:Boolean(key),secret_configured:Boolean(secret),key_hint:key?'••••'+key.slice(-4):null};};
  if(path==='/api/health'){await q('SELECT 1 AS ok');return output({status:'ok',mode:'paper trading only',storage:'serverless-sql',compute:'on-demand',source_revision:env.EDGE_SOURCE_REVISION||null});}
  if(path==='/api/experts'&&method==='GET')return output((await q('SELECT e.body FROM experts e LEFT JOIN expert_library_archives a ON a.expert_id=e.id WHERE a.expert_id IS NULL ORDER BY e.name')).map(r=>parse(r.body)));
  if(path==='/api/experts'&&method==='POST'){
   const body=await jsonBody(request),required=['name','strategy','description','objective','horizon','required_data','instructions','risk_notes','role'];
   if(required.some(k=>!(k in body)))fail(422,'Missing expert fields');
   if(required.filter(k=>k!=='required_data').some(k=>typeof body[k]!=='string')||!Array.isArray(body.required_data)||body.required_data.some(x=>typeof x!=='string'||!x.trim()))fail(422,'Invalid expert fields');
   if(!['trader','advisor','trading strategy','strategy'].includes(body.role.toLowerCase()))fail(422,'role must be trader or advisor');
   const saved={...body,id:crypto.randomUUID(),version:1,required_data:body.required_data.map(x=>['price','prices','ohlcv','price history','historical prices'].includes(x.trim().toLowerCase())?'price':x.trim().toLowerCase())};
   await sql.transaction([q('INSERT INTO experts(id,name,version,body) VALUES($1,$2,1,$3)',[saved.id,saved.name,JSON.stringify(saved)]),audit('expert_created',{expert_id:saved.id,name:saved.name,version:1})]);return output(saved);
  }
  if(path==='/api/datasets')return output((await q('SELECT id,name,checksum,synthetic,created_at,metadata FROM datasets ORDER BY created_at')).map(r=>({...r,synthetic:Number(r.synthetic),...parse(r.metadata),metadata:undefined})));
  if(path==='/api/experiments'){
   const rows=await q(`SELECT e.id,e.name,e.status,e.config,m.experiment_id AS prepared,(m.body::jsonb->'state'->>'current_date') AS current_date,(m.body::jsonb->'metrics'->>'total_return') AS total_return FROM experiments e LEFT JOIN edge_read_models m ON m.experiment_id=e.id AND ${tokenMatch} ORDER BY e.created_at DESC`);
   if(rows.some(r=>!r.prepared))fail(503,'Saved experiment views are being prepared. Retry shortly.');
   return output(rows.map(r=>{const cfg=parse(r.config);return {id:r.id,name:r.name,status:r.status,mode:cfg.mode,lab_mode:cfg.lab_mode??null,workflow_version:cfg.workflow_version??null,quant_strategy:cfg.quant_strategy??null,current_date:r.current_date??null,total_return:Number(r.total_return||0),dataset_id:cfg.dataset_id};}));
  }
  if(path==='/api/reviews'){
   const out=[];for(const row of await q('SELECT id,name,state FROM experiments ORDER BY created_at DESC'))for(const d of parse(row.state).decisions||[])if(d.status==='awaiting_review')out.push({experiment_id:row.id,experiment_name:row.name,id:d.id??null,decision_id:d.id??null,date:d.as_of_date||d.market_as_of_time||d.as_of_time||null,status:d.status,proposal:d.original_proposal??null,rationale:d.original_proposal?.rationale??null,decision:d});return output(out);
  }
  if(path==='/api/activity'){
   const [events,experiments]=await sql.transaction([q('SELECT experiment_id,event,created_at FROM events ORDER BY id DESC LIMIT 500'),q('SELECT id,name,state FROM experiments')],{readOnly:true});
   const out=events.map(r=>({experiment_id:r.experiment_id,...parse(r.event),created_at:r.created_at}));for(const row of experiments)for(const e of parse(row.state).events||[])out.push({experiment_id:row.id,experiment_name:row.name,event_id:e.id??null,date:e.date??null,type:e.type??null,details:e.details||{}});return output(out.slice(-1000));
  }
  if(path==='/api/settings'&&method==='GET')return output(await getSettings());
  if(path==='/api/settings'&&method==='PUT'){
   const body=await jsonBody(request),current=await getSettings(),patch=Object.fromEntries(Object.keys(defaults).filter(k=>k in body).map(k=>[k,body[k]])),merged={...current,...patch};
   if(!Number.isInteger(merged.max_calls)||merged.max_calls<0||!Number.isFinite(merged.budget_usd)||merged.budget_usd<0||['input_cost_per_million','output_cost_per_million'].some(k=>merged[k]!==null&&(!Number.isFinite(merged[k])||merged[k]<0)))fail(422,'Invalid settings values or endpoint URL');
   if(merged.model!==null&&typeof merged.model!=='string'||typeof merged.base_url!=='string')fail(422,'Invalid settings values or endpoint URL');
   if(merged.base_url){let u;try{u=new URL(merged.base_url);}catch{fail(422,'Invalid settings values or endpoint URL');}if(!['http:','https:'].includes(u.protocol))fail(422,'Invalid settings values or endpoint URL');}
   const queries=[];if(body.api_key){if(typeof body.api_key!=='string'||body.api_key.length>4096)fail(422,'Invalid API key value');const cipher=await fernetEncrypt(body.api_key,env.TRADING_LAB_ENCRYPTION_KEY);queries.push(q("INSERT INTO app_secrets(id,ciphertext) VALUES('llm_api_key',$1) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext",[cipher]));}
   queries.push(q('UPDATE settings SET body=(body::jsonb || $1::jsonb)::text WHERE id=1',[JSON.stringify(patch)]),audit('settings_updated',{fields:Object.keys(patch).sort(),api_key_configured:Boolean(body.api_key||current.api_key_configured)}));await sql.transaction(queries);return output(await getSettings());
  }
  if(path==='/api/market/settings'){
   if(method==='PUT'){const body=await jsonBody(request),queries=[];for(const [field,limit] of [['key_id',512],['secret',4096]])if(body[field]!==undefined&&body[field]!==null&&(typeof body[field]!=='string'||!body[field].trim()||body[field].length>limit))fail(422,'Invalid Alpaca credentials');if(Boolean(body.key_id)!==Boolean(body.secret))fail(422,'Provide both Alpaca credentials together');for(const field of ['key_id','secret'])if(body[field])queries.push(q('INSERT INTO app_secrets(id,ciphertext) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext',['alpaca_'+field,await fernetEncrypt(body[field].trim(),env.TRADING_LAB_ENCRYPTION_KEY)]));if(queries.length){queries.push(audit('market_credentials_updated',{provider:'alpaca'}));await sql.transaction(queries);}}return output(await getMarket());
  }
  if(path==='/api/harness'){const rows=await q("SELECT body FROM edge_runtime_metadata WHERE key='harness'");if(!rows[0])fail(503,'Saved capabilities are not ready.');return output(parse(rows[0].body));}
  if(path==='/api/harness/evidence-packs')return output(await q('SELECT id,checksum,created_at FROM evidence_packs ORDER BY created_at'));
  if(path==='/api/datasets/import'){
   // Timestamp normalization and larger validation workloads stay with the
   // compute service. Clone keeps the original upload available for that path.
   const form=await request.clone().formData(),file=form.get('file');if(!file||typeof file.arrayBuffer!=='function')fail(422,'CSV file is required');if(file.size>5*1024*1024)fail(413,'CSV exceeds 5 MiB import limit');
   if(file.size>256*1024)return null;const raw=await file.arrayBuffer(),rows=csvRows(new TextDecoder('utf-8',{fatal:true}).decode(raw).replace(/^\ufeff/,''));const header=(rows.shift()||[]).map(x=>x.trim().toLowerCase());
   if(header.some(x=>['timestamp','bar_start','bar_end'].includes(x))||raw.byteLength>256*1024)return null;
   if(!['date','symbol','open','high','low','close','volume'].every(x=>header.includes(x)))fail(422,'CSV needs date,symbol,open,high,low,close,volume columns');
   const policy=String(form.get('adjustment_policy')||'as_provided');if(!['as_provided','unadjusted','split_adjusted','total_return_adjusted'].includes(policy))fail(422,'Unsupported adjustment_policy');
   const bars=[],seen=new Set();for(const cells of rows){const row=Object.fromEntries(header.map((x,i)=>[x,cells[i]||''])),d=row.date.trim(),symbol=row.symbol.trim().toUpperCase();const date=new Date(d+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||d.startsWith('0000-')||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==d||!symbol)fail(422,'Invalid date or symbol');const bar={date:d,symbol};for(const k of ['open','high','low','close','volume']){if(!row[k].trim()||!Number.isFinite(Number(row[k])))fail(422,'Invalid OHLCV values');bar[k]=Number(row[k]);}if(Math.min(bar.open,bar.high,bar.low,bar.close)<=0||bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close)||bar.volume<0)fail(422,'Invalid OHLCV values');if(seen.has(d+'|'+symbol))fail(422,'Duplicate date/symbol');seen.add(d+'|'+symbol);bars.push(bar);}
   if(!bars.length)fail(422,'CSV has no data rows');bars.sort((a,b)=>a.date===b.date?(a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0):(a.date<b.date?-1:1));const id=crypto.randomUUID(),checksum=await digest(raw),synthetic=['true','1','yes','on'].includes(String(form.get('synthetic')||'false').toLowerCase()),name=String(form.get('name')||file.name||id);const meta={symbols:[...new Set(bars.map(b=>b.symbol))].sort(),rows:bars.length,start_date:bars[0].date,end_date:bars.at(-1).date,adjustment_policy:policy,label:synthetic?'SYNTHETIC DEMO DATA — not real market history':'User-imported historical data',schema_version:1};
   await sql.transaction([q('INSERT INTO datasets(id,name,checksum,synthetic,metadata,bars) VALUES($1,$2,$3,$4,$5,$6)',[id,name,checksum,synthetic?1:0,JSON.stringify(meta),JSON.stringify(bars)]),audit('dataset_imported',{dataset_id:id,checksum,rows:bars.length,synthetic})]);return output({id,dataset_id:id,name,checksum,synthetic,...meta});
  }
  if(single){const id=decodeURIComponent(single[2]);if(single[1]==='experts'){const rows=await q('SELECT body FROM experts WHERE id=$1',[id]);if(!rows[0])fail(404,'Expert not found');return output(parse(rows[0].body));}if(single[1]==='datasets'){const rows=await q('SELECT id,name,checksum,synthetic,metadata FROM datasets WHERE id=$1',[id]);if(!rows[0])fail(404,'Dataset not found');const r=rows[0];return output({id:r.id,name:r.name,checksum:r.checksum,synthetic:Number(r.synthetic)!==0,...parse(r.metadata)});}
   if(single[3]==='export'&&(url.searchParams.get('format')||'json')!=='json')return null;
   const rows=await q(`SELECT e.id,m.body FROM experiments e LEFT JOIN edge_read_models m ON m.experiment_id=e.id AND ${tokenMatch} WHERE e.id=$1`,[id]);if(!rows[0])fail(404,'Experiment not found');if(!rows[0].body)fail(503,'Saved experiment view is being prepared. Retry shortly.');const view=parse(rows[0].body);
   if(single[3]==='analysis')return output(analysis(view));const events=await q('SELECT id,event,created_at FROM events WHERE experiment_id=$1 ORDER BY id',[id]);view.events=[...(view.state.events||[]),...events.map(r=>({id:Number(r.id),created_at:r.created_at,...parse(r.event)}))];
   if(single[3]==='export'){view.intervention_summary=analysis(view).intervention_summary;return output(view,200,{'Content-Disposition':`attachment; filename="trading-lab-${id.replace(/[^\w-]/g,'')}.json"`});}return output(view);
  }
  return null;
 }catch(error){return output({detail:error.httpStatus?error.message:'Data storage is temporarily unavailable. Please retry.'},error.httpStatus||503);}
}
