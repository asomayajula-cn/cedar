import { isSqlFile } from "./sql-slice.js";
import { fileFlowKind } from "./file-flow-semantic.js";
import { isYamlPath } from "./code-map-yaml.js";
import { isJsonPath } from "./code-map-json.js";
import { formatFunctionalNode } from "./functional-flow-render.js";
import { collectJsFunctionalSteps } from "./js-functional-flow.js";
import { collectJavaFunctionalSteps } from "./java-functional-flow.js";
import { collectSqlFunctionalSteps } from "./sql-functional-flow.js";
import { collectGenericFunctionalSteps } from "./generic-functional-flow.js";
import { toGranularCodeMap } from "./code-map-detail.js";

const BEHAVIOR_CAP = 96;

/**
 * @param {{
 *   nodes: { id: string, label: string, kind: string, scope?: string }[],
 *   edges: { from: string, to: string, label?: string, style?: string }[],
 * }} map
 * @param {{ level?: string } | null} [profile]
 */
export function toBehaviorCodeMap(map, profile = null) {
  const granular = toGranularCodeMap(map, profile);
  const nodes = granular.nodes;
  const baseEdges = granular.edges;
  /** @type {typeof baseEdges} */
  const extraEdges = [];

  const callIds = new Set(nodes.filter((n) => n.kind === "call").map((n) => n.id));
  const keepIds = new Set(
    nodes
      .filter(
        (n) =>
          n.kind === "entry" ||
          n.kind === "step" ||
          n.kind === "table" ||
          n.kind === "call" ||
          n.kind === "export" ||
          n.kind === "import" ||
          n.kind === "external" ||
          n.kind === "method" ||
          n.kind === "field" ||
          n.kind === "property" ||
          n.kind === "definition" ||
          n.kind === "query" ||
          n.kind === "key"
      )
      .map((n) => n.id)
  );

  for (const e of baseEdges) {
    if (callIds.has(e.to) && keepIds.has(e.from) === false) {
      const fromNode = nodes.find((n) => n.id === e.from);
      if (fromNode) keepIds.add(e.from);
    }
  }

  const callScopes = new Set(nodes.filter((n) => n.kind === "call").map((n) => n.scope).filter(Boolean));
  for (const n of nodes) {
    if (n.kind === "symbol" && callScopes.has(n.scope)) keepIds.add(n.id);
    if (n.kind === "symbol" && callScopes.has(n.label)) keepIds.add(n.id);
  }

  let kept = nodes.filter((n) => keepIds.has(n.id));
  const calls = nodes.filter((n) => n.kind === "call");
  if (calls.length && kept.filter((n) => n.kind === "call").length === 0) {
    const entry = kept.find((n) => n.kind === "entry") ?? nodes.find((n) => n.kind === "entry");
    kept = [
      ...(entry ? [entry] : []),
      ...calls.slice(0, Math.min(calls.length, BEHAVIOR_CAP - 1)),
    ];
    if (kept.length > 1) {
      const anchor = kept[0];
      for (const c of kept.slice(1)) {
        extraEdges.push({ from: anchor.id, to: c.id, label: "invokes", style: "dotted" });
      }
    }
  }

  const entryNode = kept.find((n) => n.kind === "entry");
  if (entryNode) {
    const leaf = String(map.fileLabel ?? map.header ?? "module")
      .replace(/^…\//, "")
      .replace(/\s*·\s*structure.*$/i, "")
      .trim();
    entryNode.label = leaf ? `${leaf} · execution` : "Entrypoint · execution";
  }

  if (kept.length > BEHAVIOR_CAP) {
    const entry = kept.find((n) => n.kind === "entry");
    const priority = kept.filter((n) => n.kind !== "call" && n.kind !== "entry").slice(0, 20);
    const calls = kept.filter((n) => n.kind === "call").slice(0, BEHAVIOR_CAP - 2 - priority.length);
    kept = [...(entry ? [entry] : []), ...priority, ...calls];
    kept.push({
      id: "behavior_more",
      label: `+${nodes.filter((n) => keepIds.has(n.id)).length - kept.length + 1} more behavior nodes`,
      kind: "external",
      scope: "__behavior__",
    });
  }

  const ids = new Set(kept.map((n) => n.id));
  let keptEdges = [...baseEdges.filter((e) => ids.has(e.from) && ids.has(e.to)), ...extraEdges];
  if (kept.length >= 2 && keptEdges.length === 0 && entryNode) {
    keptEdges = kept
      .filter((n) => n.id !== entryNode.id)
      .slice(0, 24)
      .map((n) => ({
        from: entryNode.id,
        to: n.id,
        label: "invokes",
        style: "dotted",
      }));
  }

  if (kept.length <= 1 && calls.length) {
    const eid = `behavior_entry`;
    kept = [{ id: eid, label: "Call sites", kind: "entry" }, ...calls.slice(0, Math.min(32, BEHAVIOR_CAP))];
    keptEdges = kept.slice(1).map((n, i) => ({
      from: i === 0 ? eid : kept[i].id,
      to: n.id,
      label: "then",
    }));
  }

  return {
    ...map,
    header: `${map.header} · behavior`,
    nodes: kept,
    edges: keptEdges,
  };
}

/**
 * @param {string} path
 * @param {string} patch
 * @returns {import("./functional-flow-render.js").FunctionalStep[]}
 */
export function collectFunctionalStepsForFile(path, patch) {
  if (isSqlFile(path)) return collectSqlFunctionalSteps(path, patch);
  if (isYamlPath(path) || isJsonPath(path)) return collectGenericFunctionalSteps(path, patch);
  const kind = fileFlowKind(path);
  if (kind === "javascript" || kind === "component") return collectJsFunctionalSteps(path, patch);
  if (kind === "jvm") return collectJavaFunctionalSteps(path, patch);
  return collectGenericFunctionalSteps(path, patch);
}

/**
 * @param {string} path
 * @param {import("./functional-flow-render.js").FunctionalStep[]} steps
 */
export function functionalityStepsToMap(path, steps) {
  const fileLeaf = path.split("/").pop() ?? "file";
  /** @type {import("./code-map-render.js").MapNode[]} */
  const nodes = [];
  /** @type {import("./code-map-render.js").MapEdge[]} */
  const edges = [];
  let uid = 0;
  const entryId = `entry_${uid++}`;
  nodes.push({ id: entryId, label: fileLeaf, kind: "entry" });

  if (!steps.length) {
    const id = `fn_${uid++}`;
    nodes.push({ id, label: "No workflow steps in visible diff", kind: "symbol", scope: "functionality" });
    edges.push({ from: entryId, to: id, label: "patch" });
    return {
      fileLabel: fileLeaf,
      header: "functionality · overview",
      whatItDoes: "Overall role of this file in the change",
      nodes,
      edges,
    };
  }

  let prev = entryId;
  for (const step of steps) {
    const id = `fn_${uid++}`;
    const kind =
      step.phase === "dependencies" || step.phase === "integration"
        ? "import"
        : step.phase === "api" || step.phase === "contract"
          ? "export"
          : "call";
    nodes.push({
      id,
      label: formatFunctionalNode(step),
      kind,
      scope: step.phase,
    });
    edges.push({ from: prev, to: id, label: prev === entryId ? "starts" : "then" });
    prev = id;
  }

  return {
    fileLabel: fileLeaf,
    header: `functionality · ${steps.length} steps`,
    whatItDoes: steps[steps.length - 1]?.functional ?? "End-to-end effect of this file",
    nodes,
    edges,
  };
}