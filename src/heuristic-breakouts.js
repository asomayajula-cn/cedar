/**
 * @typedef {import('./partition.js').PrFile} PrFile
 */

/**
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

const LAYER_HINTS = [
  { id: "migrations", name: "Schema & migrations", match: /(^|\/)migrations?\//i },
  { id: "api", name: "API & HTTP", match: /(^|\/)(api|handlers|routes|openapi|proto)\b/i },
  { id: "domain", name: "Domain logic", match: /(^|\/)(domain|usecase|core|lib|pkg)\b/i },
  { id: "persistence", name: "Persistence", match: /(^|\/)(store|repo|db|prisma|drizzle)\b/i },
  { id: "ui", name: "UI & frontend", match: /(^|\/)(web|app|components|pages|ui)\b/i },
  { id: "infra", name: "Infra & CI", match: /(^|\/)(\.github|terraform|k8s|docker)\b/i },
  { id: "tests", name: "Tests", match: /(^|\/)(test|tests|__tests__|spec)\b|\.(test|spec)\.[a-z]+$/i },
];

/**
 * Cluster changed files into review slices without AI.
 * @param {PrFile[]} files
 * @returns {{ components: AiComponentDef[], fileAssignments: Record<string, string>, architectureSummary: string }}
 */
export function heuristicArchitecturalBreakouts(files) {
  /** @type {Map<string, { id: string, name: string, paths: string[], lines: number }>} */
  const buckets = new Map();

  for (const file of files) {
    const slice = classifyFile(file.filename);
    if (!buckets.has(slice.id)) {
      buckets.set(slice.id, { id: slice.id, name: slice.name, paths: [], lines: 0 });
    }
    const b = buckets.get(slice.id);
    b.paths.push(file.filename);
    b.lines += (file.additions ?? 0) + (file.deletions ?? 0);
  }

  let components = [...buckets.values()]
    .filter((b) => b.paths.length > 0)
    .sort((a, b) => b.lines - a.lines)
    .map((b) => ({
      id: b.id,
      name: b.name,
      description: `${b.paths.length} files, ~${b.lines} line delta`,
      rationale: inferRationale(b.id, b.paths),
      depends_on: inferDependsOn(b.id),
    }));

  if (components.length === 0) {
    components = [
      {
        id: "change_set",
        name: "PR change set",
        description: "All changed files",
        rationale: "Single cohesive slice when paths do not match known layers.",
        depends_on: [],
      },
    ];
  }

  if (components.length > 8) {
    const { components: merged, assign } = mergeSmallestBuckets(buckets, 8, files);
    components = merged;
    return {
      components,
      fileAssignments: assign,
      architectureSummary: `Heuristic breakout: ${components.length} micro-slice(s) (merged from ${buckets.size} path groups).`,
    };
  }

  const validIds = new Set(components.map((c) => c.id));
  /** @type {Record<string, string>} */
  const fileAssignments = {};
  for (const file of files) {
    const id = classifyFile(file.filename).id;
    const mapped = validIds.has(id) ? id : components[0].id;
    fileAssignments[file.filename] = mapped;
  }

  const summary = `Heuristic breakout: ${components.length} micro-slice(s) from path structure and change size.`;

  return { components, fileAssignments, architectureSummary: summary };
}

/**
 * @param {string} filename
 */
function classifyFile(filename) {
  for (const layer of LAYER_HINTS) {
    if (layer.match.test(filename)) {
      return { id: layer.id, name: layer.name };
    }
  }

  const parts = filename.split("/");
  if (parts.length >= 2) {
    const top = parts[0];
    if (top === "packages" || top === "apps") {
      const pkg = parts[1] ?? top;
      return { id: slug(pkg), name: `Package: ${pkg}` };
    }
    return { id: slug(top), name: `Area: ${top}` };
  }

  return { id: "root_misc", name: "Root & misc" };
}

/**
 * @param {string} id
 * @param {string[]} paths
 */
function inferRationale(id, paths) {
  const sample = paths.slice(0, 3).join(", ");
  return `Files share architectural role "${id}" (e.g. ${sample}).`;
}

/**
 * @param {string} id
 */
function inferDependsOn(id) {
  const order = ["migrations", "persistence", "domain", "api", "ui"];
  const idx = order.indexOf(id);
  if (idx <= 0) return [];
  return order.slice(0, idx);
}

/**
 * @param {Map<string, { id: string, name: string, paths: string[], lines: number }>} buckets
 * @param {number} maxSlices
 * @param {PrFile[]} files
 */
function mergeSmallestBuckets(buckets, maxSlices, files) {
  const sorted = [...buckets.values()].sort((a, b) => b.lines - a.lines);
  const keep = sorted.slice(0, maxSlices - 1);
  const rest = sorted.slice(maxSlices - 1);
  const mergedPaths = rest.flatMap((r) => r.paths);
  const mergedIds = new Set(rest.map((r) => r.id));

  const components = keep.map((b) => ({
    id: b.id,
    name: b.name,
    description: `${b.paths.length} files`,
    rationale: inferRationale(b.id, b.paths),
    depends_on: inferDependsOn(b.id),
  }));

  if (mergedPaths.length) {
    components.push({
      id: "other",
      name: "Other changes",
      description: `${mergedPaths.length} smaller areas merged`,
      rationale: "Merged low-volume path groups to keep review slices reviewable.",
      depends_on: [],
    });
  }

  const validIds = new Set(components.map((c) => c.id));
  /** @type {Record<string, string>} */
  const assign = {};
  for (const file of files) {
    const id = classifyFile(file.filename).id;
    if (mergedIds.has(id)) {
      assign[file.filename] = "other";
    } else {
      assign[file.filename] = validIds.has(id) ? id : keep[0]?.id ?? "other";
    }
  }

  return { components, assign };
}

/**
 * @param {string} value
 */
function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "misc";
}