/**
 * Type / class names for architecture diagrams — from changed source (diff), not partition ids.
 * @typedef {import('./partition.js').MicroPr} MicroPr
 */

import { fileFlowKind, rulesForFileFlowKind, scanLinesIntoBuckets } from "./file-flow-semantic.js";
import { walkPatchLines } from "./patch-review.js";

const MAX_NAMES_PER_SLICE = 12;
const MAX_MEMBERS_PER_TYPE = 10;

/**
 * @param {string} label
 */
function nameFromBucketLabel(label) {
  const s = String(label ?? "").trim();
  if (!s) return "";
  const tagged =
    s.match(/\b(?:class|struct|interface|enum|union|record|message|service)\s+(\w+)/i) ??
    s.match(/\b(?:type|interface)\s+(\w+)/i) ??
    s.match(/^export\s+class\s+(\w+)/i) ??
    s.match(/^export\s+(?:default\s+)?function\s+(\w+)/i);
  if (tagged) return tagged[1];
  if (s.includes(" ")) return s.split(/\s+/).pop().replace(/[^a-zA-Z0-9_$]/g, "") || "";
  return s.replace(/[^a-zA-Z0-9_$]/g, "").slice(0, 56);
}

/**
 * @param {string} path
 */
function typeNameFromFilename(path) {
  const base = (path?.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
  if (!base) return "";
  if (/^[A-Z][\w$]*$/.test(base)) return base;
  if (/^[a-z][\w$]*$/.test(base)) {
    const pascal = base.charAt(0).toUpperCase() + base.slice(1);
    if (/^[A-Z][\w$]*$/.test(pascal)) return pascal;
  }
  return "";
}

/**
 * @param {string} patch
 * @param {string} path
 */
function classNamesFromPatch(patch, path) {
  if (!patch?.trim()) return [];
  const kind = fileFlowKind(path);
  const rules = rulesForFileFlowKind(kind, path);
  /** @type {Set<string>} */
  const names = new Set();
  for (const row of walkPatchLines(patch)) {
    if (row.kind === "del") continue;
    const t = row.text.trim();
    if (!t || t.length < 2) continue;
    if (/^\s*(\/\/|#|\/\*|\*|--)/.test(t)) continue;
    for (const rule of rules) {
      if (rule.bucket === "Tests") break;
      const m = rule.re.exec(t);
      if (!m) continue;
      const label = rule.label(m, t);
      const isType =
        rule.bucket === "Types & classes" ||
        rule.bucket === "Definitions" ||
        rule.bucket === "Resources" ||
        rule.bucket === "Operations" ||
        (rule.bucket === "Exports" && /\bclass\s+/i.test(label));
      if (!isType) break;
      const n = nameFromBucketLabel(label);
      if (n && n.length > 1 && !/^(test|spec)$/i.test(n)) names.add(n);
      break;
    }
  }
  return [...names];
}

/**
 * @param {MicroPr} micro
 * @returns {string[]}
 */
/**
 * @param {string} line
 */
function methodStubFromLine(line) {
  const body = String(line ?? "")
    .trim()
    .replace(/^\+\s*/, "")
    .trim();
  if (!body || /^(@|\/\/|\/\*|\*)/.test(body)) return "";
  const m =
    body.match(
      /^(?:@\w+\s+)*(?:public|private|protected|internal|async|static|\s)*[\w<>,\[\].$]+\s+(\w+)\s*\(/
    ) ?? body.match(/^(?:def|fn|func)\s+(\w+)\s*\(/) ?? body.match(/^(\w+)\s*\(/);
  const name = m?.[1];
  if (!name || /^(if|for|while|switch|catch|function|class|return|new|describe|it|test)$/i.test(name)) {
    return "";
  }
  return `${name}()`;
}

/**
 * @param {string} label
 */
function methodStubFromLabel(label) {
  const s = String(label ?? "").trim();
  if (!s) return "";
  const tagged =
    s.match(/(?:function|def|func|fn|rpc|async function|pub fn)\s+(\w+)/i) ??
    s.match(/^(\w+)\s*\(/);
  const name = tagged?.[1];
  if (!name || /^(constructor|class|interface|type|test|describe|it)$/i.test(name)) return "";
  return `${name}()`;
}

/**
 * @param {string} line
 */
function fieldStubFromLine(line) {
  const body = String(line ?? "")
    .trim()
    .replace(/^\+\s*/, "")
    .trim();
  if (!body || body.startsWith("//") || body.startsWith("*")) return "";
  const js =
    body.match(/^(?:public|private|protected|readonly|static)\s+(?:readonly\s+)?(\w+)\s*[:=]/) ??
    body.match(/^(\w+)\s*[:=]\s*[^=]/);
  if (js?.[1] && !/^(return|if|for|while|switch|case|default|import|export)$/i.test(js[1])) {
    return js[1];
  }
  const jvm = body.match(
    /^(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[\w<>,\[\].]+\s+(\w+)\s*;/
  );
  if (jvm?.[1]) return jvm[1];
  const py = body.match(/^self\.(\w+)\s*=/);
  if (py?.[1]) return py[1];
  return "";
}

/**
 * @param {string} line
 */
function typeNameFromClassLine(line) {
  const t = line.trim();
  const m =
    t.match(/^(?:export\s+)?(?:public\s+|private\s+)?(?:abstract\s+)?class\s+(\w+)/) ??
    t.match(/^(?:export\s+)?(?:type|interface)\s+(\w+)/) ??
    t.match(/^class\s+(\w+)/) ??
    t.match(/^(?:public\s+)?(?:class|interface|record|enum)\s+(\w+)/);
  return m?.[1] ?? "";
}

/**
 * Fields and methods inferred from added diff lines (per type name in the PR).
 * @param {MicroPr} micro
 * @returns {Map<string, { fields: string[], methods: string[] }>}
 */
export function extractClassMembersFromMicroPr(micro) {
  /** @type {Map<string, { fields: Set<string>, methods: Set<string> }>} */
  const byType = new Map();

  const ensure = (typeName) => {
    const key = String(typeName ?? "").trim();
    if (!key) return null;
    if (!byType.has(key)) byType.set(key, { fields: new Set(), methods: new Set() });
    return byType.get(key);
  };

  for (const file of micro?.files ?? []) {
    const path = file.filename ?? file.path ?? "";
    const patch = file.patch ?? "";
    if (!patch.trim()) continue;

    const rules = rulesForFileFlowKind(fileFlowKind(path), path);
    const fileTypes = classNamesFromPatch(patch, path);
    const fallbackType = typeNameFromFilename(path);
    for (const t of [...fileTypes, fallbackType].filter(Boolean)) ensure(t);
    /** @type {string | null} */
    let currentType = fileTypes[0] ?? fallbackType ?? null;

    for (const row of walkPatchLines(patch)) {
      if (row.kind === "del") continue;
      const line = row.text;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const decl = typeNameFromClassLine(trimmed);
      if (decl) currentType = decl;

      const bucket = currentType ? ensure(currentType) : null;
      if (!bucket) continue;

      for (const rule of rules) {
        const m = rule.re.exec(trimmed);
        if (!m) continue;
        const label = rule.label(m, trimmed);
        if (!label) break;
        if (rule.bucket === "Functions" || rule.bucket === "Methods" || rule.bucket === "Operations") {
          const stub = methodStubFromLabel(label);
          if (stub && bucket.methods.size < MAX_MEMBERS_PER_TYPE) bucket.methods.add(stub);
        }
        break;
      }

      const field = fieldStubFromLine(line);
      if (field && bucket.fields.size < MAX_MEMBERS_PER_TYPE) bucket.fields.add(field);
      const method = methodStubFromLine(line);
      if (method && bucket.methods.size < MAX_MEMBERS_PER_TYPE) bucket.methods.add(method);
    }

    const addedText = [...walkPatchLines(patch)]
      .filter((r) => r.kind === "add")
      .map((r) => r.text)
      .join("\n");
    const buckets = scanLinesIntoBuckets(addedText, rules);
    const methodLabels = [
      ...(buckets.Functions ?? []),
      ...(buckets.Methods ?? []),
      ...(buckets.Operations ?? []),
    ];
    const typeTargets = [
      ...new Set([currentType, fallbackType, ...fileTypes].filter(Boolean)),
    ];
    for (const typeKey of typeTargets) {
      const primary = ensure(typeKey);
      if (!primary) continue;
      for (const label of methodLabels) {
        const stub = methodStubFromLabel(label);
        if (stub && primary.methods.size < MAX_MEMBERS_PER_TYPE) primary.methods.add(stub);
      }
    }
  }

  /** @type {Map<string, { fields: string[], methods: string[] }>} */
  const out = new Map();
  for (const [type, mem] of byType) {
    out.set(type, {
      fields: [...mem.fields].sort((a, b) => a.localeCompare(b)),
      methods: [...mem.methods].sort((a, b) => a.localeCompare(b)),
    });
  }
  return out;
}

/**
 * @param {Array<{ micro?: MicroPr }>} layers
 * @returns {Map<string, { fields: string[], methods: string[] }>}
 */
export function buildClassMembersIndex(layers) {
  /** @type {Map<string, { fields: Set<string>, methods: Set<string> }>} */
  const merged = new Map();
  for (const layer of layers ?? []) {
    if (!layer?.micro) continue;
    for (const [type, mem] of extractClassMembersFromMicroPr(layer.micro)) {
      if (!merged.has(type)) merged.set(type, { fields: new Set(), methods: new Set() });
      const bucket = merged.get(type);
      for (const f of mem.fields) {
        if (bucket.fields.size < MAX_MEMBERS_PER_TYPE) bucket.fields.add(f);
      }
      for (const m of mem.methods) {
        if (bucket.methods.size < MAX_MEMBERS_PER_TYPE) bucket.methods.add(m);
      }
    }
  }
  /** @type {Map<string, { fields: string[], methods: string[] }>} */
  const out = new Map();
  for (const [type, mem] of merged) {
    out.set(type, {
      fields: [...mem.fields].sort((a, b) => a.localeCompare(b)),
      methods: [...mem.methods].sort((a, b) => a.localeCompare(b)),
    });
  }
  return out;
}

export function extractClassNamesFromMicroPr(micro) {
  /** @type {Map<string, number>} */
  const score = new Map();
  const bump = (name, w = 1) => {
    const k = String(name).trim();
    if (!k || k.length < 2) return;
    score.set(k, (score.get(k) ?? 0) + w);
  };

  for (const file of micro?.files ?? []) {
    const path = file.filename ?? file.path ?? "";
    const fromFile = typeNameFromFilename(path);
    if (fromFile) bump(fromFile, 2);
    for (const n of classNamesFromPatch(file.patch ?? "", path)) bump(n, 3);
  }

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([n]) => n)
    .slice(0, MAX_NAMES_PER_SLICE);
}

/**
 * @param {{ classNames?: string[], name?: string, id?: string, micro?: MicroPr }} layer
 * @param {number} [maxLines]
 */
export function formatSourceClassDiagramLabel(layer, maxLines = 4) {
  const names = layer.classNames?.length
    ? layer.classNames
    : extractClassNamesFromMicroPr(layer.micro ?? { files: [] });
  if (names.length) {
    const head = names.slice(0, maxLines).join("\n");
    const extra = names.length > maxLines ? `\n+${names.length - maxLines} more` : "";
    return `${head}${extra}`.trim();
  }
  return String(layer.name ?? layer.id ?? "Source").trim().slice(0, 56);
}

/**
 * Single-line flowchart label from source types.
 * @param {{ classNames?: string[], name?: string, micro?: MicroPr }} layer
 */
export function formatSourceClassFlowLabel(layer) {
  const names = layer.classNames?.length
    ? layer.classNames
    : extractClassNamesFromMicroPr(layer.micro ?? { files: [] });
  if (!names.length) return String(layer.name ?? "Layer").trim().slice(0, 48);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}