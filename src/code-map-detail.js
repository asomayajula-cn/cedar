import { isSqlFile } from "./sql-slice.js";
import { collectReadablePatchText } from "./file-flow-semantic.js";
import { describeCodeMapLayout, structureOutline } from "./code-map-layout.js";

/** @typedef {'rich' | 'compact'} CodeMapDetailLevel */
/** @typedef {'sql-migration' | 'new-module' | 'new-service' | 'local-edit'} CodeMapProfile */

const COMPACT_NODE_CAP = 34;
const STRUCTURE_CAP_RICH = 56;
const GRANULAR_CAP_RICH = 420;
const GRANULAR_CAP_COMPACT = 320;

/**
 * @param {string} path
 * @param {string} patch
 * @param {{
 *   fileLabel: string,
 *   header: string,
 *   whatItDoes: string,
 *   nodes: { id: string, label: string, kind: string, scope?: string }[],
 *   edges: { from: string, to: string, label?: string, style?: string }[],
 * }} map
 * @param {string} [fileStatus]
 * @returns {{ level: CodeMapDetailLevel, profile: CodeMapProfile, label: string, hint: string }}
 */
export function classifyCodeMapProfile(path, patch, map, fileStatus = "") {
  const nodes = map.nodes ?? [];
  const steps = nodes.filter((n) => n.kind === "step").length;
  const tables = nodes.filter((n) => n.kind === "table").length;
  const exports = nodes.filter((n) => n.kind === "export").length;
  const symbols = nodes.filter((n) => n.kind === "symbol" || n.kind === "definition").length;
  const calls = nodes.filter((n) => n.kind === "call").length;
  const isNew = fileStatus === "added";
  const { added } = collectReadablePatchText(patch ?? "");

  if (/\.ya?ml$/i.test(path)) {
    const sections = nodes.filter((n) => n.kind === "definition").length;
    const keys = nodes.filter((n) => n.kind === "symbol").length;
    return {
      level: "rich",
      profile: "local-edit",
      label: "YAML config",
      hint: "Structure: document → sections → keys. Behavior summarizes what is configured.",
    };
  }

  if (/\.(json|json5|jsonc)$/i.test(path)) {
    return {
      level: "rich",
      profile: "local-edit",
      label: "JSON config",
      hint: "Structure: document → object keys and arrays. Behavior summarizes configured values.",
    };
  }

  if (isSqlFile(path) && (steps >= 1 || tables >= 1)) {
    return {
      level: "rich",
      profile: "sql-migration",
      label: "SQL migration",
      hint: "Granular: each SQL step and table, plus call edges where present.",
    };
  }

  const servicePath = /(?:^|\/)(services?|api|server|handlers?|controllers?|routes?|lambda|workers?|grpc)(\/|$)/i.test(
    path
  );

  if (isNew && servicePath) {
    return {
      level: "rich",
      profile: "new-service",
      label: "New service",
      hint: "Granular: exports, imports, symbols, and call sites.",
    };
  }

  if (isNew || (exports >= 1 && symbols >= 2)) {
    return {
      level: "rich",
      profile: "new-module",
      label: isNew ? "New module" : "Module surface",
      hint: "Granular: exports, imports, symbols, and call sites.",
    };
  }

  if (symbols >= 5 && (exports >= 1 || calls >= 8)) {
    return {
      level: "rich",
      profile: "new-module",
      label: "Structure + calls",
      hint: "Granular map with call nodes and dependencies.",
    };
  }

  if (added >= 80 && symbols >= 3) {
    return {
      level: "rich",
      profile: "new-module",
      label: "Large addition",
      hint: "Granular map of new surface and calls in this file.",
    };
  }

  if (calls >= 1 || symbols >= 1 || nodes.length >= 12) {
    return {
      level: "rich",
      profile: "local-edit",
      label: "File change",
      hint: "Structure: types, imports, exports. Summary below explains what it does.",
    };
  }

  return {
    level: "rich",
    profile: "local-edit",
    label: "Overview",
    hint: "Structure map — behavior summarized under the path.",
  };
}

/**
 * Full detail map for the rail (per-call nodes, no invocation rollup).
 *
 * @param {{
 *   fileLabel: string,
 *   header: string,
 *   whatItDoes: string,
 *   nodes: { id: string, label: string, kind: string, scope?: string }[],
 *   edges: { from: string, to: string, label?: string, style?: string }[],
 * }} map
 * @param {{ level?: CodeMapDetailLevel } | null} [profile]
 */
export function toGranularCodeMap(map, profile = null) {
  const cap = profile?.level === "rich" ? GRANULAR_CAP_RICH : GRANULAR_CAP_COMPACT;
  let nodes = prioritizeGranularNodes(map.nodes ?? [], cap);
  const nodeIds = new Set(nodes.map((n) => n.id));
  let edges = (map.edges ?? []).filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const header = /\b(AST|granular|symbols?|calls?)\b/i.test(map.header)
    ? map.header
    : `${map.header} · AST · symbols · calls`;

  return {
    ...map,
    header,
    nodes,
    edges,
  };
}

