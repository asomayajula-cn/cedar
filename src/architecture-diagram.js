/**
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import { slicesForArchitectureDiagram } from "./diagram-layout.js";
import { formatPrHubLabel, formatSliceLabel } from "./diagram-labels.js";

const MAX_SLICES_IN_DIAGRAM = 16;

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildArchitectureDiagramMermaid(microPrs, breakouts, pull, target) {
  const allTouched = slicesForArchitectureDiagram(microPrs);
  const touched = allTouched.slice(0, MAX_SLICES_IN_DIAGRAM);
  if (!touched.length) {
    return "flowchart TB\n  empty[No files in PR]";
  }

  const prLabel = formatPrHubLabel(pull, target);
  const omittedSlices = allTouched.length - touched.length;
  const direction = touched.length >= 2 ? "LR" : "TB";

  const lines = [
    `flowchart ${direction}`,
    "  classDef pr fill:#fafafa,stroke:#171717,stroke-width:2px,color:#0a0a0a",
    "  classDef slice fill:#141414,stroke:#737373,stroke-width:1px,color:#f5f5f5",
    "  classDef more fill:#0a0a0a,stroke:#404040,color:#737373",
    `  pr(("${mermaidLabel(prLabel)}")):::pr`,
  ];

  const idByComponent = new Map();

  for (const m of touched) {
    const nodeId = `slice_${safeNodeId(m.componentId)}`;
    idByComponent.set(m.componentId, nodeId);
    const label = formatSliceLabel(m.componentName, m.files.length, m.additions, m.deletions).replace(
      "\n",
      "<br/>"
    );
    lines.push(`  ${nodeId}["${mermaidLabel(label)}"]:::slice`);
    lines.push(`  pr --> ${nodeId}`);
  }

  if (omittedSlices > 0) {
    lines.push(`  pr_more["+${omittedSlices} more slices"]:::more`);
    lines.push("  pr --> pr_more");
  }

  const deps = new Set();
  for (const m of touched) {
    const from = idByComponent.get(m.componentId);
    for (const dep of [
      ...(m.dependsOn ?? []),
      ...(breakouts?.components?.find((c) => c.id === m.componentId)?.depends_on ?? []),
    ]) {
      const to = idByComponent.get(dep);
      if (to && from && to !== from) {
        const key = `${to}-->${from}`;
        if (!deps.has(key)) {
          deps.add(key);
          lines.push(`  ${to} -.-> ${from}`);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {string} mermaid
 */
export function buildArchitectureDiagramMarkdown(mermaid) {
  return ["### Complete layout", "", "```mermaid", mermaid, "```"].join("\n");
}

/**
 * @param {string} id
 */
function safeNodeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_") || "slice";
}

/**
 * Safe node / subgraph labels for Mermaid flowchart quoted strings.
 * @param {string} s
 */
function mermaidLabel(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "'")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/#/g, "")
    .replace(/;/g, ",")
    .replace(/\n/g, " ")
    .trim();
}