import sqlParser from "node-sql-parser";

const { Parser } = sqlParser;

let parserSingleton = null;

function getParser() {
  if (!parserSingleton) parserSingleton = new Parser();
  return parserSingleton;
}

/**
 * @param {string} path
 */
export function sqlDialectForPath(path) {
  const p = String(path ?? "").toLowerCase();
  if (/mysql|mariadb|aurora/.test(p)) return "MySQL";
  if (/mssql|sqlserver|tsql/.test(p)) return "TransactSQL";
  return "PostgresQL";
}

/**
 * @param {unknown} ast
 */
function normalizeAstList(ast) {
  if (!ast) return [];
  return Array.isArray(ast) ? ast : [ast];
}

/**
 * @param {string} chunk
 * @param {string} database
 */
export function tryParseStatementAst(chunk, database) {
  const sql = chunk.trim();
  if (!sql) return null;
  const parser = getParser();
  const withSemi = sql.endsWith(";") ? sql : `${sql};`;
  try {
    const ast = parser.astify(withSemi, { database });
    return normalizeAstList(ast)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} t
 */
function tableName(t) {
  if (!t) return "";
  const x = Array.isArray(t) ? t[0] : t;
  if (!x) return "";
  const parts = [x.db, x.schema, x.table].filter(Boolean);
  return parts.length ? parts.join(".") : String(x.table ?? "");
}

/**
 * @param {unknown} colRef
 */
function columnName(colRef) {
  if (!colRef) return "";
  const c = colRef.column;
  if (typeof c === "string") return c;
  return c?.expr?.value ?? c?.value ?? "";
}

/**
 * @param {unknown} def
 */
function formatColumnDef(def) {
  const name = columnName(def.column);
  const type = def.definition?.dataType ?? def.definition?.datatype ?? "";
  const bits = [name, type].filter(Boolean).join(" ");
  if (def.primary_key) return `${bits} PK`;
  if (def.unique) return `${bits} UNIQUE`;
  return bits;
}

/**
 * @param {unknown} ast
 */
export function astToWorkflowStep(ast) {
  if (!ast || typeof ast !== "object") return null;

  switch (ast.type) {
    case "create":
      return createAstStep(ast);
    case "alter":
      return alterAstStep(ast);
    case "insert":
      return insertAstStep(ast);
    case "update":
      return updateAstStep(ast);
    case "delete":
      return deleteAstStep(ast);
    case "drop":
      return dropAstStep(ast);
    case "truncate":
      return truncateAstStep(ast);
    case "select": {
      const from = tableName(ast.from);
      if (!from) return null;
      return {
        phase: "query",
        order: 6,
        label: `SELECT from ${shortId(from)}`,
        tables: [from],
      };
    }
    default:
      return {
        phase: "other",
        order: 5,
        label: String(ast.type ?? "statement").toUpperCase(),
        tables: [],
      };
  }
}

/**
 * @param {unknown} ast
 */
function createAstStep(ast) {
  if (ast.keyword === "table") {
    const table = tableName(ast.table);
    const cols = [];
    const refs = [];
    const pks = [];
    for (const def of ast.create_definitions ?? []) {
      if (def.resource === "column" || def.column) {
        const label = formatColumnDef(def);
        if (label) cols.push(label);
        const refTable = tableName(def.reference_definition?.table);
        if (refTable) {
          const col = columnName(def.column);
          refs.push(refTable);
          if (col) cols[cols.length - 1] = `${col} → ${shortId(refTable)}`;
        }
        if (def.primary_key) pks.push(columnName(def.column));
      }
      if (def.resource === "constraint" || def.constraint) {
        const refTable = tableName(def.reference_definition?.table ?? def.reference_definition?.definition);
        if (refTable) refs.push(refTable);
      }
    }
    const colLine = cols.slice(0, 6).join(", ");
    const more = cols.length > 6 ? `, +${cols.length - 6} cols` : "";
    const pkLine = pks.length ? ` · PK ${pks.join(", ")}` : "";
    const fkLine = refs.length ? ` · FK → ${[...new Set(refs.map(shortId))].join(", ")}` : "";
    return {
      phase: "ddl_create",
      order: 2,
      label: `DDL CREATE ${shortId(table)}: ${colLine || "columns"}${more}${pkLine}${fkLine}`,
      tables: table ? [table] : [],
      refs: [...new Set(refs)],
    };
  }
  if (ast.keyword === "index") {
    const on = tableName(ast.table);
    const idx = ast.index ?? "index";
    const cols = (ast.index_columns ?? []).map((c) => columnName(c)).filter(Boolean).join(", ");
    const uniq = ast.index_type === "UNIQUE" || ast.keyword === "unique" ? "UNIQUE " : "";
    return {
      phase: "index",
      order: 5,
      label: `DDL ${uniq}INDEX ${idx} ON ${shortId(on)}${cols ? ` ${cols}` : ""}`,
      tables: on ? [on] : [],
    };
  }
  if (ast.keyword === "view") {
    const view = tableName(ast.table);
    return {
      phase: "view",
      order: 3,
      label: `DDL VIEW ${shortId(view)}`,
      tables: view ? [view] : [],
    };
  }
  if (ast.keyword === "trigger") {
    const name = ast.trigger ?? ast.table ?? "trigger";
    const on = tableName(ast.table);
    return {
      phase: "logic",
      order: 7,
      label: on ? `TRIGGER ${shortId(name)} ON ${shortId(on)}` : `TRIGGER ${shortId(name)}`,
      tables: on ? [on] : [],
    };
  }
  if (ast.keyword === "function" || ast.keyword === "procedure") {
    const name = ast.name ?? ast.table ?? "routine";
    return {
      phase: "logic",
      order: 7,
      label: `${String(ast.keyword).toUpperCase()} ${shortId(String(name))}`,
      tables: [],
    };
  }
  return {
    phase: "other",
    order: 3,
    label: `DDL CREATE ${ast.keyword ?? "object"}`,
    tables: [],
  };
}

/**
 * @param {unknown} ast
 */
function alterAstStep(ast) {
  const table = tableName(ast.table);
  const parts = [];
  const refs = [];
  for (const expr of ast.expr ?? []) {
    const action = String(expr.action ?? expr.keyword ?? "alter").toLowerCase();
    if (action === "add" && expr.resource === "column") {
      const name = columnName(expr.column);
      const type = expr.definition?.dataType ?? "";
      const nn = expr.nullable?.value === "not null" ? " NOT NULL" : "";
      const def = expr.default_val?.value?.value;
      const defStr = def != null ? ` DEFAULT ${def}` : "";
      parts.push(`+${name} ${type}${nn}${defStr}`.trim());
    } else if (action === "drop" && expr.resource === "column") {
      parts.push(`-${columnName(expr.column)}`);
    } else if (expr.constraint) {
      parts.push("constraint change");
    } else {
      const refTable = tableName(expr.reference_definition?.table);
      if (refTable) {
        refs.push(refTable);
        parts.push(`FK → ${shortId(refTable)}`);
      } else {
        parts.push(action);
      }
    }
  }
  const constraint = parts.some((p) => /FK|constraint/i.test(p));
  return {
    phase: constraint ? "constraint" : "ddl_alter",
    order: constraint ? 4 : 3,
    label: `DDL ALTER ${shortId(table)}: ${parts.slice(0, 5).join(", ") || "schema change"}`,
    tables: table ? [table] : [],
    refs: [...new Set(refs)],
  };
}

/**
 * @param {unknown} ast
 */
function insertAstStep(ast) {
  const table = tableName(ast.table);
  const cols = (ast.columns ?? []).map((c) => columnName(c) || c?.value).filter(Boolean);
  const rowCount = ast.values?.values?.length ?? 0;
  const colsStr = cols.length ? ` ${cols.join(", ")}` : "";
  const rowsStr = rowCount > 1 ? ` · ${rowCount} rows` : "";
  return {
    phase: "dml_insert",
    order: 6,
    label: `DML INSERT ${shortId(table)}${colsStr}${rowsStr}`,
    tables: table ? [table] : [],
  };
}

/**
 * @param {unknown} ast
 */
function updateAstStep(ast) {
  const table = tableName(ast.table);
  const sets = (ast.set ?? [])
    .map((s) => {
      const col = columnName(s.column) || s.table;
      return col ? String(col) : "";
    })
    .filter(Boolean)
    .slice(0, 4);
  return {
    phase: "dml_update",
    order: 6,
    label: sets.length ? `DML UPDATE ${shortId(table)} SET ${sets.join(", ")}` : `DML UPDATE ${shortId(table)}`,
    tables: table ? [table] : [],
  };
}

/**
 * @param {unknown} ast
 */
function deleteAstStep(ast) {
  const table = tableName(ast.from);
  return {
    phase: "dml_delete",
    order: 6,
    label: `DML DELETE ${shortId(table)}`,
    tables: table ? [table] : [],
  };
}

/**
 * @param {unknown} ast
 */
function dropAstStep(ast) {
  const kw = ast.keyword ?? "object";
  const table = tableName(ast.table);
  return {
    phase: "drop",
    order: 8,
    label: table ? `DROP ${kw} ${shortId(table)}` : `DROP ${kw}`,
    tables: table ? [table] : [],
  };
}

/**
 * @param {unknown} ast
 */
function truncateAstStep(ast) {
  const table = tableName(ast.table);
  return {
    phase: "dml_delete",
    order: 6,
    label: `DML TRUNCATE ${shortId(table)}`,
    tables: table ? [table] : [],
  };
}

/**
 * @param {string} name
 */
function shortId(name) {
  const n = String(name ?? "").replace(/["'`]/g, "");
  const parts = n.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : n;
}