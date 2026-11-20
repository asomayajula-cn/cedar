/**
 * Canonical layer model: hexagonal core (inside → out) then 12-factor deploy surfaces.
 */

/** @type {readonly string[]} Review order: domain first, then ops rails. */
export const DDD_12FACTOR_REVIEW_ORDER = [
  "migrations",
  "persistence",
  "domain",
  "application",
  "repository",
  "infrastructure",
  "api",
  "config",
  "build_deploy",
  "integration",
  "web",
  "infra",
  "tests",
  "misc",
];

/** Core layers that must not be folded into "other" during heuristic merge. */
export const ARCHITECTURE_CORE_SLICE_IDS = new Set([
  "migrations",
  "persistence",
  "domain",
  "application",
  "repository",
  "infrastructure",
  "api",
  "config",
  "build_deploy",
  "integration",
  "web",
  "infra",
  "tests",
]);

/** @type {Record<string, string>} */
export const SLICE_ID_ALIASES = {
  ui: "web",
  frontend: "web",
  data: "repository",
  repo: "repository",
  repos: "repository",
  orm: "repository",
  datastore: "repository",
  usecase: "application",
  usecases: "application",
  app: "application",
  ports: "application",
  adapter: "infrastructure",
  adapters: "infrastructure",
  handler: "api",
  handlers: "api",
  routes: "api",
  http: "api",
  ops: "infra",
  platform: "infra",
  ci: "build_deploy",
  deploy: "build_deploy",
  general: "misc",
  change_set: "misc",
  root_misc: "misc",
  other: "misc",
};

/** @type {Record<string, string>} */
export const SLICE_DISPLAY_NAMES = {
  domain: "Domain layer",
  application: "Application layer",
  repository: "Repository & data access",
  infrastructure: "Infrastructure adapters",
  api: "API & HTTP adapters",
  config: "Runtime config · 12-factor (III)",
  build_deploy: "Build & release · 12-factor (V)",
  persistence: "Persistence models",
  migrations: "Schema & migrations",
  integration: "Contracts & integration",
  web: "Web & UI",
  infra: "Platform & ops · 12-factor",
  tests: "Tests",
  misc: "Unclassified changes",
};

/** Compact legend for Architecture tab (always the same story). */
export const ARCHITECTURE_LAYER_STACK = [
  { id: "domain", label: "Domain", hint: "entities & invariants" },
  { id: "application", label: "Application", hint: "use cases & ports" },
  { id: "repository", label: "Repository", hint: "data access & mapping" },
  { id: "infrastructure", label: "Infrastructure", hint: "port implementations" },
  { id: "api", label: "API", hint: "HTTP / driving adapters" },
  { id: "config", label: "Config", hint: "12-factor III" },
  { id: "build_deploy", label: "Build & release", hint: "12-factor V" },
  { id: "infra", label: "Platform", hint: "runtime & ops" },
];

export const ARCHITECTURE_MODEL_LABEL = "Layered · SOLID · 12-factor";

export const CANONICAL_SLICE_IDS = [
  ...new Set([...DDD_12FACTOR_REVIEW_ORDER, ...Object.values(SLICE_ID_ALIASES)]),
];

/** Human-facing checklist for slice / composite review. */
export const SOLID_REVIEW_CHECKLIST = [
  "SRP — each layer has one job; REST adapters delegate to application services.",
  "OCP — new behavior via domain/application types, not fat controllers.",
  "LSP — infrastructure adapters honor application/domain contracts.",
  "ISP — prefer small ports (e.g. .../application/port/) over wide service APIs.",
  "DIP — domain has zero Spring/JPA/HTTP imports; wiring lives in infrastructure.",
];

