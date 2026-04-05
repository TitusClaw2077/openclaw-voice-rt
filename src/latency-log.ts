import type { CallRecord, LatencyEvent, LatencyEventName } from "./types.js";

/**
 * Append a latency event to the call's timeline.
 *
 * Mutates call.latencyEvents in-place so the entry is visible to any
 * subsequent serialization (JSONL flush, status query, etc.).
 *
 * @param call     - Active CallRecord to annotate.
 * @param event    - Named stage in the per-turn latency pipeline.
 * @param metadata - Optional key/value context (e.g. transcript length, model).
 */
export function logLatencyEvent(
  call: CallRecord,
  event: LatencyEventName,
  metadata?: Record<string, unknown>,
): void {
  const entry: LatencyEvent = { event, ts: Date.now(), ...(metadata ? { metadata } : {}) };
  call.latencyEvents.push(entry);
}
