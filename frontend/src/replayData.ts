export function replayDateOf(item: any): string {
  return item?.timestamp || item?.bar_end || item?.as_of_time || item?.as_of_at || item?.available_at || item?.date || item?.as_of_date || item?.filled_date || item?.bar_start || "";
}

export function replayDecisionTime(item: any): string {
  return item?.as_of_time || item?.as_of_at || item?.timestamp || item?.bar_end || item?.date || item?.as_of_date || "";
}

export function replayFillTime(item: any): string {
  return item?.fill_at || item?.filled_at || item?.filled_date || item?.date || item?.timestamp || "";
}

export function replayFillSourceTime(item: any): string {
  return item?.source_bar_end || item?.source_bar_start || replayDateOf(item);
}

/** When the fill became knowable, including when its execution bar was observed. */
export function fillAvailableAt(item: any): string {
  const fillAt = replayFillTime(item);
  const observedAt = item?.bar_observed_at || item?.bar_available_at || item?.source_bar_available_at || item?.available_at || "";
  if (!observedAt) return fillAt;
  if (!fillAt) return observedAt;
  return atOrBeforeAsOf(fillAt, observedAt) ? observedAt : fillAt;
}

/** The knowledge clock of a saved history snapshot, distinct from its market-bar timestamp. */
export function historyAsOf(item: any): string {
  return item?.as_of_time || item?.available_at || replayDateOf(item);
}

/** A proposal is knowable after the model finished it, not when its input snapshot was taken. */
export function decisionAvailableAt(item: any): string {
  return item?.decision_completed_at || item?.completed_at || replayDecisionTime(item);
}

export function decisionVisibleAt(item: any, cutoff: string): boolean {
  return atOrBeforeAsOf(decisionAvailableAt(item), cutoff);
}

export function currentPendingDecision(decisions: any[]): any | null {
  return decisions.find((item) => ["pending", "awaiting_review"].includes(item?.status)) || null;
}

export function traceVisibleAt(trace: any, decisions: any[], cutoff: string): boolean {
  const linked = decisions.find((decision) => decision.id === trace?.decision_id || decision.decision_id === trace?.decision_id);
  if (linked) return decisionVisibleAt(linked, cutoff);
  const completed = trace?.completed_at || trace?.finished_at || trace?.decision_completed_at;
  return Boolean(completed && atOrBeforeAsOf(completed, cutoff));
}

export function fillVisibleAt(item: any, cutoff: string): boolean {
  return atOrBeforeAsOf(fillAvailableAt(item), cutoff);
}

export function orderVisibleAt(item: any, cutoff: string): boolean {
  const created = item?.submitted_at || item?.created_at || item?.created_date;
  if (!created || !atOrBeforeAsOf(created, cutoff)) return false;
  const cancelled = item?.cancelled_at || item?.cancelled_date;
  return !cancelled || !atOrBeforeAsOf(cancelled, cutoff);
}

export function reviewVisibleAt(decision: any, events: any[], cutoff: string): boolean {
  const decisionId = decision?.id || decision?.decision_id;
  const event = events.find((item) => item.type === "decision_reviewed" && item.decision_id === decisionId);
  const reviewedAt = decision?.review?.reviewed_at || decision?.review?.date || decision?.review?.created_at || event?.created_at || event?.timestamp;
  return Boolean(reviewedAt && atOrBeforeAsOf(reviewedAt, cutoff));
}

export function historyVisibleAt(item: any, cutoff: string): boolean {
  return atOrBeforeAsOf(historyAsOf(item), cutoff);
}

/** Pick the first saved account point that could already contain an event. */
export function historyKeyAtOrAfter(history: any[], eventTime: string): string {
  const point = history.find((item) => atOrBeforeAsOf(eventTime, historyAsOf(item)));
  return point ? replayDateOf(point) : "";
}

export function fillBelongsToHistoryPoint(fill: any, historyKey: string, history: any[]): boolean {
  const availableAt = fillAvailableAt(fill);
  return Boolean(availableAt && historyKeyAtOrAfter(history, availableAt) === historyKey);
}

/** Compare ISO dates/timestamps without treating a date-only value as the whole same day. */
export function atOrBeforeAsOf(value: string, cutoff: string): boolean {
  if (!value || !cutoff) return false;
  const valueHasTime = value.includes("T");
  const cutoffHasTime = cutoff.includes("T");
  if (valueHasTime && cutoffHasTime) {
    const valueMs = Date.parse(value);
    const cutoffMs = Date.parse(cutoff);
    return Number.isFinite(valueMs) && Number.isFinite(cutoffMs) && valueMs <= cutoffMs;
  }
  const valueDate = value.slice(0, 10);
  const cutoffDate = cutoff.slice(0, 10);
  if (valueDate !== cutoffDate) return valueDate < cutoffDate;
  if (valueHasTime !== cutoffHasTime) return false;
  return valueDate <= cutoffDate;
}

export function responseMatchesSelection(requestedId: string, selectedId: string, response: any): boolean {
  return Boolean(requestedId) && requestedId === selectedId && response?.id === requestedId;
}

/** Score analysis uses a simulated availability clock. A daily replay point means the 16:00 New York close. */
export function analysisVisibleAt(available: string, cutoff: string): boolean {
  if (!available || !cutoff) return false;
  if (!cutoff.includes('T') && available.includes('T')) {
    const date = new Date(available);
    if (!Number.isFinite(date.getTime())) return false;
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).formatToParts(date);
    const get = (name: string) => parts.find(p => p.type === name)?.value || '';
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    return day < cutoff || (day === cutoff && `${get('hour')}:${get('minute')}:${get('second')}` <= '16:00:00' && (date.getUTCMilliseconds() === 0 || `${get('hour')}:${get('minute')}:${get('second')}` < '16:00:00'));
  }
  return atOrBeforeAsOf(available, cutoff);
}
