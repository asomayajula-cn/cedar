import { aiChat, parseJsonFromModel } from "./ai-chat.js";
import { resolveAiModel } from "./default-model.js";
import { codeMapToCytoscapeElements } from "./code-map-cytoscape.js";
import { renderCodeMapMermaid, COMPACT_MERMAID_INIT } from "./code-map-mermaid-export.js";
import { withCodeMapAiSlot } from "./code-map-ai-pool.js";

/** @typedef {import("./code-map-render.js").MapNode} MapNode */
/** @typedef {import("./code-map-render.js").MapEdge} MapEdge */

const PATCH_CAP = 14_000;
const SKELETON_NODES = 48;
const AI_TIMEOUT_MS = 90_000;

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`code-map AI timed out after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

/**
 * @param {MapNode[]} nodes
 * @param {MapEdge[]} edges
 */
function cytoscapeNodeCount(nodes, edges) {
  const map = { nodes, edges, fileLabel: "", header: "", whatItDoes: "" };
  return codeMapToCytoscapeElements(map).filter((el) => el?.data && !Object.hasOwn(el.data, "source")).length;
}

const NODE_KINDS = new Set([
  "entry",
  "import",
  "export",
  "symbol",
  "definition",
  "call",
  "method",
  "field",
  "property",
  "step",
  "table",
  "query",
  "key",
  "external",
  "module",
  "module-focus",
]);

const VIEW_CAPS = { structure: 56, behavior: 64, functionality: 36 };

const CODE_MAP_SYSTEM = `You are Cedar's **file code-map architect**: produce three cytoscape-ready graph views that help a senior engineer understand ONE file in a pull request.

You receive: file path, git status, a **unified diff patch** (ground truth), a parser **skeleton** (hints only), and heuristic profile metadata. Your job is to **reshape** that material into three intentional diagrams — not generic summaries.

## Views (mandatory)

### 1. structure
**Goal:** Static composition — what exists in this file and how pieces nest.
- Top-down mental model: file root → imports/deps → modules/types/classes/functions → exports/public surface.
- Use kinds: \`entry\` (file root), \`import\`, \`export\`, \`definition\`, \`symbol\`, \`method\`, \`field\`, \`property\`, \`module\`, \`key\` (config), \`table\` (SQL).
- Edges: \`imports\`, \`declares\`, \`contains\`, \`exports\`, \`depends on\` — be precise.
- Collapse boilerplate; emphasize **symbols changed or introduced in the patch**.
- Labels: use real identifiers from the diff (function names, class names, columns, routes). No "misc code".

### 2. behavior
**Goal:** Runtime / execution — what runs, in what order, what gets called.
- Anchor with \`entry\` labeled for the real entrypoint (e.g. \`handler\`, \`main\`, \`useEffect\`, migration runner).
- Kind priority: \`call\`, \`step\`, \`query\`, \`method\`, \`import\` (side effects), \`external\` (IO, HTTP, DB).
- Show control flow: request → validate → persist → respond; or hook → state → render.
- Include error/branch paths only when visible in the patch.
- Edges: \`invokes\`, \`awaits\`, \`reads\`, \`writes\`, \`throws to\`, \`emits\` — match the code.

### 3. functionality
**Goal:** **Why this file matters in the PR** — end-to-end capability the change adds or modifies.
- Linear workflow (3–12 nodes): \`entry\` → steps → outcome.
- Each step label = **verb + object** tied to the diff (e.g. "Validate JWT on /api/orders", "Add column status to shipments").
- Phases in \`scope\`: \`setup\` | \`dependencies\` | \`core\` | \`integration\` | \`api\` | \`contract\` | \`persistence\` | \`cleanup\`.
- Last step should state the **observable outcome** for the product/system.

## Hard rules
- **ONLY** names and behaviors inferable from the patch + skeleton — never invent APIs, tables, or functions not evidenced.
- **Banned labels** (never use): "Runtime behavior", "File role", "misc", "No workflow", "module", "Overview", "Re-run review".
- Every non-entry label must name a **symbol, SQL object, HTTP route, config key, or typed operation** from the patch.
- Prefer: \`OrderService.validate(payload: OrderInput)\`, \`ALTER TABLE shipments ADD status\`, \`POST /v1/webhooks/stripe\`.
- Node \`id\`: stable snake_case, prefix by view (\`st_\`, \`bh_\`, \`fn_\`).
- \`label\`: ≤ 120 chars; dense; include types/signatures when helpful.
- Every view: ≥ 2 nodes, ≥ 1 edge; include exactly one \`entry\` node as workflow root (structure: file node).
- If the patch is thin (config/markdown), still produce valid minimal graphs explaining **what config keys or docs changed mean operationally**.

## Output JSON only
{
  "developerSummary": "2–4 sentences: technical role of this file in the PR (symbols, contracts, data touched)",
  "structure": { "header": "…", "whatItDoes": "…", "layoutRankdir": "TB"|"LR", "nodes": [...], "edges": [...] },
  "behavior":   { "header": "…", "whatItDoes": "…", "layoutRankdir": "TB", "nodes": [...], "edges": [...] },
  "functionality": { "header": "…", "whatItDoes": "…", "layoutRankdir": "TB", "nodes": [...], "edges": [...] }
}

Node: { "id", "label", "kind", "scope?" }
Edge: { "from", "to", "label?", "style"?: "solid"|"dotted" }`;

