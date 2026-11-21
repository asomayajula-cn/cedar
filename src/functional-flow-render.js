import { mermaidSafeText } from "./mermaid-sanitize.js";

/** Detailed file workflow — drawn out in order, capped only for huge files */
export const MAX_FUNCTIONAL_STEPS = 40;

/**
 * @typedef {{ phase: string, headline: string, functional: string }} FunctionalStep
 */

/** @type {Record<string, string>} */
const LANE_TITLES = {
  transaction: "Transaction",
  dependencies: "Dependencies",
  contract: "Types",
  schema: "Schema",
  api: "API surface",
  behavior: "Logic",
  data: "Data",
  persistence: "Persistence",
  integration: "Wiring",
  logic: "Database logic",
  finalize: "Finish",
  cleanup: "Cleanup",
  other: "Other",
};

/**
 * @param {string} phase
 */
export function normalizeLanePhase(phase) {
  if (phase === "ddl_create" || phase === "ddl_alter" || phase === "constraint" || phase === "view" || phase === "index") {
    if (phase === "index") return "integration";
    return "schema";
  }
  if (phase?.startsWith("dml")) return "data";
  return phase || "other";
}

/**
 * @param {FunctionalStep[]} steps
 */
export function mergeIdenticalSteps(steps) {
  /** @type {FunctionalStep[]} */
  const out = [];
  for (const step of steps) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.phase === step.phase &&
      prev.headline === step.headline &&
      prev.functional === step.functional
    ) {
      const m = prev.headline.match(/ ×(\d+)$/);
      const n = m ? Number(m[1]) + 1 : 2;
      prev.headline = prev.headline.replace(/ ×\d+$/, "") + ` ×${n}`;
      continue;
    }
    out.push({ ...step });
  }
  return out;
}

/**
 * @param {FunctionalStep[]} steps
 */
export function capFunctionalSteps(steps) {
  const merged = mergeIdenticalSteps(steps);
  if (merged.length <= MAX_FUNCTIONAL_STEPS) return merged;
  const head = merged.slice(0, MAX_FUNCTIONAL_STEPS - 1);
  const rest = merged.length - (MAX_FUNCTIONAL_STEPS - 1);
  head.push({
    phase: "other",
    headline: `${rest} more steps in file`,
    functional: "Additional edits follow the same pattern in source order",
  });
  return head;
}

/**
 * @param {FunctionalStep} step
 */
export function formatFunctionalNode(step) {
  const fn = step.functional ? ` — ${step.functional}` : "";
  return `${step.headline}${fn}`;
}

/**
 * @param {string[]} lines
 * @param {FunctionalStep[]} workflow
 * @param {string} entry
 */
function appendWorkflowLaneGraph(lines, workflow, entry) {
  let lane = "";
  let laneIndex = 0;
  let prev = entry;
  let laneHead = "";
  let laneTail = "";

  const openLane = (key) => {
    laneIndex += 1;
    lane = key;
    laneHead = "";
    laneTail = "";
    lines.push(`  subgraph lane_${laneIndex} ["${mermaidSafeText(LANE_TITLES[key] ?? key)}"]`);
    lines.push("    direction TB");
  };

  const closeLane = () => {
    if (!lane) return;
    lines.push("  end");
    if (laneHead) lines.push(`  ${prev} --> ${laneHead}`);
    prev = laneTail || laneHead || prev;
    lane = "";
    laneHead = "";
    laneTail = "";
  };

  workflow.forEach((step, idx) => {
    const key = normalizeLanePhase(step.phase);
    if (key !== lane) {
      closeLane();
      openLane(key);
    }
    const id = `f${idx}`;
    const text = mermaidSafeText(formatFunctionalNode(step));
    const terminal = step.phase === "finalize" || step.phase === "transaction" && /COMMIT|ROLLBACK/i.test(step.headline);
    if (terminal) lines.push(`    ${id}([${text}])`);
    else lines.push(`    ${id}["${text}"]`);
    if (!laneHead) laneHead = id;
    else lines.push(`    ${laneTail} --> ${id}`);
    laneTail = id;
  });

  closeLane();
  return prev;
}

/**
 * @param {{
 *   title: string,
 *   header: string,
 *   steps: FunctionalStep[],
 *   outcome: string,
 * }} opts
 */
export function renderFunctionalWorkflowMermaid(opts) {
  const steps = capFunctionalSteps(opts.steps);
  const lines = ["flowchart TB"];
  lines.push(`  start([${mermaidSafeText(opts.title)}])`);
  lines.push(`  hdr["${mermaidSafeText(opts.header)}"]`);
  lines.push("  start --> hdr");

  const prev = steps.length ? appendWorkflowLaneGraph(lines, steps, "hdr") : "hdr";

  lines.push(`  done(["Outcome"])`);
  lines.push(`  purpose["${mermaidSafeText(opts.outcome)}"]`);
  lines.push(`  ${prev} --> done`);
  lines.push("  done --> purpose");
  return lines.join("\n");
}

/**
 * @param {FunctionalStep[]} steps
 */
export function outcomeFromSteps(steps) {
  const phases = [...new Set(steps.map((s) => s.functional).filter(Boolean))];
  if (!phases.length) return "Executes this file’s changes in source order";
  return phases.slice(0, 5).join(". ");
}