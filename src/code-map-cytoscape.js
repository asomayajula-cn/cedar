/**
 * Cytoscape elements for interactive code map (client fcose / dagre layout).
 * @param {{
 *   fileLabel: string,
 *   whatItDoes: string,
 *   nodes: { id: string, label: string, kind: string }[],
 *   edges: { from: string, to: string, label?: string, style?: string }[],
 * }} map
 */
/**
 * @param {string} label
 * @param {string} kind
 */
function estimateNodeSize(label, kind) {
  const text = String(label ?? "");
  const cols = kind === "call" ? 18 : kind === "entry" ? 26 : 22;
  const charW = kind === "entry" ? 7 : kind === "call" ? 5.6 : 6.2;
  const lineH = kind === "entry" ? 18 : kind === "call" ? 14 : 16;
  const padX = kind === "entry" ? 28 : kind === "call" ? 16 : 20;
  const padY = kind === "entry" ? 18 : kind === "call" ? 12 : 16;
  const lines = Math.max(1, Math.ceil(text.length / cols));
  const w = Math.min(320, Math.max(52, Math.ceil(Math.min(text.length, cols) * charW) + padX));
  const h = Math.min(120, Math.max(26, lines * lineH + padY));
  return { w, h };
}

function nodeDisplayLabel(n) {
  const label = String(n.label ?? "").trim();
  const scope = String(n.scope ?? "").trim();
  if (!scope || scope.startsWith("__")) return label;
  if (label.toLowerCase().includes(scope.toLowerCase())) return label;
  if (n.kind === "symbol" || n.kind === "definition" || n.kind === "call" || n.kind === "method") {
    return `${label}\n· ${scope}`;
  }
  return label;
}

export function codeMapToCytoscapeElements(map) {
  const nodes = (map.nodes ?? []).map((n) => {
    const display = nodeDisplayLabel(n);
    const { w, h } = estimateNodeSize(display, n.kind);
    return {
      data: {
        id: n.id,
        label: display,
        kind: n.kind,
        scope: n.scope ?? "",
        width: w,
        height: h,
      },
    };
  });
  const edges = (map.edges ?? []).map((e, i) => ({
    data: {
      id: `e_${i}_${e.from}_${e.to}`,
      source: e.from,
      target: e.to,
      label: e.label ?? "",
      lineStyle: e.style === "dotted" ? "dashed" : "solid",
    },
  }));
  return [...nodes, ...edges];
}