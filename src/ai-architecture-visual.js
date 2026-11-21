import { aiChat, parseJsonFromModel } from "./ai-chat.js";
import { resolveAiModel } from "./default-model.js";
import { clampDiagramLabel } from "./diagram-labels.js";
import { ARCHITECTURE_MODEL_LABEL } from "./architecture-model.js";
import { useSplitDiagramCall } from "./diagram-visual-mode.js";

/**
 * @param {unknown} baseGraph
 * @param {import('./partition.js').MicroPr[]} microPrs
 * @param {{ architectureSummary?: string, components?: object[] } | null | undefined} breakouts
 * @param {{ title?: string, number?: number }} pull
 */
/**
 * @param {object} baseGraph
 * @param {Record<string, unknown> | null | undefined} diagramPlan from combined breakout call
 */
export function applyDiagramVisualFromPlan(baseGraph, diagramPlan) {
  if (!diagramPlan || typeof diagramPlan !== "object") {
    return {
      graph: baseGraph,
      visual: null,
      source: "heuristic",
    };
  }
  const plan = normalizeDiagramPlan(diagramPlan, baseGraph);
  return {
    graph: applyVisualPlan(baseGraph, plan),
    visual: {
      summary: String(plan.visual_summary ?? "").trim(),
      layout: plan.layout === "LR" ? "LR" : "TB",
      conceptualNotes: Array.isArray(plan.conceptual_notes)
        ? plan.conceptual_notes.map(String).slice(0, 6)
        : [],
      model: resolveAiModel(),
    },
    source: "cursor",
  };
}

export async function resolveArchitectureVisual(baseGraph, microPrs, breakouts, pull) {
  if (breakouts?.diagramVisual) {
    return applyDiagramVisualFromPlan(baseGraph, breakouts.diagramVisual);
  }

  const useAi = useSplitDiagramCall();

  if (!useAi) {
    return {
      graph: baseGraph,
      visual: null,
      source: "heuristic",
    };
  }

  const system = `You determine how a pull request architecture diagram should look in a review UI (Cytoscape + Dagre).

Context: ${ARCHITECTURE_MODEL_LABEL} — layer boundaries and 12-factor config/deploy surfaces.

Return JSON only:
{
  "visual_summary": "1-2 sentence read of how this PR should be understood visually",
  "layout": "TB" | "LR",
  "node_labels": { "<existing node id>": "multiline label" },
  "highlight_node_ids": ["ids to emphasize"],
  "layer_order": ["component ids bottom-to-top for review order"],
  "conceptual_notes": ["short bullets for reviewers, not extra graph nodes"]
}

Rules:
- Only relabel nodes whose ids already exist in the input graph (pr, slice_*, file nodes).
- Do not add new node ids; edges are already derived from the partition.
- Prefer labels that name concrete types and classes from the changed source (e.g. UserService, OrderDto), not virtual slice or partition ids.
- layout LR for wide multi-slice PRs; TB for vertical stack stories.`;

  const user = JSON.stringify({
    pr: { title: pull.title, number: pull.number },
    architecture_summary: breakouts?.architectureSummary,
    components: breakouts?.components,
    graph_overview: baseGraph.overview,
    slices: microPrs
      .filter((m) => m.files.length)
      .map((m) => ({
        componentId: m.componentId,
        componentName: m.componentName,
        dependsOn: m.dependsOn,
        files: m.files.slice(0, 10).map((f) => f.filename),
      })),
  });

  try {
    const raw = await aiChat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      json: true,
      maxTokens: 3500,
    });

    const plan = parseJsonFromModel(raw);
    return {
      graph: applyVisualPlan(baseGraph, plan),
      visual: {
        summary: String(plan.visual_summary ?? "").trim(),
        layout: plan.layout === "LR" ? "LR" : "TB",
        conceptualNotes: Array.isArray(plan.conceptual_notes)
          ? plan.conceptual_notes.map(String).slice(0, 6)
          : [],
        model: resolveAiModel(),
      },
      source: "cursor",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      graph: {
        ...baseGraph,
        meta: {
          ...baseGraph.meta,
          visualSource: "heuristic",
          visualError: message.slice(0, 200),
        },
      },
      visual: null,
      source: "heuristic",
    };
  }
}

/**
 * @param {Record<string, unknown>} diagramPlan
 * @param {object} baseGraph
 */
function normalizeDiagramPlan(diagramPlan, baseGraph) {
  const labels = { ...(diagramPlan.node_labels ?? {}) };
  const sliceLabels = diagramPlan.slice_labels ?? diagramPlan.component_labels;
  if (sliceLabels && typeof sliceLabels === "object") {
    for (const [compId, label] of Object.entries(sliceLabels)) {
      const slug = String(compId)
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 48) || "slice";
      const nodeId = `slice_${slug}`;
      if (baseGraph.overview?.nodes?.some((n) => n.id === nodeId)) {
        labels[nodeId] = String(label);
      }
    }
  }
  return { ...diagramPlan, node_labels: labels };
}

/**
 * @param {object} baseGraph
 * @param {Record<string, unknown>} plan
 */
export function applyVisualPlan(baseGraph, plan) {
  const graph = structuredClone(baseGraph);
  const labels = /** @type {Record<string, string>} */ (plan.node_labels ?? {});
  const highlights = new Set(
    Array.isArray(plan.highlight_node_ids) ? plan.highlight_node_ids.map(String) : []
  );

  graph.meta = {
    ...graph.meta,
    visualSource: "cursor",
    visualSummary: String(plan.visual_summary ?? "").trim(),
    layout: plan.layout === "LR" ? "LR" : "TB",
    highlightNodeIds: [...highlights],
    layerOrder: Array.isArray(plan.layer_order)
      ? plan.layer_order.map(String)
      : [],
    conceptualNotes: Array.isArray(plan.conceptual_notes)
      ? plan.conceptual_notes.map(String).slice(0, 6)
      : [],
  };

  for (const part of [graph.overview, graph.detail]) {
    if (!part?.nodes) continue;
    for (const node of part.nodes) {
      if (labels[node.id]) node.label = clampDiagramLabel(labels[node.id]);
      if (highlights.has(node.id)) node.highlight = true;
    }
  }

  return graph;
}