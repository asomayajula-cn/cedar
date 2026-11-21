/**
 * Complete layout: UML · components, flow, and events (one node per virtual micro-PR slice).
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 * @typedef {import('./pr-architecture-layers.js').PrArchitectureLayer} PrArchitectureLayer
 */

import { normalizeSliceId } from "./architecture-model.js";
import { formatPrHubLabel, mermaidFlowNodeLabel } from "./diagram-labels.js";
import { buildPrArchitectureLayers } from "./pr-architecture-layers.js";
import { mermaidParticipantAlias, mermaidSafeText } from "./mermaid-sanitize.js";
import { buildClassMembersIndex } from "./architecture-source-symbols.js";
import { layerAccentForTheme } from "./diagram-colors.js";

const MAX_LAYERS = 16;

/** Runtime request path (subset used when layers are present). */
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
 * @param {{ from: string, to: string }} edge
 */
function requestChainMessage(edge) {
  const key = `${edge.from}->${edge.to}`;
  /** @type {Record<string, string>} */
  const messages = {
    "client->api": "submit request",
    "client->web": "submit request",
    "web->api": "route",
    "api->application": "invoke",
    "application->domain": "command",
    "domain->application": "domain result",
    "application->repository": "persist",
    "repository->application": "stored",
    "domain->repository": "persist",
    "repository->domain": "stored",
    "infrastructure->application": "adapter callback",
  };
  return messages[key] ?? "call";
}

/**
 * @param {PrArchitectureLayer[]} layers
 */
function buildClassRegistry(layers) {
  /** @type {Map<string, string>} */
  const typeToMermaidId = new Map();
  /** @type {Map<string, string[]>} */
  const layerToClassIds = new Map();
  /** @type {Map<string, string>} */
  const layerToAnchor = new Map();
  /** @type {Map<string, string>} */
  const mermaidIdToType = new Map();
  /** @type {Array<{ typeName: string, mermaidId: string, layerId: string, layer: PrArchitectureLayer }>} */
  const classes = [];

  for (const layer of layers) {
    const typeNames =
      layer.classNames?.length > 0
        ? layer.classNames
        : [String(layer.name ?? layer.id).trim()];
    const mermaidIds = [];
    let idx = 0;
    for (const typeName of typeNames.slice(0, 8)) {
      const mermaidId = `${safeIdent(typeName)}_${safeIdent(layer.id)}_${idx}`;
      idx += 1;
      mermaidIds.push(mermaidId);
      mermaidIdToType.set(mermaidId, typeName);
      classes.push({ typeName, mermaidId, layerId: layer.id, layer });
    }
    if (!mermaidIds.length) continue;
    typeToMermaidId.set(layer.id, mermaidIds[0]);
    layerToClassIds.set(layer.id, mermaidIds);
    layerToAnchor.set(layer.id, mermaidIds[0]);
  }

  return { typeToMermaidId, layerToClassIds, layerToAnchor, mermaidIdToType, classes };
}

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 * @param {Record<string, number> | Map<string, number>} [sliceNumberById]
 * @param {"day" | "night"} [theme]
 */
export function buildCompleteLayoutViews(microPrs, breakouts, pull, target, sliceNumberById, theme = "night") {
  const layers = buildPrArchitectureLayers(microPrs, breakouts).slice(0, MAX_LAYERS);
  const active = new Set(layers.map((l) => normalizeSliceId(l.id)));
  const registry = buildClassRegistry(layers);
  const sliceNums = sliceNumberById instanceof Map ? sliceNumberById : new Map(Object.entries(sliceNumberById ?? {}));
  const diagramTheme = theme === "day" ? "day" : "night";

  return {
    components: buildComponentsClassDiagram(
      layers,
      registry,
      sliceNums,
      buildClassMembersIndex(layers),
      diagramTheme
    ),
    flow: buildRequestFlowDiagram(layers, active, pull, target, diagramTheme),
    events: buildEventsSequenceDiagram(layers, active, registry),
  };
}

/**
 * @param {Map<string, { fields: string[], methods: string[] }>} membersByType
 * @param {string} typeName
 */
