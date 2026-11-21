import YAML from "yaml";
import { collectReadablePatchText } from "./file-flow-semantic.js";
import { inferWhatItDoes, MAX_MAP_NODES } from "./code-map-render.js";

const MAX_DEPTH = 6;
const MAX_CHILDREN_PER = 16;
const MAX_DOCS = 4;

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildYamlCodeMap(path, patch) {
  const meta = collectReadablePatchText(patch);
  const text = meta.text ?? "";
  /** @type {import("./code-map-render.js").MapNode[]} */
  const nodes = [];
  /** @type {import("./code-map-render.js").MapEdge[]} */
  const edges = [];
  let uid = 0;
  const entryId = `entry_${uid++}`;
  const baseName = (path.split("/").pop() ?? path).replace(/\.ya?ml$/i, "");
  nodes.push({ id: entryId, label: `${baseName}.yaml`, kind: "entry" });

  if (!text.trim()) {
    return {
      header: "No YAML in diff",
      whatItDoes: "No configuration lines in visible patch",
      nodes,
      edges,
    };
  }

  let usedParser = false;
  try {
    const docs = YAML.parseAllDocuments(text).slice(0, MAX_DOCS);
  /** @type {unknown[]} */
    const values = [];
    for (const doc of docs) {
      if (doc.errors?.length) continue;
      const j = doc.toJSON();
      if (j != null) values.push(j);
    }
    if (values.length) {
      usedParser = true;
      values.forEach((val, di) => {
        const docRoot = values.length > 1 ? `doc_${uid++}` : entryId;
        if (values.length > 1) {
          nodes.push({ id: docRoot, label: `document ${di + 1}`, kind: "definition" });
          edges.push({ from: entryId, to: docRoot, label: "doc" });
        }
        emitKubeSurface(val, docRoot === entryId ? entryId : docRoot, nodes, edges, () => uid++);
        walkYaml(val, docRoot, docRoot, "", 0, nodes, edges, () => uid++);
      });
    }
  } catch {
    /* line fallback below */
  }

  if (!usedParser || nodes.length <= 1) {
    lineFallbackYaml(text, entryId, nodes, edges, () => uid++);
  }

  if (nodes.length <= 1 && text.trim()) {
    const id = `sym_${uid++}`;
    nodes.push({
      id,
      label: meta.added ? `+${meta.added} lines in diff` : "YAML fragment in diff",
      kind: "symbol",
      scope: "patch",
    });
    edges.push({ from: entryId, to: id, label: "patch" });
  }

  const header = [`yaml · ${nodes.length} nodes`, meta.added ? `+${meta.added} lines` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    header,
    whatItDoes: inferWhatItDoes(nodes, edges, "yaml"),
    nodes: nodes.slice(0, MAX_MAP_NODES),
    edges,
  };
}

/**
 * @param {unknown} val
 * @param {string} parentId
 * @param {import("./code-map-render.js").MapNode[]} nodes
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {() => number} nextId
 */
function emitKubeSurface(val, parentId, nodes, edges, nextId) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return;
  const o = /** @type {Record<string, unknown>} */ (val);
  const kind = typeof o.kind === "string" ? o.kind : null;
  const api = typeof o.apiVersion === "string" ? o.apiVersion : null;
  if (!kind && !api) return;
  const id = `ext_${nextId()}`;
  const name =
    o.metadata && typeof o.metadata === "object" && !Array.isArray(o.metadata)
      ? /** @type {Record<string, unknown>} */ (o.metadata).name
      : null;
  const label = [api, kind, name ? `(${name})` : ""].filter(Boolean).join(" ");
  nodes.push({ id, label: label || "Kubernetes resource", kind: "external" });
  edges.push({ from: parentId, to: id, label: "resource" });
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
function walkYaml(val, entryId, parentId, scope, depth, nodes, edges, nextId) {
  if (depth >= MAX_DEPTH) return;

  if (Array.isArray(val)) {
    const n = Math.min(val.length, MAX_CHILDREN_PER);
    for (let i = 0; i < n; i++) {
      const item = val[i];
      const id = `sym_${nextId()}`;
      const label = arrayItemLabel(item, i);
      nodes.push({ id, label, kind: "symbol", scope: scope || "list" });
      edges.push({ from: parentId, to: id, label: "item" });
      if (typeof item === "object" && item != null) {
        walkYaml(item, entryId, id, scope, depth + 1, nodes, edges, nextId);
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
    if (key === "apiVersion" || key === "kind") continue;
    const child = o[key];
    const id = `sym_${nextId()}`;
    const childScope = scope ? `${scope}.${key}` : key;
    const preview = scalarPreview(child);
    const label = preview ? `${key}: ${preview}` : key;
    const kind =
      key === "components" || key === "dependencies" || key === "resources"
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
      walkYaml(child, entryId, id, childScope, depth + 1, nodes, edges, nextId);
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
    if (typeof o.kind === "string") return `item: ${o.kind}`;
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
  return "";
}

/**
 * @param {string} text
 * @param {string} entryId
 * @param {import("./code-map-render.js").MapNode[]} nodes
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {() => number} nextId
 */
function lineFallbackYaml(text, entryId, nodes, edges, nextId) {
  /** @type {string | null} */
  let sectionId = null;
  let sectionName = "";
  let count = 0;
  for (const raw of text.split("\n")) {
    if (count >= 48) break;
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const section = line.match(/^([a-zA-Z][\w.-]*)\s*:\s*$/);
    if (section) {
      sectionName = section[1];
      sectionId = `sym_${nextId()}`;
      nodes.push({ id: sectionId, label: sectionName, kind: "definition" });
      edges.push({ from: entryId, to: sectionId, label: "section" });
      count += 1;
      continue;
    }
    const kv = line.match(/^(\s*)([a-zA-Z][\w.-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const indent = kv[1].length;
    const key = kv[2];
    const val = kv[3].trim();
    const parent = indent >= 2 && sectionId ? sectionId : entryId;
    const id = `sym_${nextId()}`;
    nodes.push({
      id,
      label: val ? `${key}: ${val.slice(0, 36)}` : key,
      kind: "symbol",
      scope: sectionName || "root",
    });
    edges.push({ from: parent, to: id, label: indent >= 2 ? "field" : "key", style: "dotted" });
    count += 1;
  }
}

function isYamlPath(path) {
  return /\.ya?ml$/i.test(String(path ?? ""));
}

export { isYamlPath };