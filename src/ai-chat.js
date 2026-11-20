import { cursorChat } from "./cursor-llm.js";
import { openRouterChat, parseJsonFromModel } from "./openrouter.js";
import { resolveAiModel } from "./default-model.js";

export { parseJsonFromModel, resolveAiModel };

export function hasAiProvider() {
  return Boolean(process.env.CURSOR_API_KEY) || Boolean(process.env.OPENROUTER_API_KEY);
}

export function activeAiProvider() {
  if (process.env.CURSOR_API_KEY) return "cursor";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return null;
}

/**
 * @param {Parameters<typeof openRouterChat>[0]} opts
 */
export async function aiChat(opts) {
  const withJson =
    opts.json && process.env.CURSOR_API_KEY
      ? {
          ...opts,
          messages: opts.messages.map((m, i) =>
            m.role === "system" && i === opts.messages.findIndex((x) => x.role === "system")
              ? {
                  ...m,
                  content: `${JSON_ONLY_INSTRUCTION}\n\n${m.content}`,
                }
              : m
          ),
        }
      : opts;

  if (process.env.CURSOR_API_KEY) return cursorChat(withJson);
  if (process.env.OPENROUTER_API_KEY) return openRouterChat(opts);
  throw new Error("Set CURSOR_API_KEY (Composer) or OPENROUTER_API_KEY");
}

const JSON_ONLY_INSTRUCTION =
  "OUTPUT: Reply with exactly one JSON object. No preamble, no explanation, no markdown code fences. The first non-whitespace character must be {.";