/**
 * Architecture layers touched by a PR (canonical model), with optional review-slice metadata.
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import { slicesForArchitectureDiagram } from "./diagram-layout.js";
import {
  compareSliceArchitectureOrder,
  dependsOnSlice,
  displayNameForSlice,
  normalizeSliceId,
  rationaleForSlice,
} from "./architecture-model.js";
import { pruneDependsOnForPr } from "./pr-architecture.js";
import { extractClassNamesFromMicroPr } from "./architecture-source-symbols.js";

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   summary: string,
 *   dependsOn: string[],
 *   classNames: string[],
 *   micro: MicroPr,
 * }} PrArchitectureLayer
 */

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @returns {PrArchitectureLayer[]}
 */
export function buildPrArchitectureLayers(microPrs, breakouts) {
  const touched = slicesForArchitectureDiagram(microPrs);
  const activeIds = new Set(touched.map((m) => normalizeSliceId(m.componentId)));
  const breakoutById = new Map((breakouts?.components ?? []).map((c) => [normalizeSliceId(c.id), c]));

  const layers = touched.map((m) => {
    const id = normalizeSliceId(m.componentId);
    const bo = breakoutById.get(id);
    const paths = (m.files ?? []).map((f) => f.filename ?? f.path ?? "");
    const catalogDeps = bo?.depends_on?.length ? bo.depends_on : [...(m.dependsOn ?? []), ...dependsOnSlice(id)];
    const dependsOn = pruneDependsOnForPr(catalogDeps, activeIds);
    const rationale = (bo?.description ?? rationaleForSlice(id, paths)).trim();
    const summary = rationale.split(/(?<=[.!?])\s+/)[0]?.slice(0, 96) ?? rationale.slice(0, 96);

    const classNames = extractClassNamesFromMicroPr(m);

    return {
      id,
      name: displayNameForSlice(id, bo?.name ?? m.componentName),
      summary,
      dependsOn,
      classNames,
      micro: m,
    };
  });

  return layers.sort((a, b) => compareSliceArchitectureOrder(a.id, b.id));
}