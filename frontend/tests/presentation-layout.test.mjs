import test from 'node:test';
import assert from 'node:assert/strict';
import { candleViewport, candleX, candlePriceAxis, candleDateTicks } from '../src/candleViewport.ts';
import { activityRecordKeys, activityTime, conciseNumber } from '../src/presentationFormatting.ts';

test('new candles retain the same spacing and start on the left before overflow', () => {
  const early = candleViewport(3, 60), later = candleViewport(4, 60);
  assert.equal(early.width, 900);
  assert.equal(later.width, 900);
  assert.equal(candleX(0, early.spacing), candleX(0, later.spacing));
  assert.ok(candleX(2, early.spacing) < 100);
  assert.equal(candleViewport(60, 60).width, 900);
  assert.ok(candleViewport(61, 60).width > 900);
  assert.ok(candleViewport(31, 30).width > 900);
});

test('the initial price band stays fixed until a candle crosses its boundary', () => {
  const first = {open: 100, low: 99, high: 101};
  assert.deepEqual(candlePriceAxis([first]), {min: 95, max: 105});
  assert.deepEqual(candlePriceAxis([first, {open: 101, low: 100, high: 104}]), {min: 95, max: 105});
  assert.deepEqual(candlePriceAxis([first, {open: 104, low: 103, high: 106}]), {min: 95, max: 107.5});
  assert.deepEqual(candlePriceAxis([first], [94]), {min: 92.5, max: 105});
  assert.deepEqual(candlePriceAxis([first]), {min: 95, max: 105}, 'rewinding must not retain a later price extent');
});

test('early candle dates do not overlap and longer histories retain readable intervals', () => {
  const spacing = candleViewport(3).spacing;
  assert.deepEqual(candleDateTicks(3, spacing), [0]);
  const ticks = candleDateTicks(120, spacing);
  assert.ok(ticks.length > 2);
  assert.ok((ticks[1] - ticks[0]) * spacing >= 120);
});

test('PostgreSQL and SQLite server times display the same Beijing clock time', () => {
  assert.deepEqual(activityTime('2026-11-24 06:18:03.591873+00'), {date:'2026-11-24',time:'14:18:03',replayDate:false});
  assert.deepEqual(activityTime('2026-11-24 06:18:03'), {date:'2026-11-24',time:'14:18:03',replayDate:false});
  assert.deepEqual(activityTime('2026-11-24T20:18:03Z'), {date:'2026-11-25',time:'04:18:03',replayDate:false});
});

test('replay dates remain dates and absent metrics do not turn into zero scores', () => {
  assert.deepEqual(activityTime('2023-01-06'), {date:'2023-01-06',time:'',replayDate:true});
  assert.equal(activityTime('invalid'), null);
  assert.equal(activityTime('2023-02-29'), null);
  assert.equal(activityTime('2026-11-24T24:00:00Z'), null);
  assert.equal(conciseNumber(null), '—');
  assert.equal(conciseNumber(-4.561466727761044), '-4.56');
});

test('activity identity follows records through insertion and reordering', () => {
  const first = { experiment_id: 'a', type: 'decision_created', details: { date: '2023-01-03', provider: 'llm' } };
  const second = { experiment_id: 'a', type: 'order_filled', details: { date: '2023-01-04' } };
  const original = activityRecordKeys([first, second]);
  const reordered = activityRecordKeys([{ id: 'new' }, second, first]);
  assert.equal(original[0], reordered[2]);
  assert.equal(original[1], reordered[1]);
  assert.equal(original[0], activityRecordKeys([{ details: { provider: 'llm', date: '2023-01-03' }, type: 'decision_created', experiment_id: 'a' }])[0]);
  const duplicates = activityRecordKeys([first, first]);
  assert.notEqual(duplicates[0], duplicates[1]);
});
