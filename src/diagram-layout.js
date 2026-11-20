import { compareSliceArchitectureOrder } from "./architecture-model.js";

/**
 * Deterministic slice ordering for diagrams and review (dependency-first).
 * @typedef {import('./partition.js').MicroPr} MicroPr
 */

/**
 * @param {MicroPr[]} microPrs
 * @returns {MicroPr[]}
 */
export function orderMicroPrsForLayout(microPrs) {
  const byId = new Map(microPrs.map((m) => [m.componentId, m]));
  const ordered = [];
  const visited = new Set();

  function visit(id) {
    if (visited.has(id) || !byId.has(id)) return;
    const m = byId.get(id);
    for (const dep of m.dependsOn ?? []) {
      visit(dep);
    }
    if (!visited.has(id)) {
      visited.add(id);
      ordered.push(m);
    }
  }

  for (const id of [...byId.keys()].sort(compareSliceArchitectureOrder)) visit(id);
  return ordered;
}

/**
 * Slices that appear in architecture diagrams, stable order.
 * @param {MicroPr[]} microPrs
 */
export function slicesForArchitectureDiagram(microPrs) {
  return orderMicroPrsForLayout(microPrs).filter((m) => m.files.length > 0);
}