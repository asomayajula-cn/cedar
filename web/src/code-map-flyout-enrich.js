const BEHAVIOR_NODE_KINDS = new Set([
  "entry",
  "call",
  "step",
  "table",
  "export",
  "import",
  "external",
  "method",
  "field",
  "property",
  "definition",
  "query",
  "key",
]);

/**
 * @param {object[] | null | undefined} elements
 */
function cytoscapeNodes(elements) {
  return (elements ?? []).filter((el) => el?.data && !Object.hasOwn(el.data, "source"));
}

/**
 * @param {object[] | null | undefined} elements
 */
function cytoscapeEdges(elements) {
  return (elements ?? []).filter((el) => el?.data && Object.hasOwn(el.data, "source"));
}

/**
 * @param {object[] | null | undefined} elements
 */
export function deriveBehaviorElements(elements) {
  const nodes = cytoscapeNodes(elements);
  const edges = cytoscapeEdges(elements);
  if (!nodes.length) return [];

  const callIds = new Set(nodes.filter((n) => n.data?.kind === "call").map((n) => n.data.id));
  const keep = new Set(
    nodes
      .filter(
        (n) =>
          BEHAVIOR_NODE_KINDS.has(n.data?.kind) ||
          (n.data?.kind === "symbol" && edges.some((e) => e.data?.source === n.data?.id && callIds.has(e.data?.target)))
      )
      .map((n) => n.data.id)
  );

  for (const e of edges) {
    if (callIds.has(e.data?.target)) keep.add(e.data?.source);
  }

  const nodePart = nodes.filter((n) => keep.has(n.data?.id));
  const ids = new Set(nodePart.map((n) => n.data.id));
  const edgePart = edges.filter((e) => ids.has(e.data?.source) && ids.has(e.data?.target));
  const out = [...nodePart, ...edgePart];
  if (out.length >= 2) return out;

  const entry = nodes.find((n) => n.data?.kind === "entry");
  const entryId = entry?.data?.id ?? "behavior_entry_client";
  const fallbackNodes = entry
    ? [entry]
    : [{ data: { id: entryId, label: "Runtime behavior", kind: "entry" } }];
  const id = "behavior_none_client";
  return [
    ...fallbackNodes,
    { data: { id, label: "No call sites in cached map — re-run review", kind: "symbol" } },
    { data: { id: "behavior_e0", source: entryId, target: id, kind: "contains" } },
  ];
}

/**
 * @param {object | null | undefined} artifact
 */
export function deriveFunctionalityElements(artifact) {
  if (artifact?.functionalityElements?.length) return artifact.functionalityElements;

  const steps = [];
  const what = String(artifact?.whatItDoes ?? artifact?.summary?.lead ?? "").trim();
  const structure = String(artifact?.structure ?? artifact?.summary?.structure ?? "").trim();
  const layout = String(artifact?.layout?.line ?? artifact?.summary?.layout?.line ?? "").trim();

  if (what) steps.push({ label: what, kind: "export" });
  if (structure) steps.push({ label: structure, kind: "definition" });
  if (layout) steps.push({ label: layout.replace(/^Layout:\s*/i, ""), kind: "symbol" });

  const bullets = artifact?.summary?.bullets;
  if (Array.isArray(bullets)) {
    for (const b of bullets.slice(0, 12)) {
      const t = String(b).trim();
      if (!t || /^Structure:/i.test(t) || /^Layout:/i.test(t)) continue;
      steps.push({ label: t, kind: "call" });
    }
  }

  if (!steps.length) {
    return deriveBehaviorElements(artifact?.elements);
  }

  /** @type {object[]} */
  const elements = [];
  const entryId = "fn_entry";
  elements.push({
    data: {
      id: entryId,
      label: "File role",
      kind: "entry",
    },
  });
  let prev = entryId;
  steps.forEach((step, i) => {
    const id = `fn_client_${i}`;
    elements.push({ data: { id, label: step.label.slice(0, 240), kind: step.kind } });
    elements.push({
      data: {
        id: `fn_e_${i}`,
        source: prev,
        target: id,
        kind: "contains",
      },
    });
    prev = id;
  });
  return elements;
}

/**
 * Ensure structure / behavior / functionality element sets exist (stale reviews).
 * @param {object | null | undefined} artifact
 */
export function enrichFlyoutArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return artifact;
  const structure = artifact.elements ?? [];
  if (!structure.length) return artifact;

  const serverBehavior = artifact.behaviorElements ?? [];
  const behaviorLooksDistinct =
    serverBehavior.length > 1 &&
    (serverBehavior.some((el) => el.data?.kind === "call" || el.data?.kind === "step") ||
      serverBehavior.length < structure.length);
  const behaviorElements = behaviorLooksDistinct ? serverBehavior : deriveBehaviorElements(structure);

  const serverFn = artifact.functionalityElements ?? [];
  const fnLooksDistinct =
    serverFn.length > 1 &&
    serverFn.some((el) => String(el.data?.id ?? "").startsWith("fn_") || String(el.data?.label ?? "").includes(" — "));
  const functionalityElements = fnLooksDistinct
    ? serverFn
    : deriveFunctionalityElements({ ...artifact, behaviorElements });

  return {
    ...artifact,
    behaviorElements,
    functionalityElements,
  };
}