/**
 * Complete layout: UML components, request flow, and event sequence (PR architecture + slice tags).
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 * @typedef {import('./pr-architecture-layers.js').PrArchitectureLayer} PrArchitectureLayer
 */

import { normalizeSliceId } from "./architecture-model.js";
import { formatArchitectureLayerLabel, formatPrHubLabel, formatSliceTag } from "./diagram-labels.js";
import { buildPrArchitectureLayers } from "./pr-architecture-layers.js";

const MAX_LAYERS = 16;

/** Runtime request path (subset used when layers are present). */
const REQUEST_CHAIN = ["web", "api", "application", "domain", "repository", "infrastructure"];

/** Sidecar ops layers linked into flow. */
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
  const layers = buildPrArchitectureLayers(microPrs, breakouts).slice(0, MAX_LAYERS);
  const active = new Set(layers.map((l) => l.id));

  return {
    components: buildComponentsClassDiagram(layers),
    flow: buildRequestFlowDiagram(layers, active, pull, target),
    events: buildEventsSequenceDiagram(layers, active),
  };
}

/**
 * @param {PrArchitectureLayer[]} layers
 */
function buildComponentsClassDiagram(layers) {
  if (!layers.length) {
    return "classDiagram\n  class PR {\n    <<empty>>\n    No changed layers\n  }";
  }

  const lines = ["classDiagram", layers.length <= 4 ? "  direction LR" : "  direction TB"];
  const classByLayer = new Map();

  for (const layer of layers) {
    const className = `${safeIdent(layer.id)}_layer`;
    classByLayer.set(layer.id, className);
    const title = mermaidSafe(layer.name);
    lines.push(`  class ${className}["${title}"]`);
    if (layer.summary) {
      lines.push(`  ${className} : ${mermaidSafe(layer.summary)}`);
    }
    for (const t of layer.types) {
      lines.push(`  ${className} : ${mermaidSafe(t)}`);
    }
    lines.push(`  ${className} : ${mermaidSafe(formatSliceTag(layer.micro))}`);
  }

  const deps = new Set();
  for (const layer of layers) {
    const from = classByLayer.get(layer.id);
    for (const depId of layer.dependsOn) {
      const dep = normalizeSliceId(depId);
      const to = classByLayer.get(dep);
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
 * @param {PrArchitectureLayer[]} layers
 * @param {Set<string>} active
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
function buildRequestFlowDiagram(layers, active, pull, target) {
  if (!layers.length) {
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

  for (const layer of layers) {
    const label = flowNodeLabel(layer);
    register(layer.id, label);
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

  for (const layer of layers) {
    const from = nodeId.get(layer.id);
    if (!from) continue;
    for (const dep of layer.dependsOn) {
      const to = nodeId.get(normalizeSliceId(dep));
      if (to && to.nid !== from.nid) {
        lines.push(`  ${from.nid} -.-> ${to.nid}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {Set<string>} active
 */
function buildEventsSequenceDiagram(layers, active) {
  if (!layers.length) {
    return "sequenceDiagram\n  participant PR as Pull request\n  PR->>PR: No layer changes";
  }

  const lines = ["sequenceDiagram", "  autonumber"];
  /** @type {Map<string, string>} */
  const alias = new Map();

  const ensure = (layer) => {
    const key = layer.id;
    if (alias.has(key)) return alias.get(key);
    const a = safeIdent(key).slice(0, 24) || "layer";
    alias.set(key, a);
    const display = mermaidSafe(`${layer.name} · ${formatSliceTag(layer.micro)}`);
    lines.push(`  participant ${a} as ${display}`);
    return a;
  };

  const layerById = new Map(layers.map((l) => [l.id, l]));

  if (active.has("web")) {
    const webLayer = layerById.get("web");
    if (webLayer) ensure(webLayer);
    else {
      alias.set("web", "web");
      lines.push("  participant web as Client / Web");
    }
  } else {
    lines.push("  actor Client as Client");
  }

  const order = ["api", "application", "domain", "repository", "infrastructure"];
  for (const id of order) {
    if (!active.has(id)) continue;
    const layer = layerById.get(id);
    if (layer) ensure(layer);
  }

  for (const id of ["config", "build_deploy", "integration", "infra", "migrations", "persistence", "tests", "misc"]) {
    if (!active.has(id)) continue;
    const layer = layerById.get(id);
    if (layer) ensure(layer);
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
    const first = layers[0];
    const a = ensure(first);
    lines.push(`  Client->>${a}: ${mermaidSafe(formatSliceTag(first.micro))}`);
  }

  return lines.join("\n");
}

/**
 * @param {PrArchitectureLayer} layer
 */
function flowNodeLabel(layer) {
  return formatArchitectureLayerLabel(layer.name, formatSliceTag(layer.micro)).replace(/\n/g, " · ");
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