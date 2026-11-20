/**
 * @typedef {import('./review-engine.js').MicroReviewResult} MicroReviewResult
 */

/**
 * @param {MicroReviewResult[]} microResults
 * @param {{ headSha: string, ready: boolean, blockedReason?: string }} gate
 */
export function formatComponentBoard(microResults, gate) {
  const compositeStatus = gate.ready
    ? "ready — whole picture painted below"
    : gate.blockedReason ?? "waiting for component slices";

  const table = [
    "| Component | Status | Files | Blockers |",
    "|-----------|--------|-------|----------|",
    ...microResults.map((r) => {
      const b = r.findings.filter((f) => f.severity === "blocker").length;
      let status;
      if (r.status === "skipped") status = "skipped";
      else if (r.status === "passed") status = "✅ reviewed";
      else status = "❌ blocked";
      return `| ${r.componentName} | ${status} | ${r.filesReviewed} | ${b} |`;
    }),
    "",
    `**Composite** · head \`${gate.headSha.slice(0, 7)}\` · ${compositeStatus}`,
  ].join("\n");

  return ["## Component review board", "", table].join("\n");
}

/**
 * @param {object} report
 */
export function formatJsonReport(report) {
  return JSON.stringify(report, null, 2);
}