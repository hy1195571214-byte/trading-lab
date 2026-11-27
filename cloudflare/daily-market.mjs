// Read-only projection of the pinned daily dataset. No indicators or trading
// decisions are calculated here; intraday snapshots remain on the Python engine.
function fail(status, message) {
  const error = new Error(message);
  error.httpStatus = status;
  throw error;
}

export function dailyReadContext(config, state, asOf = null, symbol = null) {
  const current = state.current_date ?? null;
  const requested = asOf === null ? current : asOf;
  if (requested !== null) {
    const date = new Date(requested + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requested) || requested.startsWith('0000-') ||
        !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== requested) {
      fail(422, 'as_of must use a valid ISO YYYY-MM-DD date');
    }
    if (current !== null && requested > current) fail(422, 'as_of cannot be later than the current replay date');
  }
  const symbols = config.symbols || [];
  if (symbol !== null && !symbols.includes(symbol)) fail(422, 'symbol must be one of the experiment symbols');
  const cutoff = current === null ? null : requested === null ? current : requested < current ? requested : current;
  return {current, requested, symbols, cutoff};
}

export function dailyMarketSnapshot(experimentId, config, state, dataset, asOf = null, symbol = null) {
  const {current, requested, symbols, cutoff} = dailyReadContext(config, state, asOf, symbol);
  if (!dataset) fail(409, 'Pinned dataset is missing');
  if (config.dataset_checksum && dataset.checksum !== config.dataset_checksum) fail(409, 'Pinned dataset checksum does not match the experiment snapshot');
  // An unstarted experiment has no observable market snapshot, even when as_of
  // is within its configured date range. Never use dataset end as the cutoff.
  const bars = cutoff !== null && cutoff >= config.start_date
    ? (typeof dataset.bars === 'string' ? JSON.parse(dataset.bars) : dataset.bars)
      .filter(bar => config.start_date <= bar.date && bar.date <= config.end_date && bar.date <= cutoff && symbols.includes(bar.symbol) && (symbol === null || bar.symbol === symbol))
      .sort((a, b) => a.date === b.date ? (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0) : a.date < b.date ? -1 : 1)
    : [];
  return {experiment_id: experimentId, as_of: requested, current_date: current, symbols, bars, synthetic: Boolean(Number(dataset.synthetic)), dataset_id: config.dataset_id};
}