function resolveTypeMembers(membersByType, typeName) {
  const want = String(typeName ?? "").trim();
  if (!want || !membersByType?.size) return null;
  const direct = membersByType.get(want);
  if (direct && (direct.fields?.length || direct.methods?.length)) return direct;

  const lower = want.toLowerCase();
  for (const [k, v] of membersByType) {
    if (k.toLowerCase() === lower && (v.fields?.length || v.methods?.length)) return v;
  }

  const short = want.split(/[./]/).pop() ?? want;
  if (short && short !== want) {
    for (const [k, v] of membersByType) {
      const kShort = k.split(/[./]/).pop() ?? k;
      if (
        (k === short || kShort === short || k.endsWith(`.${short}`) || k.endsWith(`/${short}`)) &&
        (v.fields?.length || v.methods?.length)
      ) {
        return v;
      }
    }
  }
  return direct ?? null;
}

/**
 * @param {string} member
 */
function mermaidUmlMember(member) {
  return String(member)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "'")
    .replace(/#/g, "")
    .replace(/;/g, ",")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 56);
}

/**
 * @param {PrArchitectureLayer[]} layers
 * @param {ReturnType<typeof buildClassRegistry>} registry
 * @param {Map<string, number>} sliceNums
 * @param {Map<string, { fields: string[], methods: string[] }>} [membersByType]
 * @param {"day" | "night"} [theme]
 */