/**
 * @param {string} path
 * @param {string} patch
 * @param {string} status
 * @param {{
 *   raw: { nodes: MapNode[], edges: MapEdge[], header: string, whatItDoes: string, fileLabel: string },
 *   profile: { level: string, profile: string, label: string, hint: string },
 *   summary: { lead?: string, bullets?: string[], structure?: string },
 * }} ctx
 */
function buildCodeMapUserPayload(path, patch, status, ctx) {
  const nodes = (ctx.raw.nodes ?? []).slice(0, SKELETON_NODES).map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    scope: n.scope ?? "",
  }));
  const edges = (ctx.raw.edges ?? [])
    .filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to))
    .slice(0, 80)
    .map((e) => ({ from: e.from, to: e.to, label: e.label ?? "", style: e.style ?? "solid" }));

  return JSON.stringify(
    {
      model_hint: resolveAiModel(),
      file: { path, status: status || "modified" },
      profile: ctx.profile,
      heuristic: {
        header: ctx.raw.header,
        whatItDoes: ctx.raw.whatItDoes,
        summaryLead: ctx.summary.lead ?? "",
        summaryBullets: (ctx.summary.bullets ?? []).slice(0, 6),
        structureOutline: ctx.summary.structure ?? "",
      },
      skeleton: { nodes, edges },
      patch: (patch ?? "").slice(0, PATCH_CAP),
    },
    null,
    0
  );
}

/**
 * @param {string} id
 * @param {string} prefix
 * @param {number} i
 */
function safeId(id, prefix, i) {
  const base = String(id ?? "")
    .trim()
    .replace(/[^\w.-]/g, "_")
    .slice(0, 64);
  return base || `${prefix}_n${i}`;
}

/**
 * @param {unknown} raw
 * @param {string} viewKey
 * @param {string} path
 * @param {string} fileLabel
 */
