import { isCodeReviewFinding, coerceFindingLine } from "../../src/finding-meta.js";
import { findingKey, findingsForSlice, isFindingIgnored } from "./finding-actions.js";

/**
 * Stable #1…#n across the PR for Cursor / Composer slice findings (for cards + diff gutters).
 *
 * @param {{ data?: { microResults?: object[] }, ignoredFindings?: Set<string> } | undefined} session
 */
export function buildCursorFindingNumberIndex(session) {
  /** @type {Map<string, number>} */
  const byKey = new Map();
  /** @type {Array<{ n: number, key: string, path: string, line: number | null, preview: string }>} */
  const list = [];
  let n = 0;

  for (const r of session?.data?.microResults ?? []) {
    if (r.status === "skipped") continue;
    const slice = /** @type {{ componentId: string }} */ (r);
    const comments = findingsForSlice(slice.componentId, r).filter(isCodeReviewFinding);
    comments.forEach((f, fi) => {
      const key = findingKey(slice.componentId, f, fi);
      if (isFindingIgnored(key)) return;
      n += 1;
      byKey.set(key, n);
      list.push({
        n,
        key,
        path: String(f.filename ?? ""),
        line: coerceFindingLine(f.line),
        preview: String(f.message ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 96),
      });
    });
  }

  return { byKey, list, total: n };
}

/**
 * @param {number} n
 */
export function renderFindingNumberBadge(n) {
  if (!Number.isFinite(n) || n < 1) return "";
  return `<span class="cedar-finding-number cedar-badge cedar-badge-muted cedar-badge-compact font-mono" title="Finding #${n}">#${n}</span>`;
}