/**
 * PR-scoped architecture: slices and summaries from changed paths only.
 * @typedef {import('./partition.js').PrFile} PrFile
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./load-config.js').ComponentDef} ComponentDef
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import {
  compareSliceArchitectureOrder,
  dependsOnSlice,
  displayNameForSlice,
  normalizeSliceId,
  rationaleForSlice,
} from "./architecture-model.js";

/**
 * Deployable modules / apps touched in this PR (repo layout, not a fixed catalog).
 * @param {PrFile[]} files
 */
export function detectPrModules(files) {
  /** @type {Set<string>} */
  const modules = new Set();
  for (const f of files) {
    const p = f.filename;
    const rules = [
      [/^examples\/([^/]+)\//, (n) => `examples/${n}`],
      [/^apps\/([^/]+)\//, (n) => `apps/${n}`],
      [/^packages\/([^/]+)\//, (n) => `packages/${n}`],
      [/^services\/([^/]+)\//, (n) => `services/${n}`],
    ];
    for (const [re, label] of rules) {
      const m = p.match(re);
      if (m) modules.add(label(m[1]));
    }
  }
  return [...modules].sort();
}

/**
 * @param {string[]} deps
 * @param {Set<string>} activeIds
 */
export function pruneDependsOnForPr(deps, activeIds) {
  return [...new Set((deps ?? []).map(normalizeSliceId).filter((d) => activeIds.has(d)))];
}

/**
 * Component catalog entries only for layers that appear in this PR.
 * @param {MicroPr[]} microPrs
 * @param {ComponentDef[]} yamlComponents
 * @param {AiComponentDef[]} [breakoutComponents]
 */
export function componentsForPrPartition(microPrs, yamlComponents, breakoutComponents = []) {
  const yamlById = new Map(yamlComponents.map((c) => [c.id, c]));
  const breakoutById = new Map(breakoutComponents.map((c) => [normalizeSliceId(c.id), c]));
  const touched = microPrs.filter((m) => (m.files?.length ?? 0) > 0);
  const activeIds = new Set(touched.map((m) => normalizeSliceId(m.componentId)));

  return touched
    .map((m) => normalizeSliceId(m.componentId))
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .sort(compareSliceArchitectureOrder)
    .map((id) => {
      const yaml = yamlById.get(id);
      const bo = breakoutById.get(id);
      const micro = touched.find((m) => normalizeSliceId(m.componentId) === id);
      const paths = micro?.files?.map((f) => f.filename) ?? [];
      return {
        id,
        name: displayNameForSlice(id, bo?.name ?? yaml?.name ?? id),
        description: bo?.description ?? `${paths.length} file(s) in this PR`,
        rationale: bo?.rationale ?? rationaleForSlice(id, paths),
        depends_on: pruneDependsOnForPr(bo?.depends_on ?? yaml?.depends_on ?? dependsOnSlice(id), activeIds),
      };
    });
}

/**
 * @param {ComponentDef[]} yamlComponents
 * @param {Record<string, string>} assignments
 * @param {AiComponentDef[]} [breakoutComponents]
 */
export function resolvePartitionCatalog(yamlComponents, assignments, breakoutComponents = []) {
  const yamlById = new Map(yamlComponents.map((c) => [c.id, c]));
  const breakoutById = new Map(breakoutComponents.map((c) => [normalizeSliceId(c.id), c]));
  const ids = [...new Set(Object.values(assignments).map(normalizeSliceId))];

  return ids.sort(compareSliceArchitectureOrder).map((id) => {
    const yaml = yamlById.get(id);
    const bo = breakoutById.get(id);
    return {
      id,
      name: displayNameForSlice(id, bo?.name ?? yaml?.name ?? id),
      paths: yaml?.paths ?? [],
      depends_on: bo?.depends_on ?? yaml?.depends_on ?? dependsOnSlice(id),
      description: bo?.description ?? yaml?.description,
      rationale: bo?.rationale,
    };
  });
}

/**
 * @param {MicroPr[]} microPrs
 * @param {Set<string>} activeIds
 */
export function alignMicroPrsToPrArchitecture(microPrs, activeIds) {
  for (const m of microPrs) {
    const id = normalizeSliceId(m.componentId);
    m.componentId = id;
    m.componentName = displayNameForSlice(id, m.componentName);
    m.dependsOn = pruneDependsOnForPr(m.dependsOn, activeIds);
  }
  return microPrs;
}

/**
 * @param {PrFile[]} files
 * @param {MicroPr[]} microPrs
 * @param {string[]} [modules]
 */
export function summarizePrArchitecture(files, microPrs, modules = detectPrModules(files)) {
  const touched = microPrs
    .filter((m) => (m.files?.length ?? 0) > 0)
    .sort((a, b) => compareSliceArchitectureOrder(a.componentId, b.componentId));
  const sliceTrail = touched.map((m) => m.componentName).join(" → ");
  const moduleLine = modules.length ? `Touches ${modules.join(", ")}. ` : "";
  return `${moduleLine}Partitions this PR into ${touched.length} slice(s) from paths in the diff: ${sliceTrail}.`;
}

/**
 * @param {AiComponentDef[]} components
 * @param {Record<string, string>} assignments
 */
export function filterComponentsWithFiles(components, assignments) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const id of Object.values(assignments)) {
    const key = normalizeSliceId(id);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return components.filter((c) => (counts[normalizeSliceId(c.id)] ?? 0) > 0);
}