export const AI_PARTITION_SYSTEM_EXTRA = `Partition ONLY into these slice ids (snake_case, pick the best fit per file):
${CANONICAL_SLICE_IDS.filter((id) => id !== "misc").join(", ")}

Hexagonal core (inside → out):
- domain — entities, value objects, domain services (no framework imports)
- application — use cases, application services, inbound/outbound ports
- repository — repositories, DAOs, ORM mappings, DB access code (not HTTP)
- infrastructure — adapters implementing ports (messaging, external APIs, Spring @Configuration wiring)
- api — REST/grpc routes, controllers, request/response DTOs

12-factor deploy surfaces (separate slices when changed; cite factor in rationale when relevant):
- migrations / persistence — schema & migration assets
- config — application.yml/properties, .env.example (factor III: config in environment)
- build_deploy — pom.xml, Dockerfile, CI workflows that build/release (factor V)
- infra — k8s, terraform, platform ops

depends_on should follow: domain → application → repository → infrastructure/api → config/build_deploy/infra.
Use 2–8 slices; every changed file must use one of the ids above (use misc only if truly unclassifiable).`;

/**
 * @param {string} rawId
 */
export function normalizeSliceId(rawId) {
  const slug = String(rawId ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  if (!slug) return "misc";
  return SLICE_ID_ALIASES[slug] ?? slug;
}

/**
 * @param {string} sliceId
 */
export function architectureOrderRank(sliceId) {
  const id = normalizeSliceId(sliceId);
  const idx = DDD_12FACTOR_REVIEW_ORDER.indexOf(id);
  return idx === -1 ? 900 + id.charCodeAt(0) : idx;
}

/**
 * @param {string} a
 * @param {string} b
 */
export function compareSliceArchitectureOrder(a, b) {
  const ra = architectureOrderRank(a);
  const rb = architectureOrderRank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}

/**
 * @param {string} sliceId
 * @returns {string[]}
 */
export function dependsOnSlice(sliceId) {
  const id = normalizeSliceId(sliceId);
  const chain = ["domain", "application", "repository", "infrastructure", "api"];
  const idx = chain.indexOf(id);
  if (idx <= 0) return [];
  return [chain[idx - 1]];
}

/**
 * @param {string} sliceId
 * @param {string} [fallbackName]
 * @returns {string}
 */
export function displayNameForSlice(sliceId, fallbackName) {
  const id = normalizeSliceId(sliceId);
  return SLICE_DISPLAY_NAMES[id] ?? fallbackName ?? sliceId;
}

export function heuristicSummaryLead() {
  return "Layered architecture review";
}

/**
 * @param {import('./ai-breakouts.js').AiComponentDef[]} components
 * @param {import('./load-config.js').ComponentDef[]} yamlComponents
 */
export function enrichComponentsFromYaml(components, yamlComponents) {
  const byId = new Map(yamlComponents.map((c) => [c.id, c]));
  return components.map((c) => {
    const id = normalizeSliceId(c.id);
    const yaml = byId.get(id);
    return {
      ...c,
      id,
      name: displayNameForSlice(id, c.name),
      depends_on:
        c.depends_on?.length ? c.depends_on.map(normalizeSliceId) : yaml?.depends_on ?? dependsOnSlice(id),
      description: c.description ?? yaml?.description,
      rationale: c.rationale ?? rationaleForSlice(id),
    };
  });
}

export function rationaleForSlice(sliceId, paths = []) {
  const id = normalizeSliceId(sliceId);
  const sample = paths.slice(0, 2).join(", ");
  const notes = {
    domain: "Core business rules and model types.",
    application: "Orchestration and port boundaries.",
    repository: "Persistence and data-mapping concerns.",
    infrastructure: "Framework adapters and external system glue.",
    api: "Inbound HTTP/API surface.",
    config: "Environment and runtime configuration (12-factor III).",
    build_deploy: "Build, container, and release pipeline (12-factor V).",
    infra: "Platform provisioning and ops wiring.",
    migrations: "Schema evolution and migration scripts.",
    persistence: "Storage-related assets outside application code.",
    integration: "API contracts and cross-service definitions.",
    web: "Client/UI assets.",
    tests: "Test-only changes.",
    misc: "Paths outside the canonical layer map.",
  };
  const lead = notes[id] ?? `Architectural slice "${id}".`;
  return sample ? `${lead} e.g. ${sample}` : lead;
}