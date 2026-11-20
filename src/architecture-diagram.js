/**
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./ai-breakouts.js').AiComponentDef} AiComponentDef
 */

import { slicesForArchitectureDiagram } from "./diagram-layout.js";

const MAX_FILES_PER_SLICE = 12;
const MAX_SLICES_IN_DIAGRAM = 24;

/**
 * @param {MicroPr[]} microPrs
 * @param {{ components?: AiComponentDef[] }} [breakouts]
 * @param {{ title?: string, number?: number }} [pull]
 * @param {{ owner?: string, repo?: string }} [target]
 */
export function buildArchitectureDiagramMermaid(microPrs, breakouts, pull, target) {
  const allTouched = slicesForArchitectureDiagram(microPrs);
  const touched = allTouched.slice(0, MAX_SLICES_IN_DIAGRAM);
  if (!touched.length) {
    return "flowchart TB\n  empty[No files in PR]";
  }

  const repo =
    target?.owner && target?.repo ? `${target.owner}/${target.repo}` : "repository";
  const prLabel = pull?.number ? `${repo} #${pull.number}` : repo;
  const omittedSlices = allTouched.length - touched.length;

  const lines = [
    "flowchart TB",
    "  classDef pr fill:#fafafa,stroke:#52525b,color:#09090b",
    "  classDef slice fill:#18181b,stroke:#71717a,color:#e4e4e7",
    "  classDef file fill:#09090b,stroke:#3f3f46,color:#a1a1aa",
    "  classDef more fill:#0c0c0c,stroke:#27272a,color:#71717a",
    `  pr["${mermaidLabel(prLabel)}"]:::pr`,
  ];

  const idByComponent = new Map();

  for (const m of touched) {
    const sgId = `vpr_${safeNodeId(m.componentId)}`;
    const headId = `${sgId}_head`;
    idByComponent.set(m.componentId, headId);

    lines.push(`  subgraph ${sgId}["${mermaidLabel(m.componentName)}"]`);
    lines.push("    direction TB");
    lines.push(
      `    ${headId}["${mermaidLabel(`${m.componentId} · ${m.files.length} files · +${m.additions}/-${m.deletions}`)}"]:::slice`
    );

    const show = [...m.files]
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .slice(0, MAX_FILES_PER_SLICE);

    for (let j = 0; j < show.length; j++) {
      const file = show[j];
      const fid = `${sgId}_f${j}`;
      const short = shortenPath(file.filename);
      const delta = `+${file.additions ?? 0}/-${file.deletions ?? 0}`;
      lines.push(`    ${fid}["${mermaidLabel(`${short} (${delta})`)}"]:::file`);
      lines.push(`    ${headId} --> ${fid}`);
    }

    if (m.files.length > MAX_FILES_PER_SLICE) {
      const moreId = `${sgId}_more`;
      const rest = m.files.length - MAX_FILES_PER_SLICE;
      lines.push(`    ${moreId}["+${rest} more files in this slice"]:::more`);
      lines.push(`    ${headId} --> ${moreId}`);
    }

    lines.push("  end");
    lines.push(`  pr --> ${headId}`);
  }

  if (omittedSlices > 0) {
    lines.push(`  pr_more["+${omittedSlices} more slices not shown"]:::more`);
    lines.push("  pr --> pr_more");
  }

  const deps = new Set();
  for (const m of touched) {
    const from = idByComponent.get(m.componentId);
    for (const dep of [
      ...(m.dependsOn ?? []),
      ...(breakouts?.components?.find((c) => c.id === m.componentId)?.depends_on ?? []),
    ]) {
      const to = idByComponent.get(dep);
      if (to && from && to !== from) {
        const key = `${to}-->${from}`;
        if (!deps.has(key)) {
          deps.add(key);
          lines.push(`  ${to} -.-> ${from}`);
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {string} mermaid
 */
export function buildArchitectureDiagramMarkdown(mermaid) {
  return ["### Complete layout", "", "```mermaid", mermaid, "```"].join("\n");
}

/**
 * @param {string} path
 */
function shortenPath(path) {
  const p = String(path);
  if (p.length <= 48) return p;
  const parts = p.split("/");
  if (parts.length <= 2) return `…${p.slice(-45)}`;
  return `${parts[0]}/…/${parts[parts.length - 1]}`;
}

/**
 * @param {string} id
 */
function safeNodeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_") || "slice";
}

/**
 * Safe node / subgraph labels for Mermaid flowchart quoted strings.
 * @param {string} s
 */
function mermaidLabel(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "'")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/#/g, "")
    .replace(/;/g, ",")
    .replace(/\n/g, " ")
    .trim();
}