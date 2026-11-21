import {
  collectReadablePatchText,
  scanLinesIntoBuckets,
  rulesForFileFlowKind,
  fileFlowKindRoleLabel,
} from "./file-flow-semantic.js";
import { inferWhatItDoes, MAX_MAP_NODES } from "./code-map-render.js";

const IMPORT_BUCKETS = new Set(["Imports", "Import"]);
const DEF_BUCKETS = new Set([
  "Definitions",
  "Types & classes",
  "Functions",
  "Methods",
  "Exports",
  "Resources",
  "Modules",
  "Operations",
]);

/**
 * @param {string} path
 * @param {string} patch
 * @param {string} kind
 */
export function buildGenericCodeMap(path, patch, kind) {
  const meta = collectReadablePatchText(patch);
  const rules = rulesForFileFlowKind(kind, path);
  const buckets = scanLinesIntoBuckets(meta.text, rules);
  const role = fileFlowKindRoleLabel(kind);

  /** @type {import("./code-map-render.js").MapNode[]} */
  const nodes = [];
  /** @type {import("./code-map-render.js").MapEdge[]} */
  const edges = [];
  let uid = 0;
  const entryId = `entry_${uid++}`;
  const fileLeaf = path.split("/").pop() ?? path;
  nodes.push({ id: entryId, label: fileLeaf, kind: "entry" });

  const bucketOrder = Object.keys(buckets).sort((a, b) => a.localeCompare(b));
  for (const bucket of bucketOrder) {
    const items = buckets[bucket];
    if (!items?.length) continue;
    const parentId = `sym_${uid++}`;
    const parentKind = IMPORT_BUCKETS.has(bucket)
      ? "import"
      : DEF_BUCKETS.has(bucket)
        ? "definition"
        : "symbol";
    nodes.push({ id: parentId, label: bucket, kind: parentKind, scope: role });
    edges.push({ from: entryId, to: parentId, label: "contains" });
    for (const label of [...new Set(items)].slice(0, 10)) {
      const id = `leaf_${uid++}`;
      const leafKind = IMPORT_BUCKETS.has(bucket) ? "import" : bucket === "Calls" ? "call" : "symbol";
      nodes.push({ id, label, kind: leafKind, scope: bucket });
      edges.push({ from: parentId, to: id, label: "item", style: "dotted" });
    }
    if (items.length > 10) {
      const id = `ext_${uid++}`;
      nodes.push({ id, label: `+${items.length - 10} more in ${bucket}`, kind: "external", scope: bucket });
      edges.push({ from: parentId, to: id, label: "…" });
    }
  }

  if (nodes.length <= 1) {
    const roleId = `sym_${uid++}`;
    nodes.push({ id: roleId, label: role, kind: "definition", scope: "file-type" });
    edges.push({ from: entryId, to: roleId, label: "type" });
    if (meta.added || meta.removed || meta.lineCount) {
      const id = `leaf_${uid++}`;
      const stat = [
        meta.added ? `+${meta.added}` : null,
        meta.removed ? `−${meta.removed}` : null,
        meta.lineCount ? `${meta.lineCount} lines` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      nodes.push({ id, label: stat || "diff hunk", kind: "symbol", scope: "diff" });
      edges.push({ from: roleId, to: id, label: "patch", style: "dotted" });
    }
  }

  const header = [role, `${nodes.length} nodes`, meta.added ? `+${meta.added} lines` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    header,
    whatItDoes: inferWhatItDoes(nodes, edges, kind),
    nodes: nodes.slice(0, MAX_MAP_NODES),
    edges,
  };
}