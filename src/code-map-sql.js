import { collectSqlPatchText, migrationMetaFromPath, splitSqlStatementsOrdered } from "./file-flow-sql.js";
import { astToWorkflowStep, sqlDialectForPath, tryParseStatementAst } from "./sql-ast-workflow.js";
import { inferWhatItDoes } from "./code-map-render.js";

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildSqlCodeMap(path, patch) {
  const { text, lineCount, scope } = collectSqlPatchText(patch);
  const meta = migrationMetaFromPath(path);
  /** @type {import("./code-map-render.js").MapNode[]} */
  const nodes = [];
  /** @type {import("./code-map-render.js").MapEdge[]} */
  const edges = [];
  let uid = 0;

  const entryId = `entry_${uid++}`;
  nodes.push({ id: entryId, label: meta.version ? meta.label.replace(/__/g, " · ") : "SQL script", kind: "entry" });

  if (!text.trim()) {
    return {
      header: "No SQL in diff",
      whatItDoes: "No database operations in visible patch",
      nodes,
      edges,
    };
  }

  const dialect = sqlDialectForPath(path);
  const tableIds = new Map();
  let prev = entryId;

  for (const stmt of splitSqlStatementsOrdered(text)) {
    const t = stmt.trim();
    if (!t) continue;
    const ast = tryParseStatementAst(t, dialect);
    const step = ast ? astToWorkflowStep(ast) : null;
    const stepId = `step_${uid++}`;
    nodes.push({ id: stepId, label: step?.label ?? t.slice(0, 72), kind: "step", scope: "__sql__" });
    edges.push({ from: prev, to: stepId, label: "then" });
    prev = stepId;

    for (const table of step?.tables ?? []) {
      const key = shortTable(table);
      if (!key) continue;
      if (!tableIds.has(key)) {
        const id = `tbl_${uid++}`;
        tableIds.set(key, id);
        nodes.push({ id, label: `table ${key}`, kind: "table" });
        edges.push({ from: entryId, to: id, label: "touches", style: "dotted" });
      }
      edges.push({ from: stepId, to: tableIds.get(key), label: opVerb(step?.phase), style: "dotted" });
    }
    for (const ref of step?.refs ?? []) {
      const key = shortTable(ref);
      if (!key || !tableIds.has(key)) {
        const id = `tbl_${uid++}`;
        tableIds.set(key, id);
        nodes.push({ id, label: `table ${key}`, kind: "table" });
      }
      edges.push({ from: stepId, to: tableIds.get(key), label: "references", style: "dotted" });
    }
  }

  const header = [meta.tool, `${nodes.length - 1} steps`, lineCount ? `${lineCount} lines` : null, scope]
    .filter(Boolean)
    .join(" · ");
  const whatItDoes = inferWhatItDoes(nodes, edges, "sql");

  return { header, whatItDoes, nodes, edges };
}

function opVerb(phase) {
  if (phase === "ddl_create") return "creates";
  if (phase === "ddl_alter" || phase === "constraint") return "alters";
  if (phase?.includes("insert")) return "writes";
  if (phase?.includes("dml")) return "mutates";
  if (phase === "index") return "indexes";
  return "affects";
}

function shortTable(name) {
  const n = String(name ?? "").replace(/["'`]/g, "");
  const p = n.split(".");
  return p.length ? p[p.length - 1] : n;
}