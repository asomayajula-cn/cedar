/**
 * Canonical graph JSON for interactive diagrams (PR architecture nodes, slice-tagged labels).
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import { ARCHITECTURE_MODEL_LABEL, normalizeSliceId } from "./architecture-model.js";
import { formatClassArchitectureLabel, formatPrHubLabel } from "./diagram-labels.js";
import { buildPrArchitectureLayers } from "./pr-architecture-layers.js";

const MAX_LAYERS = 24;

/**
 * @param {unknown} graph
 */
export function isRenderableDiagramGraph(graph) {
  return Boolean(
    graph &&
      typeof graph === "object" &&
      graph.overview &&
      Array.isArray(graph.overview.nodes) &&
      graph.overview.nodes.length > 0
  );
}

/**
 * @typedef {{ id: string, label: string, type: 'pr'|'slice'|'file', parent?: string, layerId?: string }} DiagramNode
 * @typedef {{ id: string, source: string, target: string, kind: 'contains'|'depends' }} DiagramEdge
 */

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ number?: number, title?: string }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildDiagramGraph(microPrs, breakouts, pull, target) {
  const allLayers = buildPrArchitectureLayers(microPrs, breakouts);
  const layers = allLayers.slice(0, MAX_LAYERS);
  const prLabel = formatPrHubLabel(pull, target);
  const prSubtitle =
    target?.owner && target?.repo && pull?.number
      ? `${target.owner}/${target.repo}`
      : pull?.title?.trim()
        ? String(pull.title).slice(0, 64)
        : "";
  const prNodeLabel = prSubtitle ? `${prLabel}\n${prSubtitle}` : prLabel;

  /** @type {DiagramNode[]} */
  const overviewNodes = [{ id: "pr", label: prNodeLabel, type: "pr" }];
  /** @type {DiagramEdge[]} */
  const overviewEdges = [];

  /** @type {DiagramNode[]} */
  const detailNodes = [{ id: "pr", label: prNodeLabel, type: "pr" }];
  /** @type {DiagramEdge[]} */
  const detailEdges = [];

  for (const layer of layers) {
    const sliceId = `slice_${safeId(layer.id)}`;
    const sliceLabel = formatClassArchitectureLabel(layer);

    overviewNodes.push({ id: sliceId, label: sliceLabel, type: "slice", layerId: layer.id });
    overviewEdges.push({
      id: `e_pr_${sliceId}`,
      source: "pr",
      target: sliceId,
      kind: "contains",
    });

    detailNodes.push({ id: sliceId, label: sliceLabel, type: "slice", layerId: layer.id });
    detailEdges.push({
      id: `e_pr_${sliceId}`,
      source: "pr",
      target: sliceId,
      kind: "contains",
    });
  }

  const deps = new Set();
  for (const layer of layers) {
    const from = `slice_${safeId(layer.id)}`;
    for (const dep of layer.dependsOn) {
      const to = `slice_${safeId(normalizeSliceId(dep))}`;
      if (!overviewNodes.some((n) => n.id === to)) continue;
      const key = `${to}->${from}`;
      if (!deps.has(key)) {
        deps.add(key);
        overviewEdges.push({
          id: `dep_${to}_${from}`,
          source: to,
          target: from,
          kind: "depends",
        });
        detailEdges.push({
          id: `dep_${to}_${from}`,
          source: to,
          target: from,
          kind: "depends",
        });
      }
    }
  }

  if (allLayers.length > layers.length) {
    const moreId = "slices_omitted";
    const n = allLayers.length - layers.length;
    overviewNodes.push({ id: moreId, label: `+${n} more layers`, type: "slice" });
    overviewEdges.push({ id: "e_pr_omitted", source: "pr", target: moreId, kind: "contains" });
    detailNodes.push({ id: moreId, label: `+${n} more layers`, type: "slice" });
    detailEdges.push({ id: "e_pr_omitted", source: "pr", target: moreId, kind: "contains" });
  }

  const sliceNodes = overviewNodes.filter((n) => n.type === "slice" && n.id !== "slices_omitted");
  const layout = sliceNodes.length >= 3 ? "LR" : sliceNodes.length === 2 ? "LR" : "TB";

  return {
    meta: {
      prLabel,
      sliceCount: allLayers.length,
      slicesShown: layers.length,
      architectureModel: ARCHITECTURE_MODEL_LABEL,
      layout,
      version: 5,
    },
    overview: { nodes: overviewNodes, edges: overviewEdges },
    detail: { nodes: detailNodes, edges: detailEdges },
  };
}

/**
 * @param {string} id
 */
function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_") || "slice";
}