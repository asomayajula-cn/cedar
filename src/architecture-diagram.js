/**
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import { slicesForArchitectureDiagram } from "./diagram-layout.js";

const MAX_SLICES_IN_DIAGRAM = 16;
const MAX_MEMBERS = 8;

/** Outside-in order for flow and sequence participants. */
const OUTSIDE_IN = [
  "web",
  "api",
  "application",
  "infrastructure",
  "repository",
  "domain",
  "persistence",
  "migrations",
  "integration",
  "config",
  "build_deploy",
  "infra",
  "tests",
  "misc",
];

/**
 * Relations that exist only when both slices are in the pull request.
 * kind: call (solid), implements (dashed), event (domain event), supports (ops).
 */
const RELATIONS = [
  { from: "web", to: "api", kind: "call", flow: "user action", event: "UiAction", reply: "ViewUpdated" },
  { from: "api", to: "application", kind: "call", flow: "use case", event: "CommandReceived", reply: "UseCaseCompleted" },
  { from: "application", to: "domain", kind: "call", flow: "apply rules", event: "RulesRequested", reply: "DecisionMade" },
  { from: "application", to: "repository", kind: "call", flow: "load or save", event: "LoadRequested", reply: "RecordLoaded" },
  { from: "repository", to: "persistence", kind: "call", flow: "map record", event: "RecordMapped", reply: "RecordStored" },
  { from: "persistence", to: "migrations", kind: "call", flow: "schema", event: "SchemaChecked", reply: "SchemaReady" },
  { from: "application", to: "integration", kind: "call", flow: "outbound contract", event: "ContractCall", reply: "ContractAck" },
  { from: "infrastructure", to: "integration", kind: "call", flow: "external call", event: "OutboundCall", reply: "Ack" },
  { from: "infrastructure", to: "application", kind: "implements", flow: "implements port", event: "PortInvoked", reply: "AdapterResult" },
  { from: "infrastructure", to: "repository", kind: "implements", flow: "implements store", event: "StoreInvoked", reply: "StoreResult" },
  { from: "domain", to: "infrastructure", kind: "event", flow: "domain event", event: "DomainEvent", reply: "EventPublished" },
  { from: "config", to: "application", kind: "supports", flow: "configures", event: "ConfigBound", reply: "Ready" },
  { from: "config", to: "api", kind: "supports", flow: "configures", event: "ConfigBound", reply: "Ready" },
  { from: "build_deploy", to: "infra", kind: "supports", flow: "releases", event: "ReleaseCut", reply: "Deployed" },
  { from: "infra", to: "api", kind: "supports", flow: "runs", event: "TrafficRouted", reply: "Healthy" },
  { from: "infra", to: "web", kind: "supports", flow: "runs", event: "TrafficRouted", reply: "Healthy" },
  { from: "tests", to: "domain", kind: "supports", flow: "verifies", event: "CaseRun", reply: "Assertion" },
  { from: "tests", to: "application", kind: "supports", flow: "verifies", event: "CaseRun", reply: "Assertion" },
  { from: "tests", to: "api", kind: "supports", flow: "verifies", event: "CaseRun", reply: "Assertion" },
];

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildCompleteLayoutDiagrams(microPrs, breakouts, pull, target) {
  const allTouched = slicesForArchitectureDiagram(microPrs);
  const touched = allTouched.slice(0, MAX_SLICES_IN_DIAGRAM);
  const omitted = allTouched.length - touched.length;
  if (!touched.length) {
    const empty = "flowchart TB\n  empty[No files in PR]";
    return {
      modules: [],
      diagrams: [
        { id: "uml", title: "UML · components", badge: "class", caption: "No components in this pull request.", source: empty },
        { id: "flow", title: "Flow", badge: "flowchart", caption: "No flow to draw.", source: empty },
        { id: "events", title: "Events", badge: "sequence", caption: "No events to draw.", source: "sequenceDiagram\n  Note over empty: No files in PR" },
      ],
    };
  }

  const nodes = componentNodes(touched);
  const activeSlices = new Set(touched.map((m) => m.componentId));
  const edges = relationsFor(activeSlices, nodes);
  const modules = [...new Set(nodes.map((n) => n.module).filter(Boolean))];
  const scope = modules.length ? modules.join(", ") : pull?.number ? `PR #${pull.number}` : target?.repo || "this pull request";

  return {
    modules,
    diagrams: [
      {
        id: "uml",
        title: "UML · components",
        badge: "class",
        caption: `Components in ${scope}${omitted ? ` · ${omitted} more slices omitted` : ""}.`,
        source: buildUml(nodes, edges),
      },
      {
        id: "flow",
        title: "Flow",
        badge: "flowchart",
        caption: "Request, adapter, and release flow through the components in this pull request.",
        source: buildFlow(nodes, edges, activeSlices),
      },
      {
        id: "events",
        title: "Events",
        badge: "sequence",
        caption: "Commands and domain events between those components.",
        source: buildEvents(nodes, edges, activeSlices, touched),
      },
    ],
  };
}

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildArchitectureDiagramMermaid(microPrs, breakouts, pull, target) {
  const layout = buildCompleteLayoutDiagrams(microPrs, breakouts, pull, target);
  return layout.diagrams.map((d) => d.source).join("\n\n");
}

