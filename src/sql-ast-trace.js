import { collectSqlPatchText, migrationMetaFromPath, splitSqlStatementsOrdered } from "./file-flow-sql.js";
import { astToWorkflowStep, sqlDialectForPath, tryParseStatementAst } from "./sql-ast-workflow.js";
import { renderAstTraceMermaid, traceOutcome } from "./ast-trace-mermaid.js";

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildSqlAstTraceMermaid(path, patch) {
  const { text, lineCount, scope } = collectSqlPatchText(patch);
  const meta = migrationMetaFromPath(path);
  const role = meta.version
    ? `SQL AST: ${meta.label.replace(/__/g, " · ")}`
    : "SQL AST trace";

  if (!text.trim()) {
    return renderAstTraceMermaid({
      title: role,
      header: "No SQL in diff",
      nodes: [],
      edges: [],
    });
  }

  const dialect = sqlDialectForPath(path);
  const graph = buildSqlDependencyGraph(splitSqlStatementsOrdered(text), dialect);
  const header = [
    meta.tool,
    `${graph.nodes.length} objects`,
    `${graph.edges.length} dependencies`,
    lineCount ? `${lineCount} diff lines` : null,
    scope,
  ]
    .filter(Boolean)
    .join(" · ");

  return renderAstTraceMermaid({
    title: role,
    header,
    nodes: graph.nodes,
    edges: graph.edges,
    outcome: traceOutcome(graph.nodes, graph.edges),
  });
}

/**
 * @param {string[]} statements
 * @param {string} dialect
 */
function buildSqlDependencyGraph(statements, dialect) {
  /** @type {import("./ast-trace-mermaid.js").TraceNode[]} */
  const nodes = [];
  /** @type {import("./ast-trace-mermaid.js").TraceEdge[]} */
  const edges = [];
  const tableIds = new Map();
  let uid = 0;
  const tid = (table) => {
    const key = shortTable(table);
    if (!key) return null;
    if (!tableIds.has(key)) {
      const id = `tbl_${uid++}`;
      tableIds.set(key, id);
      nodes.push({ id, label: `table ${key}`, kind: "table", scope: "__module__" });
    }
    return tableIds.get(key);
  };

  const flowId = `flow_${uid++}`;
  nodes.push({ id: flowId, label: "Execution order", kind: "definition", scope: "__module__" });
  let prev = flowId;

  for (const stmt of statements) {
    const t = stmt.trim();
    if (!t) continue;
    const stepId = `stmt_${uid++}`;
    const ast = tryParseStatementAst(t, dialect);
    const step = ast ? astToWorkflowStep(ast) : null;
    const label = step?.label ?? t.replace(/\s+/g, " ").slice(0, 80);
    nodes.push({ id: stepId, label, kind: "definition", scope: "__module__" });
    edges.push({ from: prev, to: stepId, label: "then" });
    prev = stepId;

    for (const table of step?.tables ?? []) {
      const id = tid(table);
      if (id) edges.push({ from: stepId, to: id, label: opLabel(step?.phase), style: "dotted" });
    }
    for (const ref of step?.refs ?? []) {
      const id = tid(ref);
      if (id) edges.push({ from: stepId, to: id, label: "references", style: "dotted" });
    }
  }

  return { nodes, edges };
}

/**
 * @param {string | undefined} phase
 */
function opLabel(phase) {
  if (phase === "ddl_create") return "creates";
  if (phase === "ddl_alter" || phase === "constraint") return "alters";
  if (phase?.startsWith("dml_insert")) return "writes";
  if (phase?.startsWith("dml")) return "mutates";
  if (phase === "index") return "indexes";
  return "touches";
}

function shortTable(name) {
  const n = String(name ?? "").replace(/["'`]/g, "");
  const parts = n.split(".");
  return parts.length ? parts[parts.length - 1] : n;
}