import { collectSqlPatchText, migrationMetaFromPath, splitSqlStatementsOrdered } from "./file-flow-sql.js";
import { astToWorkflowStep, sqlDialectForPath, tryParseStatementAst } from "./sql-ast-workflow.js";
import { capFunctionalSteps, normalizeLanePhase, outcomeFromSteps, renderFunctionalWorkflowMermaid } from "./functional-flow-render.js";

/**
 * @param {string} path
 * @param {string} patch
 * @returns {import("./functional-flow-render.js").FunctionalStep[]}
 */
export function collectSqlFunctionalSteps(path, patch) {
  const { text } = collectSqlPatchText(patch);
  if (!text.trim()) return [];
  const dialect = sqlDialectForPath(path);
  const micro = collectSqlMicroSteps(splitSqlStatementsOrdered(text), dialect);
  return capFunctionalSteps(micro.map((m) => microToFunctionalStep(m)));
}

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildSqlFunctionalWorkflowMermaid(path, patch) {
  const { text, lineCount, scope } = collectSqlPatchText(patch);
  const meta = migrationMetaFromPath(path);
  const role =
    /migrations?\/|db\/migration|flyway|liquibase|V\d+__/i.test(path)
      ? "Database migration"
      : /seed|fixture/i.test(path)
        ? "Data seed script"
        : "SQL script";

  if (!text.trim()) {
    return renderFunctionalWorkflowMermaid({
      title: role,
      header: "No SQL in diff",
      steps: [],
      outcome: "No executable SQL visible in patch",
    });
  }

  const dialect = sqlDialectForPath(path);
  const statements = splitSqlStatementsOrdered(text);
  const micro = collectSqlMicroSteps(statements, dialect);
  const steps = micro.map((m) => microToFunctionalStep(m));
  const astCount = micro.filter((m) => m.ast).length;

  const title = meta.version ? `${role}: ${meta.label.replace(/__/g, " · ")}` : role;
  const header = [
    meta.tool,
    `${steps.length} workflow steps`,
    astCount ? `${astCount} parsed` : null,
    lineCount ? `${lineCount} diff lines` : null,
    scope,
  ]
    .filter(Boolean)
    .join(" · ");

  return renderFunctionalWorkflowMermaid({
    title,
    header,
    steps,
    outcome: outcomeFromSteps(steps) || summarizeSqlOutcome(micro),
  });
}

/**
 * @param {string[]} statements
 * @param {string} dialect
 */
function collectSqlMicroSteps(statements, dialect) {
  /** @type {object[]} */
  const micro = [];
  for (const stmt of statements) {
    const t = stmt.trim();
    if (!t) continue;
    const u = t.toUpperCase();
    if (/^BEGIN/i.test(t) || /^START\s+TRANSACTION/i.test(u)) {
      micro.push({ phase: "transaction", label: "BEGIN", tables: [], ast: false });
      continue;
    }
    if (/^COMMIT$/i.test(t) || /^ROLLBACK$/i.test(t)) {
      micro.push({ phase: "finalize", label: t.toUpperCase(), tables: [], ast: false });
      continue;
    }
    const ast = tryParseStatementAst(t, dialect);
    if (ast) {
      const step = astToWorkflowStep(ast);
      if (step) {
        micro.push({
          phase: step.phase,
          label: step.label,
          tables: step.tables ?? [],
          refs: step.refs ?? [],
          ast: true,
        });
        continue;
      }
    }
    micro.push({ phase: "other", label: t.replace(/\s+/g, " ").slice(0, 72), tables: [], ast: false });
  }
  return micro;
}

/**
 * @param {object} m
 * @returns {import("./functional-flow-render.js").FunctionalStep}
 */
function microToFunctionalStep(m) {
  return {
    phase: normalizeLanePhase(m.phase),
    headline: m.label,
    functional: sqlFunctionalMeaning(m),
  };
}

/**
 * @param {object} m
 */
function sqlFunctionalMeaning(m) {
  const table = m.tables?.[0] ? shortTable(m.tables[0]) : "";
  const refs = (m.refs ?? []).map(shortTable).filter(Boolean);

  switch (m.phase) {
    case "transaction":
      return m.label === "BEGIN"
        ? "Open a transaction so later DDL/DML succeeds or fails together"
        : "Close the transaction boundary";
    case "ddl_create":
      return table
        ? `Create storage for ${table} and define columns/constraints in this migration`
        : "Add a new database object";
    case "ddl_alter":
      return table
        ? `Change ${table} shape for application code that reads/writes this entity`
        : "Modify an existing table or column definition";
    case "constraint":
      return refs.length
        ? `Enforce relationship between ${table || "child"} and ${refs.join(", ")}`
        : "Add or drop constraint rules on stored data";
    case "view":
      return table ? `Expose ${table} as a queryable view for readers` : "Define a view over existing tables";
    case "index":
      return table ? `Accelerate queries filtering/sorting ${table}` : "Add index to support access patterns";
    case "dml_insert":
      return table
        ? /seed|fixture|test/i.test(m.label)
          ? `Populate ${table} with seed or fixture rows`
          : `Insert rows into ${table} after schema is ready`
        : "Load rows";
    case "dml_update":
      return table ? `Update existing ${table} rows to new values or status` : "Mutate existing rows";
    case "dml_delete":
      return table ? `Remove rows from ${table} or clear the table` : "Delete data";
    case "logic":
      return "Run procedural logic when rows change or on a schedule";
    case "drop":
      return "Remove database object superseded by this change";
    case "finalize":
      return m.label === "COMMIT"
        ? "Make all migration changes visible to application connections"
        : "Abort migration work and discard staged changes";
    default:
      return "Execute SQL step that affects runtime data or schema";
  }
}

/**
 * @param {object[]} micro
 */
function summarizeSqlOutcome(micro) {
  const hasSchema = micro.some((m) => /ddl|constraint|view|index/.test(m.phase));
  const hasData = micro.some((m) => m.phase?.startsWith("dml"));
  if (hasSchema && hasData) return "Schema changes and data migration run in script order.";
  if (hasSchema) return "Schema evolves to match the application model.";
  if (hasData) return "Data is loaded or corrected in place.";
  return "SQL batch executes top to bottom.";
}

/**
 * @param {string} name
 */
function shortTable(name) {
  const n = String(name ?? "").replace(/["'`]/g, "");
  const parts = n.split(".");
  return parts.length ? parts[parts.length - 1] : n;
}