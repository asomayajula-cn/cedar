/**
 * Graphviz overview SVG (Node) — PR → slice heads, dependency-first order.
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import { slicesForArchitectureDiagram } from "./diagram-layout.js";

/** @type {import('@viz-js/viz').Viz | null} */
let vizInstance = null;

async function getViz() {
  if (!vizInstance) {
    const { instance } = await import("@viz-js/viz");
    vizInstance = await instance();
  }
  return vizInstance;
}

/**
 * @param {string} dot
 * @returns {Promise<string>}
 */
export async function renderGraphvizSvg(dot) {
  const viz = await getViz();
  const svg = viz.renderString(dot, { engine: "dot", format: "svg" });
  return normalizeGraphvizSvg(svg);
}

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildPipelineDot(microPrs, breakouts, pull, target) {
  const touched = slicesForArchitectureDiagram(microPrs);
  if (!touched.length) {
    return 'digraph cedar { rankdir=TB; bgcolor="#0a0a0a"; node [fontcolor="#a1a1aa"]; empty [label="No files in PR", shape=plaintext]; }';
  }

  const repo =
    target?.owner && target?.repo ? `${target.owner}/${target.repo}` : "repository";
  const prLabel = pull?.number ? `${repo} #${pull.number}` : repo;

  const lines = [
    "digraph cedar_pipeline {",
    '  graph [rankdir=TB, bgcolor="#0a0a0a", pad="0.55", nodesep=0.5, ranksep=0.85, fontname="Helvetica", fontsize=11];',
    '  edge [color="#71717a", penwidth=1.1];',
    '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10, margin="0.14,0.09"];',
    `  pr [label=${quoteDot(prLabel)}, fillcolor="#fafafa", fontcolor="#09090b", penwidth=0];`,
  ];

  const headIds = new Map();

  for (const m of touched) {
    const cluster = `cluster_${safeId(m.componentId)}`;
    const headId = `head_${safeId(m.componentId)}`;
    headIds.set(m.componentId, headId);

    const summary =
      m.description?.trim() ||
      `${m.componentId} · ${m.files.length} file${m.files.length === 1 ? "" : "s"}`;

    lines.push(`  subgraph ${cluster} {`);
    lines.push(
      '    graph [style="rounded,filled", fillcolor="#141416", color="#3f3f46", fontcolor="#e4e4e7", labeljust="l", fontsize=10, margin=12];'
    );
    lines.push(`    label=${quoteDot(m.componentName)};`);
    lines.push(
      `    ${headId} [label=${quoteDot(`${summary}\\n+${m.additions} / −${m.deletions}`)}, fillcolor="#27272a", fontcolor="#e4e4e7"];`
    );
    lines.push("  }");
    lines.push(`  pr -> ${headId};`);
  }

  const deps = new Set();
  for (const m of touched) {
    const from = headIds.get(m.componentId);
    for (const dep of [
      ...(m.dependsOn ?? []),
      ...(breakouts?.components?.find((c) => c.id === m.componentId)?.depends_on ?? []),
    ]) {
      const to = headIds.get(dep);
      if (to && from && to !== from) {
        const key = `${to}->${from}`;
        if (!deps.has(key)) {
          deps.add(key);
          lines.push(`  ${to} -> ${from} [style=dashed, color="#a1a1aa"];`);
        }
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * @param {object} opts
 * @param {MicroPr[]} opts.microPrs
 * @param {{ components?: AiComponentDef[] }} [opts.breakouts]
 * @param {{ number?: number, title?: string }} [opts.pull]
 * @param {{ owner?: string, repo?: string }} [opts.target]
 */
export async function renderReviewDiagrams({ microPrs, breakouts, pull, target }) {
  const pipelineDot = buildPipelineDot(microPrs, breakouts, pull, target);
  let pipelineSvg = "";
  try {
    pipelineSvg = await renderGraphvizSvg(pipelineDot);
  } catch (err) {
    console.warn("[cedar] pipeline graphviz render failed:", err?.message ?? err);
  }
  return { pipelineDot, pipelineSvg };
}

/**
 * @param {string} svg
 */
function normalizeGraphvizSvg(svg) {
  return svg.replace(
    /<svg\b([^>]*)>/,
    (_match, attrs) =>
      `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="100%" preserveAspectRatio="xMidYMid meet">`
  );
}

/**
 * @param {string} s
 */
function quoteDot(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * @param {string} id
 */
function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_") || "slice";
}