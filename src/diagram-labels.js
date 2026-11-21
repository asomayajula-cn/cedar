import {
  formatSourceClassDiagramLabel,
  formatSourceClassFlowLabel,
} from "./architecture-source-symbols.js";

/**
 * Review-slice tag line for architecture-first diagrams.
 * @param {import('./partition.js').MicroPr} micro
 */
export function formatSliceTag(micro) {
  const files = micro.files?.length ?? micro.fileCount ?? 0;
  const add = micro.additions ?? 0;
  const del = micro.deletions ?? 0;
  const id = String(micro.componentId ?? "slice").trim();
  return `slice ${id} · ${files} file${files === 1 ? "" : "s"} · +${add} −${del}`;
}

/**
 * Slice tag safe for Mermaid (no leading +/− — those break classDiagram members).
 * @param {import('./partition.js').MicroPr} micro
 */
export function formatSliceTagMermaid(micro) {
  const files = micro.files?.length ?? micro.fileCount ?? 0;
  const add = micro.additions ?? 0;
  const del = micro.deletions ?? 0;
  const id = String(micro.componentId ?? "slice").trim();
  return `slice ${id} · ${files} file${files === 1 ? "" : "s"} · ${add} added · ${del} removed`;
}

/**
 * Cytoscape / overview node — types & classes from source (not partition slice tags).
 * @param {{ name: string, classNames?: string[], micro: import('./partition.js').MicroPr }} layer
 */
export function formatClassArchitectureLabel(layer) {
  return formatSourceClassDiagramLabel(layer);
}

/**
 * Flow / flowchart node label — primary types from changed source.
 * @param {{ name: string, classNames?: string[], micro: import('./partition.js').MicroPr }} layer
 */
export function mermaidFlowNodeLabel(layer) {
  return formatSourceClassFlowLabel(layer);
}

/**
 * Architecture layer title with optional review-slice tag (second line).
 * @param {string} layerName
 * @param {string} [sliceTag]
 */
export function formatArchitectureLayerLabel(layerName, sliceTag) {
  const title = String(layerName ?? "Layer").trim().slice(0, 48);
  if (!sliceTag?.trim()) return title;
  return `${title}\n${String(sliceTag).trim().slice(0, 56)}`;
}

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