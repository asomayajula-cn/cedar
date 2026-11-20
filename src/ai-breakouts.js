import { openRouterChat, parseJsonFromModel } from "./openrouter.js";
import { resolveOpenRouterModel } from "./default-model.js";
import { heuristicArchitecturalBreakouts } from "./heuristic-breakouts.js";

const MAX_FILES_FULL = 80;
const PATCH_CHAR_LIMIT = 1200;

/**
 * @typedef {import('./partition.js').PrFile} PrFile
 */

/**
 * @typedef {object} AiComponentDef
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {string} [rationale]
 * @property {string[]} [depends_on]
 */

/**
 * @typedef {object} AiBreakoutPlan
 * @property {string} architectureSummary
 * @property {AiComponentDef[]} components
 * @property {Record<string, string>} fileAssignments
 * @property {string} model
 * @property {'ai' | 'heuristic' | 'ai+heuristic'} strategy
 */

/**
 * @param {PrFile[]} files
 * @param {{ title: string, body?: string, baseRef: string, headRef: string }} pullCtx
 * @returns {Promise<AiBreakoutPlan>}
 */
export async function discoverArchitecturalBreakouts(files, pullCtx) {
  const heuristic = heuristicArchitecturalBreakouts(files);
  const digest = buildPrDigest(files);

  try {
    const ai = await requestAiBreakouts(digest, pullCtx, heuristic);
    const merged = mergePlans(ai, heuristic, files);
    return {
      ...merged,
      model: resolveOpenRouterModel(),
      strategy: merged.strategy,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      architectureSummary: `${heuristic.architectureSummary} (AI breakout skipped: ${message})`,
      components: heuristic.components,
      fileAssignments: heuristic.fileAssignments,
      model: resolveOpenRouterModel(),
      strategy: "heuristic",
    };
  }
}

/**
 * @param {unknown} ai
 * @param {ReturnType<typeof heuristicArchitecturalBreakouts>} heuristic
 * @param {PrFile[]} files
 */
function mergePlans(ai, heuristic, files) {
  const components = ai.components.length ? ai.components : heuristic.components;
  const assignments = { ...heuristic.fileAssignments, ...ai.fileAssignments };
  ensureAllFilesAssigned(assignments, files, components);

  const strategy = ai.components.length && Object.keys(ai.fileAssignments).length ? "ai" : "ai+heuristic";

  return {
    architectureSummary: ai.architectureSummary || heuristic.architectureSummary,
    components,
    fileAssignments: assignments,
    strategy,
  };
}

/**
 * @param {PrFile[]} files
 * @param {*} pullCtx
 * @param {ReturnType<typeof heuristicArchitecturalBreakouts>} hint
 */
async function requestAiBreakouts(digest, pullCtx, hint) {
  const system = `You partition pull requests into micro-review slices for parallel architectural review.

Goals:
- 2–8 slices (not one per file; not one giant slice unless the PR is tiny)
- Slice by architectural responsibility: data, domain, API, UI, infra, tests — inferred from paths and diffs
- Each changed file appears exactly once in file_assignments
- depends_on reflects review order (e.g. persistence before api)

Return JSON only with keys: architecture_summary, components[], file_assignments{}.
components[].id must be snake_case.`;

  const user = JSON.stringify({
    pull_request: {
      title: pullCtx.title,
      description: (pullCtx.body ?? "").slice(0, 1500),
      base: pullCtx.baseRef,
      head: pullCtx.headRef,
    },
    changed_files: digest,
    heuristic_hint: {
      summary: hint.architectureSummary,
      suggested_slices: hint.components.map((c) => ({ id: c.id, name: c.name, file_count: Object.values(hint.fileAssignments).filter((id) => id === c.id).length })),
    },
    required_paths: digest.map((d) => d.path),
  });

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await openRouterChat({
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content:
              attempt === 0
                ? user
                : `${user}\n\nPrevious response was invalid. Include components[] and file_assignments for EVERY path in required_paths.`,
          },
        ],
        json: true,
        maxTokens: 8000,
      });

      const parsed = extractParsedBreakout(parsedSafe(raw));
      const components = coalesceComponents(parsed);
      const fileAssignments = coalesceAssignments(parsed, components);

      return {
        architectureSummary: String(
          parsed.architecture_summary ?? parsed.architectureSummary ?? parsed.summary ?? ""
        ),
        components,
        fileAssignments,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error("AI breakout failed");
}

/**
 * @param {string} raw
 */
function parsedSafe(raw) {
  return parseJsonFromModel(raw);
}

/**
 * @param {unknown} parsed
 */
function extractParsedBreakout(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI returned non-object JSON");
  }
  return parsed;
}

/**
 * @param {Record<string, unknown>} parsed
 */
function coalesceComponents(parsed) {
  const raw =
    parsed.components ??
    parsed.slices ??
    parsed.micro_prs ??
    parsed.micro_slices ??
    parsed.breakouts;

  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  return raw.map((c) => ({
    id: slugId(c.id ?? c.component_id ?? c.name),
    name: String(c.name ?? c.title ?? c.id ?? "Slice"),
    description: c.description ? String(c.description) : undefined,
    rationale: c.rationale ? String(c.rationale) : c.why ? String(c.why) : undefined,
    depends_on: Array.isArray(c.depends_on)
      ? c.depends_on.map((d) => slugId(String(d)))
      : Array.isArray(c.dependsOn)
        ? c.dependsOn.map((d) => slugId(String(d)))
        : [],
  }));
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {AiComponentDef[]} components
 */
function coalesceAssignments(parsed, components) {
  const raw =
    parsed.file_assignments ??
    parsed.fileAssignments ??
    parsed.assignments ??
    parsed.files;

  /** @type {Record<string, string>} */
  const out = {};

  if (raw && typeof raw === "object") {
    for (const [path, comp] of Object.entries(raw)) {
      const id = typeof comp === "string" ? slugId(comp) : slugId(comp?.component_id ?? comp?.id ?? String(comp));
      out[path] = id;
    }
  }

  if (Array.isArray(parsed.components)) {
    for (const c of parsed.components) {
      if (Array.isArray(c.files)) {
        const id = slugId(c.id ?? c.name);
        for (const p of c.files) {
          out[String(p)] = id;
        }
      }
    }
  }

  const valid = new Set(components.map((c) => c.id));
  for (const [path, id] of Object.entries(out)) {
    if (!valid.has(id)) delete out[path];
  }

  return out;
}

/**
 * @param {Record<string, string>} assignments
 * @param {PrFile[]} files
 * @param {AiComponentDef[]} components
 */
function ensureAllFilesAssigned(assignments, files, components) {
  const fallback = components[0]?.id ?? "general";
  for (const f of files) {
    if (!assignments[f.filename]) {
      assignments[f.filename] = fallback;
    }
  }
}

function buildPrDigest(files) {
  return files.slice(0, MAX_FILES_FULL).map((f) => ({
    path: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch_excerpt: truncatePatch(f.patch),
  }));
}

function truncatePatch(patch) {
  if (!patch) return "";
  if (patch.length <= PATCH_CHAR_LIMIT) return patch;
  return `${patch.slice(0, PATCH_CHAR_LIMIT)}\n… [truncated]`;
}

function slugId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "general";
}

export function aiComponentsToDefs(components) {
  return components.map((c) => ({
    id: c.id,
    name: c.name,
    paths: [],
    depends_on: c.depends_on ?? [],
    description: c.description,
    rationale: c.rationale,
  }));
}