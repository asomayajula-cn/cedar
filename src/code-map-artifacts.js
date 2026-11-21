import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCodeMapData } from "./code-map.js";
import { renderCodeMapMermaid, COMPACT_MERMAID_INIT } from "./code-map-mermaid-export.js";
import { renderCodeMapSvg } from "./code-map-graphviz.js";
import { codeMapToCytoscapeElements } from "./code-map-cytoscape.js";
import { classifyCodeMapProfile, summarizeCodeMap, toStructuralCodeMap } from "./code-map-detail.js";
import {
  toBehaviorCodeMap,
  collectFunctionalStepsForFile,
  functionalityStepsToMap,
} from "./code-map-flyout-views.js";
import { buildFlyoutModuleDeps, isFlyoutDepCruiserEligible } from "./dependency-cruiser-flyout.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} filename
 * @param {string} [patch]
 * @param {{ status?: string }} [opts]
 */
export async function buildFileFlowArtifacts(filename, patch = "", opts = {}) {
  const raw = buildCodeMapData(String(filename ?? ""), patch ?? "");
  const profile = classifyCodeMapProfile(String(filename ?? ""), patch ?? "", raw, opts.status);
  const summary = summarizeCodeMap(raw, { ...profile, path: String(filename ?? "") });
  const map = toStructuralCodeMap(
    {
      ...raw,
      whatItDoes: raw.whatItDoes || summary.lead,
    },
    profile
  );
  const mermaid = `${COMPACT_MERMAID_INIT}\n${renderCodeMapMermaid(map)}`;
  const [svg] = await Promise.all([renderCodeMapSvg(map)]);
  const behaviorMap = toBehaviorCodeMap(raw, profile);
  const functionalityMap = functionalityStepsToMap(
    String(filename ?? ""),
    collectFunctionalStepsForFile(String(filename ?? ""), patch ?? "")
  );

  let elements = codeMapToCytoscapeElements(map);
  let behaviorElements = codeMapToCytoscapeElements(behaviorMap);
  let functionalityElements = codeMapToCytoscapeElements(functionalityMap);
  let mergedSummary = summary;
  let moduleDepsMeta = null;
  let profileHint = profile.hint;

  if (isFlyoutDepCruiserEligible(filename)) {
    const depLayer = await buildFlyoutModuleDeps(repoRoot, String(filename ?? ""));
    moduleDepsMeta = depLayer?.meta ?? null;
    if (depLayer?.elements?.length) {
      elements = [...elements, ...depLayer.elements];
    }
    if (depLayer?.bullets?.length) {
      mergedSummary = {
        ...mergedSummary,
        bullets: [...(mergedSummary.bullets ?? []), ...depLayer.bullets],
      };
    }
    if (moduleDepsMeta && !moduleDepsMeta.skipped && moduleDepsMeta.modules > 0) {
      profileHint = `${profile.hint} Module imports overlaid (dependency-cruiser).`;
    }
  }

  return {
    mermaid,
    svg,
    whatItDoes: mergedSummary.lead || map.whatItDoes,
    header: map.header,
    elements,
    behaviorElements,
    functionalityElements,
    codeMapDetail: profile.level,
    codeMapProfile: profile.profile,
    codeMapProfileLabel: profile.label,
    codeMapProfileHint: profileHint,
    codeMapSummary: mergedSummary,
    codeMapLayout: summary.layout ?? null,
    codeMapStructure: summary.structure ?? null,
    codeMapModuleDeps: moduleDepsMeta,
    codeMapView: "structure",
  };
}

/**
 * Sync fallback for callers that only need Mermaid.
 * @param {string} filename
 * @param {string} [patch]
 */
export function buildFileFlowMermaid(filename, patch = "") {
  const map = buildCodeMapData(String(filename ?? ""), patch ?? "");
  return `${COMPACT_MERMAID_INIT}\n${renderCodeMapMermaid(map)}`;
}