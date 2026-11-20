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

const MAX_TYPES_PER_LAYER = 14;

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   summary: string,
 *   dependsOn: string[],
 *   types: string[],
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

    return {
      id,
      name: displayNameForSlice(id, bo?.name ?? m.componentName),
      summary,
      dependsOn,
      types: collectChangedTypes(m),
      micro: m,
    };
  });

  return layers.sort((a, b) => compareSliceArchitectureOrder(a.id, b.id));
}

/**
 * @param {MicroPr} micro
 * @returns {string[]}
 */
function collectChangedTypes(micro) {
  /** @type {Set<string>} */
  const types = new Set();

  for (const f of micro.files ?? []) {
    const path = f.filename ?? "";
    const base = path.split("/").pop() ?? path;
    const fromName = typeNameFromPath(base);
    if (fromName) types.add(fromName);

    const patch = f.patch ?? "";
    for (const line of patch.split("\n")) {
      if (line.startsWith("\\")) continue;
      if (!line.startsWith("+") && !line.startsWith("-") && !line.startsWith(" ")) continue;
      const body = line.slice(1).trim();
      if (!body) continue;
      extractTypeNamesFromSourceLine(body, types);
    }
  }

  return [...types].sort((a, b) => a.localeCompare(b)).slice(0, MAX_TYPES_PER_LAYER);
}

/**
 * @param {string} line
 * @param {Set<string>} types
 */
function extractTypeNamesFromSourceLine(line, types) {
  const rules = [
    /^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|sealed\s+)?(?:class|interface|enum|record)\s+(\w+)/,
    /^export\s+(?:default\s+)?(?:abstract\s+)?(?:class|interface|type)\s+(\w+)/,
    /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
    /^type\s+(\w+)\s+struct\b/,
    /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/,
    /^class\s+(\w+)\s*[:(]/,
    /^struct\s+(\w+)\s*\{/,
  ];
  for (const re of rules) {
    const m = line.match(re);
    if (m?.[1] && isLikelyTypeName(m[1])) types.add(m[1]);
  }
}

/**
 * @param {string} name
 */
function isLikelyTypeName(name) {
  if (!name || name.length < 2) return false;
  if (/^(if|for|while|switch|catch|return|import|from|const|let|var)$/.test(name)) return false;
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}

/**
 * @param {string} filename
 */
function typeNameFromPath(filename) {
  const m = filename.match(/^(.+)\.(java|kt|ts|tsx|jsx|js|go|py|rb)$/i);
  if (!m) return "";
  const base = m[1];
  if (base === "index" || base === "mod") return "";
  return base.replace(/[^A-Za-z0-9_$]/g, "") || "";
}