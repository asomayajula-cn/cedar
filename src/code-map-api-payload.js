/**
 * Client-facing artifact for the code-map flyout (from buildFileFlowArtifacts).
 * @param {Awaited<ReturnType<typeof import("./file-flow-build-safe.js").buildFileFlowArtifactsSafe>> | null} flow
 */
export function codeMapFlowToFlyoutPayload(flow) {
  if (!flow) return null;
  return {
    mermaid: flow.mermaid ?? null,
    svg: flow.svg ?? null,
    whatItDoes: flow.whatItDoes ?? null,
    header: flow.header ?? null,
    elements: flow.elements ?? null,
    behaviorElements: flow.behaviorElements ?? null,
    functionalityElements: flow.functionalityElements ?? null,
    detail: flow.codeMapDetail ?? null,
    profile: flow.codeMapProfile ?? null,
    profileLabel: flow.codeMapProfileLabel ?? null,
    profileHint: flow.codeMapProfileHint ?? null,
    summary: flow.codeMapSummary ?? null,
    structure: flow.codeMapStructure ?? null,
    layout: flow.codeMapLayout ?? null,
    moduleDeps: flow.codeMapModuleDeps ?? null,
    aiDirected: Boolean(flow.codeMapAiDirected),
    source: flow.codeMapSource === "ai" || flow.codeMapAiDirected ? "ai" : flow.codeMapSource ?? "parser",
  };
}