function buildComponentsClassDiagram(layers, registry, sliceNums, membersByType = new Map(), theme = "night") {
  void sliceNums;
  if (!layers.length) {
    return 'classDiagram\n  class EmptyPR["No changed layers"]';
  }

  const lines = ["classDiagram", layers.length <= 4 ? "  direction LR" : "  direction TB"];
  /** @type {Set<string>} */
  const declared = new Set();

  /** @param {string} className @param {string} layerId */
  const paintClass = (className, layerId) => {
    const accent = layerAccentForTheme(normalizeSliceId(layerId), theme);
    lines.push(
      `  style ${className} fill:${accent.fill},stroke:${accent.stroke},stroke-width:1.5px,color:${accent.text}`
    );
  };

  for (const c of registry.classes) {
    if (declared.has(c.mermaidId)) continue;
    declared.add(c.mermaidId);
    lines.push(`  class ${c.mermaidId}["${mermaidSafeText(c.typeName)}"]`);
    paintClass(c.mermaidId, c.layerId);
    const mem = resolveTypeMembers(membersByType, c.typeName);
    const fields = mem?.fields ?? [];
    const methods = mem?.methods ?? [];
    if (fields.length || methods.length) {
      for (const f of fields) {
        lines.push(`  ${c.mermaidId} : +${mermaidUmlMember(f)}`);
      }
      for (const m of methods) {
        lines.push(`  ${c.mermaidId} : +${mermaidUmlMember(m)}`);
      }
    } else if (c.layer.summary && c.mermaidId === registry.layerToAnchor.get(c.layerId)) {
      lines.push(`  ${c.mermaidId} : ${mermaidSafeText(c.layer.summary)}`);
    }
  }

  const deps = new Set();
  for (const layer of layers) {
    const from = registry.layerToAnchor.get(layer.id);
    if (!from) continue;
    for (const depId of layer.dependsOn) {
      const dep = normalizeSliceId(depId);
      const to = registry.layerToAnchor.get(dep);
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
function buildRequestFlowDiagram(layers, active, pull, target, theme = "night") {
  if (!layers.length) {
    return "flowchart LR\n  empty[No layers in PR]";
  }

  const prLabel = mermaidSafeText(formatPrHubLabel(pull, target));
  const isDay = theme === "day";
  const lines = [
    "flowchart LR",
    isDay
      ? "  classDef pr fill:#fafafa,stroke:#171717,stroke-width:2px,color:#0a0a0a"
      : "  classDef pr fill:#27272a,stroke:#e5e5e5,stroke-width:2px,color:#fafafa",
    isDay
      ? "  classDef layer fill:#f4f4f5,stroke:#71717a,stroke-width:1px,color:#18181b"
      : "  classDef layer fill:#141414,stroke:#737373,stroke-width:1px,color:#f5f5f5",
    isDay
      ? "  classDef ops fill:#fafafa,stroke:#a1a1aa,stroke-width:1px,color:#52525b"
      : "  classDef ops fill:#0a0a0a,stroke:#525252,stroke-width:1px,color:#a3a3a3",
    `  pr(("${prLabel}")):::pr`,
  ];

  const layerClassNames = new Map();
  for (const layer of layers) {
    const key = normalizeSliceId(layer.id);
    const accent = layerAccentForTheme(key, theme);
    const className = `cedar_${safeIdent(key)}`;
    layerClassNames.set(key, className);
    lines.push(
      `  classDef ${className} fill:${accent.fill},stroke:${accent.stroke},stroke-width:1.5px,color:${accent.text}`
    );
  }

  const nodeId = new Map();
  const register = (id, label, kind = "layer") => {
    const key = normalizeSliceId(id);
    if (!active.has(key) || nodeId.has(key)) return;
    const nid = `flow_${safeIdent(key)}`;
    nodeId.set(key, { nid, kind });
    const labelSafe = mermaidSafeText(label);
    const shape = kind === "ops" ? `[${labelSafe}]` : `["${labelSafe}"]`;
    const layerClass = layerClassNames.get(key);
    const suffix = layerClass && kind === "layer" ? `:::${layerClass}` : kind === "ops" ? ":::ops" : "";
    lines.push(`  ${nid}${shape}${suffix}`);
  };

  for (const layer of layers) {
    register(layer.id, mermaidFlowNodeLabel(layer));
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
 * @param {ReturnType<typeof buildClassRegistry>} registry
 */
function buildEventsSequenceDiagram(layers, active, registry) {
  if (!registry.classes.length) {
    return "sequenceDiagram\n  participant Empty as Empty\n  Empty->>Empty: No slices in PR";
  }

  const lines = ["sequenceDiagram", "  autonumber"];
  const seen = new Set();
  const anchor = (layerId) => registry.layerToAnchor.get(layerId);

  const webAnchor = anchor("web");
  if (!webAnchor || !active.has("web")) {
    lines.push("  actor Client as Client");
  }

  for (const c of registry.classes) {
    if (seen.has(c.mermaidId)) continue;
    seen.add(c.mermaidId);
    lines.push(`  participant ${c.mermaidId} as ${mermaidParticipantAlias(c.typeName)}`);
  }

  const msgDone = new Set();
  const emit = (from, to, text, dashed = false) => {
    if (!from || !to || from === to) return;
    const key = `${from}${dashed ? "--" : "->>"}${to}:${text}`;
    if (msgDone.has(key)) return;
    msgDone.add(key);
    const arrow = dashed ? "-->>" : "->>";
    lines.push(`  ${from}${arrow}${to}: ${mermaidSafeText(text)}`);
  };

  /** @type {Set<string>} */
  const chainPairs = new Set();
  const chainPresent = REQUEST_CHAIN.filter((id) => active.has(id) && anchor(id));
  if (chainPresent.length) {
    let prevKey = active.has("web") && webAnchor ? "web" : "client";
    let prevId = prevKey === "client" ? "Client" : webAnchor;
    for (const lid of chainPresent) {
      const toId = anchor(lid);
      if (!toId || !prevId) continue;
      emit(prevId, toId, requestChainMessage({ from: prevKey, to: lid }));
      chainPairs.add(`${prevId}->${toId}`);
      prevKey = lid;
      prevId = toId;
    }
  }

  if (anchor("domain") && anchor("application")) {
    emit(anchor("domain"), anchor("application"), "domain result", true);
  }
  if (anchor("repository") && anchor("application")) {
    emit(anchor("repository"), anchor("application"), "stored", true);
  } else if (anchor("repository") && anchor("domain")) {
    emit(anchor("repository"), anchor("domain"), "stored", true);
  }
  if (anchor("infrastructure") && anchor("application")) {
    emit(anchor("infrastructure"), anchor("application"), "adapter callback", true);
  }

  for (const layer of layers) {
    const from = anchor(layer.id);
    if (!from) continue;
    for (const dep of layer.dependsOn) {
      const to = anchor(normalizeSliceId(dep));
      if (chainPairs.has(`${from}->${to}`)) continue;
      emit(from, to, "uses");
    }
  }

  for (const link of OPS_LINKS) {
    if (!active.has(link.from) || !active.has(link.to)) continue;
    emit(anchor(link.from), anchor(link.to), link.label, true);
  }

  for (const layer of layers) {
    const ids = registry.layerToClassIds.get(layer.id) ?? [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = ids[i];
      const b = ids[i + 1];
      const aName = registry.mermaidIdToType.get(a) ?? a;
      const bName = registry.mermaidIdToType.get(b) ?? b;
      emit(a, b, `collaborates`);
    }
  }

  if (lines.length <= 2) {
    const first = registry.classes[0];
    emit(active.has("web") && webAnchor ? webAnchor : "Client", first.mermaidId, `touch ${first.typeName}`);
  }

  return lines.join("\n");
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