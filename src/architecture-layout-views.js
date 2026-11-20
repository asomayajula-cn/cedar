/**
 * Complete layout: UML components, request flow, and event sequence (PR architecture + slice tags).
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 * @typedef {import('./pr-architecture-layers.js').PrArchitectureLayer} PrArchitectureLayer
 */

import { normalizeSliceId } from "./architecture-model.js";
import { formatPrHubLabel, primaryClassNames } from "./diagram-labels.js";
import { buildPrArchitectureLayers } from "./pr-architecture-layers.js";
import { mermaidClassId, mermaidParticipantAlias, mermaidSafeText } from "./mermaid-sanitize.js";

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
/**
 * @param {PrArchitectureLayer[]} layers
 */
function buildClassAnchorMaps(layers) {
  /** @type {Map<string, string>} typeName → mermaid class id */
  const mermaidIdByType = new Map();
  /** @type {Map<string, string>} layer id → primary class id */
  const anchorByLayer = new Map();
  const classLines = [];

  for (const layer of layers) {
    const layerTypes = layer.types ?? [];
    if (!layerTypes.length) {
      const className = `${safeIdent(layer.id)}_layer`;
      mermaidIdByType.set(className, className);
      anchorByLayer.set(layer.id, className);
      classLines.push(`  class ${className}["${mermaidSafeText(layer.name)}"]`);
      continue;
    }

    const layerAnchors = [];
    for (const typeName of layerTypes) {
      const className = mermaidClassId(typeName, mermaidIdByType);
      if (!mermaidIdByType.has(typeName)) {
        mermaidIdByType.set(typeName, className);
        classLines.push(`  class ${className}["${mermaidSafeText(typeName)}"]`);
      }
      layerAnchors.push(className);
    }
    if (layerAnchors[0]) anchorByLayer.set(layer.id, layerAnchors[0]);
  }

  return { mermaidIdByType, anchorByLayer, classLines };
}

/**
 * @param {PrArchitectureLayer[]} layers
 */
function buildComponentsClassDiagram(layers) {
  if (!layers.length) {
    return 'classDiagram\n  class EmptyPR["No changed layers"]';
  }

  const lines = ["classDiagram", layers.length <= 4 ? "  direction LR" : "  direction TB"];
  const { anchorByLayer, classLines } = buildClassAnchorMaps(layers);
  lines.push(...classLines);

  const deps = new Set();
  for (const layer of layers) {
    const from = anchorByLayer.get(layer.id);
    if (!from) continue;
    for (const depId of layer.dependsOn) {
      const dep = normalizeSliceId(depId);
      const to = anchorByLayer.get(dep);
      if (to && from !== to) {
        const key = `${from}..>${to}`;
        if (!deps.has(key)) {
          deps.add(key);
          lines.push(`  ${from} ..> ${to} : uses`);
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

  const prLabel = mermaidSafeText(formatPrHubLabel(pull, target));
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
    const labelSafe = mermaidSafeText(label);
    const shape = kind === "ops" ? `[${labelSafe}]` : `["${labelSafe}"]`;
    lines.push(`  ${nid}${shape}:::${kind}`);
  };

  for (const layer of layers) {
    const names = primaryClassNames(layer, 4);
    const label = names.length ? names.join(", ") : layer.name;
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
      lines.push(`  ${from.nid} -.->|${mermaidSafeText(link.label)}| ${to.nid}`);
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

  const { mermaidIdByType, anchorByLayer } = buildClassAnchorMaps(layers);
  const lines = ["sequenceDiagram", "  autonumber"];
  const declared = new Set();

  const declareClass = (classId, displayName) => {
    if (!classId || declared.has(classId)) return;
    declared.add(classId);
    lines.push(`  participant ${classId} as ${mermaidParticipantAlias(displayName)}`);
  };

  for (const layer of layers) {
    for (const typeName of layer.types ?? []) {
      const classId = mermaidIdByType.get(typeName);
      if (classId) declareClass(classId, typeName);
    }
    if (!(layer.types?.length)) {
      const classId = anchorByLayer.get(layer.id);
      if (classId) declareClass(classId, layer.name);
    }
  }

  const messageKeys = new Set();

  const message = (from, to, label = "call") => {
    if (!from || !to || from === to) return;
    const key = `${from}->>${to}:${label}`;
    if (messageKeys.has(key)) return;
    messageKeys.add(key);
    lines.push(`  ${from}->>${to}: ${mermaidSafeText(label)}`);
  };

  const chain = REQUEST_CHAIN.filter((id) => active.has(id) && anchorByLayer.has(id));
  for (let i = 0; i < chain.length - 1; i++) {
    message(anchorByLayer.get(chain[i]), anchorByLayer.get(chain[i + 1]));
  }

  for (const layer of layers) {
    const from = anchorByLayer.get(layer.id);
    if (!from) continue;
    for (const depId of layer.dependsOn) {
      message(from, anchorByLayer.get(normalizeSliceId(depId)), "uses");
    }
  }

  for (const link of OPS_LINKS) {
    if (!active.has(link.from) || !active.has(link.to)) continue;
    message(anchorByLayer.get(link.from), anchorByLayer.get(link.to), link.label);
  }

  for (const layer of layers) {
    const types = layer.types ?? [];
    for (let i = 0; i < types.length - 1; i++) {
      const a = mermaidIdByType.get(types[i]);
      const b = mermaidIdByType.get(types[i + 1]);
      message(a, b, "collaborates");
    }
  }

  if (lines.length <= 2) {
    const first = anchorByLayer.get(layers[0].id);
    if (first) {
      lines.push("  actor Caller as Caller");
      message("Caller", first, "invoke");
    }
  }

  return lines.join("\n");
}

/**
 * @param {PrArchitectureLayer} layer
 */

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
