import { buildFileFlowArtifacts } from "./code-map-artifacts.js";
import { buildCodeMapData } from "./code-map.js";
import { renderCodeMapMermaid, COMPACT_MERMAID_INIT } from "./code-map-mermaid-export.js";
import { codeMapToCytoscapeElements } from "./code-map-cytoscape.js";
import { toBehaviorCodeMap, collectFunctionalStepsForFile, functionalityStepsToMap } from "./code-map-flyout-views.js";
import { classifyCodeMapProfile } from "./code-map-detail.js";

/**
 * Never let a single file's diagram build take down the whole review payload.
 *
 * @param {string} filename
 * @param {string} [patch]
 * @param {{ status?: string }} [opts]
 */
export async function buildFileFlowArtifactsSafe(filename, patch = "", opts = {}) {
  try {
    return await buildFileFlowArtifacts(filename, patch, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cedar] code map build failed for ${filename}: ${msg}`);
    try {
      const raw = buildCodeMapData(String(filename ?? ""), patch ?? "");
      const profile = classifyCodeMapProfile(String(filename ?? ""), patch ?? "", raw, opts.status);
      const behaviorMap = toBehaviorCodeMap(raw, profile);
      const functionalityMap = functionalityStepsToMap(
        String(filename ?? ""),
        collectFunctionalStepsForFile(String(filename ?? ""), patch ?? "")
      );
      const map = raw;
      return {
        mermaid: `${COMPACT_MERMAID_INIT}\n${renderCodeMapMermaid(map)}`,
        svg: null,
        whatItDoes: raw.whatItDoes ?? raw.header,
        header: raw.header,
        elements: codeMapToCytoscapeElements(map),
        behaviorElements: codeMapToCytoscapeElements(behaviorMap),
        functionalityElements: codeMapToCytoscapeElements(functionalityMap),
        codeMapDetail: profile.level,
        codeMapProfile: profile.profile,
        codeMapProfileLabel: profile.label,
        codeMapProfileHint: profile.hint,
        codeMapSummary: null,
        codeMapLayout: null,
        codeMapStructure: null,
        codeMapModuleDeps: null,
        codeMapView: "structure",
        codeMapAiDirected: false,
        codeMapSource: "parser",
      };
    } catch (fallbackErr) {
      const fb = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.warn(`[cedar] code map fallback failed for ${filename}: ${fb}`);
      return null;
    }
  }
}