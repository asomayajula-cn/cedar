import { mermaidSafeText } from "./mermaid-sanitize.js";
import { walkPatchLines } from "./patch-review.js";
import { astToWorkflowStep, sqlDialectForPath, tryParseStatementAst } from "./sql-ast-workflow.js";

const MAX_WORKFLOW_STEPS = 28;
const MAX_COLUMNS_SHOWN = 5;

/**
 * @param {string} patch
 */
export function collectSqlPatchText(patch) {
  if (!patch?.trim()) return { text: "", lineCount: 0, scope: "empty" };
  const chunks = [];
  let lineCount = 0;
  let added = 0;
  for (const row of walkPatchLines(patch)) {
    if (row.kind === "del") continue;
    lineCount += 1;
    if (row.kind === "add") added += 1;
    chunks.push(row.text);
  }
  const scope =
    added === 0 ? "context only" : lineCount > 500 ? "large script in diff" : "diff hunks";
  return { text: chunks.join("\n"), lineCount, scope };
}

/**
 * @param {string} path
 */
export function migrationMetaFromPath(path) {
  const base = path.split("/").pop() ?? path;
  const flyway = base.match(/^(V\d+__[^.]+)/i);
  if (flyway) return { tool: "Flyway", version: flyway[1], label: flyway[1].replace(/__/g, " · ") };
  const liquibase = base.match(/^(\d+)[_-](.+)\.sql$/i);
  if (liquibase) return { tool: "Liquibase", version: liquibase[1], label: `${liquibase[1]} ${liquibase[2]}` };
  return { tool: "", version: "", label: base };
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitSqlStatementsOrdered(text) {
  const noComments = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .replace(/--[^\n]*/g, "\n");
  const statements = [];
  let buf = "";
  let quote = null;
  let dollar = null;

  for (let i = 0; i < noComments.length; i += 1) {
    const ch = noComments[i];
    const next2 = noComments.slice(i, i + 2);

    if (dollar) {
      buf += ch;
      if (ch === "$" && noComments.slice(i - dollar.length + 1, i + 1) === dollar) {
        dollar = null;
      }
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote && noComments[i - 1] !== "\\") quote = null;
      continue;
    }
    if (next2 === "$$") {
      const close = noComments.indexOf("$$", i + 2);
      if (close === -1) {
        buf += noComments.slice(i);
        break;
      }
      buf += noComments.slice(i, close + 2);
      i = close + 1;
      continue;
    }
    const dollarOpen = noComments.slice(i).match(/^(\$[a-zA-Z0-9_]*\$)/);
    if (dollarOpen) {
      dollar = dollarOpen[1];
      buf += dollarOpen[1];
      i += dollarOpen[1].length - 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === ";") {
      const stmt = buf.trim();
      if (stmt.length > 3) statements.push(stmt);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail.length > 3) statements.push(tail);
  return statements;
}

/**
 * @param {string} stmt
 * @param {string} path
 */
function statementToWorkflowStep(stmt, path) {
  const trimmed = stmt.trim();
  if (!trimmed) return null;
  const u = trimmed.replace(/\s+/g, " ").toUpperCase();
  if (/^BEGIN(\s+WORK)?$/i.test(trimmed) || /^START\s+TRANSACTION/i.test(u)) {
    return { phase: "tx", order: 0, label: "BEGIN transaction", tables: [] };
  }
  if (/^COMMIT$/i.test(trimmed) || /^ROLLBACK$/i.test(trimmed)) {
    return { phase: "tx", order: 9, label: trimmed.toUpperCase(), tables: [] };
  }
  if (/^(GRANT|REVOKE)\s+/i.test(trimmed)) {
    return {
      phase: "security",
      order: 8,
      label: trimmed.replace(/\s+/g, " ").slice(0, 56),
      tables: [],
    };
  }

  const ast = tryParseStatementAst(trimmed, sqlDialectForPath(path));
  if (ast) {
    const step = astToWorkflowStep(ast);
    if (step) return { ...step, ast: true };
  }
  const fallback = parseStatementWorkflowStepLegacy(stmt);
  if (fallback) return { ...fallback, ast: false };
  return null;
}

/**
 * Regex fallback when node-sql-parser cannot parse a hunk.
 * @param {string} stmt
 */
function parseStatementWorkflowStepLegacy(stmt) {
  const norm = stmt.replace(/\s+/g, " ").trim();
  const u = norm.toUpperCase();

  if (/^BEGIN(\s+WORK)?$/i.test(norm) || /^START\s+TRANSACTION/i.test(u)) {
    return { phase: "tx", order: 0, label: "BEGIN transaction", tables: [] };
  }
  if (/^COMMIT$/i.test(norm) || /^END\s*;?$/i.test(norm)) {
    return { phase: "tx", order: 9, label: "COMMIT", tables: [] };
  }
  if (u.startsWith("CREATE SCHEMA")) {
    return { phase: "setup", order: 1, label: `Schema ${qualName(norm, /CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?/i)}`, tables: [] };
  }
  if (u.startsWith("CREATE EXTENSION")) {
    return { phase: "setup", order: 1, label: norm.slice(0, 64), tables: [] };
  }
  if (u.startsWith("CREATE TABLE")) {
    const table = qualName(norm, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i);
    const detail = parseCreateTableBody(stmt, table);
    return {
      phase: "ddl_create",
      order: 2,
      label: detail.label,
      tables: [table],
      refs: detail.refs,
    };
  }
  if (u.startsWith("CREATE OR REPLACE VIEW") || (u.startsWith("CREATE") && /\bVIEW\b/.test(u))) {
    const table = qualName(norm, /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?/i);
    return { phase: "view", order: 3, label: `CREATE VIEW ${shortId(table)}`, tables: [table] };
  }
  if (u.startsWith("ALTER TABLE")) {
    const table = qualName(norm, /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?/i);
    const detail = parseAlterTable(norm, stmt);
    return {
      phase: detail.constraint ? "constraint" : "ddl_alter",
      order: detail.constraint ? 4 : 3,
      label: `ALTER ${shortId(table)} — ${detail.summary}`,
      tables: [table, ...detail.refs],
      refs: detail.refs,
    };
  }
  if (u.startsWith("CREATE UNIQUE INDEX") || u.startsWith("CREATE INDEX")) {
    const on = norm.match(/\bON\s+(?:ONLY\s+)?([\w."`]+)/i)?.[1] ?? "table";
    const cols = norm.match(/\(([^)]+)\)/)?.[1]?.slice(0, 48) ?? "";
    const uniq = u.startsWith("CREATE UNIQUE") ? "UNIQUE " : "";
    return {
      phase: "index",
      order: 5,
      label: `${uniq}INDEX on ${shortId(on)}${cols ? ` ${cols}` : ""}`,
      tables: [on],
    };
  }
  if (u.startsWith("INSERT INTO")) {
    const table = qualName(norm, /INSERT\s+INTO\s+/i);
    const cols = norm.match(/INSERT\s+INTO\s+[\w."`]+\s*\(([^)]+)\)/i)?.[1]?.slice(0, 40) ?? "";
    return {
      phase: "dml_insert",
      order: 6,
      label: cols ? `INSERT ${shortId(table)} ${cols}` : `INSERT ${shortId(table)}`,
      tables: [table],
    };
  }
  if (u.startsWith("UPDATE ")) {
    const table = qualName(norm, /UPDATE\s+(?:ONLY\s+)?/i);
    const set = norm.match(/\bSET\s+(.+?)(?:\s+WHERE\b|$)/i)?.[1]?.slice(0, 36) ?? "";
    return {
      phase: "dml_update",
      order: 6,
      label: set ? `UPDATE ${shortId(table)} SET ${set}` : `UPDATE ${shortId(table)}`,
      tables: [table],
    };
  }
  if (u.startsWith("DELETE FROM")) {
    const table = qualName(norm, /DELETE\s+FROM\s+(?:ONLY\s+)?/i);
    return { phase: "dml_delete", order: 6, label: `DELETE ${shortId(table)}`, tables: [table] };
  }
  if (u.startsWith("TRUNCATE")) {
    const table = qualName(norm, /TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?/i);
    return { phase: "dml_delete", order: 6, label: `TRUNCATE ${shortId(table)}`, tables: [table] };
  }
  if (u.startsWith("CREATE TRIGGER") || (u.startsWith("CREATE") && /\bTRIGGER\b/.test(u))) {
    const name = norm.match(/\bTRIGGER\s+([\w."`]+)/i)?.[1] ?? "trigger";
    const on = norm.match(/\bON\s+([\w."`]+)/i)?.[1] ?? "";
    return {
      phase: "logic",
      order: 7,
      label: on ? `TRIGGER ${shortId(name)} ON ${shortId(on)}` : `TRIGGER ${shortId(name)}`,
      tables: on ? [on] : [],
    };
  }
  if (u.startsWith("CREATE ") && /\b(FUNCTION|PROCEDURE)\b/i.test(u)) {
    const m = norm.match(/\b(FUNCTION|PROCEDURE)\s+([\w."`]+)/i);
    return {
      phase: "logic",
      order: 7,
      label: `${m?.[1] ?? "ROUTINE"} ${shortId(m?.[2] ?? "routine")}`,
      tables: [],
    };
  }
  if (u.startsWith("DROP ")) {
    const label = norm.slice(0, 52);
    return { phase: "drop", order: 8, label, tables: [] };
  }
  if (u.startsWith("GRANT ") || u.startsWith("REVOKE ")) {
    return { phase: "security", order: 8, label: norm.slice(0, 52), tables: [] };
  }
  if (u.startsWith("COPY ")) {
    const table = norm.match(/^COPY\s+([\w."`]+)/i)?.[1] ?? "table";
    return { phase: "dml_insert", order: 6, label: `COPY into ${shortId(table)}`, tables: [table] };
  }
  if (norm.length > 6) {
    return { phase: "other", order: 5, label: norm.slice(0, 48), tables: [] };
  }
  return null;
}

/**
 * @param {string} stmt raw
 * @param {string} table
 */
function parseCreateTableBody(stmt, table) {
  const inner = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w."`]+\s*\(([\s\S]*)\)\s*;?$/i)?.[1];
  if (!inner) return { label: `CREATE TABLE ${shortId(table)}`, refs: [] };

  const cols = [];
  const refs = [];
  const parts = splitCommaRespectingParens(inner);
  for (const p of parts) {
    const piece = p.trim();
    if (!piece) continue;
    if (/^(PRIMARY\s+KEY|UNIQUE|CONSTRAINT|CHECK|FOREIGN\s+KEY|EXCLUDE)/i.test(piece)) {
      const ref = piece.match(/REFERENCES\s+([\w."`]+)/i)?.[1];
      if (ref) refs.push(ref);
      continue;
    }
    const col = piece.match(/^["`]?(\w+)["`]?\s+([\w]+(?:\s*\([^)]*\))?)/);
    if (col) cols.push(`${col[1]} ${col[2].split(/\s+/).slice(0, 2).join(" ")}`);
    const inlineRef = piece.match(/REFERENCES\s+([\w."`]+)/i)?.[1];
    if (inlineRef) refs.push(inlineRef);
  }

  const colSummary =
    cols.length > 0
      ? cols.slice(0, MAX_COLUMNS_SHOWN).join(", ") + (cols.length > MAX_COLUMNS_SHOWN ? ", …" : "")
      : "";
  const fkSummary = refs.length ? ` · FK → ${refs.map(shortId).join(", ")}` : "";
  const label = colSummary
    ? `CREATE ${shortId(table)}: ${colSummary}${fkSummary}`
    : `CREATE TABLE ${shortId(table)}${fkSummary}`;
  return { label, refs };
}

/**
 * @param {string} norm
 * @param {string} raw
 */
function parseAlterTable(norm, raw) {
  const refs = [];
  let constraint = false;
  const pieces = [];

  const addCols = [...raw.matchAll(/ADD\s+(?:COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?)?["`]?(\w+)["`]?\s+([\w]+(?:\s*\([^)]*\))?)/gi)];
  for (const m of addCols) pieces.push(`+${m[1]} ${m[2].trim().split(/\s+/).slice(0, 2).join(" ")}`);

  if (/DROP\s+COLUMN/i.test(norm)) {
    const drops = [...norm.matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi)];
    for (const m of drops) pieces.push(`-${m[1]}`);
  }
  if (/ADD\s+CONSTRAINT/i.test(norm)) {
    constraint = true;
    const ref = norm.match(/REFERENCES\s+([\w."`]+)/i)?.[1];
    if (ref) {
      refs.push(ref);
      pieces.push(`FK → ${shortId(ref)}`);
    } else pieces.push("add constraint");
  }
  if (/DROP\s+CONSTRAINT/i.test(norm)) {
    constraint = true;
    pieces.push("drop constraint");
  }
  if (/RENAME\s+COLUMN/i.test(norm)) pieces.push("rename column");
  if (/ALTER\s+COLUMN/i.test(norm)) pieces.push("alter column");

  const summary = pieces.length ? pieces.slice(0, 6).join(", ") : "schema change";
  return { summary, constraint, refs };
}

/**
 * @param {string} inner
 */
function splitCommaRespectingParens(inner) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/**
 * @param {NonNullable<ReturnType<typeof parseStatementWorkflowStep>>[]} steps
 */
function mergeConsecutiveWorkflowSteps(steps) {
  const out = [];
  for (const step of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.phase === step.phase && prev.label === step.label) {
      const n = (prev.runCount ?? 1) + 1;
      prev.runCount = n;
      prev.label = step.label.replace(/(?:\s×\d+)?$/, "") + ` ×${n}`;
      prev.tables = [...new Set([...(prev.tables ?? []), ...(step.tables ?? [])])];
      prev.refs = [...new Set([...(prev.refs ?? []), ...(step.refs ?? [])])];
      continue;
    }
    out.push({ ...step });
  }
  return out;
}

/**
 * @param {NonNullable<ReturnType<typeof parseStatementWorkflowStep>>[]} steps
 */
function compressWorkflowSteps(steps) {
  if (steps.length <= MAX_WORKFLOW_STEPS) return steps;
  const out = [];
  let i = 0;
  while (i < steps.length && out.length < MAX_WORKFLOW_STEPS - 1) {
    const cur = steps[i];
    let j = i + 1;
    while (
      j < steps.length &&
      steps[j].phase === cur.phase &&
      steps[j].tables[0] === cur.tables[0] &&
      j - i < 40
    ) {
      j += 1;
    }
    const run = steps.slice(i, j);
    if (run.length === 1) {
      out.push(cur);
    } else {
      const table = cur.tables[0] ? shortId(cur.tables[0]) : cur.phase;
      out.push({
        ...cur,
        label: workflowRunLabel(cur.phase, table, run.length),
        tables: [...new Set(run.flatMap((s) => s.tables ?? []))],
        refs: [...new Set(run.flatMap((s) => s.refs ?? []))],
      });
    }
    i = j;
  }
  if (i < steps.length) {
    out.push({
      phase: "other",
      order: 5,
      label: `… ${steps.length - i} more steps in file`,
      tables: [],
    });
  }
  return out;
}

/**
 * @param {string} phase
 * @param {string} table
 * @param {number} n
 */
/**
 * @param {string} phase
 */
function workflowLaneKey(phase) {
  if (phase === "tx" || phase === "setup") return "transaction";
  if (phase === "ddl_create" || phase === "ddl_alter" || phase === "constraint" || phase === "view" || phase === "index") {
    return "schema";
  }
  if (phase?.startsWith("dml") || phase === "query") return "data";
  if (phase === "logic") return "logic";
  if (phase === "drop" || phase === "security") return "finalize";
  return "other";
}

/** @type {Record<string, string>} */
const LANE_TITLES = {
  transaction: "1 · Transaction",
  schema: "2 · Schema change",
  data: "3 · Data change",
  logic: "4 · Logic",
  finalize: "5 · Grants & drops",
  other: "Steps",
};

/**
 * @param {string[]} lines
 * @param {object[]} workflow
 * @param {string} entry
 */
function appendWorkflowLaneGraph(lines, workflow, entry) {
  let lane = "";
  let laneIndex = 0;
  let prev = entry;
  let laneHead = "";
  let laneTail = "";

  const openLane = (key) => {
    laneIndex += 1;
    lane = key;
    laneHead = "";
    laneTail = "";
    lines.push(`  subgraph lane_${laneIndex} ["${mermaidSafeText(LANE_TITLES[key] ?? key)}"]`);
    lines.push("    direction TB");
  };

  const closeLane = () => {
    if (!lane) return;
    lines.push("  end");
    if (laneHead) {
      lines.push(`  ${prev} --> ${laneHead}`);
      prev = laneTail || laneHead;
    }
    lane = "";
    laneHead = "";
    laneTail = "";
  };

  workflow.forEach((step, idx) => {
    const key = workflowLaneKey(step.phase);
    if (key !== lane) {
      closeLane();
      openLane(key);
    }

    const id = `w${idx}`;
    const commitShape = step.phase === "tx" && /COMMIT|ROLLBACK/i.test(step.label);
    if (commitShape) {
      lines.push(`    ${id}([${mermaidSafeText(step.label)}])`);
    } else {
      lines.push(`    ${id}["${mermaidSafeText(step.label)}"]`);
    }

    if (!laneHead) laneHead = id;
    else lines.push(`    ${laneTail} --> ${id}`);
    laneTail = id;
  });

  closeLane();
  return prev;
}

function workflowRunLabel(phase, table, n) {
  const verbs = {
    ddl_create: "CREATE tables",
    ddl_alter: "ALTER",
    constraint: "Constraints on",
    index: "INDEX on",
    dml_insert: "INSERT into",
    dml_update: "UPDATE",
    dml_delete: "DELETE/TRUNCATE",
    view: "VIEW",
    logic: "Logic on",
    drop: "DROP ops",
    security: "GRANT/REVOKE",
    other: "Steps on",
  };
  const verb = verbs[phase] ?? "Ops on";
  return `${verb} ${table} · ${n} steps`;
}

/**
 * @param {string} init
 * @param {string} path
 * @param {string} patch
 */
export function buildSqlWorkflowMermaid(init, path, patch) {
  const { text, lineCount, scope } = collectSqlPatchText(patch);
  const meta = migrationMetaFromPath(path);
  const role =
    /migrations?\/|db\/migration|flyway|liquibase|V\d+__/i.test(path)
      ? "Migration workflow"
      : /seed|fixture/i.test(path)
        ? "Seed workflow"
        : "SQL workflow";

  if (!text.trim()) {
    return `${init}\nflowchart TB\n  start([${mermaidSafeText(role)}])\n  note["No SQL in diff"]\n  start --> note`;
  }

  const rawStatements = splitSqlStatementsOrdered(text);
  const steps = mergeConsecutiveWorkflowSteps(
    rawStatements.map((stmt) => statementToWorkflowStep(stmt, path)).filter(Boolean)
  );
  const astSteps = steps.filter((s) => s.ast).length;

  if (!steps.length) {
    return `${init}\nflowchart TB\n  start([${mermaidSafeText(role)}])\n  note["${mermaidSafeText(shortName(path))}"]\n  start --> note`;
  }

  const workflow = compressWorkflowSteps(steps);
  const lines = ["flowchart TB"];
  const title = meta.version ? `${role}: ${meta.label}` : role;
  lines.push(`  start([${mermaidSafeText(title)}])`);

  const hdr = [
    meta.tool ? meta.tool : null,
    `${steps.length} ordered steps`,
    astSteps ? `${astSteps} AST-parsed` : null,
    lineCount ? `${lineCount} diff lines` : null,
    scope,
  ]
    .filter(Boolean)
    .join(" · ");
  lines.push(`  hdr["${mermaidSafeText(hdr)}"]`);
  lines.push("  start --> hdr");

  const prev = appendWorkflowLaneGraph(lines, workflow, "hdr");

  const depEdges = collectDependencyEdges(workflow);
  for (const [from, to, label] of depEdges.slice(0, 6)) {
    lines.push(`  ${from} -.->|${mermaidSafeText(label)}| ${to}`);
  }

  const purpose = summarizeSqlWorkflow(steps, workflow);
  lines.push(`  done(["Outcome"])`);
  lines.push(`  purpose["${mermaidSafeText(purpose)}"]`);
  lines.push(`  ${prev} --> done`);
  lines.push("  done --> purpose");

  return lines.join("\n");
}

/**
 * @param {typeof steps} all
 * @param {ReturnType<typeof compressWorkflowSteps>} workflow
 */
function summarizeSqlWorkflow(all, workflow) {
  const phases = new Set(all.map((s) => s.phase));
  const parts = [];
  if (phases.has("ddl_create")) parts.push("creates tables");
  if (phases.has("ddl_alter") || phases.has("constraint")) parts.push("evolves schema");
  if (phases.has("index")) parts.push("adds indexes");
  if (phases.has("dml_insert")) parts.push("loads data");
  if (phases.has("dml_update")) parts.push("updates rows");
  if (phases.has("dml_delete")) parts.push("removes data");
  if (phases.has("view")) parts.push("defines views");
  if (phases.has("logic")) parts.push("adds triggers/routines");
  if (phases.has("drop")) parts.push("drops objects");
  const tables = new Map();
  for (const s of all) {
    for (const t of s.tables ?? []) {
      if (!t) continue;
      tables.set(t, (tables.get(t) ?? 0) + 1);
    }
  }
  const top = [...tables.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top) parts.push(`focus ${shortId(top)}`);
  parts.push(`runs ${all.length} steps in file order`);
  if (!parts.length) return "Executes SQL in sequence";
  return parts.join("; ").replace(/; ([^;]*)$/, ". $1");
}

/**
 * @param {ReturnType<typeof compressWorkflowSteps>} workflow
 */
function collectDependencyEdges(workflow) {
  const tableToNode = new Map();
  workflow.forEach((step, idx) => {
    for (const t of step.tables ?? []) {
      if (t) tableToNode.set(t, `w${idx}`);
    }
  });
  const edges = [];
  workflow.forEach((step, idx) => {
    const from = `w${idx}`;
    for (const ref of step.refs ?? []) {
      const to = tableToNode.get(ref);
      if (to && to !== from) edges.push([from, to, `ref ${shortId(ref)}`]);
    }
  });
  return edges;
}

/**
 * @param {string} stmt
 * @param {RegExp} prefix
 */
function qualName(stmt, prefix) {
  const rest = stmt.replace(prefix, "").trim();
  const m = rest.match(/^["'`]?([\w.]+)["'`]?/);
  return m?.[1] ?? rest.split(/\s+/)[0]?.replace(/["'`]/g, "") ?? "object";
}

/**
 * @param {string} name
 */
function shortId(name) {
  const n = String(name ?? "").replace(/["'`]/g, "");
  const parts = n.split(".");
  return parts.length > 2 ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}` : n;
}

/**
 * @param {string} path
 */
function shortName(path) {
  const p = path.split("/");
  return p.length > 2 ? `…/${p.slice(-2).join("/")}` : path;
}