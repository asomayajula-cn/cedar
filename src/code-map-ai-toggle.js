import { hasAiProvider } from "./ai-chat.js";

/**
 * CEDAR_AI_CODE_MAP:
 * - false — AST/diff parsers only (no LLM per file)
 * - unset / auto / true — AI-directed Structure / Behavior / Functionality when an AI provider is configured (default on)
 */
export function codeMapAiRequested(explicit) {
  if (explicit !== undefined) return Boolean(explicit);
  const raw = String(process.env.CEDAR_AI_CODE_MAP ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "auto" || raw === "1" || raw === "on") return true;
  return hasAiProvider();
}

export function codeMapAiEnabled(explicit) {
  return codeMapAiRequested(explicit) && hasAiProvider();
}