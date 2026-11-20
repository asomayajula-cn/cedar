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
 * @param {{ types?: string[], name: string }} layer
 * @param {number} [maxClasses]
 */
export function primaryClassNames(layer, maxClasses = 4) {
  return (layer.types ?? []).filter(Boolean).slice(0, maxClasses);
}

/**
 * Headline = changed class/type names when present; subline = layer + slice tag.
 * @param {{ types?: string[], name: string, micro: import('./partition.js').MicroPr }} layer
 * @param {number} [maxClasses]
 */
export function formatClassArchitectureLabel(layer, maxClasses = 3) {
  const names = primaryClassNames(layer, maxClasses);
  const headline = names.length ? names.join(", ") : layer.name;
  const sub = names.length ? `${layer.name} · ${formatSliceTag(layer.micro)}` : formatSliceTag(layer.micro);
  return formatArchitectureLayerLabel(headline, sub);
}

/**
 * Single-line flow / flowchart node label (Mermaid-safe stats).
 * @param {{ types?: string[], name: string, micro: import('./partition.js').MicroPr }} layer
 */
export function mermaidFlowNodeLabel(layer) {
  const names = primaryClassNames(layer, 3);
  const headline = names.length ? names.join(", ") : layer.name;
  return `${headline} · ${layer.name} · ${formatSliceTagMermaid(layer.micro)}`;
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