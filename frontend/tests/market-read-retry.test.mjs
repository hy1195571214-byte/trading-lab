import test from 'node:test';
import assert from 'node:assert/strict';
import { abortableDelay, parseRetryAfter, retryMarketRead } from '../src/marketReadRetry.ts';

const limited = (ms) => Object.assign(new Error('Too many requests'), {status: 429, retryAfterMs: ms});

test('market GET recovers from a temporary 429 without overlapping reads', async () => {
  const delays = []; let calls = 0; let active = 0; let maximum = 0;
  const result = await retryMarketRead(async () => {
    active++; maximum = Math.max(maximum, active); calls++; active--;
    if (calls < 3) throw limited();
    return {bars: ['synthetic fixture']};
  }, new AbortController().signal, async ms => { delays.push(ms); });
  assert.deepEqual(result.bars, ['synthetic fixture']);
  assert.deepEqual(delays, [1000, 2000]); assert.equal(calls, 3); assert.equal(maximum, 1);
});

test('Retry-After is honored; long waits do not cause automatic request loops', async () => {
  const delays = []; let calls = 0;
  await retryMarketRead(async () => { if (++calls === 1) throw limited(4000); return 'ok'; }, new AbortController().signal, async ms => { delays.push(ms); });
  assert.deepEqual(delays, [4000]);
  calls = 0;
  await assert.rejects(retryMarketRead(async () => { calls++; throw limited(60000); }, new AbortController().signal, async () => { assert.fail('must not wait/retry'); }));
  assert.equal(calls, 1);
});

test('persistent 429 stops after three attempts; data and authorization errors do not retry', async () => {
  for (const [status, expected] of [[429, 3], [401, 1], [404, 1], [409, 1], [422, 1], [503, 1]]) {
    let calls = 0;
    await assert.rejects(retryMarketRead(async () => { calls++; throw Object.assign(new Error('fixture'), {status}); }, new AbortController().signal, async () => {}));
    assert.equal(calls, expected);
  }
});

test('switching experiments aborts the retry delay and prevents the next request', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(retryMarketRead(async () => { calls++; throw limited(); }, controller.signal, async () => { controller.abort(); }), {name: 'AbortError'});
  assert.equal(calls, 1);
  const waiting = new AbortController();
  const promise = abortableDelay(60000, waiting.signal); waiting.abort();
  await assert.rejects(promise, {name: 'AbortError'});
});

test('Retry-After supports HTTP dates and rejects invalid or negative delays', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter('Fri, 27 Nov 2026 12:00:03 GMT', Date.parse('2026-11-27T12:00:00Z')), 3000);
  assert.equal(parseRetryAfter('-1'), undefined);
  assert.equal(parseRetryAfter('nonsense'), undefined);
  assert.equal(parseRetryAfter(null), undefined);
});
