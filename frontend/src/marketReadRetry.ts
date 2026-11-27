export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  if (/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Only the chart's idempotent GET opts in. Never replay a trade, review, import
// or any other write. Long Retry-After values are left for an explicit retry.
export async function retryMarketRead<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = abortableDelay,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await read(); }
    catch (error: any) {
      signal.throwIfAborted();
      if (error?.status !== 429 || attempt >= 2) throw error;
      const delay = error.retryAfterMs ?? 1000 * 2 ** attempt;
      if (!Number.isFinite(delay) || delay < 0 || delay > 10000) throw error;
      await wait(delay, signal);
    }
  }
}
