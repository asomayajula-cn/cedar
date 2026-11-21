import dagre from "@dagrejs/dagre";

/**
 * Layout with parent→child rank hints so scoped members sit under types.
 *
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {{ rankdir?: string, flowNodeSpacing?: number, flowRankSpacing?: number }} spacing
 */
export function layoutWithDagreScoped(nodes, edges, spacing = {}) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  const rankdir = spacing.rankdir === "LR" ? "LR" : "TB";
  const nodesep = spacing.flowNodeSpacing ?? 52;
  const ranksep = spacing.flowRankSpacing ?? 72;
  const small = nodes.length <= 6;
  g.setGraph({
    rankdir,
    nodesep: small ? nodesep + 12 : nodesep,
    ranksep: small ? ranksep + 24 : ranksep,
    marginx: 32,
    marginy: 32,
    acyclicer: "greedy",
    ranker: "network-simplex",
  });

  for (const node of nodes) {
    const w = Number(node.width) || 150;
    const h = Number(node.height) || 42;
    g.setNode(node.id, { width: w, height: h });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
    const lbl = String(edge.label ?? "").toLowerCase();
    if (lbl === "field" || lbl === "method" || lbl === "member") {
      g.setEdge(edge.source, edge.target, { weight: 2, minlen: 1 });
    }
    if (lbl === "imports" || lbl === "key") {
      g.setEdge(edge.source, edge.target, { weight: 0.6, minlen: 2 });
    }
  }
  dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const pos = g.node(node.id);
      const w = Number(node.width) || 150;
      const h = Number(node.height) || 42;
      return {
        ...node,
        position: { x: pos.x - w / 2, y: pos.y - h / 2 },
      };
    }),
    edges,
  };
}