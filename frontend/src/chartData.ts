import { atOrBeforeAsOf } from "./replayData";

export type ChartMode = "intraday" | "day" | "week";

export function rawBarTime(bar: any): string {
  return String(bar?.bar_start || bar?.timestamp || bar?.date || "");
}

export function rawBarEnd(bar: any): string {
  return String(bar?.bar_end || bar?.timestamp || bar?.date || rawBarTime(bar));
}

function partsInTimeZone(date: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function marketSessionDate(value: string): string {
  if (!value) return "";
  if (!value.includes("T")) return value.slice(0, 10);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  const parts = partsInTimeZone(date, "America/New_York");
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function etMinuteOfDay(value: string): number {
  if (!value?.includes("T")) return Number.NaN;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return Number.NaN;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return get("hour") * 60 + get("minute") + get("second") / 60;
}

export function regularSessionX(barEnd: string): number | null {
  const minute = etMinuteOfDay(barEnd);
  if (!Number.isFinite(minute) || minute < 570 || minute > 960) return null;
  return 48 + ((minute - 570) / 390) * 824;
}

export function isRegularSessionBar(bar: any): boolean {
  const start = etMinuteOfDay(rawBarTime(bar));
  const end = etMinuteOfDay(rawBarEnd(bar));
  return Number.isFinite(start) && Number.isFinite(end) && start >= 570 && start < 960 && end <= 960 && end >= start;
}

export function intradayPriceAxis(bars: any[], extraPrices: number[] = []): { open: number; min: number; max: number; percent: number } | null {
  if (!bars.length) return null;
  const open = Number(bars[0]?.open);
  if (!Number.isFinite(open) || open <= 0) return null;
  const deviation = Math.max(0, ...bars.flatMap((bar) => [
    Math.abs(Number(bar.high) - open),
    Math.abs(Number(bar.low) - open),
    Math.abs(Number(bar.close) - open),
  ].filter(Number.isFinite)), ...extraPrices.map((value) => Math.abs(Number(value) - open)).filter(Number.isFinite));
  const percent = Math.max(1, Math.ceil((deviation / open) * 200 - 1e-10) / 2);
  const halfRange = open * percent / 100;
  return { open, min: open - halfRange, max: open + halfRange, percent };
}

export function weekStartEt(dateValue: string): string {
  const [year, month, day] = dateValue.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export function supportsIntraday(bars: any[], schemaVersion: unknown, interval: unknown): boolean {
  const normalizedInterval = String(interval || "").toLowerCase();
  const minuteOrHour = /(^|[^0-9])(1m|1min|1h|1hour)([^a-z]|$)/.test(normalizedInterval)
    || normalizedInterval === "1min" || normalizedInterval === "1hour";
  return Number(schemaVersion || 1) >= 2 && minuteOrHour && bars.some((bar) => rawBarTime(bar).includes("T"));
}

export function visibleBarsAt(bars: any[], cutoff: string): any[] {
  if (!cutoff) return [];
  return bars.filter((bar) => {
    const eventTime = rawBarEnd(bar);
    if (!eventTime || !atOrBeforeAsOf(eventTime, cutoff)) return false;
    if (bar.available_at && !atOrBeforeAsOf(bar.available_at, cutoff)) return false;
    return true;
  });
}

export function aggregateBars(bars: any[], mode: "day" | "week", interval = ""): any[] {
  const groups = new Map<string, any[]>();
  for (const bar of bars) {
    const sessionDate = marketSessionDate(rawBarTime(bar));
    if (!sessionDate) continue;
    const bucket = mode === "week" ? weekStartEt(sessionDate) : sessionDate;
    const key = `${bar.symbol || ""}|${bucket}`;
    const group = groups.get(key) || [];
    group.push(bar);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, sourceBars]) => {
    sourceBars.sort((a, b) => {
      const left = rawBarTime(a), right = rawBarTime(b);
      return left.includes("T") && right.includes("T") ? Date.parse(left) - Date.parse(right) : left.localeCompare(right);
    });
    const [symbol, bucketDate] = key.split("|");
    const first = sourceBars[0];
    const last = sourceBars[sourceBars.length - 1];
    const barsComplete = sourceBars.every((bar) => bar.is_complete !== false);
    const hasIntraday = rawBarTime(first).includes("T");
    return {
      symbol,
      date: bucketDate,
      open: Number(first.open),
      high: Math.max(...sourceBars.map((bar) => Number(bar.high))),
      low: Math.min(...sourceBars.map((bar) => Number(bar.low))),
      close: Number(last.close),
      volume: sourceBars.reduce((total, bar) => total + Number(bar.volume || 0), 0),
      bar_start: rawBarTime(first),
      bar_end: rawBarEnd(last),
      source_as_of: rawBarEnd(last),
      source_bars: sourceBars,
      source_times: sourceBars.map(rawBarEnd),
      source_starts: sourceBars.map(rawBarTime),
      is_complete: barsComplete,
      coverage_complete: false,
      coverage_label: hasIntraday || mode === "week"
        ? mode === "week" ? "按已有数据汇总，周覆盖完整性未确认" : "按已有数据汇总，日覆盖完整性未确认"
        : "",
    };
  }).sort((a, b) => `${a.date}|${a.symbol}`.localeCompare(`${b.date}|${b.symbol}`));
}

export function chartBarIndexForSource(bars: any[], symbol: string, sourceTime: string): number {
  return bars.findIndex((bar) => bar.symbol === symbol && (
    (Array.isArray(bar.source_times) && bar.source_times.includes(sourceTime))
    || (Array.isArray(bar.source_starts) && bar.source_starts.includes(sourceTime))
    || rawBarEnd(bar) === sourceTime
    || bar.bar_start === sourceTime
  ));
}
