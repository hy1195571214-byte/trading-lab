import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const vite = await createServer({configFile: false, root: resolve(dirname(fileURLToPath(import.meta.url)), '..'), server: {middlewareMode: true}, appType: 'custom'});
const { holdingsAtSnapshot, allocationAtSnapshot, priceDirection } = await vite.ssrLoadModule('/src/portfolio.ts');
test.after(() => vite.close());
const snapshot = {date: '2023-01-05', equity: 1600, cash: 500, positions: {AAA: {quantity: 10, last_price: 110, value: 1100}}};
const fills = [{symbol: 'AAA', side: 'buy', quantity: 10, fill_price: 100, date: '2023-01-03'}];

test('historical costs use visible fills and ignore later buys', () => {
  const later = {symbol: 'AAA', side: 'buy', quantity: 100, fill_price: 900, date: '2023-01-06'};
  const [holding] = holdingsAtSnapshot(snapshot, [...fills, later]);
  assert.equal(holding.cost, 100);
  assert.equal(holding.costSource, 'fills');
  assert.equal(holding.pnl, 100);
  assert.ok(Math.abs(holding.pnlPct - .1) < 1e-12);
});

test('weighted average basis survives partial sales and follows a new purchase', () => {
  const ledger = [...fills,
    {symbol: 'AAA', side: 'sell', quantity: 4, fill_price: 150, date: '2023-01-04'},
    {symbol: 'AAA', side: 'buy', quantity: 4, fill_price: 125, date: '2023-01-05'}];
  const [holding] = holdingsAtSnapshot(snapshot, ledger.reverse());
  assert.equal(holding.cost, 110);
  assert.equal(holding.pnl, 0);
});

test('incomplete fills and absent historical costs stay unknown', () => {
  const [incomplete] = holdingsAtSnapshot(snapshot, [{...fills[0], quantity: 9}]);
  const [missing] = holdingsAtSnapshot(snapshot);
  assert.ok(Number.isNaN(incomplete.cost));
  assert.ok(Number.isNaN(missing.cost));
  assert.equal(missing.costSource, 'unavailable');
});

test('explicit snapshot cost takes precedence and a closed lot resets its basis', () => {
  const explicit = structuredClone(snapshot);
  explicit.positions.AAA.average_cost = 80;
  assert.equal(holdingsAtSnapshot(explicit, fills)[0].cost, 80);
  const ledger = [...fills,
    {symbol: 'AAA', side: 'sell', quantity: 10, fill_price: 130, date: '2023-01-04'},
    {symbol: 'AAA', side: 'buy', quantity: 10, fill_price: 90, date: '2023-01-05'}];
  assert.equal(holdingsAtSnapshot(snapshot, ledger)[0].cost, 90);
});

test('timestamped fills wait for their observation time', () => {
  const timed = {...snapshot, date: '2023-01-05', as_of_time: '2023-01-05T14:31:00Z'};
  const delayed = {...fills[0], date: '2023-01-05T14:30:00Z', available_at: '2023-01-05T14:32:00Z'};
  assert.ok(Number.isNaN(holdingsAtSnapshot(timed, [delayed])[0].cost));
  timed.as_of_time = '2023-01-05T14:32:00Z';
  assert.equal(holdingsAtSnapshot(timed, [delayed])[0].cost, 100);
});

test('allocation includes cash and uses market values', () => {
  const slices = allocationAtSnapshot(snapshot, holdingsAtSnapshot(snapshot));
  assert.equal(slices.length, 2);
  assert.equal(slices[0].weight, 1100 / 1600);
  assert.equal(slices[1].kind, 'cash');
  assert.equal(slices.reduce((sum, slice) => sum + slice.weight, 0), 1);
  assert.deepEqual(allocationAtSnapshot({cash: 1000, equity: 1000, positions: {}}, []), [{symbol: 'cash', kind: 'cash', value: 1000, weight: 1}]);
  assert.deepEqual(allocationAtSnapshot(null, []), []);
  assert.deepEqual(allocationAtSnapshot({cash: 0}, []), []);
});

test('ten-stock allocation and colors retain explicit neutral and unavailable states', () => {
  const ten = {date: '2023-01-05', cash: 0, equity: 1000, positions: Object.fromEntries(Array.from({length: 10}, (_, i) => [`S${i}`, {quantity: 1, last_price: 100, value: 100}]))};
  assert.equal(allocationAtSnapshot(ten, holdingsAtSnapshot(ten)).length, 10);
  assert.equal(priceDirection(2), 'price-up');
  assert.equal(priceDirection(-2), 'price-down');
  assert.equal(priceDirection(0), 'price-flat');
  assert.equal(priceDirection(NaN), 'price-flat');
});
