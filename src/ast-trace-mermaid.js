import { mermaidSafeText } from "./mermaid-sanitize.js";

export const MAX_TRACE_NODES = 48;
export const MAX_CALLS_PER_SCOPE = 14;

/**
 * @typedef {{ id: string, label: string, kind: string, scope?: string }} TraceNode
 * @typedef {{ from: string, to: string, label?: string, style?: "solid" | "dotted" }} TraceEdge
 */

/**
 * @param {TraceNode} n
 */
function nodeShape(n) {
  const text = mermaidSafeText(n.label);
  if (n.kind === "import" || n.kind === "export") return `${n.id}(["${text}"])`;
  if (n.kind === "table") return `${n.id}[("${text}")]`;
  if (n.kind === "call") return `${n.id}["${text}"]`;
  return `${n.id}["${text}"]`;
}

/**
 * @param {{
 *   title: string,
 *   header: string,
 *   nodes: TraceNode[],
 *   edges: TraceEdge[],
 *   outcome?: string,
 * }} graph
 */
export function renderAstTraceMermaid(graph) {
  const { nodes, edges } = capGraph(graph.nodes, graph.edges);
  const lines = ["flowchart TB"];
  lines.push(`  root([${mermaidSafeText(graph.title)}])`);
  lines.push(`  hdr["${mermaidSafeText(graph.header)}"]`);
  lines.push("  start --> hdr");
  lines.push(`  start([${mermaidSafeText(graph.title)}])`);

  const callsByScope = new Map();
  const structNodes = [];

  for (const n of nodes) {
    if (n.kind === "call") {
      const s = safeId(n.scope ?? "calls");
      if (!callsByScope.has(s)) callsByScope.set(s, { title: n.scope ?? "calls", nodes: [] });
      callsByScope.get(s).nodes.push(n);
    } else {
      structNodes.push(n);
    }
  }

  for (const n of structNodes) {
    lines.push(`  ${nodeShape(n)}`);
  }

  for (const [sgId, { title, nodes: callNodes }] of callsByScope) {
    if (!callNodes.length) continue;
    lines.push(`  subgraph ${sgId} ["Calls in ${mermaidSafeText(title)}"]`);
    lines.push("    direction TB");
    for (const c of callNodes) {
      lines.push(`    ${nodeShape(c)}`);
    }
    lines.push("  end");
  }

  const seen = new Set();
  for (const e of edges) {
    const key = `${e.from}|${e.to}|${e.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const arrow = e.style === "dotted" ? "-.->" : "-->";
    const lbl = e.label ? `|${mermaidSafeText(e.label)}| ` : " ";
    lines.push(`  ${e.from} ${arrow}${lbl}${e.to}`);
  }

  const tail =
    structNodes.find((n) => n.kind === "definition" && n.scope === "__module__" && !n.label.includes("order")) ??
    structNodes[structNodes.length - 1];
  const prev = tail?.id ?? "hdr";
  lines.push(`  done(["Trace summary"])`);
  lines.push(`  purpose["${mermaidSafeText(graph.outcome ?? "AST links show definitions, calls, and data dependencies")}"]`);
  lines.push(`  hdr --> ${structNodes[0]?.id ?? "done"}`);
  lines.push(`  ${prev} --> done`);
  lines.push("  done --> purpose");
  return lines.join("\n");
}

/**
 * @param {string} s
 */
function safeId(s) {
  return `sg_${String(s).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 24)}`;
}

/**
 * @param {TraceNode[]} nodes
 * @param {TraceEdge[]} edges
 */
function capGraph(nodes, edges) {
  if (nodes.length <= MAX_TRACE_NODES) return { nodes, edges };
  const kept = nodes.slice(0, MAX_TRACE_NODES - 1);
  kept.push({ id: "more", label: "Truncated AST — open file for full tree", kind: "other", scope: "__module__" });
  const ids = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

/**
 * @param {TraceNode[]} nodes
 * @param {TraceEdge[]} edges
 */
export function traceOutcome(nodes, edges) {
  const defs = nodes.filter((n) => n.kind === "definition").length;
  const calls = nodes.filter((n) => n.kind === "call").length;
  const tables = nodes.filter((n) => n.kind === "table").length;
  const parts = [];
  if (defs) parts.push(`${defs} definitions in order`);
  if (calls) parts.push(`${calls} traced invocations`);
  if (tables) parts.push(`${tables} tables linked`);
  if (edges.length) parts.push(`${edges.length} dependency edges`);
  return parts.length ? parts.join(". ") : "AST trace from visible diff";
}