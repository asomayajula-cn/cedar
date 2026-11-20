/**
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import { formatArchitectureLayerLabel, formatPrHubLabel, formatSliceTag } from "./diagram-labels.js";
import { buildPrArchitectureLayers } from "./pr-architecture-layers.js";
import { normalizeSliceId } from "./architecture-model.js";

const MAX_LAYERS_IN_DIAGRAM = 16;

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildArchitectureDiagramMermaid(microPrs, breakouts, pull, target) {
  const allLayers = buildPrArchitectureLayers(microPrs, breakouts);
  const layers = allLayers.slice(0, MAX_LAYERS_IN_DIAGRAM);
  if (!layers.length) {
    return "flowchart TB\n  empty[No architecture layers in PR]";
  }

  const prLabel = formatPrHubLabel(pull, target);
  const omittedLayers = allLayers.length - layers.length;
  const direction = layers.length >= 2 ? "LR" : "TB";

  const lines = [
    `flowchart ${direction}`,
    "  classDef pr fill:#fafafa,stroke:#171717,stroke-width:2px,color:#0a0a0a",
    "  classDef layer fill:#141414,stroke:#737373,stroke-width:1px,color:#f5f5f5",
    "  classDef more fill:#0a0a0a,stroke:#404040,color:#737373",
    `  pr(("${mermaidLabel(prLabel)}")):::pr`,
  ];

  const idByLayer = new Map();

  for (const layer of layers) {
    const nodeId = `layer_${safeNodeId(layer.id)}`;
    idByLayer.set(layer.id, nodeId);
    const label = formatArchitectureLayerLabel(layer.name, formatSliceTag(layer.micro)).replace(/\n/g, " · ");
    lines.push(`  ${nodeId}["${mermaidLabel(label)}"]:::layer`);
    lines.push(`  pr --> ${nodeId}`);
  }

  if (omittedLayers > 0) {
    lines.push(`  pr_more["+${omittedLayers} more layers"]:::more`);
    lines.push("  pr --> pr_more");
  }

  const deps = new Set();
  for (const layer of layers) {
    const from = idByLayer.get(layer.id);
    for (const dep of layer.dependsOn) {
      const depId = normalizeSliceId(dep);
      const to = idByLayer.get(depId);
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
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_") || "layer";
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