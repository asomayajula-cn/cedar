import { aiChat, parseJsonFromModel, resolveAiModel } from "./ai-chat.js";
import {
  AI_PARTITION_SYSTEM_EXTRA,
  ARCHITECTURE_MODEL_LABEL,
  CANONICAL_SLICE_IDS,
  displayNameForSlice,
  enrichComponentsFromYaml,
  normalizeSliceId,
} from "./architecture-model.js";
import { includeDiagramInBreakoutCall } from "./diagram-visual-mode.js";
import { heuristicArchitecturalBreakouts } from "./heuristic-breakouts.js";
import { filterComponentsWithFiles } from "./pr-architecture.js";

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
 * @property {'ai' | 'heuristic' | 'ai+heuristic' | 'cache'} strategy
 * @property {Record<string, unknown> | null} [diagramVisual]
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
      diagramVisual: merged.diagramVisual ?? null,
      model: resolveAiModel(),
      strategy: merged.strategy,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      architectureSummary: `${heuristic.architectureSummary} (AI breakout skipped: ${message})`,
      components: heuristic.components,
      fileAssignments: heuristic.fileAssignments,
      diagramVisual: null,
      model: resolveAiModel(),
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
  let components = ai.components.length ? ai.components : heuristic.components;
  const assignments = { ...heuristic.fileAssignments, ...ai.fileAssignments };
  ensureAllFilesAssigned(assignments, files, components);
  components = filterComponentsWithFiles(components, assignments);

  const strategy = ai.components.length && Object.keys(ai.fileAssignments).length ? "ai" : "ai+heuristic";

  return {
    architectureSummary: ai.architectureSummary || heuristic.architectureSummary,
    components,
    fileAssignments: assignments,
    diagramVisual: ai.diagramVisual ?? null,
    strategy,
  };
}

/**
 * @param {Record<string, unknown>} parsed
 * @returns {Record<string, unknown> | null}
 */
function coalesceDiagramVisual(parsed) {
  const raw = parsed.diagram_visual ?? parsed.diagramVisual;
  if (!raw || typeof raw !== "object") return null;
  const highlights = raw.highlight_slice_ids ?? raw.highlight_node_ids;
  return {
    ...raw,
    highlight_node_ids: Array.isArray(highlights)
      ? highlights.map((id) =>
          String(id).startsWith("slice_") ? String(id) : `slice_${slugId(String(id))}`
        )
      : raw.highlight_node_ids,
    slice_labels: raw.slice_labels ?? raw.component_labels,
    node_labels: raw.node_labels ?? {},
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
- Each changed file appears exactly once in file_assignments
- components[] must only include slices that have ≥1 file in this PR (infer layers from changed_paths; do not invent empty layers)
- architecture_summary: one short paragraph on which modules and layers this PR actually changes (paths in the diff)

${AI_PARTITION_SYSTEM_EXTRA}

SOLID (use in component names/rationale, not as extra slice ids unless paths demand it):
- SRP: one reason per slice/layer; controllers stay thin
- OCP: extend via domain/application, not sprawling conditionals in api
- LSP: substitutable port implementations in infrastructure
- ISP: small application ports, not god interfaces
- DIP: domain/application do not depend on infrastructure or Spring; depend on abstractions

Your entire response must be one JSON object (no text before or after). Keys: architecture_summary, components[], file_assignments{}.
components[].id must be snake_case.${
    includeDiagramInBreakoutCall()
      ? `

Also return diagram_visual for a black-and-white slice overview (same response, one object):
"diagram_visual": {
  "visual_summary": "1-2 sentences",
  "layout": "TB" | "LR",
  "slice_labels": { "<component.id>": "short multiline label for slice node" },
  "highlight_slice_ids": ["component ids to emphasize"],
  "conceptual_notes": ["optional reviewer bullets"]
}
Context: ${ARCHITECTURE_MODEL_LABEL}. Labels only — no extra nodes.`
      : ""
  }`;

  const user = JSON.stringify({
    pull_request: {
      title: pullCtx.title,
      description: (pullCtx.body ?? "").slice(0, 1500),
      base: pullCtx.baseRef,
      head: pullCtx.headRef,
    },
    changed_files: digest,
    allowed_slice_ids: CANONICAL_SLICE_IDS.filter((id) => id !== "misc"),
    heuristic_hint: {
      summary: hint.architectureSummary,
      suggested_slices: hint.components.map((c) => ({ id: c.id, name: c.name, file_count: Object.values(hint.fileAssignments).filter((id) => id === c.id).length })),
    },
    required_paths: digest.map((d) => d.path),
  });

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await aiChat({
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
        diagramVisual: coalesceDiagramVisual(parsed),
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/prose instead of json/i.test(msg) || /Unexpected token/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 400));
      }
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

  return raw.map((c) => {
    const id = normalizeSliceId(slugId(c.id ?? c.component_id ?? c.name));
    return {
    id,
    name: displayNameForSlice(id, String(c.name ?? c.title ?? c.id ?? "Slice")),
    description: c.description ? String(c.description) : undefined,
    rationale: c.rationale ? String(c.rationale) : c.why ? String(c.why) : undefined,
    depends_on: Array.isArray(c.depends_on)
      ? c.depends_on.map((d) => normalizeSliceId(slugId(String(d))))
      : Array.isArray(c.dependsOn)
        ? c.dependsOn.map((d) => normalizeSliceId(slugId(String(d))))
        : [],
  };
  });
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
      const id = normalizeSliceId(
        typeof comp === "string" ? slugId(comp) : slugId(comp?.component_id ?? comp?.id ?? String(comp))
      );
      out[path] = id;
    }
  }

  if (Array.isArray(parsed.components)) {
    for (const c of parsed.components) {
      if (Array.isArray(c.files)) {
        const id = normalizeSliceId(slugId(c.id ?? c.name));
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
  const fallback = components[0]?.id ?? "misc";
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
    .slice(0, 48) || "misc";
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