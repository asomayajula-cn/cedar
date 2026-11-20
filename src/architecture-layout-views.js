/**
 * Complete layout: UML components, request flow, and event sequence (all PRs).
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import { displayNameForSlice, normalizeSliceId } from "./architecture-model.js";
import { slicesForArchitectureDiagram } from "./diagram-layout.js";
import { formatPrHubLabel } from "./diagram-labels.js";

const MAX_TYPES_PER_SLICE = 14;
const MAX_SLICES = 16;

/** Runtime request path (subset used when slices are present). */
const REQUEST_CHAIN = ["web", "api", "application", "domain", "repository", "infrastructure"];

/** Sidecar ops slices linked into flow. */
const OPS_LINKS = [
  { from: "config", to: "api", label: "configures" },
  { from: "config", to: "application", label: "configures" },
  { from: "build_deploy", to: "api", label: "release" },
  { from: "integration", to: "api", label: "contract" },
  { from: "infrastructure", to: "application", label: "adapters" },
  { from: "persistence", to: "repository", label: "storage" },
  { from: "migrations", to: "repository", label: "schema" },
];

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildCompleteLayoutViews(microPrs, breakouts, pull, target) {
  const touched = slicesForArchitectureDiagram(microPrs).slice(0, MAX_SLICES);
  const active = new Set(touched.map((m) => normalizeSliceId(m.componentId)));

  return {
    components: buildComponentsClassDiagram(touched, breakouts),
    flow: buildRequestFlowDiagram(touched, active, pull, target),
    events: buildEventsSequenceDiagram(touched, active),
  };
}

