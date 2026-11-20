/**
 * @typedef {import('./partition.js').PrFile} PrFile
 */

/**
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import {
  ARCHITECTURE_CORE_SLICE_IDS,
  dependsOnSlice,
  displayNameForSlice,
  heuristicSummaryLead,
  normalizeSliceId,
  rationaleForSlice,
} from "./architecture-model.js";
import { detectPrModules } from "./pr-architecture.js";

const LAYER_HINTS = [
  { id: "migrations", name: "Schema & migrations", match: /(^|\/)migrations?\//i },
  { id: "migrations", name: "Schema & migrations", match: /db\/migration\//i },
  {
    id: "domain",
    name: "Domain layer",
    match: /src\/main\/java\/.*\/domain\/|(^|\/)(domain)\//i,
  },
  {
    id: "application",
    name: "Application layer",
    match: /src\/main\/java\/.*\/application\/|(^|\/)(application|usecase|usecases|port)\//i,
  },
  {
    id: "repository",
    name: "Repository & data access",
    match: /src\/main\/java\/.*\/(repository|persistence|data)\/|Repository\.(java|kt)$/i,
  },
  {
    id: "repository",
    name: "Repository & data access",
    match: /(^|\/)(store|repo|repos|repository)\b/i,
  },
  {
    id: "infrastructure",
    name: "Infrastructure adapters",
    match: /src\/main\/java\/.*\/(infrastructure|adapter)\//i,
  },
  {
    id: "api",
    name: "API & HTTP adapters",
    match: /src\/main\/java\/.*\/api\/|(^|\/)(api|handlers|routes)\//i,
  },
  {
    id: "config",
    name: "Runtime config · 12-factor",
    match: /application(-.*)?\.(ya?ml|properties)$/i,
  },
  {
    id: "config",
    name: "Runtime config · 12-factor",
    match: /src\/main\/resources\/application/i,
  },
  { id: "config", name: "Runtime config · 12-factor", match: /(^|\/)\.env(\.example)?$/i },
  {
    id: "build_deploy",
    name: "Build & release · 12-factor",
    match: /(^|\/)pom\.xml$|(^|\/)build\.gradle(\.kts)?$|Dockerfile|docker-compose|Procfile$|\.github\/workflows\//i,
  },
  { id: "persistence", name: "Persistence", match: /(^|\/)(prisma|drizzle|db)\b/i },
  { id: "web", name: "Web & UI", match: /(^|\/)(web|components|pages)\b/i },
  { id: "infra", name: "Platform & ops", match: /(^|\/)(terraform|k8s)\b/i },
  { id: "infra", name: "Platform & ops", match: /(^|\/)\.github\b/i },
  { id: "tests", name: "Tests", match: /(^|\/)(test|tests|__tests__|spec)\b|\.(test|spec)\.[a-z]+$/i },
  { id: "integration", name: "Contracts", match: /(^|\/)(openapi|proto|contracts)\b/i },
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
    const classified = classifyFile(file.filename);
    const slice = { id: normalizeSliceId(classified.id), name: classified.name };
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
      name: displayNameForSlice(b.id, b.name),
      description: `${b.paths.length} files, ~${b.lines} line delta`,
      rationale: rationaleForSlice(b.id, b.paths),
      depends_on: dependsOnSlice(b.id),
    }));

  if (components.length === 0) {
    components = [
      {
        id: "misc",
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
      architectureSummary: `${heuristicSummaryLead()}: ${components.length} slices (merged from ${buckets.size} groups).`,
    };
  }

  const validIds = new Set(components.map((c) => c.id));
  /** @type {Record<string, string>} */
  const fileAssignments = {};
  for (const file of files) {
    const id = normalizeSliceId(classifyFile(file.filename).id);
    const mapped = validIds.has(id) ? id : components[0].id;
    fileAssignments[file.filename] = mapped;
  }

  const modules = detectPrModules(files);
  const touchedNames = components.map((c) => c.name).join(" → ");
  const moduleLine = modules.length ? `Touches ${modules.join(", ")}. ` : "";
  const summary = `${heuristicSummaryLead()}: ${moduleLine}${touchedNames}.`;

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
      return { id: "misc", name: `Package: ${pkg}` };
    }
    if (top === "src" && parts[1] === "main" && parts[2] === "java") {
      const pkgSegment = parts[5] ?? parts[4];
      if (pkgSegment) {
        return {
          id: normalizeSliceId(pkgSegment),
          name: displayNameForSlice(pkgSegment, pkgSegment),
        };
      }
    }
    return { id: "misc", name: `Area: ${top}` };
  }

  return { id: "misc", name: "Root & misc" };
}

/**
 * @param {Map<string, { id: string, name: string, paths: string[], lines: number }>} buckets
 * @param {number} maxSlices
 * @param {PrFile[]} files
 */
function mergeSmallestBuckets(buckets, maxSlices, files) {
  const sorted = [...buckets.values()].sort((a, b) => b.lines - a.lines);
  const core = sorted.filter((b) => ARCHITECTURE_CORE_SLICE_IDS.has(b.id));
  let peripheral = sorted.filter((b) => !ARCHITECTURE_CORE_SLICE_IDS.has(b.id));

  while (core.length + peripheral.length > maxSlices && peripheral.length > 1) {
    peripheral.sort((a, b) => a.lines - b.lines);
    const a = peripheral.shift();
    const b = peripheral.shift();
    peripheral.push({
      id: "misc",
      name: "Unclassified changes",
      paths: [...a.paths, ...b.paths],
      lines: a.lines + b.lines,
    });
  }

  const keep = core.length + peripheral.length <= maxSlices ? [...core, ...peripheral] : core;
  const mergedBuckets =
    core.length + peripheral.length <= maxSlices
      ? []
      : peripheral.length
        ? [
            peripheral.reduce(
              (acc, cur) => ({
                id: "misc",
                name: "Unclassified changes",
                paths: [...acc.paths, ...cur.paths],
                lines: acc.lines + cur.lines,
              }),
              { id: "misc", name: "Unclassified changes", paths: [], lines: 0 }
            ),
          ]
        : [];

  const mergedPaths = mergedBuckets.flatMap((r) => r.paths);
  const mergedIds = new Set(
    sorted.filter((b) => !keep.some((k) => k.id === b.id)).map((b) => b.id)
  );

  const components = keep.map((b) => ({
    id: b.id,
    name: displayNameForSlice(b.id, b.name),
    description: `${b.paths.length} files`,
    rationale: rationaleForSlice(b.id, b.paths),
    depends_on: dependsOnSlice(b.id),
  }));

  if (mergedPaths.length) {
    components.push({
      id: "misc",
      name: "Unclassified changes",
      description: `${mergedPaths.length} files outside core layers`,
      rationale: rationaleForSlice("misc", mergedPaths),
      depends_on: [],
    });
    mergedIds.add("misc");
  }

  const validIds = new Set(components.map((c) => c.id));
  /** @type {Record<string, string>} */
  const assign = {};
  for (const file of files) {
    const id = normalizeSliceId(classifyFile(file.filename).id);
    if (mergedIds.has(id)) {
      assign[file.filename] = "misc";
    } else {
      assign[file.filename] = validIds.has(id) ? id : keep[0]?.id ?? "misc";
    }
  }

  return { components, assign };
}