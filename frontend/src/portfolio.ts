import { fillVisibleAt, replayFillTime } from "./replayData";

export type HistoricalHolding = {
  symbol: string;
  quantity: number;
  mark: number;
  cost: number;
  costSource: "snapshot" | "fills" | "unavailable";
  value: number;
  pnl: number;
  pnlPct: number;
  weight: number;
};

export function historicalNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return Number.NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

export function holdingsAtSnapshot(
  snapshot: any,
  fills: any[] = [],
): HistoricalHolding[] {
  const cutoff =
    snapshot?.as_of_time ||
    snapshot?.available_at ||
    snapshot?.timestamp ||
    snapshot?.date ||
    "";
  const lots = new Map<
    string,
    { quantity: number; cost: number; valid: boolean }
  >();
  const visibleFills = fills
    .filter((fill) => fillVisibleAt(fill, cutoff))
    .slice()
    .sort((a, b) => replayFillTime(a).localeCompare(replayFillTime(b)));
  for (const fill of visibleFills) {
    const lot = lots.get(fill.symbol) || { quantity: 0, cost: 0, valid: true };
    const quantity = historicalNumber(fill.quantity);
    const fillPrice = historicalNumber(fill.fill_price ?? fill.price);
    if (
      !(quantity > 0) ||
      !(fillPrice > 0) ||
      !["buy", "sell"].includes(fill.side)
    ) {
      lot.valid = false;
    } else if (fill.side === "buy") {
      lot.cost =
        (lot.quantity * lot.cost + quantity * fillPrice) /
        (lot.quantity + quantity);
      lot.quantity += quantity;
    } else if (quantity > lot.quantity + Math.max(1, lot.quantity) * 1e-8) {
      lot.valid = false;
    } else {
      lot.quantity = Math.max(0, lot.quantity - quantity);
      if (lot.quantity < 1e-8) {
        lot.quantity = 0;
        lot.cost = 0;
      }
    }
    lots.set(fill.symbol, lot);
  }
  return Object.entries(snapshot?.positions || {}).map(
    ([symbol, raw]: [string, any]) => {
      const holding = raw && typeof raw === "object" ? raw : { quantity: raw };
      const quantity = historicalNumber(holding.quantity ?? holding.shares);
      const mark = historicalNumber(holding.last_price ?? holding.price);
      const recordedCost = historicalNumber(
        holding.average_cost ??
          holding.avg_cost ??
          holding.cost_basis_per_share,
      );
      const lot = lots.get(symbol);
      const matchesQuantity =
        lot?.valid &&
        lot.quantity > 0 &&
        Math.abs(lot.quantity - quantity) <= Math.max(1, quantity) * 1e-8;
      const cost = Number.isFinite(recordedCost)
        ? recordedCost
        : matchesQuantity
          ? lot!.cost
          : Number.NaN;
      const costSource = Number.isFinite(recordedCost)
        ? "snapshot"
        : matchesQuantity
          ? "fills"
          : "unavailable";
      const recordedValue = historicalNumber(holding.value);
      const value = Number.isFinite(recordedValue)
        ? recordedValue
        : Number.isFinite(mark) && Number.isFinite(quantity)
          ? mark * quantity
          : Number.NaN;
      const pnl =
        Number.isFinite(mark) &&
        Number.isFinite(cost) &&
        Number.isFinite(quantity)
          ? (mark - cost) * quantity
          : Number.NaN;
      const equity = historicalNumber(snapshot?.equity);
      const recordedWeight = historicalNumber(holding.weight);
      return {
        symbol,
        quantity,
        mark,
        cost,
        costSource,
        value,
        pnl,
        pnlPct:
          Number.isFinite(mark) && Number.isFinite(cost) && cost !== 0
            ? mark / cost - 1
            : Number.NaN,
        weight: Number.isFinite(recordedWeight)
          ? recordedWeight
          : Number.isFinite(value) && Number.isFinite(equity) && equity !== 0
            ? value / equity
            : Number.NaN,
      };
    },
  );
}

export function historicalMarketValue(
  snapshot: any,
  holdings: HistoricalHolding[],
): number {
  if (!snapshot) return Number.NaN;
  const recorded = historicalNumber(snapshot?.market_value);
  return Number.isFinite(recorded)
    ? recorded
    : holdings.every((holding) => Number.isFinite(holding.value))
      ? holdings.reduce((total, holding) => total + holding.value, 0)
      : Number.NaN;
}

export type AllocationSlice = {
  symbol: string;
  value: number;
  weight: number;
  kind: "stock" | "cash";
};

export function allocationAtSnapshot(
  snapshot: any,
  holdings: HistoricalHolding[],
): AllocationSlice[] {
  const cash = historicalNumber(snapshot?.cash);
  if (
    !snapshot ||
    !Number.isFinite(cash) ||
    cash < 0 ||
    holdings.some(
      (holding) => !Number.isFinite(holding.value) || holding.value < 0,
    )
  )
    return [];
  const parts = holdings
    .filter((holding) => holding.value > 0)
    .map((holding) => ({
      symbol: holding.symbol,
      value: holding.value,
      kind: "stock" as const,
    }));
  const total = cash + parts.reduce((sum, part) => sum + part.value, 0);
  if (!(total > 0)) return [];
  const slices: AllocationSlice[] = parts.map((part) => ({
    ...part,
    weight: part.value / total,
  }));
  if (cash > 0)
    slices.push({
      symbol: "cash",
      value: cash,
      weight: cash / total,
      kind: "cash",
    });
  return slices;
}

export function priceDirection(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "price-flat";
  return value > 0 ? "price-up" : "price-down";
}
