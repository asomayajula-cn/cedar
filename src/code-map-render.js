import { mermaidSafeText } from "./mermaid-sanitize.js";

/** Max nodes emitted from AST / symbol builders (granular code map). */
export const MAX_MAP_NODES = 320;

/**
 * @typedef {{ id: string, label: string, kind: string, scope?: string }} MapNode
 * @typedef {{ from: string, to: string, label?: string, style?: "solid" | "dotted" }} MapEdge
 */

/**
 * @param {MapNode} n
 */
function shape(n) {
  const t = mermaidSafeText(n.label);
  switch (n.kind) {
    case "entry":
      return `${n.id}[[${t}]]`;
    case "import":
    case "table":
    case "external":
      return `${n.id}[(${t})]`;
    case "export":
      return `${n.id}((${t}))`;
    case "call":
      return `${n.id}["${t}"]`;
    default:
      return `${n.id}["${t}"]`;
  }
}

/**
 * @param {{
 *   fileLabel: string,
 *   header: string,
 *   whatItDoes: string,
 *   nodes: MapNode[],
 *   edges: MapEdge[],
 * }} map
 */
export function renderCodeMapMermaid(map) {
  const nodes = capNodes(map.nodes);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = map.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const symbols = nodes.filter((n) => n.kind === "symbol" || n.kind === "definition" || n.kind === "export");
  const calls = nodes.filter((n) => n.kind === "call");
  const external = nodes.filter((n) => n.kind === "import" || n.kind === "table" || n.kind === "external");
  const flow = nodes.filter((n) => n.kind === "step" || n.kind === "entry");
  const other = nodes.filter(
    (n) => !symbols.includes(n) && !calls.includes(n) && !external.includes(n) && !flow.includes(n)
  );

  const lines = ["flowchart TB"];
  lines.push(`  mapRoot[[${mermaidSafeText(map.fileLabel)}]]`);
  lines.push(`  mapHdr["${mermaidSafeText(map.header)}"]`);
  lines.push(`  mapDoes["What it does: ${mermaidSafeText(map.whatItDoes)}"]`);
  lines.push("  mapRoot --> mapHdr");
  lines.push("  mapHdr --> mapDoes");

  let anchor = "mapDoes";

  if (flow.length) {
    lines.push(`  subgraph map_flow ["Execution flow"]`);
    lines.push("    direction TB");
    for (const n of flow) lines.push(`    ${shape(n)}`);
    lines.push("  end");
    lines.push(`  ${anchor} --> ${flow[0].id}`);
    anchor = flow[flow.length - 1].id;
    for (let i = 0; i < flow.length - 1; i++) {
      lines.push(`    ${flow[i].id} --> ${flow[i + 1].id}`);
    }
  }

  if (symbols.length) {
    lines.push(`  subgraph map_sym ["Symbols"]`);
    lines.push("    direction TB");
    for (const n of symbols) lines.push(`    ${shape(n)}`);
    lines.push("  end");
    lines.push(`  ${anchor} --> ${symbols[0].id}`);
    if (!flow.length) anchor = symbols[0].id;
  }

  if (calls.length) {
    const byScope = groupCalls(calls);
    for (const [scope, list] of byScope) {
      const sg = safeId(scope);
      lines.push(`  subgraph ${sg} ["Calls · ${mermaidSafeText(scope)}"]`);
      lines.push("    direction TB");
      for (const c of list) lines.push(`    ${shape(c)}`);
      lines.push("  end");
    }
  }

  if (external.length) {
    lines.push(`  subgraph map_ext ["Dependencies"]`);
    lines.push("    direction TB");
    for (const n of external) lines.push(`    ${shape(n)}`);
    lines.push("  end");
    lines.push(`  ${anchor} --> ${external[0]?.id ?? anchor}`);
  }

  for (const n of other) lines.push(`  ${shape(n)}`);

  const seen = new Set();
  for (const e of edges) {
    const k = `${e.from}|${e.to}|${e.label ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const ar = e.style === "dotted" ? "-.->" : "-->";
    const lbl = e.label ? `|${mermaidSafeText(e.label)}| ` : " ";
    lines.push(`  ${e.from} ${ar}${lbl}${e.to}`);
  }

  return lines.join("\n");
}

/**
 * @param {MapNode[]} calls
 */
function groupCalls(calls) {
  /** @type {Map<string, MapNode[]>} */
  const m = new Map();
  for (const c of calls) {
    const s = c.scope ?? "module";
    m.set(s, [...(m.get(s) ?? []), c]);
  }
  return m;
}

function safeId(s) {
  return `calls_${String(s).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20)}`;
}

/**
 * @param {MapNode[]} nodes
 */
function capNodes(nodes) {
  if (nodes.length <= MAX_MAP_NODES) return nodes;
  const kept = nodes.slice(0, MAX_MAP_NODES - 1);
  kept.push({ id: "map_more", label: "More symbols in full file", kind: "external", scope: "__module__" });
  return kept;
}

/**
 * @param {MapNode[]} nodes
 * @param {MapEdge[]} edges
 * @param {string} [lang]
 */
export function inferWhatItDoes(nodes, edges, lang = "file") {
  const imports = nodes.filter((n) => n.kind === "import").map((n) => n.label);
  const symbols = nodes.filter((n) => n.kind === "symbol" || n.kind === "definition").map((n) => n.label);
  const exports = nodes.filter((n) => n.kind === "export").map((n) => n.label);
  const calls = nodes.filter((n) => n.kind === "call").map((n) => n.label);
  const tables = nodes.filter((n) => n.kind === "table").map((n) => n.label);
  const steps = nodes.filter((n) => n.kind === "step").map((n) => n.label);

  if (lang === "yaml") {
    const defs = nodes.filter((n) => n.kind === "definition" || n.kind === "external").map((n) => n.label);
    const keys = nodes.filter((n) => n.kind === "symbol").map((n) => n.label);
    const top = [...new Set([...defs, ...keys])].slice(0, 4).join(", ");
    return top
      ? `Declares configuration structure (${top}).`
      : "Maps YAML keys and nested sections from the diff.";
  }

  if (lang === "sql" && (steps.length || tables.length)) {
    const tbl = tables.slice(0, 3).join(", ");
    return tbl
      ? `Changes the database for ${tbl}, in statement order.`
      : `Runs ${steps.length} SQL steps against the data model.`;
  }

  if (symbols.length || exports.length) {
    const names = [...new Set([...exports, ...symbols])].slice(0, 4).join(", ");
    const callHint = calls.length ? ` Traces calls like ${calls.slice(0, 3).join(", ")}.` : "";
    const imp = imports.length ? ` Uses ${imports.slice(0, 2).join(", ")}.` : "";
    return `Defines ${names || "symbols"} in this file.${imp}${callHint}`.trim();
  }

  if (calls.length) return `Invokes ${calls.slice(0, 5).join(", ")} from visible code.`;
  if (imports.length) return `Wires in ${imports.slice(0, 4).join(", ")}.`;
  return "Maps structure and calls visible in this diff.";
}