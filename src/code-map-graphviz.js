import { renderGraphvizSvg } from "./diagram-graphviz.js";

/**
 * @param {{
 *   fileLabel: string,
 *   header: string,
 *   whatItDoes: string,
 *   nodes: { id: string, label: string, kind: string, scope?: string }[],
 *   edges: { from: string, to: string, label?: string, style?: string }[],
 * }} map
 */
export function buildCodeMapDot(map) {
  const lines = [
    "digraph cedar_code_map {",
    '  graph [rankdir=TB, bgcolor="#0c0c0e", pad="0.45", nodesep=0.55, ranksep=0.75, splines=spline, overlap=false, fontname="Helvetica", fontsize=10];',
    '  edge [fontname="Helvetica", fontsize=8, color="#a1a1aa"];',
    '  node [fontname="Menlo", fontsize=9, margin="0.12,0.08", shape=box, style="rounded,filled"];',
    `  title [shape=plaintext, label=${dotQuote(map.fileLabel)}, fontcolor="#fafafa", fontsize=11];`,
    `  hdr [label=${dotQuote(map.header)}, fillcolor="#18181b", fontcolor="#a1a1aa", color="#3f3f46"];`,
    `  does [shape=note, label=${dotQuote(`What it does:\\n${map.whatItDoes}`)}, fillcolor="#27272a", fontcolor="#e4e4e7", color="#71717a"];`,
    "  title -> hdr -> does;",
  ];

  const clusters = clusterPlan(map.nodes);
  let linkedFromDoes = false;
  for (const [clusterId, { title, nodeIds }] of clusters) {
    if (!nodeIds.length) continue;
    lines.push(`  subgraph ${clusterId} {`);
    lines.push(
      `    graph [style="rounded,filled", fillcolor="#141416", color="#52525b", fontcolor="#e4e4e7", label=${dotQuote(title)}, fontsize=10, margin=14];`
    );
    for (const id of nodeIds) {
      const n = map.nodes.find((x) => x.id === id);
      if (!n) continue;
      lines.push(`    ${dotSafeId(id)} ${nodeAttrs(n)};`);
    }
    lines.push("  }");
    if (!linkedFromDoes) {
      lines.push(`  does -> ${dotSafeId(nodeIds[0])} [color="#71717a"];`);
      linkedFromDoes = true;
    }
  }

  const clustered = new Set(clusters.flatMap(([, c]) => c.nodeIds));
  const loose = map.nodes.filter((n) => !clustered.has(n.id));
  for (const n of loose) {
    lines.push(`  ${dotSafeId(n.id)} ${nodeAttrs(n)};`);
    lines.push(`  does -> ${dotSafeId(n.id)} [color="#71717a"];`);
  }

  for (const e of map.edges) {
    const style = e.style === "dotted" ? 'style=dashed, color="#38bdf8"' : 'color="#d4d4d8"';
    const lbl = e.label ? `, label=${dotQuote(e.label)}` : "";
    lines.push(`  ${dotSafeId(e.from)} -> ${dotSafeId(e.to)} [${style}${lbl}];`);
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * @param {typeof map.nodes} nodes
 */
function clusterPlan(nodes) {
  const groups = [
    ["cluster_flow", "Execution flow", (n) => n.kind === "step" || n.kind === "entry"],
    ["cluster_sym", "Symbols", (n) => n.kind === "symbol" || n.kind === "definition" || n.kind === "export"],
    ["cluster_calls", "Invocations", (n) => n.kind === "call"],
    ["cluster_ext", "Dependencies", (n) => n.kind === "import" || n.kind === "table" || n.kind === "external"],
  ];
  return groups
    .map(([id, title, pred]) => [id, { title, nodeIds: nodes.filter(pred).map((n) => n.id) }])
    .filter(([, g]) => g.nodeIds.length);
}

/**
 * @param {{ kind: string, label: string }} n
 */
function nodeAttrs(n) {
  const colors = {
    entry: ['fillcolor="#27272a"', 'fontcolor="#fafafa"', 'color="#71717a"'],
    step: ['fillcolor="#1f2937"', 'fontcolor="#f3f4f6"', 'color="#6b7280"'],
    symbol: ['fillcolor="#27272a"', 'fontcolor="#fafafa"', 'color="#71717a"'],
    definition: ['fillcolor="#27272a"', 'fontcolor="#fafafa"', 'color="#71717a"'],
    export: ['fillcolor="#1f2937"', 'fontcolor="#f4f4f5"', 'color="#9ca3af"'],
    call: ['fillcolor="#3f3f46"', 'fontcolor="#fafafa"', 'color="#a1a1aa"', 'shape=ellipse'],
    import: ['fillcolor="#27272a"', 'fontcolor="#e4e4e7"', 'color="#737373"', 'shape=component'],
    table: ['fillcolor="#1f2937"', 'fontcolor="#f4f4f5"', 'color="#9ca3af"', 'shape=cylinder'],
    external: ['fillcolor="#3f3f46"', 'fontcolor="#f4f4f5"', 'color="#a1a1aa"'],
  };
  const style = colors[n.kind] ?? colors.symbol;
  return `[label=${dotQuote(n.label)}, ${style.join(", ")}]`;
}

/**
 * @param {{
 *   fileLabel: string,
 *   header: string,
 *   whatItDoes: string,
 *   nodes: object[],
 *   edges: object[],
 * }} map
 */
export async function renderCodeMapSvg(map) {
  const dot = buildCodeMapDot(map);
  try {
    return await renderGraphvizSvg(dot);
  } catch (err) {
    console.warn("[cedar] code map graphviz failed:", err?.message ?? err);
    return "";
  }
}

function dotQuote(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function dotSafeId(id) {
  return `n_${String(id).replace(/[^a-zA-Z0-9_]/g, "_")}`;
}