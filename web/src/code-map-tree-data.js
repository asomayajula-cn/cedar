/** @typedef {{ id: string, name: string, kind?: string, children?: object[] }} ArboristDatum */

const KIND_LABELS = {
  entry: "Entry",
  export: "Exports",
  import: "Imports",
  symbol: "Symbols",
  definition: "Definitions",
  call: "Call sites",
  module: "Module imports",
  "module-focus": "This file (module)",
  step: "SQL steps",
  table: "Tables",
};

const KIND_ORDER = [
  "entry",
  "module-focus",
  "export",
  "import",
  "definition",
  "symbol",
  "call",
  "module",
  "step",
  "table",
];

/**
 * @param {string} kind
 */
function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind.replace(/-/g, " ");
}

/**
 * Group flat nodes when call-graph edges do not form a single tree.
 * @param {object[]} nodeElements
 */
function groupByKindTree(nodeElements) {
  /** @type {Map<string, object[]>} */
  const byKind = new Map();
  for (const el of nodeElements) {
    const kind = el.data.kind ?? "symbol";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(el);
  }

  /** @type {ArboristDatum[]} */
  const groups = [];
  const seen = new Set();

  for (const kind of KIND_ORDER) {
    const list = byKind.get(kind);
    if (!list?.length) continue;
    seen.add(kind);
    groups.push({
      id: `kind:${kind}`,
      name: `${kindLabel(kind)} (${list.length})`,
      kind,
      children: list.map((el) => ({
        id: String(el.data.id),
        name: String(el.data.label ?? el.data.id),
        kind,
      })),
    });
  }

  for (const [kind, list] of byKind) {
    if (seen.has(kind)) continue;
    groups.push({
      id: `kind:${kind}`,
      name: `${kindLabel(kind)} (${list.length})`,
      kind,
      children: list.map((el) => ({
        id: String(el.data.id),
        name: String(el.data.label ?? el.data.id),
        kind,
      })),
    });
  }

  return groups;
}

/**
 * @param {object[]} elements
 * @param {string} [filePath]
 * @returns {ArboristDatum[]}
 */
export function buildCodeMapTreeData(elements, filePath = "Code map") {
  const nodeElements = (elements ?? []).filter((el) => el?.data && !Object.hasOwn(el.data, "source"));
  const edgeElements = (elements ?? []).filter((el) => el?.data && Object.hasOwn(el.data, "source"));

  if (!nodeElements.length) {
    return [{ id: "empty", name: "No symbols in map", children: [] }];
  }

  const byId = new Map(nodeElements.map((el) => [el.data.id, el.data]));
  /** @type {Map<string, string[]>} */
  const childrenBy = new Map();
  /** @type {Set<string>} */
  const hasParent = new Set();

  for (const el of edgeElements) {
    if (el.data.lineStyle === "dashed") continue;
    const from = el.data.source;
    const to = el.data.target;
    if (!byId.has(from) || !byId.has(to)) continue;
    if (!childrenBy.has(from)) childrenBy.set(from, []);
    childrenBy.get(from).push(to);
    hasParent.add(to);
  }

  const roots = nodeElements.filter((el) => !hasParent.has(el.data.id));
  const useGraph = roots.length > 0 && roots.length <= 48 && edgeElements.length > 0;

  /** @type {ArboristDatum[]} */
  let body = [];

  if (useGraph) {
    /** @param {string} id @param {Set<string>} chain */
    const toNode = (id, chain) => {
      if (chain.has(id)) {
        const d = byId.get(id);
        return { id: `cycle:${id}`, name: `${d?.label ?? id} (cycle)`, kind: d?.kind };
      }
      const d = byId.get(id);
      const next = new Set(chain);
      next.add(id);
      const childIds = childrenBy.get(id) ?? [];
      const kids = childIds.map((cid) => toNode(cid, next)).filter(Boolean);
      return {
        id: String(id),
        name: String(d?.label ?? id),
        kind: d?.kind,
        children: kids.length ? kids : undefined,
      };
    };

    const rootKindRank = (id) => {
      const k = byId.get(id)?.kind ?? "";
      const idx = KIND_ORDER.indexOf(k);
      return idx === -1 ? 50 : idx;
    };

    roots
      .sort((a, b) => rootKindRank(a.data.id) - rootKindRank(b.data.id))
      .forEach((el) => body.push(toNode(el.data.id, new Set())));

    const attached = new Set();
    const walk = (n) => {
      attached.add(n.id);
      for (const c of n.children ?? []) walk(c);
    };
    body.forEach(walk);

    const orphans = nodeElements.filter((el) => !attached.has(el.data.id));
    if (orphans.length) {
      body.push({
        id: "kind:orphans",
        name: `Other (${orphans.length})`,
        children: orphans.map((el) => ({
          id: String(el.data.id),
          name: String(el.data.label ?? el.data.id),
          kind: el.data.kind,
        })),
      });
    }
  } else {
    body = groupByKindTree(nodeElements);
  }

  const leaf = filePath.split("/").pop() || filePath;
  return [
    {
      id: "code-map-root",
      name: leaf,
      children: body,
    },
  ];
}