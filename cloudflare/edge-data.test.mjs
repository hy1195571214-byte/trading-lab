import {test} from 'node:test';import assert from 'node:assert/strict';
import {edgeData,fernetEncrypt,fernetDecrypt} from './edge-data.mjs';import worker from './worker.mjs';
const env={EDGE_DATA_ENABLED:'true',EDGE_PUBLIC_WORKSPACE:'true'};
function database(handler){const calls=[];const sql={query:(text,params=[])=>{calls.push({text,params});return Promise.resolve().then(()=>handler(text,params));},transaction:(queries)=>Promise.all(queries)};return {sql,calls};}
const req=(path,method='GET',body)=>new Request('https://trading.example/api'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
const key='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
test('public storage is opt-in and private mode never bypasses the backend',async()=>{
 const db=database(()=>{throw Error('must not query');});assert.equal(await edgeData(req('/experts'),{},db),null);assert.equal(await edgeData(req('/experts'),{...env,EDGE_PUBLIC_WORKSPACE:'false'},db),null);assert.equal(db.calls.length,0);
});
test('core data and public auth never wake the compute origin',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('compute must not be called');};
 try{const db=database(text=>text.startsWith('SELECT e.body')?[{body:JSON.stringify({id:'five-only'})}]:[]);
 const r=await edgeData(req('/experts'),env,db);assert.deepEqual(await r.json(),[{id:'five-only'}]);assert.match(db.calls[0].text,/expert_library_archives/);assert.equal(r.headers.get('X-Trading-Lab-Storage'),'serverless-sql');
 assert.deepEqual(await (await edgeData(req('/auth/status'),env,db)).json(),{auth_required:false,authenticated:true});
 assert.equal(await edgeData(req('/experiments/x/step','POST',{}),env,db),null);
 assert.equal(await edgeData(req('/experiments/x?live=1'),env,db),null);
 }finally{globalThis.fetch=original;}
});
test('a failed data store does not silently fall back to waking compute',async()=>{
 const db=database(()=>{throw new Error('private postgres URL and secret');});const r=await edgeData(req('/experts'),env,db);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/postgres|secret/);
 const original=globalThis.fetch;let originCalls=0;globalThis.fetch=async(request)=>{if(String(request?.url||request).includes('compute.example'))originCalls++;throw Error('storage unavailable');};
 try{const r=await worker.fetch(req('/experts'),{...env,DATABASE_URL:'postgresql://unit:unit@unit.neon.tech/db',ORIGIN_URL:'https://compute.example',ORIGIN_TOKEN:'not-a-real-origin-token-12345678901234567890'});assert.equal(r.status,503);assert.equal(originCalls,0);}finally{globalThis.fetch=original;}
});
test('expert writes parameterize content and preserve research-only metadata',async()=>{
 const db=database(()=>[]);const body={name:"test'); DROP TABLE experts; --",strategy:'value',description:'test',objective:'test',horizon:'test',required_data:['OHLCV','macro'],instructions:'test',risk_notes:'test',role:'trader',id:'client-controlled',activation_status:'research_only'};
 const r=await edgeData(req('/experts','POST',body),env,db);assert.equal(r.status,200);const saved=await r.json();assert.notEqual(saved.id,body.id);assert.deepEqual(saved.required_data,['price','macro']);assert.equal(saved.activation_status,'research_only');assert.equal(db.calls.length,2);assert.ok(db.calls.every(c=>!c.text.includes(body.name)));assert.equal(JSON.parse(db.calls[0].params[2]).name,body.name);
});
test('Fernet reads Python tokens and rejects corrupted ciphertext',async()=>{
 const token='gAAAAABlU_EASshl7lgnF3IKlsD8AukAg5HW3T5RtKu0f4mpzPbx5cCGxsYAqAGhN61F8Y0ZYy770ZeAd0LqtYfRBbYygRmeTrhi8wvGRShEY11XTxZi5p8-PuEx7bgDDPcClIXeNlne';
 assert.equal(await fernetDecrypt(token,key),'test-only-interoperability-value');const fresh=await fernetEncrypt('test-only-new-value',key);assert.equal(await fernetDecrypt(fresh,key),'test-only-new-value');await assert.rejects(fernetDecrypt(fresh.slice(0,30)+'A'+fresh.slice(31),key));
});
test('settings expose only approved fields and encryption status',async()=>{
 const secret=await fernetEncrypt('test-only-key-not-real',key);const db=database(text=>text.startsWith('SELECT body FROM settings')?[{body:JSON.stringify({base_url:'https://provider.example',model:'test',api_key:'must-not-leak',unexpected:'must-not-leak'})}]:text.startsWith('SELECT ciphertext')?[{ciphertext:secret}]:[]);
 const r=await edgeData(req('/settings'),{...env,TRADING_LAB_ENCRYPTION_KEY:key},db);const body=await r.json();assert.equal(body.api_key_configured,true);assert.equal(body.max_calls,100);assert.ok(!('api_key' in body));assert.doesNotMatch(JSON.stringify(body),/must-not-leak|test-only-key|ciphertext/);
});
test('invalid settings and partial market credentials perform no mutation',async()=>{
 const db=database(text=>[]);let r=await edgeData(req('/settings','PUT',{max_calls:true}),env,db);assert.equal(r.status,422);r=await edgeData(req('/market/settings','PUT',{key_id:'test-only-id'}),env,db);assert.equal(r.status,422);assert.ok(db.calls.every(c=>c.text.startsWith('SELECT')));
});
test('daily CSV saves immutable bytes checksum and rejects duplicate rows',async()=>{
 const raw='date,symbol,open,high,low,close,volume\n2023-01-03,AAPL,100,102,99,101,200\n';
 function upload(text){const form=new FormData();form.set('file',new File([text],'sample.csv'));return new Request('https://trading.example/api/datasets/import',{method:'POST',body:form});}
 const db=database(()=>[]);let r=await edgeData(upload(raw),env,db);assert.equal(r.status,200);const saved=await r.json();assert.equal(saved.rows,1);assert.equal(saved.synthetic,false);assert.match(saved.checksum,/^[a-f0-9]{64}$/);assert.equal(db.calls.length,2);const bars=JSON.parse(db.calls[0].params[5]);assert.equal(bars[0].date,'2023-01-03');
 const invalid=database(()=>[]);r=await edgeData(upload(raw+'2023-01-03,AAPL,100,102,99,101,200\n'),env,invalid);assert.equal(r.status,422);assert.equal(invalid.calls.length,0);
});
test('a view from another state cannot be served as current and audit rows are joined fresh',async()=>{
 const stale=database(()=>[{id:'e1',body:null}]);assert.equal((await edgeData(req('/experiments/e1'),env,stale)).status,503);assert.match(stale.calls[0].text,/m.source_token=md5/);
 const db=database(text=>text.includes('LEFT JOIN edge_read_models')?[{id:'e1',body:JSON.stringify({id:'e1',state:{events:[{type:'state'}]},config:{},events:[{type:'old'}]})}]:[{id:'7',event:JSON.stringify({type:'fresh'}),created_at:'2026-11-24'}]);
 const r=await edgeData(req('/experiments/e1'),env,db);assert.deepEqual((await r.json()).events.map(e=>e.type),['state','fresh']);
});