/**
 * @param {string | { diagrams?: { title: string, source: string }[] }} mermaidOrLayout
 */
export function buildArchitectureDiagramMarkdown(mermaidOrLayout) {
  const diagrams = Array.isArray(mermaidOrLayout?.diagrams)
    ? mermaidOrLayout.diagrams
    : [{ title: "Complete layout", source: String(mermaidOrLayout ?? "") }];
  const parts = ["### Complete layout", ""];
  for (const diagram of diagrams) {
    if (!diagram?.source?.trim()) continue;
    parts.push(`#### ${diagram.title}`, "", "```mermaid", diagram.source.trim(), "```", "");
  }
  return parts.join("\n").trim();
}

/**
 * @param {MicroPr[]} slices
 */
function componentNodes(slices) {
  /** @type {{ id: string, sliceId: string, module: string | null, name: string, members: string[] }[]} */
  const nodes = [];
  for (const slice of slices) {
    const grouped = groupFilesByModule(slice);
    const moduleKeys = [...grouped.keys()];
    const realModules = moduleKeys.filter((k) => k !== "shared");
    const split = realModules.length > 1;
    if (!split) {
      const files = [...grouped.values()].flat();
      nodes.push({
        id: safeId(slice.componentId),
        sliceId: slice.componentId,
        module: realModules[0] ?? null,
        name: shortName(slice.componentName),
        members: membersFromFiles(files),
      });
      continue;
    }
    for (const [mod, files] of grouped) {
      const moduleLabel = mod === "shared" ? null : mod;
      nodes.push({
        id: safeId(moduleLabel ? `${moduleLabel}__${slice.componentId}` : slice.componentId),
        sliceId: slice.componentId,
        module: moduleLabel,
        name: moduleLabel ? `${moduleLabel} · ${shortName(slice.componentName)}` : shortName(slice.componentName),
        members: membersFromFiles(files),
      });
    }
  }
  return nodes;
}

/**
 * @param {MicroPr} slice
 */
function groupFilesByModule(slice) {
  /** @type {Map<string, { filename?: string, path?: string }[]>} */
  const grouped = new Map();
  for (const file of slice.files ?? []) {
    const key = moduleKey(file.filename || file.path || "") ?? "shared";
    const list = grouped.get(key) ?? [];
    list.push(file);
    grouped.set(key, list);
  }
  if (!grouped.size) grouped.set("shared", []);
  return grouped;
}

/**
 * @param {string} filename
 */
