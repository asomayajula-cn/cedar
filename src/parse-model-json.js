/**
 * Composer sometimes emits `\d`-style escapes JSON does not allow — double the backslash.
 * @param {string} text
 */
export function repairInvalidJsonEscapes(text) {
  return text.replace(/\\(?!["\\/bfnrtu]|u[0-9a-fA-F]{4})/g, "\\\\");
}

/**
 * @param {string} raw
 */
function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    try {
      return JSON.parse(repairInvalidJsonEscapes(raw));
    } catch {
      throw firstErr;
    }
  }
}

const COMPOSER_STATUS_LINE =
  /^(Reviewing|Reading|Searching|Thinking|Working|Delegating|Fetching|Running|Editing|Connecting|Warming|Sending)\b/i;

/**
 * Drop Composer / bridge status lines that precede the JSON payload.
 * @param {string} text
 */
export function stripComposerPreamble(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();

  const lines = raw.split("\n");
  const out = [];
  let sawJson = false;
  for (const line of lines) {
    const t = line.trim();
    if (!sawJson && (t.startsWith("{") || t.startsWith("["))) sawJson = true;
    if (!sawJson && COMPOSER_STATUS_LINE.test(t)) continue;
    out.push(line);
  }
  let joined = out.join("\n").trim();
  const lead = joined.match(/^[\s\S]*?(\{[\s\S]*)$/);
  if (lead && lead[1] && !joined.trimStart().startsWith("{") && !joined.trimStart().startsWith("[")) {
    joined = lead[1].trim();
  }
  return joined;
}

/**
 * Prefer the stream/summary chunk that actually contains JSON (Composer often streams status first).
 * @param {string} streamText
 * @param {string} summaryText
 */
export function coalesceJsonModelText(streamText, summaryText) {
  const stream = stripComposerPreamble(streamText);
  const summary = stripComposerPreamble(summaryText);
  const streamHas = hasJsonPayload(stream);
  const summaryHas = hasJsonPayload(summary);
  if (summaryHas && !streamHas) return summary;
  if (streamHas && !summaryHas) return stream;
  if (summaryHas && streamHas) {
    const pick = summary.length >= stream.length ? summary : stream;
    return stripComposerPreamble(pick);
  }
  const merged = [summary, stream].filter(Boolean).join("\n\n").trim();
  return stripComposerPreamble(merged);
}

/**
 * @param {string} text
 */
function hasJsonPayload(text) {
  const t = String(text ?? "");
  return t.includes("{") || t.includes("[");
}

/**
 * Extract a JSON object/array from model output (prose, fences, or truncated).
 * @param {string} content
 */
export function parseJsonFromModel(content) {
  if (content == null || !String(content).trim()) {
    throw new Error("Model returned empty content");
  }

  const trimmed = String(content).trim();
  const body = stripComposerPreamble(trimmed);
  const errors = [];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return tryParseJson(fence[1].trim());
    } catch (err) {
      errors.push(fenceErr(err));
    }
  }

  for (const candidate of jsonParseCandidates(body.length ? body : trimmed)) {
    try {
      return tryParseJson(candidate);
    } catch (err) {
      errors.push(fenceErr(err));
    }
  }

  const preview = (body || trimmed).slice(0, 80).replace(/\s+/g, " ");
  const looksLikeProse =
    /^[A-Za-z]/.test(body || trimmed) && !hasJsonPayload(body || trimmed);
  if (looksLikeProse) {
    throw new Error(composerProseJsonError(preview));
  }
  throw new Error(
    errors[0] ?? `Could not parse JSON from model output (starts with: "${preview}…")`
  );
}

/**
 * @param {string} preview
 */
function composerProseJsonError(preview) {
  return `Composer returned progress text instead of JSON (starts with: "${preview}…"). Run Start review again, or set CEDAR_COMPOSER_REVIEW_MODE=plan in .env and restart the API.`;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function jsonParseCandidates(text) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();

  /** @param {string} s */
  function push(s) {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  }

  push(text);

  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const start =
    objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart) ? objectStart : arrayStart;

  if (start > 0) {
    push(text.slice(start));
  }

  if (start >= 0) {
    const slice = extractBalancedJson(text, start);
    if (slice) push(slice);
  }

  return out;
}

/**
 * @param {unknown} err
 */
function fenceErr(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param {string} text
 * @param {number} start
 */
function extractBalancedJson(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}