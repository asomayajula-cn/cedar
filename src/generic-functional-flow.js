import {
  collectReadablePatchText,
  fileFlowKind,
  scanLinesIntoBuckets,
  rulesForFileFlowKind,
  fileFlowKindRoleLabel,
} from "./file-flow-semantic.js";
import { capFunctionalSteps, outcomeFromSteps, renderFunctionalWorkflowMermaid } from "./functional-flow-render.js";

/**
 * @param {string} path
 * @param {string} patch
 * @returns {import("./functional-flow-render.js").FunctionalStep[]}
 */
export function collectGenericFunctionalSteps(path, patch) {
  const kind = fileFlowKind(path);
  const meta = collectReadablePatchText(patch);
  const rules = rulesForFileFlowKind(kind, path);
  const buckets = scanLinesIntoBuckets(meta.text, rules);
  const steps = expandBucketsToSteps(kind, buckets);
  if (steps.length) return capFunctionalSteps(steps);
  if (!meta.text.trim()) return [];
  return capFunctionalSteps([
    {
      phase: "behavior",
      headline: `${meta.added || meta.lineCount || 0} lines in diff`,
      functional: "Edits not matched to language patterns in visible diff",
    },
  ]);
}

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildGenericFunctionalWorkflowMermaid(path, patch) {
  const kind = fileFlowKind(path);
  const meta = collectReadablePatchText(patch);
  const rules = rulesForFileFlowKind(kind, path);
  const buckets = scanLinesIntoBuckets(meta.text, rules);
  const steps = expandBucketsToSteps(kind, buckets);

  const header = [
    `${steps.length} workflow steps`,
    meta.added ? `+${meta.added} lines` : null,
    meta.lineCount ? `${meta.lineCount} in diff` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return renderFunctionalWorkflowMermaid({
    title: shortName(path),
    header: header || roleForKind(kind),
    steps: steps.length
      ? steps
      : [
          {
            phase: "behavior",
            headline: `${meta.added} lines added`,
            functional: "Edits not matched to language patterns in visible diff",
          },
        ],
    outcome: outcomeFromSteps(steps) || `Change ${roleForKind(kind).toLowerCase()} behavior`,
  });
}

/**
 * @param {string} kind
 * @param {Record<string, string[]>} buckets
 */
function expandBucketsToSteps(kind, buckets) {
  /** @type {import("./functional-flow-render.js").FunctionalStep[]} */
  const steps = [];
  const phaseForBucket = {
    Imports: "dependencies",
    Dependencies: "dependencies",
    Exports: "api",
    Functions: "behavior",
    Methods: "behavior",
    "Types & classes": "contract",
    "HTTP / routes": "api",
    Tests: "integration",
    "Keys & values": "integration",
    Resources: "integration",
    Modules: "integration",
    "Build steps": "integration",
    Artifacts: "integration",
    Configuration: "integration",
    Runtime: "integration",
    Commands: "behavior",
    "Control flow": "behavior",
    Definitions: "behavior",
    Selectors: "behavior",
    Variables: "integration",
    "At-rules": "integration",
    Tags: "contract",
    Structure: "contract",
  };
  const functionalForBucket = {
    Imports: "Pull dependency into scope",
    Exports: "Publish symbol to consumers",
    Functions: "Define runnable behavior",
    Methods: "Define behavior on a type",
    "Types & classes": "Model data or role",
    "HTTP / routes": "Register external entry point",
    Tests: "Assert expected behavior",
    "Keys & values": "Change runtime configuration",
    Resources: "Declare infrastructure resource",
  };

  for (const [bucket, items] of Object.entries(buckets)) {
    if (!items?.length) continue;
    const phase = phaseForBucket[bucket] ?? "behavior";
    const fn = functionalForBucket[bucket] ?? "Apply change in this part of the file";
    const counts = new Map();
    for (const label of items) counts.set(label, (counts.get(label) ?? 0) + 1);
    for (const [label, n] of counts) {
      steps.push({
        phase,
        headline: n > 1 ? `${label} ×${n}` : label,
        functional: fn,
      });
    }
  }
  return steps;
}

function roleForKind(kind) {
  return fileFlowKindRoleLabel(kind);
}

function shortName(path) {
  const p = path.split("/");
  return p.length > 2 ? `…/${p.slice(-2).join("/")}` : path;
}