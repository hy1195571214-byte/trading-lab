export function candleViewport(barCount: number, slots = 60) {
  const spacing = 824 / Math.max(1, slots);
  return { spacing, width: Math.max(900, 48 + barCount * spacing + 28) };
}

export function candleX(index: number, spacing: number) {
  return 48 + (index + 0.5) * spacing;
}

export function candlePriceAxis(bars: any[], extraPrices: number[] = []) {
  const open = Number(bars[0]?.open);
  if (!bars.length || !Number.isFinite(open) || open <= 0) return null;
  const values = bars.flatMap(bar => [Number(bar.low), Number(bar.high)])
    .concat(extraPrices).filter(value => Number.isFinite(value) && value > 0);
  const low = Math.min(open, ...values), high = Math.max(open, ...values);
  const step = open * 0.025;
  const lowerSteps = Math.max(2, Math.ceil((open - low) / step - 1e-10));
  const upperSteps = Math.max(2, Math.ceil((high - open) / step - 1e-10));
  return { min: Math.max(0, open - lowerSteps * step), max: open + upperSteps * step };
}

export function candleDateTicks(barCount: number, spacing: number) {
  const stride = Math.max(1, Math.ceil(120 / spacing));
  return Array.from({ length: Math.ceil(barCount / stride) }, (_, index) => index * stride);
}
