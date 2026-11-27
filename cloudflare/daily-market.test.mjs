import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dailyMarketSnapshot} from './daily-market.mjs';
import {edgeData} from './edge-data.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/daily-market-parity.json', import.meta.url)));
for (const {name, args, expected} of fixtures.cases) {
  test(`daily market matches original Python route: ${name}`, () => {
    const {experimentId, config, state, dataset, asOf, symbol} = args;
    if (expected.status === 200) assert.deepEqual(dailyMarketSnapshot(experimentId, config, state, dataset, asOf, symbol), expected.body);
    else assert.throws(() => dailyMarketSnapshot(experimentId, config, state, dataset, asOf, symbol), error => error.httpStatus === expected.status && error.message === expected.detail);
  });
}

const env = {EDGE_DATA_ENABLED:'true', EDGE_PUBLIC_WORKSPACE:'true'};
test('daily market is handled on the edge, without a prepared report or compute request', async () => {
  const {args, expected} = fixtures.cases.find(row => row.name === 'current');
  const queries = [];
  const sql = {query: async (query, values) => {
    queries.push(query);
    if (query.startsWith('SELECT config,state')) return [{config:JSON.stringify(args.config),state:JSON.stringify(args.state)}];
    if (query.startsWith('SELECT bars,checksum')) { assert.deepEqual(values, ['fixture']); return [args.dataset]; }
    assert.fail('Unexpected storage operation: '+query);
  }};
  const response = await edgeData(new Request('https://lab.test/api/experiments/experiment-fixture/market'), env, {sql});
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), expected.body);
  assert.equal(response.headers.get('X-Trading-Lab-Storage'), 'serverless-sql');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(queries.length, 2);
});

test('intraday snapshots and disabled/private edge mode stay with the original engine', async () => {
  let queries = 0;
  const sql = {query:async () => { queries++; return [{config:'{"schema_version":2}',state:'{}'}]; }};
  const request = new Request('https://lab.test/api/experiments/intraday/market');
  assert.equal(await edgeData(request, env, {sql}), null);
  assert.equal(queries, 1);
  assert.equal(await edgeData(request, {...env, EDGE_PUBLIC_WORKSPACE:'false'}, {sql}), null);
  assert.equal(await edgeData(request, {...env, EDGE_DATA_ENABLED:'false'}, {sql}), null);
  assert.equal(queries, 1);
});

test('missing experiments fail locally; malformed/future dates never leak dataset bars', async () => {
  const request = new Request('https://lab.test/api/experiments/missing/market');
  const response = await edgeData(request, env, {sql:{query:async () => []}});
  assert.equal(response.status, 404);
  const {args} = fixtures.cases.find(row => row.name === 'future');
  const failed = await edgeData(new Request('https://lab.test/api/experiments/test/market?as_of=2023-01-05'), env, {sql:{query:async query => query.startsWith('SELECT config,state') ? [{config:JSON.stringify(args.config),state:JSON.stringify(args.state)}] : [args.dataset]}});
  assert.equal(failed.status, 422); assert.equal((await failed.json()).bars, undefined);
});

test('news stays within the frozen pack, selected symbol and replay cutoff', async () => {
 const config={symbols:['A'],evidence_pack_id:'pack',evidence_pack_checksum:'fixed'};
 const calls=[];
 const sql={query:async (query,args)=>{calls.push([query,args]);if(query.startsWith('SELECT config,state'))return [{config:JSON.stringify(config),state:'{"current_date":"2025-12-31"}'}];if(query.startsWith('SELECT checksum'))return [{checksum:'fixed'}];if(query.startsWith('SELECT to_char')){assert.deepEqual(args,['2023-01-03']);return [{cutoff:'2023-01-03T21:00:00.000000Z'}];}assert.match(query,/i.available_at<=\$2/);assert.match(query,/symbol=ANY/);assert.deepEqual(args,['pack','2023-01-03T21:00:00.000000Z',['A']]);return [{body:'{"id":"headline-fixture","kind":"news","title":"Synthetic test headline"}'}];}};
 const response=await edgeData(new Request('https://lab.test/api/experiments/test/news?as_of=2023-01-03&symbol=A'),env,{sql});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.role,'context_only');assert.equal(body.items[0].id,'headline-fixture');assert.equal(calls.length,4);
});

test('news rejects a future date and a changed pack instead of returning context', async () => {
 for(const future of [true,false]){
 const config={symbols:['A'],evidence_pack_id:'pack',evidence_pack_checksum:'fixed'};
 const sql={query:async query=>query.startsWith('SELECT config,state')?[{config:JSON.stringify(config),state:'{"current_date":"2023-01-03"}'}]:[{checksum:'changed'}]};
 const response=await edgeData(new Request('https://lab.test/api/experiments/test/news?as_of='+(future?'2023-01-04':'2023-01-03')),env,{sql});assert.equal(response.status,future?422:409);assert.equal((await response.json()).items,undefined);
 }
});