/**
 * @param {typeof map.nodes} nodes
 * @param {number} cap
 */
function prioritizeGranularNodes(nodes, cap) {
  if (nodes.length <= cap) return [...nodes];

  const mustKinds = new Set(["entry", "step", "table", "export", "import", "definition"]);
  const mustRank = (n) => {
    if (n.kind === "entry") return 0;
    if (n.kind === "step") return 1;
    if (n.kind === "table") return 2;
    if (n.kind === "export") return 3;
    if (n.kind === "import") return 4;
    if (n.kind === "definition") return 5;
    return 9;
  };
  const must = [...nodes.filter((n) => mustKinds.has(n.kind))].sort(
    (a, b) => mustRank(a) - mustRank(b) || a.label.localeCompare(b.label)
  );
  const calls = nodes.filter((n) => n.kind === "call");
  const symbols = [...nodes.filter((n) => n.kind === "symbol")].sort(
    (a, b) => (a.scope ?? "").localeCompare(b.scope ?? "") || a.label.localeCompare(b.label)
  );
  const other = nodes.filter((n) => !mustKinds.has(n.kind) && n.kind !== "call" && n.kind !== "symbol");

  /** @type {typeof nodes} */
  const kept = [];
  for (const n of must) {
    if (kept.length >= cap - 1) break;
    kept.push(n);
  }

  let room = cap - 1 - kept.length;
  const callTake = Math.min(calls.length, room > 0 ? Math.max(Math.floor(room * 0.62), Math.min(calls.length, 64)) : 0);
  kept.push(...calls.slice(0, callTake));
  room = cap - 1 - kept.length;
  const symTake = Math.min(symbols.length, room);
  kept.push(...symbols.slice(0, symTake));
  room = cap - 1 - kept.length;
  if (room > 0) kept.push(...other.slice(0, room));

  kept.push({
    id: "granular_more",
    label: `+${nodes.length - kept.length} more in file`,
    kind: "external",
    scope: "__granular__",
  });
  return kept.slice(0, cap);
}

const STRUCTURAL_KINDS = new Set([
  "entry",
  "step",
  "table",
  "import",
  "export",
  "symbol",
  "definition",
  "module",
  "module-focus",
]);

/**
 * High-level structure map for the rail (no per-call nodes).
 *
 * @param {{
 *   fileLabel: string,
 *   header: string,
 *   whatItDoes: string,
 *   nodes: { id: string, label: string, kind: string, scope?: string }[],
 *   edges: { from: string, to: string, label?: string, style?: string }[],
 * }} map
 * @param {{ level?: CodeMapDetailLevel } | null} [profile]
 */
export function toStructuralCodeMap(map, profile = null) {
  const calls = map.nodes.filter((n) => n.kind === "call");
  const isRich = profile?.level === "rich";
  const cap = isRich ? STRUCTURE_CAP_RICH : COMPACT_NODE_CAP;
  const kinds = isRich
    ? new Set([...STRUCTURAL_KINDS, "call", "method", "field", "property"])
    : STRUCTURAL_KINDS;
  /** @type {typeof map.nodes} */
  let nodes = prioritizeStructuralNodes(
    map.nodes.filter((n) => kinds.has(n.kind)),
    cap
  );

  /** @type {typeof map.edges} */
  const extraEdges = [];

  const structureHasCalls = nodes.some((n) => n.kind === "call");
  if (calls.length > 0 && !isRich) {
    const rollupId = "invocations_rollup";
    nodes.push({
      id: rollupId,
      label: calls.length === 1 ? "1 invocation (see diff)" : `${calls.length} invocations (see diff)`,
      kind: "external",
      scope: "__structure__",
    });
    const anchor =
      nodes.find((n) => n.kind === "export")?.id ??
      nodes.find((n) => n.kind === "symbol" || n.kind === "definition")?.id ??
      nodes.find((n) => n.kind === "entry")?.id ??
      nodes.find((n) => n.kind === "step")?.id;
    if (anchor) {
      extraEdges.push({ from: anchor, to: rollupId, label: "invokes", style: "dotted" });
    }
  } else if (calls.length > 0 && isRich && !structureHasCalls) {
    const rollupId = "invocations_rollup";
    nodes.push({
      id: rollupId,
      label: `${calls.length} call sites (open Behavior tab)`,
      kind: "external",
      scope: "__structure__",
    });
    const anchor =
      nodes.find((n) => n.kind === "export")?.id ??
      nodes.find((n) => n.kind === "symbol" || n.kind === "definition")?.id ??
      nodes.find((n) => n.kind === "entry")?.id;
    if (anchor) {
      extraEdges.push({ from: anchor, to: rollupId, label: "invokes", style: "dotted" });
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [...map.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)), ...extraEdges].filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to)
  );

  const header = /structure/i.test(map.header) ? map.header : `${map.header} · structure`;

  return {
    ...map,
    header,
    nodes,
    edges,
  };
}

