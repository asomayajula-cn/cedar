import { isCodeReviewFinding } from "../../src/finding-meta.js";

/**
 * @param {object[] | undefined} microResults
 */
function summarizeCursorSliceReview(microResults) {
  /** @type {Array<{ componentId: string, componentName: string, count: number, status: string, error?: string }>} */
  const bySlice = [];
  let total = 0;
  let slicesWithFindings = 0;
  let slicesAttempted = 0;

  for (const r of microResults ?? []) {
    if (r.status === "skipped") continue;
    const cr = r.cursorReview;
    const comments = (r.reviewComments ?? []).filter(isCodeReviewFinding);
    const count = comments.length || Math.max(0, Number(cr?.count) || 0);
    let status = cr?.status ?? (count > 0 ? "ok" : "empty");
    if (!cr && count === 0) status = "pending";
    if (cr) slicesAttempted += 1;
    total += count;
    if (count > 0) slicesWithFindings += 1;
    bySlice.push({
      componentId: r.componentId,
      componentName: r.componentName,
      count,
      status,
      error: cr?.error,
    });
  }

  return { total, slicesWithFindings, slicesAttempted, bySlice };
}

/**
 * Rebuild left-rail Cursor rollup from live microResults (browser-safe — no Node credentials).
 * @param {{ data?: { microResults?: object[], macroReview?: object | null, cursorReviewSummary?: Record<string, unknown> } } | null | undefined} session
 */
export function refreshCursorReviewSummary(session) {
  if (!session?.data?.microResults) return null;
  const prev = session.data.cursorReviewSummary ?? {};
  const slice = summarizeCursorSliceReview(session.data.microResults);
  const macroReview = session.data.macroReview ?? null;
  const macroFindingCount = Array.isArray(macroReview?.findings) ? macroReview.findings.length : 0;
  const slicePassRan = slice.slicesAttempted > 0 || Boolean(prev.slicePassRan);

  const summary = {
    enabled: Boolean(prev.enabled ?? prev.requested),
    requested: Boolean(prev.requested ?? prev.enabled),
    available: Boolean(prev.available ?? slicePassRan ?? prev.enabled),
    slicePassRan,
    slice,
    macro: macroReview
      ? {
          findingCount: macroFindingCount,
          event: macroReview.event ?? "COMMENT",
          priority: macroReview.priority,
          hasBody: Boolean(macroReview.body?.trim()),
        }
      : prev.macro ?? null,
    totalFindings: slice.total + macroFindingCount,
  };

  session.data.cursorReviewSummary = summary;
  return summary;
}