/**
 * @param {MicroPr[]} touched
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 */
function buildComponentsClassDiagram(touched, breakouts) {
  if (!touched.length) {
    return "classDiagram\n  class PR {\n    <<empty>>\n    No changed layers\n  }";
  }

  const lines = [
    "classDiagram",
    touched.length <= 4 ? "  direction LR" : "  direction TB",
  ];
  const classBySlice = new Map();

  for (const m of touched) {
    const id = normalizeSliceId(m.componentId);
    const className = `${safeIdent(id)}_layer`;
    const types = collectChangedTypes(m);
    classBySlice.set(id, className);
    const title = mermaidSafe(displayNameForSlice(id, m.componentName));
    lines.push(`  class ${className} {`);
    lines.push(`    <<${title}>>`);
    for (const t of types) {
      lines.push(`    +${mermaidSafe(t)}`);
    }
    if (!types.length) {
      lines.push(`    +${m.files.length} file(s)`);
    }
    lines.push("  }");
  }

  const deps = new Set();
  for (const m of touched) {
    const from = classBySlice.get(normalizeSliceId(m.componentId));
    for (const depId of [
      ...(m.dependsOn ?? []),
      ...(breakouts?.components?.find((c) => c.id === m.componentId)?.depends_on ?? []),
    ]) {
      const dep = normalizeSliceId(depId);
      const to = classBySlice.get(dep);
      if (from && to && from !== to) {
        const key = `${from}..>${to}`;
        if (!deps.has(key)) {
          deps.add(key);
          lines.push(`  ${from} ..> ${to} : depends`);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {MicroPr[]} touched
 * @param {Set<string>} active
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
function buildRequestFlowDiagram(touched, active, pull, target) {
  if (!touched.length) {
    return "flowchart LR\n  empty[No layers in PR]";
  }

  const prLabel = mermaidSafe(formatPrHubLabel(pull, target));
  const lines = [
    "flowchart LR",
    "  classDef pr fill:#fafafa,stroke:#171717,stroke-width:2px,color:#0a0a0a",
    "  classDef layer fill:#141414,stroke:#737373,stroke-width:1px,color:#f5f5f5",
    "  classDef ops fill:#0a0a0a,stroke:#525252,stroke-width:1px,color:#a3a3a3",
    `  pr(("${prLabel}")):::pr`,
  ];

  const nodeId = new Map();
  const register = (id, label, kind = "layer") => {
    const key = normalizeSliceId(id);
    if (!active.has(key) || nodeId.has(key)) return;
    const nid = `flow_${safeIdent(key)}`;
    nodeId.set(key, { nid, kind });
    const shape = kind === "ops" ? `[${mermaidSafe(label)}]` : `["${mermaidSafe(label)}"]`;
    lines.push(`  ${nid}${shape}:::${kind}`);
  };

  for (const m of touched) {
    register(m.componentId, displayNameForSlice(m.componentId, m.componentName));
  }

  const chainPresent = REQUEST_CHAIN.filter((id) => active.has(id));
  const entry =
    (chainPresent.includes("web") && nodeId.get("web")) ||
    (chainPresent.includes("api") && nodeId.get("api")) ||
    (chainPresent[0] && nodeId.get(chainPresent[0]));
  if (entry) lines.push(`  pr --> ${entry.nid}`);
  for (let i = 0; i < chainPresent.length - 1; i++) {
    const a = nodeId.get(chainPresent[i]);
    const b = nodeId.get(chainPresent[i + 1]);
    if (a && b) lines.push(`  ${a.nid} --> ${b.nid}`);
  }

  if (!chainPresent.includes("web") && chainPresent.includes("api")) {
    lines.push(`  client["Client / caller"]:::ops`);
    const api = nodeId.get("api");
    if (api) lines.push(`  client --> ${api.nid}`);
  }

  for (const link of OPS_LINKS) {
    if (!active.has(link.from) || !active.has(link.to)) continue;
    const from = nodeId.get(link.from);
    const to = nodeId.get(link.to);
    if (from && to) {
      lines.push(`  ${from.nid} -.->|${mermaidSafe(link.label)}| ${to.nid}`);
    }
  }

  for (const m of touched) {
    const from = nodeId.get(normalizeSliceId(m.componentId));
    if (!from) continue;
    for (const dep of m.dependsOn ?? []) {
      const to = nodeId.get(normalizeSliceId(dep));
      if (to && to.nid !== from.nid) {
        lines.push(`  ${from.nid} -.-> ${to.nid}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {MicroPr[]} touched
 * @param {Set<string>} active
 */
function buildEventsSequenceDiagram(touched, active) {
  if (!touched.length) {
    return "sequenceDiagram\n  participant PR as Pull request\n  PR->>PR: No layer changes";
  }

  const lines = ["sequenceDiagram", "  autonumber"];
  /** @type {Map<string, string>} */
  const alias = new Map();

  const ensure = (id, display) => {
    const key = normalizeSliceId(id);
    if (alias.has(key)) return alias.get(key);
    const a = safeIdent(key).slice(0, 24) || "layer";
    alias.set(key, a);
    lines.push(`  participant ${a} as ${mermaidSafe(display)}`);
    return a;
  };

  if (active.has("web")) ensure("web", "Client / Web");
  else lines.push("  actor Client as Client");

  const order = ["api", "application", "domain", "repository", "infrastructure"];
  for (const id of order) {
    if (!active.has(id)) continue;
    const m = touched.find((s) => normalizeSliceId(s.componentId) === id);
    ensure(id, m?.componentName ?? displayNameForSlice(id));
  }

  for (const id of ["config", "build_deploy", "integration", "infra", "migrations", "persistence", "tests", "misc"]) {
    if (!active.has(id)) continue;
    const m = touched.find((s) => normalizeSliceId(s.componentId) === id);
    ensure(id, m?.componentName ?? displayNameForSlice(id));
  }

  const client = active.has("web") ? alias.get("web") : "Client";
  const api = alias.get("api");
  const app = alias.get("application");
  const domain = alias.get("domain");
  const repo = alias.get("repository");
  const infra = alias.get("infrastructure");

  if (api) {
    lines.push(active.has("web") ? `  ${client}->>${api}: HTTP request` : `  Client->>${api}: HTTP request`);
  }
  if (api && app) lines.push(`  ${api}->>${app}: invoke use case`);
  else if (api && domain) lines.push(`  ${api}->>${domain}: domain call`);
  if (app && domain) lines.push(`  ${app}->>${domain}: command`);
  if (domain && app) lines.push(`  ${domain}-->>${app}: domain event / result`);
  if (app && repo) lines.push(`  ${app}->>${repo}: persist`);
  else if (domain && repo) lines.push(`  ${domain}->>${repo}: persist`);
  if (repo && app) lines.push(`  ${repo}-->>${app}: stored`);
  if (infra && app) lines.push(`  ${infra}-->>${app}: adapter (ports)`);

  const config = alias.get("config");
  if (config && api) lines.push(`  ${config}-->>${api}: runtime config (III)`);
  const build = alias.get("build_deploy");
  if (build && api) lines.push(`  ${build}-->>${api}: build & release (V)`);

  if (lines.length <= 2) {
    const first = touched[0];
    const a = ensure(first.componentId, first.componentName);
    lines.push(`  Client->>${a}: change in ${mermaidSafe(first.componentName)}`);
  }

  return lines.join("\n");
}

/**
 * @param {MicroPr} micro
 * @returns {string[]}
 */
function collectChangedTypes(micro) {
  /** @type {Set<string>} */
  const types = new Set();

  for (const f of micro.files ?? []) {
    const path = f.filename ?? "";
    const base = path.split("/").pop() ?? path;
    const fromName = typeNameFromPath(base);
    if (fromName) types.add(fromName);

    const patch = f.patch ?? "";
    for (const m of patch.matchAll(/^\+\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+)?(?:class|interface|enum|record)\s+(\w+)/gm)) {
      types.add(m[1]);
    }
    for (const m of patch.matchAll(/^\+\s*export\s+(?:default\s+)?(?:class|interface|type|function)\s+(\w+)/gm)) {
      types.add(m[1]);
    }
  }

  return [...types].slice(0, MAX_TYPES_PER_SLICE);
}

/**
 * @param {string} filename
 */
function typeNameFromPath(filename) {
  const m = filename.match(/^(.+)\.(java|kt|ts|tsx|jsx|js|go|py|rb)$/i);
  if (!m) return "";
  const base = m[1];
  if (base === "index" || base === "mod") return "";
  return base.replace(/[^A-Za-z0-9_$]/g, "") || "";
}

/**
 * @param {{ components: string, flow: string, events: string }} views
 */
export function buildCompleteLayoutMarkdown(views) {
  return [
    "### Complete layout",
    "",
    "#### UML · components",
    "",
    "```mermaid",
    views.components,
    "```",
    "",
    "#### Flow",
    "",
    "```mermaid",
    views.flow,
    "```",
    "",
    "#### Events",
    "",
    "```mermaid",
    views.events,
    "```",
  ].join("\n");
}

function safeIdent(s) {
  return String(s).replace(/[^a-zA-Z0-9_]/g, "_") || "layer";
}

function mermaidSafe(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "'")
    .replace(/#/g, "")
    .replace(/;/g, ",")
    .replace(/[()]/g, " ")
    .trim();
}