/**
 * @param {typeof map.nodes} nodes
 * @param {number} cap
 */
function prioritizeStructuralNodes(nodes, cap) {
  const rank = (n) => {
    if (n.kind === "entry") return 0;
    if (n.kind === "step") return 1;
    if (n.kind === "table") return 2;
    if (n.kind === "export") return 3;
    if (n.kind === "import") return 4;
    if (n.kind === "definition") return 5;
    if (n.kind === "call") return 6;
    if (n.kind === "method" || n.kind === "field" || n.kind === "property") return 6;
    if (n.kind === "symbol" && !n.scope) return 7;
    if (n.kind === "symbol") return 8;
    return 9;
  };
  const sorted = [...nodes].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  if (sorted.length <= cap) return sorted;
  const kept = sorted.slice(0, cap - 1);
  kept.push({
    id: "structure_more",
    label: `+${sorted.length - cap + 1} more in file`,
    kind: "external",
    scope: "__structure__",
  });
  return kept;
}

/** @deprecated Use toStructuralCodeMap */
export function simplifyCodeMapForDetail(map, level) {
  return toStructuralCodeMap(map, { level });
}

/**
 * Short plain-language summary for the code-map rail (graph stays optional detail).
 *
 * @param {{
 *   fileLabel: string,
 *   header: string,
 *   whatItDoes: string,
 *   nodes: { id: string, label: string, kind: string, scope?: string }[],
 * }} map
 * @param {{ label?: string, profile?: string } | null} [profile]
 */
export function summarizeCodeMap(map, profile = null) {
  const nodes = map.nodes ?? [];
  const steps = nodes.filter((n) => n.kind === "step").map((n) => n.label);
  const tables = [...new Set(nodes.filter((n) => n.kind === "table").map((n) => n.label.replace(/^table\s+/i, "")))];
  const imports = nodes.filter((n) => n.kind === "import").map((n) => shortLabel(n.label));
  const exports = nodes.filter((n) => n.kind === "export").map((n) => shortLabel(n.label));
  const symbols = nodes
    .filter((n) => n.kind === "symbol" || n.kind === "definition")
    .map((n) => shortLabel(n.label));
  const calls = nodes.filter((n) => n.kind === "call").map((n) => n.label);

  /** @type {string[]} */
  const bullets = [];

  if (steps.length) {
    const chain = steps
      .slice(0, 3)
      .map((s) => (s.length > 48 ? `${s.slice(0, 45)}…` : s))
      .join(" → ");
    bullets.push(
      `${steps.length} SQL step${steps.length === 1 ? "" : "s"}${chain ? `: ${chain}` : ""}${
        steps.length > 3 ? "…" : ""
      }`
    );
  }
  if (tables.length) {
    bullets.push(
      `Touches ${tables.slice(0, 4).join(", ")}${tables.length > 4 ? ` (+${tables.length - 4} more tables)` : ""}`
    );
  }
  if (exports.length) {
    bullets.push(`Exports ${uniq(exports).slice(0, 4).join(", ")}${exports.length > 4 ? "…" : ""}`);
  }
  if (symbols.length) {
    bullets.push(`Defines ${uniq(symbols).slice(0, 4).join(", ")}${symbols.length > 4 ? ` (+${symbols.length - 4} more)` : ""}`);
  }
  if (imports.length) {
    bullets.push(`Imports ${uniq(imports).slice(0, 3).join(", ")}${imports.length > 3 ? "…" : ""}`);
  }
  if (calls.length) {
    const uniqCalls = uniq(calls.map((c) => c.replace(/\s+/g, " ").trim()));
    bullets.push(
      `${calls.length} call site${calls.length === 1 ? "" : "s"}${uniqCalls.length ? ` (e.g. ${uniqCalls.slice(0, 3).join(", ")})` : ""}`
    );
  }

  const structure = structureOutline(map);
  const layoutMeta = describeCodeMapLayout(map, profile?.path ?? "");
  if (structure && structure !== "file") {
    bullets.unshift(`Structure: ${structure}`);
  }
  if (layoutMeta.line) {
    bullets.push(layoutMeta.line);
  }

  let lead = (map.whatItDoes ?? "").trim();
  if (!lead) lead = (map.header ?? "").trim();
  if (profile?.label && lead && !lead.toLowerCase().startsWith(profile.label.toLowerCase())) {
    lead = `${profile.label}: ${lead}`;
  } else if (profile?.label && !lead) {
    lead = profile.label;
  }

  if (!bullets.length && lead) bullets.push(lead);

  return {
    lead,
    bullets: bullets.slice(0, 6),
    structure,
    layout: layoutMeta,
  };
}

/**
 * @param {string} label
 */
function shortLabel(label) {
  return String(label ?? "")
    .replace(/^export\s+/i, "")
    .replace(/^(function|class|const fn)\s+/i, "")
    .trim();
}

/**
 * @param {string[]} list
 */
function uniq(list) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const item of list) {
    const k = item.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}