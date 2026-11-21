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
import { codeMapAiEnabled } from "./code-map-ai-toggle.js";
import { generateAiCodeMapViews, mergeAiCodeMapIntoArtifacts } from "./ai-code-map.js";

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
  let svg = null;
  try {
    svg = await renderCodeMapSvg(map);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cedar] code map SVG skipped for ${filename}: ${msg}`);
  }
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

  let depElements = null;
  if (isFlyoutDepCruiserEligible(filename)) {
    const depLayer = await buildFlyoutModuleDeps(repoRoot, String(filename ?? ""));
    moduleDepsMeta = depLayer?.meta ?? null;
    if (depLayer?.elements?.length) {
      depElements = depLayer.elements;
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

  let result = {
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
    codeMapAiDirected: false,
    codeMapSource: "parser",
  };

  const patchText = (patch ?? "").trim();
  const aiRequested = opts.aiCodeMap ?? codeMapAiEnabled();
  if (aiRequested && patchText.length > 0) {
    try {
      const plan = await generateAiCodeMapViews(String(filename ?? ""), patch ?? "", opts.status ?? "", {
        raw,
        profile,
        summary: mergedSummary,
      });
      if (plan) {
        result = mergeAiCodeMapIntoArtifacts(result, plan, depElements);
        result.codeMapSource = "ai";
      } else {
        profileHint = `${profileHint} AI returned no diagram JSON — showing AST/diff parser map.`;
        result.codeMapProfileHint = profileHint;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[cedar] AI code map skipped for ${filename}: ${msg}`);
      profileHint = `${profileHint} AI map failed (${msg.slice(0, 72)}); using parser map.`;
      result.codeMapProfileHint = profileHint;
    }
  } else if (!aiRequested) {
    profileHint = `${profileHint} Parser map (AST/diff). Enable CEDAR_AI_CODE_MAP=auto for LLM-directed views.`;
    result.codeMapProfileHint = profileHint;
  }

  return result;
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