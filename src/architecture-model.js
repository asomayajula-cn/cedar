/**
 * Cedar PR architecture matches Spring Boot examples: layered packages, SOLID boundaries, 12-factor ops.
 */

/** @type {readonly string[]} Review order: inner domain first, then config/deploy surfaces. */
export const DDD_12FACTOR_REVIEW_ORDER = [
  "migrations",
  "persistence",
  "domain",
  "application",
  "infrastructure",
  "api",
  "config",
  "build_deploy",
  "integration",
  "web",
  "infra",
  "tests",
];

/** @type {Record<string, string>} */
export const SLICE_DISPLAY_NAMES = {
  domain: "Domain layer",
  application: "Application layer",
  infrastructure: "Infrastructure layer",
  api: "API adapters",
  config: "Runtime config · 12-factor (III)",
  build_deploy: "Build & release · 12-factor (V)",
  persistence: "Persistence",
  migrations: "Schema & migrations",
  integration: "Contracts & integration",
  web: "Web & UI",
  infra: "Platform & ops · 12-factor",
  tests: "Tests",
};

export const ARCHITECTURE_MODEL_LABEL = "Layered · SOLID · 12-factor";

/** Human-facing checklist for slice / composite review. */
export const SOLID_REVIEW_CHECKLIST = [
  "SRP — each layer has one job; REST adapters delegate to application services.",
  "OCP — new behavior via domain/application types, not fat controllers.",
  "LSP — infrastructure adapters honor application/domain contracts.",
  "ISP — prefer small ports (e.g. .../application/port/) over wide service APIs.",
  "DIP — domain has zero Spring/JPA/HTTP imports; wiring lives in infrastructure.",
];

export const AI_PARTITION_SYSTEM_EXTRA = `Slice pull requests like a Spring Boot bounded context:

Layers (prefer these ids when paths match):
- domain — entities, value objects, domain services (no framework)
- application — use cases, application services, inbound/outbound ports
- infrastructure — adapters implementing ports, Spring @Configuration
- api — REST controllers and request DTOs (driving adapters)

12-factor boundaries (separate slices when changed):
- config — application.yml/properties, env samples (factor III: config in environment)
- build_deploy — pom.xml, Dockerfile, CI workflows (factors V build/release/run)
- infra — k8s, terraform, platform ops

depends_on should follow: domain → application → infrastructure/api → config/build_deploy where applicable.
Use 2–8 slices; map Java paths like .../domain/, .../application/, .../infrastructure/, .../api/.`;

/**
 * @param {string} sliceId
 * @returns {string[]}
 */
export function dependsOnSlice(sliceId) {
  const order = DDD_12FACTOR_REVIEW_ORDER;
  const idx = order.indexOf(sliceId);
  if (idx <= 0) return [];
  const predecessors = order.slice(0, idx).filter((id) =>
    ["domain", "application", "infrastructure", "persistence", "migrations"].includes(id)
  );
  return predecessors.length ? [predecessors[predecessors.length - 1]] : [];
}

/**
 * @param {string} sliceId
 * @param {string} [fallbackName]
 * @returns {string}
 */
export function displayNameForSlice(sliceId, fallbackName) {
  return SLICE_DISPLAY_NAMES[sliceId] ?? fallbackName ?? sliceId;
}

export function heuristicSummaryLead() {
  return "Architectural micro-slices";
}