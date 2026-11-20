/** Default on OpenRouter (breakouts + slice review). Override with OPENROUTER_MODEL. */
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";

export function resolveOpenRouterModel(explicit) {
  return explicit ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
}