function moduleKey(filename) {
  const path = String(filename).replace(/\\/g, "/");
  const nested = path.match(/^(?:examples|apps|packages|services)\/([^/]+)\//);
  if (nested) return nested[1];
  const top = path.match(/^([^/]+)\//);
  if (!top) return null;
  const name = top[1];
  if (["src", "web", "k8s", "terraform", "docker", ".github", "test", "tests"].includes(name)) return null;
  if (name.startsWith(".")) return null;
  return name;
}

/**
 * @param {Set<string>} activeSlices
 * @param {{ id: string, sliceId: string, module: string | null }[]} nodes
 */
function relationsFor(activeSlices, nodes) {
  /** @type {typeof RELATIONS} */
  const catalog = [...RELATIONS];
  if (activeSlices.has("api") && activeSlices.has("domain") && !activeSlices.has("application")) {
    catalog.push({
      from: "api",
      to: "domain",
      kind: "call",
      flow: "command",
      event: "CommandReceived",
      reply: "DecisionMade",
    });
  }
  /** @type {{ from: string, to: string, kind: string, flow: string, event: string, reply: string }[]} */
  const edges = [];
  const seen = new Set();
  for (const rel of catalog) {
    if (!activeSlices.has(rel.from) || !activeSlices.has(rel.to)) continue;
    const sources = nodes.filter((n) => n.sliceId === rel.from);
    const targets = nodes.filter((n) => n.sliceId === rel.to);
    for (const source of sources) {
      const sameModule = targets.filter((t) => t.module && t.module === source.module);
      const chosen = sameModule.length ? sameModule : targets;
      for (const target of chosen) {
        const key = `${source.id}->${target.id}:${rel.kind}`;
        if (seen.has(key) || source.id === target.id) continue;
        seen.add(key);
        edges.push({ ...rel, from: source.id, to: target.id });
      }
    }
  }
  return edges;
}

/**
 * @param {{ id: string, name: string, members: string[] }[]} nodes
 * @param {{ from: string, to: string, kind: string, flow: string }[]} edges
 */
function buildUml(nodes, edges) {
  const lines = ["classDiagram", "  direction LR"];
  for (const node of nodes) {
    const members = node.members.length ? node.members : ["changed"];
    lines.push(`  class ${node.id}["${mermaidLabel(node.name)}"] {`);
    for (const member of members) lines.push(`    ${member}`);
    lines.push("  }");
  }
  for (const edge of edges) {
    const arrow = edge.kind === "call" ? "-->" : "..>";
    lines.push(`  ${edge.from} ${arrow} ${edge.to} : ${mermaidLabel(edge.flow)}`);
  }
  return lines.join("\n");
}

/**
 * @param {{ id: string, sliceId: string, name: string }[]} nodes
 * @param {{ from: string, to: string, kind: string, flow: string }[]} edges
 * @param {Set<string>} activeSlices
 */
function buildFlow(nodes, edges, activeSlices) {
  const lines = [
    "flowchart LR",
    "  classDef component fill:#141414,stroke:#d4d4d4,stroke-width:1px,color:#fafafa",
    "  classDef actor fill:#fafafa,stroke:#171717,stroke-width:1px,color:#0a0a0a",
  ];
  const entry = entryActor(activeSlices);
  if (entry) lines.push(`  ${entry.id}(["${mermaidLabel(entry.name)}"]):::actor`);
  for (const node of nodes) {
    lines.push(`  ${node.id}["${mermaidLabel(node.name)}"]:::component`);
  }
  const first = firstParticipant(nodes);
  if (entry && first) lines.push(`  ${entry.id} ==> ${first.id}`);
  if (!edges.length && nodes.length > 1) {
    for (let i = 0; i < nodes.length - 1; i++) {
      lines.push(`  ${nodes[i].id} --> ${nodes[i + 1].id}`);
    }
  }
  for (const edge of edges) {
    const arrow = edge.kind === "call" ? "==>" : "-.->";
    lines.push(`  ${edge.from} ${arrow}|${mermaidLabel(edge.flow)}| ${edge.to}`);
  }
  return lines.join("\n");
}

/**
 * @param {{ id: string, sliceId: string, name: string }[]} nodes
 * @param {{ from: string, to: string, kind: string, event: string, reply: string }[]} edges
 * @param {Set<string>} activeSlices
 * @param {MicroPr[]} slices
 */
function buildEvents(nodes, edges, activeSlices, slices) {
  const entry = entryActor(activeSlices);
  const ordered = [...nodes].sort((a, b) => outsideRank(a.sliceId) - outsideRank(b.sliceId));
  const lines = ["sequenceDiagram", "  autonumber"];
  if (entry) lines.push(`  actor ${entry.id} as ${mermaidLabel(entry.name)}`);
  for (const node of ordered) {
    lines.push(`  participant ${node.id} as ${mermaidLabel(node.name)}`);
  }
  const first = firstParticipant(ordered);
  if (entry && first) {
    lines.push(`  ${entry.id}->>${first.id}: ${entry.message}`);
  }
  const eventEdges = edges.filter((edge) => edge.kind === "event" || edge.kind === "call" || edge.kind === "implements");
  const drawn = eventEdges.length ? eventEdges : edges.slice(0, 8);
  for (const edge of drawn) {
    const eventName = domainEventName(slices) && edge.kind === "event" ? domainEventName(slices) : edge.event;
    lines.push(`  ${edge.from}->>${edge.to}: ${mermaidLabel(eventName)}`);
    if (edge.reply) lines.push(`  ${edge.to}-->>${edge.from}: ${mermaidLabel(edge.reply)}`);
  }
  if (entry && first) lines.push(`  ${first.id}-->>${entry.id}: ${entry.reply}`);
  return lines.join("\n");
}

/**
 * @param {Set<string>} activeSlices
 */
function entryActor(activeSlices) {
  if (activeSlices.has("web")) return { id: "actor_user", name: "User", message: "interaction", reply: "updated view" };
  if (activeSlices.has("api")) return { id: "actor_client", name: "Client", message: "HTTP request", reply: "HTTP response" };
  if (activeSlices.has("application")) return { id: "actor_caller", name: "Caller", message: "command", reply: "result" };
  if (activeSlices.has("build_deploy") || activeSlices.has("infra")) {
    return { id: "actor_pipeline", name: "Pipeline", message: "deploy", reply: "released" };
  }
  if (activeSlices.has("domain")) return { id: "actor_usecase", name: "Use case", message: "apply", reply: "decision" };
  return { id: "actor_change", name: "Change", message: "apply", reply: "done" };
}

/**
 * @param {{ id: string, sliceId: string }[]} nodes
 */
function firstParticipant(nodes) {
  return [...nodes].sort((a, b) => outsideRank(a.sliceId) - outsideRank(b.sliceId))[0] ?? null;
}

/**
 * @param {string} sliceId
 */
function outsideRank(sliceId) {
  const idx = OUTSIDE_IN.indexOf(sliceId);
  return idx === -1 ? 500 : idx;
}

/**
 * @param {MicroPr[]} slices
 */
function domainEventName(slices) {
  for (const slice of slices) {
    for (const file of slice.files ?? []) {
      const base = basename(file.filename || file.path || "");
      if (/event/i.test(base)) return memberName(base.replace(/\.[^.]+$/, "")) || "DomainEvent";
    }
  }
  return "";
}

/**
 * @param {{ filename?: string, path?: string }[]} files
 */
function membersFromFiles(files) {
  /** @type {string[]} */
  const members = [];
  const seen = new Set();
  for (const file of files) {
    const base = basename(file.filename || file.path || "");
    const member = memberName(base.replace(/\.[^.]+$/, ""));
    if (!member || seen.has(member)) continue;
    seen.add(member);
    members.push(member);
    if (members.length >= MAX_MEMBERS) break;
  }
  return members;
}

/**
 * @param {string} filename
 */
function basename(filename) {
  const parts = String(filename).split("/");
  return parts[parts.length - 1] || "file";
}

/**
 * @param {string} name
 */
function shortName(name) {
  return String(name ?? "Component")
    .split("·")[0]
    .trim()
    .slice(0, 42);
}

/**
 * @param {string} raw
 */
function memberName(raw) {
  const cleaned = String(raw)
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!cleaned) return "";
  return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned;
}

/**
 * @param {string} id
 */
function safeId(id) {
  const cleaned = String(id).replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "");
  const ident = cleaned || "component";
  return /^[0-9]/.test(ident) ? `n_${ident}` : ident;
}

/**
 * @param {string} value
 */
function mermaidLabel(value) {
  return String(value ?? "")
    .replace(/\\/g, " ")
    .replace(/"/g, "'")
    .replace(/&/g, " and ")
    .replace(/[\[\]{}|#;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
