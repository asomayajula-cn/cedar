import { normalizeSliceId } from "./architecture-model.js";

/** Matches heuristic-breakouts "Tests" layer (test dirs + *.test.* / *.spec.*). */
export const TEST_FILE_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec)\b|\.(test|spec)\.[a-z]+$/i;

/**
 * @param {string} filename
 */
export function isTestFilePath(filename) {
  if (!filename) return false;
  return TEST_FILE_PATH_RE.test(String(filename));
}

/**
 * @param {string} componentId
 */
export function isTestsSliceId(componentId) {
  return normalizeSliceId(componentId) === "tests";
}

/**
 * Micro-PR rows for architecture / Mermaid / cytoscape (production paths only).
 * @param {import("./partition.js").MicroPr[]} microPrs
 */
export function microPrsForDiagram(microPrs) {
  return microPrs
    .filter((m) => !isTestsSliceId(m.componentId))
    .map((m) => ({
      ...m,
      files: (m.files ?? []).filter((f) => !isTestFilePath(f.filename ?? f.path ?? "")),
    }))
    .filter((m) => m.files.length > 0);
}