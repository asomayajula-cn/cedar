import { AsyncLocalStorage } from "node:async_hooks";

/** @typedef {(event: Record<string, unknown>) => void} ReviewProgressFn */

const progressStore = new AsyncLocalStorage();

/**
 * @param {ReviewProgressFn} emit
 * @param {() => Promise<T>} fn
 * @template T
 */
export function runWithReviewProgress(emit, fn) {
  return progressStore.run({ emit }, fn);
}

/**
 * @param {Record<string, unknown>} event
 */
export function emitReviewProgress(event) {
  progressStore.getStore()?.emit?.(event);
}

/**
 * Bridge SSE events → Cedar review stream.
 * @param {Record<string, unknown>} event
 */
export function emitBridgeSse(event) {
  if (!event || typeof event !== "object") return;
  const type = event.type;
  if (type === "activity") {
    emitReviewProgress({
      type: "activity",
      text: event.text ?? "Working…",
      phase: event.phase ?? null,
      tool: event.tool ?? null,
      path: event.path ?? null,
      status: event.status ?? null,
    });
    return;
  }
  if (type === "text" && event.text) {
    const snippet = String(event.text).replace(/\s+/g, " ").trim().slice(0, 72);
    if (snippet) {
      emitReviewProgress({ type: "activity", text: `Composing… ${snippet}`, phase: "compose" });
    }
    return;
  }
  if (type === "tool" && event.text) {
    emitReviewProgress({ type: "activity", text: String(event.text).trim(), phase: "tool" });
    return;
  }
  if (type === "error" && event.error) {
    emitReviewProgress({ type: "activity", text: String(event.error), phase: "error" });
  }
}

/**
 * @param {string} id
 * @param {string} label
 * @param {'running' | 'done' | 'skipped'} status
 * @param {string} [detail]
 */
export function emitPhase(id, label, status, detail) {
  emitReviewProgress({ type: "phase", id, label, status, detail });
}