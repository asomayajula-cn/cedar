import fs from "node:fs";
import path from "node:path";
import { cruise } from "dependency-cruiser";

const JS_EXT = /\.(cjs|mjs|jsx?|tsx?)$/i;
const MAX_MODULE_NODES = 32;
const MAX_DEPTH = 4;

/**
 * @param {string} filename
 */
export function isFlyoutDepCruiserEligible(filename) {
  return JS_EXT.test(String(filename ?? ""));
}

/**
 * @param {string} label
 * @param {string} kind
 */
function estimateModuleNodeSize(label, kind) {
  const text = String(label ?? "");
  const padX = 18;
  const padY = 12;
  const charW = 6.2;
  const cols = 24;
  const lineH = 15;
  const lines = Math.max(1, Math.ceil(text.length / cols));
  const w = Math.min(220, Math.max(72, Math.ceil(Math.min(text.length, cols) * charW) + padX));
  const h = Math.min(64, Math.max(30, lines * lineH + padY));
  return { w, h: kind === "module-focus" ? h + 4 : h };
}

/**
 * @param {string} repoRoot
 * @param {string} relPath
 */
function cruiseIncludeRoots(repoRoot, relPath) {
  /** @type {string[]} */
  const roots = [];
  const norm = String(relPath ?? "").replace(/\\/g, "/");
  if (norm.startsWith("web/")) {
    roots.push("web/src", "web");
  }
  if (norm.startsWith("src/")) {
    roots.push("src");
  }
  roots.push(".");
  const seen = new Set();
  return roots.filter((r) => {
    if (seen.has(r)) return false;
    seen.add(r);
    return fs.existsSync(path.join(repoRoot, r));
  });
}

/**
 * @param {string} p
 */
function nodeIdForModule(p) {
  return `dc:mod:${String(p).replace(/\\/g, "/").replace(/[^a-zA-Z0-9:._/-]/g, "_")}`;
}

/**
 * @param {string} relPath
 */
function shortModuleLabel(relPath) {
  const norm = String(relPath).replace(/\\/g, "/");
  const parts = norm.split("/");
  if (parts.length <= 2) return norm;
  return parts.slice(-2).join("/");
}

/**
 * @param {string} focusFile
 * @param {object[]} modules
 */
function modulesToCyElements(focusFile, modules) {
  const focusNorm = focusFile.replace(/\\/g, "/");
  const focusMod =
    modules.find((m) => m.source === focusNorm) ??
    modules.find((m) => String(m.source).replace(/\\/g, "/") === focusNorm);

  if (!focusMod) return { elements: [], stats: { modules: 0, edges: 0 } };

  /** @type {Map<string, object>} */
  const bySource = new Map();
  for (const m of modules) {
    bySource.set(String(m.source).replace(/\\/g, "/"), m);
  }

  /** @type {Set<string>} */
  const chosen = new Set([focusNorm]);
  const queue = [focusNorm];
  while (queue.length && chosen.size < MAX_MODULE_NODES) {
    const src = queue.shift();
    const mod = bySource.get(src);
    if (!mod?.dependencies) continue;
    for (const dep of mod.dependencies) {
      const resolved = dep.resolved ? String(dep.resolved).replace(/\\/g, "/") : "";
      if (!resolved || dep.coreModule || !dep.followable) continue;
      if (!chosen.has(resolved)) {
        chosen.add(resolved);
        queue.push(resolved);
        if (chosen.size >= MAX_MODULE_NODES) break;
      }
    }
  }

  /** @type {object[]} */
  const nodes = [];
  for (const src of chosen) {
    const isFocus = src === focusNorm;
    const kind = isFocus ? "module-focus" : "module";
    const label = isFocus ? shortModuleLabel(src) : shortModuleLabel(src);
    const { w, h } = estimateModuleNodeSize(label, kind);
    nodes.push({
      data: {
        id: nodeIdForModule(src),
        label,
        kind,
        width: w,
        height: h,
      },
    });
  }

  const idFor = (p) => nodeIdForModule(p);
  const nodeIds = new Set(nodes.map((n) => n.data.id));
  /** @type {object[]} */
  const edges = [];
  let edgeIdx = 0;
  for (const src of chosen) {
    const mod = bySource.get(src);
    if (!mod?.dependencies) continue;
    const fromId = idFor(src);
    if (!nodeIds.has(fromId)) continue;
    for (const dep of mod.dependencies) {
      const resolved = dep.resolved ? String(dep.resolved).replace(/\\/g, "/") : "";
      if (!resolved || !chosen.has(resolved)) continue;
      const toId = idFor(resolved);
      if (!nodeIds.has(toId)) continue;
      const dashed = Boolean(dep.dynamic) || dep.couldNotResolve;
      edges.push({
        data: {
          id: `dc:e_${edgeIdx++}_${fromId}_${toId}`,
          source: fromId,
          target: toId,
          label: dep.dynamic ? "dynamic" : "import",
          lineStyle: dashed ? "dashed" : "solid",
        },
      });
    }
  }

  return { elements: [...nodes, ...edges], stats: { modules: nodes.length, edges: edges.length } };
}

