/** Synthetic slice id — all PR files in one diff viewer (not a review partition). */
export const FULL_PR_SLICE_ID = "__full_pr__";

/**
 * @param {string} id
 */
export function isFullPrSliceId(id) {
  return id === FULL_PR_SLICE_ID;
}

/**
 * @param {Array<{ files?: Array<{ path?: string, filename?: string, status?: string, additions?: number, deletions?: number, patch?: string | null }> }>} microPrs
 */
export function mergeAllPrFiles(microPrs) {
  /** @type {Map<string, { path: string, status: string, additions: number, deletions: number, patch: string | null }>} */
  const byPath = new Map();
  for (const m of microPrs ?? []) {
    for (const f of m.files ?? []) {
      const path = f.path ?? f.filename;
      if (!path || byPath.has(path)) continue;
      byPath.set(path, {
        path,
        status: f.status ?? "modified",
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        patch: f.patch ?? null,
      });
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}