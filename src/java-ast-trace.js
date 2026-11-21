import { collectReadablePatchText } from "./file-flow-semantic.js";
import { renderAstTraceMermaid, traceOutcome, MAX_CALLS_PER_SCOPE } from "./ast-trace-mermaid.js";

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildJavaAstTraceMermaid(path, patch) {
  const meta = collectReadablePatchText(patch);
  const title = shortName(path);
  const graph = extractJavaTrace(meta.text);
  const header = [
    `${graph.nodes.length} AST nodes`,
    `${graph.edges.length} links`,
    meta.added ? `+${meta.added} lines` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return renderAstTraceMermaid({
    title,
    header,
    nodes: graph.nodes,
    edges: graph.edges,
    outcome: traceOutcome(graph.nodes, graph.edges),
  });
}

/**
 * @param {string} text
 */
function extractJavaTrace(text) {
  /** @type {import("./ast-trace-mermaid.js").TraceNode[]} */
  const nodes = [];
  /** @type {import("./ast-trace-mermaid.js").TraceEdge[]} */
  const edges = [];
  let uid = 0;
  const unitId = `unit_${uid++}`;
  nodes.push({ id: unitId, label: "Compilation unit", kind: "definition", scope: "__module__" });

  let currentClass = null;
  let currentClassId = unitId;
  let currentMethod = null;
  let currentMethodId = unitId;
  let pendingMapping = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;

    const mapping = line.match(/@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(([^)]*)\)/i);
    if (mapping) {
      pendingMapping = { method: mapping[1].toUpperCase(), path: extractPath(mapping[2]) };
      continue;
    }

    if (/^import\s+/.test(line)) {
      const id = `imp_${uid++}`;
      const pkg = line.replace(/^import\s+(static\s+)?/, "").replace(/;$/, "");
      nodes.push({ id, label: `import ${lastSeg(pkg)}`, kind: "import", scope: "__module__" });
      edges.push({ from: unitId, to: id, label: "depends", style: "dotted" });
      continue;
    }

    const classM = line.match(/^(?:public\s+)?(?:class|interface|enum|record)\s+(\w+)/);
    if (classM) {
      currentClass = classM[1];
      currentClassId = `cls_${uid++}`;
      nodes.push({ id: currentClassId, label: `type ${currentClass}`, kind: "definition", scope: "__module__" });
      edges.push({ from: unitId, to: currentClassId, label: "defines" });
      currentMethod = null;
      currentMethodId = currentClassId;
      if (/@RestController|@Controller/.test(line)) {
        const aid = `ann_${uid++}`;
        nodes.push({ id: aid, label: "HTTP controller", kind: "export", scope: currentClass });
        edges.push({ from: currentClassId, to: aid, label: "role" });
      }
      continue;
    }

    const methodM = line.match(/^(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\],\s]+\s+(\w+)\s*\(/);
    if (methodM && methodM[1] !== "class") {
      currentMethod = methodM[1];
      currentMethodId = `m_${uid++}`;
      const head = pendingMapping
        ? `${pendingMapping.method} ${pendingMapping.path} → ${currentMethod}`
        : `method ${currentMethod}`;
      nodes.push({
        id: currentMethodId,
        label: head,
        kind: "definition",
        scope: currentClass ?? "__module__",
      });
      edges.push({ from: currentClassId, to: currentMethodId, label: "contains" });
      pendingMapping = null;
      continue;
    }

    if (currentMethodId) traceJavaCallsOnLine(line, currentMethod, currentMethodId, nodes, edges, () => `call_${uid++}`);
  }

  return { nodes, edges };
}

/**
 * @param {string} line
 * @param {string} methodScope
 * @param {string} methodId
 */
function traceJavaCallsOnLine(line, methodScope, methodId, nodes, edges, nextId) {
  let n = nodes.filter((x) => x.scope === methodScope && x.kind === "call").length;
  const patterns = [
    /(\w+)\.(\w+)\s*\(/g,
    /new\s+(\w+)\s*\(/g,
    /(\w+)\s*\(/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(line)) !== null && n < MAX_CALLS_PER_SCOPE) {
      const label =
        m[0].startsWith("new ") ? `new ${m[1]}` : m[2] ? `${m[1]}.${m[2]}()` : `${m[1]}()`;
      if (/^(if|for|while|switch|catch|return)$/.test(m[1])) continue;
      const id = nextId();
      nodes.push({ id, label: label.slice(0, 72), kind: "call", scope: methodScope });
      edges.push({ from: methodId, to: id, label: "calls", style: "dotted" });
      n += 1;
    }
  }
}

function extractPath(raw) {
  const q = raw.match(/["']([^"']+)["']/);
  return q ? q[1] : "/";
}

function lastSeg(pkg) {
  const p = pkg.split(".");
  return p[p.length - 1] || pkg;
}

function shortName(path) {
  const p = path.split("/");
  return p.length > 2 ? `…/${p.slice(-2).join("/")}` : path;
}