/**
 * Flyout-only module graph via dependency-cruiser (local files on disk).
 *
 * @param {string} repoRoot
 * @param {string} filename PR-relative path
 * @returns {Promise<{
 *   elements?: object[],
 *   bullets?: string[],
 *   meta?: { modules: number, edges: number, violations: number, skipped?: boolean, reason?: string },
 * } | null>}
 */
export async function buildFlyoutModuleDeps(repoRoot, filename) {
  const rel = String(filename ?? "").replace(/\\/g, "/");
  if (!isFlyoutDepCruiserEligible(rel)) {
    return { meta: { modules: 0, edges: 0, violations: 0, skipped: true, reason: "not-js" } };
  }

  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    return {
      meta: { modules: 0, edges: 0, violations: 0, skipped: true, reason: "not-on-disk" },
      bullets: ["Module graph needs this file on disk — open locally or re-run review after checkout."],
    };
  }

  const include = cruiseIncludeRoots(repoRoot, rel);
  if (!include.length) {
    return { meta: { modules: 0, edges: 0, violations: 0, skipped: true, reason: "no-cruise-root" } };
  }

  try {
    const result = await cruise(include, {
      focus: rel,
      maxDepth: MAX_DEPTH,
      outputType: "json",
      exclude: "node_modules",
    });
    const out =
      typeof result.output === "string" ? JSON.parse(result.output) : result.output ?? { modules: [] };
    const modules = Array.isArray(out.modules) ? out.modules : [];
    const violations = out.summary?.violations?.length ?? 0;
    const { elements, stats } = modulesToCyElements(rel, modules);

    /** @type {string[]} */
    const bullets = [];
    if (stats.modules > 1) {
      bullets.push(
        `Module graph (dependency-cruiser): ${stats.modules} local files, ${stats.edges} import edges (depth ≤ ${MAX_DEPTH}).`
      );
    } else if (stats.modules === 1) {
      bullets.push("Module graph: no followable local imports in this slice (node built-ins / packages only).");
    }
    if (violations > 0) {
      bullets.push(`${violations} dependency rule violation(s) reported in this focus tree.`);
    }

    if (!elements.length) {
      return {
        meta: {
          modules: 0,
          edges: 0,
          violations,
          skipped: true,
          reason: modules.length ? "empty-graph" : "no-modules",
        },
        bullets: bullets.length ? bullets : undefined,
      };
    }

    return {
      elements,
      bullets,
      meta: { modules: stats.modules, edges: stats.edges, violations, skipped: false },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      meta: { modules: 0, edges: 0, violations: 0, skipped: true, reason: "cruise-error" },
      bullets: [`Module graph skipped (${message.slice(0, 120)}).`],
    };
  }
}