const activityClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function activityTime(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00", fraction = "", offset] = match;
  const calendarDate = `${year}-${month}-${day}`;
  const calendar = new Date(`${calendarDate}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.getUTCFullYear() !== Number(year)
    || calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day)) return null;
  if (hour == null) return { date: calendarDate, time: "", replayDate: true };
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  // SQLite CURRENT_TIMESTAMP is UTC without an offset; PostgreSQL may use +00
  // and microseconds. Parse only these explicit ISO/SQL forms, never host-local dates.
  let zone = offset?.toUpperCase() || "Z";
  if (zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const offsetHour = digits.slice(0, 2), offsetMinute = digits.slice(2) || "00";
    if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
    zone = `${zone[0]}${offsetHour}:${offsetMinute}`;
  }
  const date = new Date(`${calendarDate}T${hour}:${minute}:${second}.${fraction.padEnd(3, "0").slice(0, 3)}${zone}`);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(activityClock.formatToParts(date)
    .filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}`, replayDate: false };
}

export function activityRecordKeys(items: Record<string, unknown>[]) {
  const occurrences = new Map<string, number>();
  return items.map(event => {
    const id = event.id ?? event.event_id;
    const identity = id != null
      ? JSON.stringify([event.experiment_id ?? "system", event.id != null ? "id" : "event_id", id])
      : JSON.stringify(event, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
    const occurrence = occurrences.get(identity) || 0;
    occurrences.set(identity, occurrence + 1);
    return `${identity}:${occurrence}`;
  });
}

export function conciseNumber(value: unknown) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(2);
}
