/**
 * CEDAR_AI_DIAGRAM:
 * - unset or "auto" — diagram styling in the same Cursor call as breakouts (when CURSOR_API_KEY is set)
 * - "false" — partition only, no diagram AI
 * - "split" — legacy second Cursor call after the graph is built
 */
export function cedarAiDiagramMode() {
  const raw = (process.env.CEDAR_AI_DIAGRAM ?? "auto").toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return "off";
  if (raw === "split" || raw === "separate") return "split";
  return "auto";
}

export function includeDiagramInBreakoutCall() {
  if (!process.env.CURSOR_API_KEY) return false;
  return cedarAiDiagramMode() !== "off";
}

export function useSplitDiagramCall() {
  if (!process.env.CURSOR_API_KEY) return false;
  return cedarAiDiagramMode() === "split";
}