function normalizeView(raw, viewKey, path, fileLabel) {
  if (!raw || typeof raw !== "object") return null;
  const v = /** @type {Record<string, unknown>} */ (raw);
  const cap = VIEW_CAPS[viewKey] ?? 48;
  const prefix = viewKey === "structure" ? "st" : viewKey === "behavior" ? "bh" : "fn";

  /** @type {MapNode[]} */
  const nodes = [];
  const idMap = new Map();
  const rawNodes = Array.isArray(v.nodes) ? v.nodes : [];
  for (let i = 0; i < rawNodes.length && nodes.length < cap; i++) {
    const n = rawNodes[i];
    if (!n || typeof n !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (n);
    const id = safeId(o.id, prefix, i);
    const kind = String(o.kind ?? "symbol").toLowerCase();
    const label = String(o.label ?? "").trim().slice(0, 120);
    if (!label) continue;
    idMap.set(String(o.id ?? id), id);
    nodes.push({
      id,
      label,
      kind: NODE_KINDS.has(kind) ? kind : "symbol",
      scope: o.scope ? String(o.scope).slice(0, 48) : undefined,
    });
  }

  if (!nodes.length) return null;

  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodes.some((n) => n.kind === "entry")) {
    nodes.unshift({ id: `${prefix}_entry`, label: fileLabel || path.split("/").pop() || "file", kind: "entry" });
    nodeIds.add(`${prefix}_entry`);
  }

  /** @type {MapEdge[]} */
  const edges = [];
  const rawEdges = Array.isArray(v.edges) ? v.edges : [];
  for (const e of rawEdges) {
    if (!e || typeof e !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (e);
    let from = idMap.get(String(o.from)) ?? safeId(o.from, prefix, edges.length);
    let to = idMap.get(String(o.to)) ?? safeId(o.to, prefix, edges.length + 1);
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    edges.push({
      from,
      to,
      label: o.label ? String(o.label).slice(0, 40) : undefined,
      style: o.style === "dotted" ? "dotted" : "solid",
    });
    if (edges.length >= cap) break;
  }

  if (nodes.length >= 2 && edges.length === 0) {
    const root = nodes.find((n) => n.kind === "entry") ?? nodes[0];
    for (const n of nodes.filter((x) => x.id !== root.id).slice(0, 24)) {
      edges.push({ from: root.id, to: n.id, label: "contains", style: "solid" });
    }
  }

  return {
    fileLabel,
    header: String(v.header ?? `${viewKey} · ${path.split("/").pop() ?? "file"}`).slice(0, 120),
    whatItDoes: String(v.whatItDoes ?? "").slice(0, 400),
    nodes,
    edges,
    layoutRankdir: v.layoutRankdir === "LR" ? "LR" : "TB",
  };
}

/**
 * @param {unknown} parsed
 * @param {string} path
 * @param {string} fileLabel
 */
export function applyAiCodeMapPlan(parsed, path, fileLabel) {
  if (!parsed || typeof parsed !== "object") return null;
  const p = /** @type {Record<string, unknown>} */ (parsed);

  const structure = normalizeView(p.structure, "structure", path, fileLabel);
  const behavior = normalizeView(p.behavior, "behavior", path, fileLabel);
  const functionality = normalizeView(p.functionality, "functionality", path, fileLabel);

  if (!structure && !behavior && !functionality) return null;

  return {
    developerSummary: typeof p.developerSummary === "string" ? p.developerSummary.trim().slice(0, 600) : "",
    structure,
    behavior,
    functionality,
  };
}

/**
 * @param {string} path
 * @param {string} patch
 * @param {string} status
 * @param {{
 *   raw: { fileLabel: string, header: string, whatItDoes: string, nodes: MapNode[], edges: MapEdge[] },
 *   profile: { level: string, profile: string, label: string, hint: string },
 *   summary: { lead?: string, bullets?: string[], structure?: string },
 * }} ctx
 */
export async function generateAiCodeMapViews(path, patch, status, ctx) {
  const user = buildCodeMapUserPayload(path, patch, status, ctx);

  const text = await withCodeMapAiSlot(() =>
    withTimeout(
      aiChat({
        json: true,
        temperature: 0.15,
        maxTokens: 4096,
        messages: [
          { role: "system", content: CODE_MAP_SYSTEM },
          { role: "user", content: user },
        ],
      }),
      AI_TIMEOUT_MS
    )
  );

  const parsed = parseJsonFromModel(text);
  const plan = applyAiCodeMapPlan(parsed, path, ctx.raw.fileLabel ?? path);
  return plan;
}

/**
 * Merge AI views into file-flow artifacts (keeps deps overlay on structure elements).
 *
 * @param {Awaited<ReturnType<typeof import("./code-map-artifacts.js").buildFileFlowArtifacts>>} artifacts
 * @param {NonNullable<ReturnType<typeof applyAiCodeMapPlan>>} plan
 * @param {object[] | null} depElements
 */
export function mergeAiCodeMapIntoArtifacts(artifacts, plan, depElements) {
  const next = { ...artifacts };

  if (plan.developerSummary) {
    next.whatItDoes = plan.developerSummary;
    if (next.codeMapSummary && typeof next.codeMapSummary === "object") {
      next.codeMapSummary = { ...next.codeMapSummary, lead: plan.developerSummary };
    }
  }

  if (plan.structure && cytoscapeNodeCount(plan.structure.nodes, plan.structure.edges) >= 1) {
    next.header = plan.structure.header || next.header;
    const structural = plan.structure;
    let elements = codeMapToCytoscapeElements(structural);
    if (depElements?.length) elements = [...elements, ...depElements];
    if (elements.filter((el) => el?.data && !Object.hasOwn(el.data, "source")).length >= 1) {
      next.elements = elements;
      try {
        next.mermaid = `${COMPACT_MERMAID_INIT}\n${renderCodeMapMermaid(structural)}`;
      } catch {
        /* keep heuristic mermaid */
      }
      if (plan.structure.whatItDoes) next.codeMapStructure = plan.structure.whatItDoes;
      if (next.codeMapLayout && typeof next.codeMapLayout === "object") {
        next.codeMapLayout = {
          ...next.codeMapLayout,
          rankdir: plan.structure.layoutRankdir ?? next.codeMapLayout.rankdir,
        };
      }
    }
  }

  if (plan.behavior && cytoscapeNodeCount(plan.behavior.nodes, plan.behavior.edges) >= 2) {
    next.behaviorElements = codeMapToCytoscapeElements(plan.behavior);
  }

  if (plan.functionality && cytoscapeNodeCount(plan.functionality.nodes, plan.functionality.edges) >= 2) {
    next.functionalityElements = codeMapToCytoscapeElements(plan.functionality);
  }

  const hint = String(next.codeMapProfileHint ?? "");
  next.codeMapProfileHint = hint.includes("AI-directed")
    ? hint
    : `${hint} AI-directed Structure / Behavior / Functionality.`.trim();
  next.codeMapAiDirected = true;

  return next;
}