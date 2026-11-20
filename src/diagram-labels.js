/**
 * Compact labels for interactive + export diagrams.
 * @param {string} name
 * @param {number} files
 * @param {number} additions
 * @param {number} deletions
 */
export function formatSliceLabel(name, files, additions, deletions) {
  const title = String(name ?? "Slice").trim().slice(0, 42);
  const stats = `${files} file${files === 1 ? "" : "s"} · +${additions} −${deletions}`;
  return `${title}\n${stats}`;
}

/**
 * @param {{ number?: number, title?: string }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function formatPrHubLabel(pull, target) {
  if (pull?.number) return `PR #${pull.number}`;
  if (target?.owner && target?.repo) return `${target.repo}`;
  return "Pull request";
}

/**
 * @param {string} label
 * @param {number} [maxLines]
 */
export function clampDiagramLabel(label, maxLines = 2) {
  const lines = String(label).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, maxLines).join("\n");
}