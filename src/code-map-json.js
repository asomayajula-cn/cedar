import { collectReadablePatchText } from "./file-flow-semantic.js";
import { inferWhatItDoes, MAX_MAP_NODES } from "./code-map-render.js";

const MAX_DEPTH = 6;
const MAX_CHILDREN_PER = 16;

/**
 * @param {string} path
 */
export function isJsonPath(path) {
  return /\.(json|json5|jsonc)$/i.test(String(path ?? ""));
}

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildJsonCodeMap(path, patch) {
  const meta = collectReadablePatchText(patch);
  const text = meta.text ?? "";
  /** @type {import("./code-map-render.js").MapNode[]} */
  const nodes = [];
  /** @type {import("./code-map-render.js").MapEdge[]} */
  const edges = [];
  let uid = 0;
  const entryId = `entry_${uid++}`;
  const baseName = path.split("/").pop() ?? "document.json";
  nodes.push({ id: entryId, label: baseName, kind: "entry" });

  if (!text.trim()) {
    return {
      header: "No JSON in diff",
      whatItDoes: "No JSON keys in visible patch",
      nodes,
      edges,
    };
  }

  const parsed = tryParseJsonDocument(text);
  if (parsed != null) {
    emitPackageSurface(parsed, entryId, nodes, edges, () => uid++);
    walkJson(parsed, entryId, entryId, "", 0, nodes, edges, () => uid++);
  }
  if (nodes.length <= 1) {
    lineFallbackJson(text, entryId, nodes, edges, () => uid++);
  }

  const header = [`json · ${nodes.length} nodes`, meta.added ? `+${meta.added} lines` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    header,
    whatItDoes: inferWhatItDoes(nodes, edges, "json"),
    nodes: nodes.slice(0, MAX_MAP_NODES),
    edges,
  };
}

/**
 * @param {string} text
 */
function tryParseJsonDocument(text) {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    /* */
  }
  const blocks = extractJsonBlocks(t);
  for (const block of blocks) {
    try {
      return JSON.parse(block);
    } catch {
      /* */
    }
  }
  return null;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractJsonBlocks(text) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let start = -1;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/**
 * @param {unknown} val
 * @param {string} parentId
 */
function emitPackageSurface(val, parentId, nodes, edges, nextId) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return;
  const o = /** @type {Record<string, unknown>} */ (val);
  const name = typeof o.name === "string" ? o.name : null;
  const version = typeof o.version === "string" ? o.version : null;
  if (!name && !version) return;
  const id = `ext_${nextId()}`;
  const label = [name, version ? `v${version}` : ""].filter(Boolean).join(" ");
  nodes.push({ id, label: label || "package", kind: "external" });
  edges.push({ from: parentId, to: id, label: "manifest" });
}

/**
 * @param {unknown} val
 * @param {string} entryId
 * @param {string} parentId
 * @param {string} scope
 * @param {number} depth
 * @param {import("./code-map-render.js").MapNode[]} nodes
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {() => number} nextId
 */
function walkJson(val, entryId, parentId, scope, depth, nodes, edges, nextId) {
  if (depth >= MAX_DEPTH) return;

  if (Array.isArray(val)) {
    const n = Math.min(val.length, MAX_CHILDREN_PER);
    for (let i = 0; i < n; i++) {
      const item = val[i];
      const id = `sym_${nextId()}`;
      const label = arrayItemLabel(item, i);
      nodes.push({ id, label, kind: "symbol", scope: scope || "array" });
      edges.push({ from: parentId, to: id, label: "item" });
      if (typeof item === "object" && item != null) {
        walkJson(item, entryId, id, scope, depth + 1, nodes, edges, nextId);
      }
    }
    if (val.length > n) {
      const id = `ext_${nextId()}`;
      nodes.push({ id, label: `+${val.length - n} more items`, kind: "external", scope });
      edges.push({ from: parentId, to: id, label: "…" });
    }
    return;
  }

  if (!val || typeof val !== "object") return;
  const o = /** @type {Record<string, unknown>} */ (val);
  const keys = Object.keys(o).slice(0, MAX_CHILDREN_PER);
  for (const key of keys) {
    const child = o[key];
    const id = `sym_${nextId()}`;
    const childScope = scope ? `${scope}.${key}` : key;
    const preview = scalarPreview(child);
    const label = preview ? `${key}: ${preview}` : key;
    const kind =
      key === "dependencies" || key === "devDependencies" || key === "scripts" || key === "workspaces"
        ? "definition"
        : typeof child === "object" && child != null && !Array.isArray(child)
          ? "definition"
          : "symbol";
    nodes.push({ id, label, kind, scope: childScope });
    edges.push({
      from: parentId,
      to: id,
      label: parentId === entryId ? "root" : "field",
    });
    if (typeof child === "object" && child != null) {
      walkJson(child, entryId, id, childScope, depth + 1, nodes, edges, nextId);
    }
  }
  if (Object.keys(o).length > keys.length) {
    const id = `ext_${nextId()}`;
    nodes.push({ id, label: `+${Object.keys(o).length - keys.length} more keys`, kind: "external", scope });
    edges.push({ from: parentId, to: id, label: "…" });
  }
}

/**
 * @param {unknown} item
 * @param {number} index
 */
function arrayItemLabel(item, index) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const o = /** @type {Record<string, unknown>} */ (item);
    if (typeof o.id === "string") return `item: ${o.id}`;
    if (typeof o.name === "string") return `item: ${o.name}`;
  }
  const pv = scalarPreview(item);
  return pv ? `[${index}] ${pv}` : `[${index}]`;
}

/**
 * @param {unknown} v
 */
function scalarPreview(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 37)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  return "";
}

/**
 * @param {string} text
 * @param {string} entryId
 * @param {import("./code-map-render.js").MapNode[]} nodes
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {() => number} nextId
 */
function lineFallbackJson(text, entryId, nodes, edges, nextId) {
  const seen = new Set();
  let count = 0;
  for (const raw of text.split("\n")) {
    if (count >= 56) break;
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const kv = line.match(/^"([^"]+)"\s*:/);
    if (!kv) continue;
    const key = kv[1];
    if (seen.has(key)) continue;
    seen.add(key);
    const id = `sym_${nextId()}`;
    const val = line.match(/:\s*(.+?)\s*,?\s*$/);
    const preview = val ? val[1].replace(/^["']|["']$/g, "").slice(0, 36) : "";
    nodes.push({
      id,
      label: preview ? `${key}: ${preview}` : key,
      kind: "symbol",
      scope: "root",
    });
    edges.push({ from: entryId, to: id, label: "key", style: "dotted" });
    count += 1;
  }
  if (count === 0) {
    const id = `sym_${nextId()}`;
    nodes.push({ id, label: "JSON fragment in diff", kind: "symbol", scope: "root" });
    edges.push({ from: entryId, to: id, label: "patch" });
  }
}