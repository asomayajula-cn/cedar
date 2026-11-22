/**
 * Architecture tab UML / Flow / Events / Data model — from PR diff source, not slice layers.
 * @typedef {import('./partition.js').MicroPr} MicroPr
 */

import {
  classNamesFromPatch,
  extractClassMembersFromMicroPr,
  typeNameFromClassLine,
  typeNameFromFilename,
} from "./architecture-source-symbols.js";
import { formatPrHubLabel } from "./diagram-labels.js";
import { mermaidSafeText } from "./mermaid-sanitize.js";
import { collectSqlPatchText, splitSqlStatementsOrdered } from "./file-flow-sql.js";
import { walkPatchLines } from "./patch-review.js";

const MAX_TYPES = 40;
const MAX_FILES = 28;
const MAX_FLOW_EDGES = 48;
const MAX_EVENT_EDGES = 40;
const MAX_TABLES = 24;
const MAX_MEMBER_LINES = 4;

/**
 * @param {string} s
 */
function safeId(s) {
  const t = String(s).replace(/[^a-zA-Z0-9_]/g, "_");
  return t || "node";
}

/**
 * @param {string} path
 */
function shortPathLabel(path) {
  const parts = String(path ?? "").split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/") || path;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/**
 * @param {string} moduleSpec
 * @param {string} fromPath
 */
function resolveModuleToFile(moduleSpec, fromPath, filePaths) {
  const spec = String(moduleSpec ?? "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
  if (!spec || spec.startsWith("@") || /^node:/.test(spec)) return "";
  let candidate = spec.replace(/\.(js|ts|tsx|jsx|mjs|cjs|py|go|rs|java)$/i, "");
  if (spec.startsWith(".")) {
    const dir = (fromPath.split("/").slice(0, -1) ?? []).join("/");
    const joined = `${dir}/${spec}`.replace(/\/\.\//g, "/");
    const normalized = joined.split("/").reduce((acc, seg) => {
      if (seg === "..") acc.pop();
      else if (seg !== "." && seg) acc.push(seg);
      return acc;
    }, []);
    candidate = normalized.join("/");
  }
  const base = candidate.split("/").pop() ?? candidate;
  /** @type {string[]} */
  const paths = [...filePaths];
  const exact = paths.find((p) => p === candidate || p === `${candidate}.ts` || p === `${candidate}.tsx`);
  if (exact) return exact;
  const suffix = paths.find(
    (p) =>
      p.endsWith(`/${candidate}`) ||
      p.endsWith(`/${candidate}.ts`) ||
      p.endsWith(`/${candidate}.tsx`) ||
      p.endsWith(`/${candidate}.js`)
  );
  if (suffix) return suffix;
  const byBase = paths.filter((p) => (p.split("/").pop() ?? p).replace(/\.[^.]+$/, "") === base);
  return byBase.length === 1 ? byBase[0] : byBase[0] ?? "";
}

/**
 * @param {string} line
 */
function importHintsFromLine(line) {
  const body = String(line ?? "")
    .trim()
    .replace(/^\+\s*/, "");
  /** @type {{ module: string, symbols: string[] }[]} */
  const out = [];
  const req = body.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  if (req) out.push({ module: req[1], symbols: [] });
  const pyFrom = body.match(/^from\s+(\S+)\s+import\s+(.+)/);
  if (pyFrom) {
    const symbols = pyFrom[2]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter((s) => s && s !== "*");
    out.push({ module: pyFrom[1], symbols });
  }
  const jsFrom = body.match(/\bfrom\s+['"]([^'"]+)['"]/);
  const jsImp = body.match(/^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s*(?:,|\s+from)/);
  if (jsFrom) {
    const symbols = jsImp?.[1]
      ? jsImp[1]
          .split(",")
          .map((s) => s.trim().split(/\s+as\s+/).pop().trim())
          .filter(Boolean)
      : jsImp?.[2]
        ? [jsImp[2]]
        : [];
    out.push({ module: jsFrom[1], symbols });
  } else if (/^import\s+['"][^'"]+['"]/.test(body)) {
    const m = body.match(/^import\s+['"]([^'"]+)['"]/);
    if (m) out.push({ module: m[1], symbols: [] });
  }
  const usePhp = body.match(/^use\s+([\\\w]+)/);
  if (usePhp) out.push({ module: usePhp[1].replace(/\\/g, "/"), symbols: [] });
  return out;
}

/**
 * @param {string} line
 */
function inheritanceFromLine(line) {
  const body = line.trim().replace(/^\+\s*/, "");
  const m = body.match(/\b(?:extends|implements)\s+([\w.<>,\s]+)/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/<.*>$/, "").split(".").pop())
    .filter((s) => s && /^[A-Z]\w*$/.test(s));
}

/**
 * @param {string} line
 * @param {string | null} currentType
 */
function callHintsFromLine(line, currentType) {
  const body = line.trim().replace(/^\+\s*/, "");
  /** @type {{ from: string, to: string, label: string }[]} */
  const hints = [];
  const nw = body.match(/\bnew\s+([A-Z]\w*)\s*\(/);
  if (nw && currentType) hints.push({ from: currentType, to: nw[1], label: `new ${nw[1]}` });
  const dot = body.match(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/);
  if (dot && currentType) {
    hints.push({ from: currentType, to: dot[1], label: `${dot[1]}.${dot[2]}()` });
  }
  const bare = body.match(/(?:^|[^\w.])([A-Z]\w*)\.([A-Za-z_]\w*)\s*\(/);
  if (bare) hints.push({ from: bare[1], to: bare[2], label: `${bare[1]}.${bare[2]}()` });
  return hints;
}

/**
 * @param {string} raw
 */
function shortTableId(raw) {
  return String(raw ?? "")
    .replace(/["`]/g, "")
    .split(".")
    .pop()
    .slice(0, 48);
}

/**
 * @param {string} stmt
 * @returns {{ tables: string[], refs: string[], label: string } | null}
 */
function sqlSchemaStep(stmt) {
  const norm = stmt.replace(/\s+/g, " ").trim();
  if (norm.length < 6) return null;
  const u = norm.toUpperCase();
  const qual = (re) => {
    const m = norm.match(re);
    return m?.[1] ? shortTableId(m[1]) : "";
  };
  if (u.startsWith("CREATE TABLE")) {
    const table = qual(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."`]+)/i);
    const refs = [...norm.matchAll(/\bREFERENCES\s+([\w."`]+)/gi)].map((m) => shortTableId(m[1]));
    return { tables: table ? [table] : [], refs, label: table ? `CREATE ${table}` : "CREATE TABLE" };
  }
  if (u.startsWith("ALTER TABLE")) {
    const table = qual(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?([\w."`]+)/i);
    const refs = [...norm.matchAll(/\bREFERENCES\s+([\w."`]+)/gi)].map((m) => shortTableId(m[1]));
    return { tables: table ? [table] : [], refs, label: table ? `ALTER ${table}` : "ALTER TABLE" };
  }
  if (u.startsWith("CREATE INDEX") || u.startsWith("CREATE UNIQUE INDEX")) {
    const on = norm.match(/\bON\s+(?:ONLY\s+)?([\w."`]+)/i)?.[1];
    const table = on ? shortTableId(on) : "";
    return { tables: table ? [table] : [], refs: [], label: table ? `INDEX on ${table}` : "INDEX" };
  }
  return null;
}

/**
 * @param {string} path
 * @param {string} patch
 * @param {{ tables: Map<string, { path: string, ops: Set<string> }>, fk: Array<{ from: string, to: string }> }} bucket
 */
function scanSqlPatch(path, patch, bucket) {
  const { text } = collectSqlPatchText(patch);
  if (!text.trim()) return;
  for (const stmt of splitSqlStatementsOrdered(text)) {
    const step = sqlSchemaStep(stmt);
    if (!step) continue;
    for (const t of step.tables) {
      if (!t) continue;
      if (!bucket.tables.has(t)) bucket.tables.set(t, { path, ops: new Set() });
      bucket.tables.get(t).ops.add(step.label);
    }
    const primary = step.tables[0];
    for (const ref of step.refs) {
      if (primary && ref) bucket.fk.push({ from: primary, to: ref });
    }
  }
}

/**
 * @param {string} patch
 * @param {{ tables: Map<string, { path: string, ops: Set<string> }> }} bucket
 */
function scanPrismaPatch(path, patch, bucket) {
  let model = "";
  for (const row of walkPatchLines(patch)) {
    if (row.kind === "del") continue;
    const t = row.text.trim().replace(/^\+\s*/, "");
    const dm = t.match(/^model\s+(\w+)\s*\{/);
    if (dm) model = dm[1];
    if (model && /^@@map\(|^\/\//.test(t)) continue;
    if (model && /^\w+\s+\w+/.test(t) && !t.startsWith("@@")) {
      if (!bucket.tables.has(model)) bucket.tables.set(model, { path, ops: new Set() });
    }
  }
}

/**
 * @param {MicroPr[]} microPrs
 */
function buildPrSourceIndex(microPrs) {
  /** @type {Set<string>} */
  const filePaths = new Set();
  /** @type {Map<string, { path: string, types: Set<string> }>} */
  const files = new Map();
  /** @type {Map<string, { typeName: string, path: string }>} */
  const types = new Map();
  /** @type {Set<string>} */
  const typeExtends = new Set();
  /** @type {Set<string>} */
  const fileImports = new Set();
  /** @type {Set<string>} */
  const typeCalls = new Set();
  /** @type {{ tables: Map<string, { path: string, ops: Set<string> }>, fk: Array<{ from: string, to: string }> }} */
  const data = { tables: new Map(), fk: [] };

  for (const micro of microPrs ?? []) {
    for (const file of micro?.files ?? []) {
      const path = file.filename ?? file.path ?? "";
      const patch = file.patch ?? "";
      if (!path || !patch.trim()) continue;
      filePaths.add(path);
      if (!files.has(path)) files.set(path, { path, types: new Set() });
      const fRec = files.get(path);

      const isSql = /\.sql$/i.test(path);
      const isPrisma = /\.prisma$/i.test(path) || /schema\.prisma$/i.test(path);

      if (isSql) {
        scanSqlPatch(path, patch, data);
        continue;
      }
      if (isPrisma) {
        scanPrismaPatch(path, patch, data);
        continue;
      }

      const declared = new Set([
        ...classNamesFromPatch(patch, path),
        typeNameFromFilename(path),
      ].filter(Boolean));

      let currentType = [...declared][0] ?? typeNameFromFilename(path) ?? null;

      for (const row of walkPatchLines(patch)) {
        if (row.kind === "del") continue;
        const line = row.text;
        const trimmed = line.trim();
        if (!trimmed) continue;

        const decl = typeNameFromClassLine(trimmed);
        if (decl) {
          currentType = decl;
          declared.add(decl);
        }

        for (const base of inheritanceFromLine(line)) {
          if (currentType) typeExtends.add(`${currentType}->${base}`);
          else if (declared.size) {
            for (const d of declared) typeExtends.add(`${d}->${base}`);
          }
        }

        for (const imp of importHintsFromLine(line)) {
          const targetFile = resolveModuleToFile(imp.module, path, filePaths);
          if (targetFile && targetFile !== path) {
            fileImports.add(`${path}->${targetFile}`);
            if (currentType) {
              for (const sym of imp.symbols) {
                if (/^[A-Z]\w*$/.test(sym)) typeExtends.add(`${currentType}->${sym}`);
              }
            }
          } else if (currentType && imp.symbols.length) {
            for (const sym of imp.symbols) {
              if (/^[A-Z]\w*$/.test(sym)) typeExtends.add(`${currentType}->${sym}`);
            }
          }
        }

        for (const d of declared) fRec.types.add(d);
        for (const name of declared) {
          if (!types.has(name)) types.set(name, { typeName: name, path });
        }
        if (currentType) {
          fRec.types.add(currentType);
          if (!types.has(currentType)) types.set(currentType, { typeName: currentType, path: path });
        }

        for (const call of callHintsFromLine(line, currentType)) {
          if (call.from && call.to) {
            typeCalls.add(`${call.from}:${call.to}:${call.label}`);
          }
        }
      }
    }
  }

  /** @type {Map<string, { fields: string[], methods: string[] }>} */
  const membersByType = new Map();
  for (const micro of microPrs ?? []) {
    for (const [type, mem] of extractClassMembersFromMicroPr(micro)) {
      if (!membersByType.has(type)) membersByType.set(type, mem);
      else {
        const prev = membersByType.get(type);
        membersByType.set(type, {
          fields: [...new Set([...prev.fields, ...mem.fields])].slice(0, 10),
          methods: [...new Set([...prev.methods, ...mem.methods])].slice(0, 10),
        });
      }
    }
  }

  return { files, types, membersByType, typeExtends, fileImports, typeCalls, data };
}

/**
 * @param {ReturnType<typeof buildPrSourceIndex>} index
 */
function buildSourceComponentsGraph(index) {
  const typeNames = [...index.types.keys()].slice(0, MAX_TYPES);
  if (!typeNames.length) {
    return {
      meta: { layout: "TB" },
      overview: {
        nodes: [{ id: "empty", label: "No types in PR diffs", type: "class" }],
        edges: [],
      },
    };
  }

  const nodes = typeNames.map((name) => {
    const mem = index.membersByType.get(name);
    const extras = [...(mem?.fields ?? []).slice(0, 2), ...(mem?.methods ?? []).slice(0, 2)];
    let label = name;
    if (extras.length) label += `\n${extras.join("\n")}`;
    const path = index.types.get(name)?.path;
    if (path) label += `\n${shortPathLabel(path)}`;
    return { id: `type_${safeId(name)}`, label: mermaidSafeText(label), type: "class" };
  });

  const idForType = (t) => (index.types.has(t) ? `type_${safeId(t)}` : "");
  const edges = [];
  const seen = new Set();
  for (const key of index.typeExtends) {
    const [from, to] = key.split("->");
    const src = idForType(from);
    const tgt = idForType(to);
    if (!src || !tgt || src === tgt) continue;
    const eid = `ext_${safeId(from)}_${safeId(to)}`;
    if (seen.has(eid)) continue;
    seen.add(eid);
    edges.push({ id: eid, source: src, target: tgt, kind: "depends", label: "uses" });
  }

  return { meta: { layout: typeNames.length <= 6 ? "LR" : "TB" }, overview: { nodes, edges } };
}

/**
 * @param {ReturnType<typeof buildPrSourceIndex>} index
 * @param {string} prLabel
 */
function buildSourceFlowGraph(index, prLabel) {
  /** @type {Set<string>} */
  const fileSet = new Set([...index.files.keys()].slice(0, MAX_FILES));
  for (const key of index.fileImports) {
    const [from, to] = key.split("->");
    if (from && index.files.has(from)) fileSet.add(from);
    if (to && index.files.has(to)) fileSet.add(to);
  }
  const fileList = [...fileSet].slice(0, MAX_FILES);
  if (!fileList.length) {
    return {
      meta: { layout: "LR" },
      overview: { nodes: [{ id: "empty", label: "No changed files in PR", type: "file" }], edges: [] },
    };
  }

  const nodes = [{ id: "pr", label: prLabel, type: "pr" }];
  const fileId = (p) => `file_${safeId(p)}`;
  for (const path of fileList) {
    const types = [...(index.files.get(path)?.types ?? [])].slice(0, 3);
    const label = types.length ? `${shortPathLabel(path)}\n${types.join(", ")}` : shortPathLabel(path);
    nodes.push({ id: fileId(path), label: mermaidSafeText(label), type: "file" });
  }

  const edges = [];
  const seen = new Set();
  let n = 0;
  for (const key of index.fileImports) {
    if (n >= MAX_FLOW_EDGES) break;
    const [from, to] = key.split("->");
    if (!from || !to || !index.files.has(from) || !index.files.has(to)) continue;
    const eid = `imp_${safeId(from)}_${safeId(to)}`;
    if (seen.has(eid)) continue;
    seen.add(eid);
    edges.push({ id: eid, source: fileId(from), target: fileId(to), kind: "depends", label: "import" });
    n += 1;
  }

  if (fileList[0]) {
    edges.push({ id: "pr_entry", source: "pr", target: fileId(fileList[0]), kind: "contains" });
  }

  return { meta: { layout: "LR" }, overview: { nodes, edges } };
}

/**
 * @param {ReturnType<typeof buildPrSourceIndex>} index
 */
function buildSourceEventsGraph(index) {
  /** @type {Set<string>} */
  const typeNames = new Set(index.types.keys());
  if (!typeNames.size && !index.typeCalls.size) {
    return {
      meta: { layout: "LR" },
      overview: { nodes: [{ id: "empty", label: "No call graph in diffs", type: "class" }], edges: [] },
    };
  }

  const idFor = (t) => `evt_${safeId(t)}`;
  /** @type {Array<{ id: string, label: string, type: string }>} */
  const nodes = [];
  const ensureType = (name) => {
    if (!name) return;
    typeNames.add(name);
    if (nodes.length >= MAX_TYPES) return;
    if (nodes.some((n) => n.id === idFor(name))) return;
    nodes.push({ id: idFor(name), label: name, type: "class" });
  };
  for (const name of [...typeNames].slice(0, MAX_TYPES)) ensureType(name);

  const edges = [];
  const seen = new Set();
  let n = 0;
  for (const key of index.typeCalls) {
    if (n >= MAX_EVENT_EDGES) break;
    const firstSep = key.indexOf(":");
    const secondSep = firstSep >= 0 ? key.indexOf(":", firstSep + 1) : -1;
    if (firstSep < 0 || secondSep < 0) continue;
    const from = key.slice(0, firstSep);
    const to = key.slice(firstSep + 1, secondSep);
    const label = key.slice(secondSep + 1);
    if (!index.types.has(from)) continue;
    ensureType(from);
    if (/^[A-Z]\w*$/.test(to)) ensureType(to);
    const source = idFor(from);
    const target = idFor(to);
    if (source === target) continue;
    const eid = `call_${safeId(from)}_${safeId(to)}_${n}`;
    if (seen.has(eid)) continue;
    seen.add(eid);
    edges.push({
      id: eid,
      source,
      target,
      kind: "contains",
      label: mermaidSafeText(label || "call"),
    });
    n += 1;
  }

  if (!nodes.length) {
    nodes.push({ id: "empty", label: "No call graph in diffs", type: "class" });
  }

  return { meta: { layout: "LR" }, overview: { nodes, edges } };
}

/**
 * @param {ReturnType<typeof buildPrSourceIndex>} index
 */
function buildSourceDataModelGraph(index) {
  const names = [...index.data.tables.keys()].slice(0, MAX_TABLES);
  if (!names.length && !index.data.fk.length) {
    return {
      meta: { layout: "TB" },
      overview: {
        nodes: [{ id: "empty", label: "No schema / migration changes in PR", type: "table" }],
        edges: [],
      },
    };
  }

  const nodes = names.map((name) => {
    const rec = index.data.tables.get(name);
    const ops = [...(rec?.ops ?? [])].slice(0, MAX_MEMBER_LINES);
    let label = name;
    if (ops.length) label += `\n${ops.join("\n")}`;
    if (rec?.path) label += `\n${shortPathLabel(rec.path)}`;
    return { id: `tbl_${safeId(name)}`, label: mermaidSafeText(label), type: "table" };
  });

  const idFor = (t) => `tbl_${safeId(t)}`;
  const have = new Set(names);
  const edges = [];
  const seen = new Set();

  const ensureTableNode = (t) => {
    if (!t || have.has(t)) return;
    if (nodes.length >= MAX_TABLES) return;
    nodes.push({ id: idFor(t), label: t, type: "table" });
    have.add(t);
  };

  for (const { from, to } of index.data.fk) {
    ensureTableNode(from);
    ensureTableNode(to);
    if (!from || !to) continue;
    const eid = `fk_${safeId(from)}_${safeId(to)}`;
    if (seen.has(eid)) continue;
    seen.add(eid);
    edges.push({ id: eid, source: idFor(from), target: idFor(to), kind: "depends", label: "FK" });
  }

  return { meta: { layout: names.length <= 5 ? "LR" : "TB" }, overview: { nodes, edges } };
}

/**
 * @param {MicroPr[]} microPrs
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildPrSourceLayoutGraphs(microPrs, pull, target) {
  const index = buildPrSourceIndex(microPrs);
  const prLabel = formatPrHubLabel(pull, target);

  return {
    components: buildSourceComponentsGraph(index),
    flow: buildSourceFlowGraph(index, prLabel),
    events: buildSourceEventsGraph(index),
    dataModel: buildSourceDataModelGraph(index),
  };
}