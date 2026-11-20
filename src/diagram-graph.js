/**
 * Canonical graph JSON for interactive diagrams (same structure every review).
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import { slicesForArchitectureDiagram } from "./diagram-layout.js";

const MAX_FILES_PER_SLICE = 12;
const MAX_SLICES = 24;

/**
 * @typedef {{ id: string, label: string, type: 'pr'|'slice'|'file', parent?: string }} DiagramNode
 * @typedef {{ id: string, source: string, target: string, kind: 'contains'|'depends' }} DiagramEdge
 */

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ number?: number, title?: string }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildDiagramGraph(microPrs, breakouts, pull, target) {
  const allTouched = slicesForArchitectureDiagram(microPrs);
  const touched = allTouched.slice(0, MAX_SLICES);
  const repo =
    target?.owner && target?.repo ? `${target.owner}/${target.repo}` : "repository";
  const prLabel = pull?.number ? `${repo} #${pull.number}` : repo;

  /** @type {DiagramNode[]} */
  const overviewNodes = [{ id: "pr", label: prLabel, type: "pr" }];
  /** @type {DiagramEdge[]} */
  const overviewEdges = [];

  /** @type {DiagramNode[]} */
  const detailNodes = [{ id: "pr", label: prLabel, type: "pr" }];
  /** @type {DiagramEdge[]} */
  const detailEdges = [];

  for (const m of touched) {
    const sliceId = `slice_${safeId(m.componentId)}`;
    const sliceLabel = `${m.componentName}\n${m.componentId} · ${m.files.length} files · +${m.additions}/−${m.deletions}`;

    overviewNodes.push({ id: sliceId, label: sliceLabel, type: "slice" });
    overviewEdges.push({
      id: `e_pr_${sliceId}`,
      source: "pr",
      target: sliceId,
      kind: "contains",
    });

    detailNodes.push({ id: sliceId, label: sliceLabel, type: "slice" });
    detailEdges.push({
      id: `e_pr_${sliceId}`,
      source: "pr",
      target: sliceId,
      kind: "contains",
    });

    const files = [...m.files]
      .sort((a, b) => filePath(a).localeCompare(filePath(b)))
      .slice(0, MAX_FILES_PER_SLICE);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const fileId = `${sliceId}_f${i}`;
      const short = shortenPath(filePath(f));
      const fileLabel = `${short}\n+${f.additions ?? 0}/−${f.deletions ?? 0}`;
      detailNodes.push({
        id: fileId,
        label: fileLabel,
        type: "file",
      });
      detailEdges.push({
        id: `e_${sliceId}_${fileId}`,
        source: sliceId,
        target: fileId,
        kind: "contains",
      });
    }

    if (m.files.length > MAX_FILES_PER_SLICE) {
      const moreId = `${sliceId}_more`;
      const rest = m.files.length - MAX_FILES_PER_SLICE;
      detailNodes.push({
        id: moreId,
        label: `+${rest} more files`,
        type: "file",
      });
      detailEdges.push({
        id: `e_${sliceId}_${moreId}`,
        source: sliceId,
        target: moreId,
        kind: "contains",
      });
    }
  }

  const deps = new Set();
  for (const m of touched) {
    const from = `slice_${safeId(m.componentId)}`;
    for (const dep of [
      ...(m.dependsOn ?? []),
      ...(breakouts?.components?.find((c) => c.id === m.componentId)?.depends_on ?? []),
    ]) {
      const to = `slice_${safeId(dep)}`;
      if (!overviewNodes.some((n) => n.id === to)) continue;
      const key = `${to}->${from}`;
      if (!deps.has(key)) {
        deps.add(key);
        overviewEdges.push({
          id: `dep_${to}_${from}`,
          source: to,
          target: from,
          kind: "depends",
        });
        detailEdges.push({
          id: `dep_${to}_${from}`,
          source: to,
          target: from,
          kind: "depends",
        });
      }
    }
  }

  if (allTouched.length > touched.length) {
    const moreId = "slices_omitted";
    const n = allTouched.length - touched.length;
    overviewNodes.push({ id: moreId, label: `+${n} more slices`, type: "slice" });
    overviewEdges.push({ id: "e_pr_omitted", source: "pr", target: moreId, kind: "contains" });
    detailNodes.push({ id: moreId, label: `+${n} more slices`, type: "slice" });
    detailEdges.push({ id: "e_pr_omitted", source: "pr", target: moreId, kind: "contains" });
  }

  return {
    meta: {
      prLabel,
      sliceCount: allTouched.length,
      slicesShown: touched.length,
      version: 1,
    },
    overview: { nodes: overviewNodes, edges: overviewEdges },
    detail: { nodes: detailNodes, edges: detailEdges },
  };
}

/**
 * @param {{ filename?: string, path?: string }} f
 */
function filePath(f) {
  return f.filename ?? f.path ?? "";
}

/**
 * @param {string} path
 */
function shortenPath(path) {
  const p = String(path);
  if (p.length <= 44) return p;
  const parts = p.split("/");
  if (parts.length <= 2) return `…${p.slice(-42)}`;
  return `${parts[0]}/…/${parts[parts.length - 1]}`;
}

/**
 * @param {string} id
 */
function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_") || "slice";
}