/** Mermaid reserved / fragile class and node ids */
const RESERVED_IDS = new Set([
  "end",
  "subgraph",
  "graph",
  "flowchart",
  "class",
  "classDiagram",
  "style",
  "click",
  "direction",
  "default",
  "participant",
  "actor",
  "pr",
  "client",
]);

/**
 * @param {string} s
 */
export function mermaidSafeText(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "'")
    .replace(/\u2212/g, "-")
    .replace(/#/g, "")
    .replace(/;/g, ",")
    .replace(/[()]/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

/**
 * @param {string} typeName
 * @param {Map<string, string>} [existing]
 */
export function mermaidClassId(typeName, existing = new Map()) {
  if (existing.has(typeName)) return existing.get(typeName);
  let base = String(typeName).replace(/[^a-zA-Z0-9_]/g, "_");
  if (!base || !/^[A-Za-z_]/.test(base)) base = `T_${base || "Type"}`;
  if (RESERVED_IDS.has(base.toLowerCase())) base = `C_${base}`;
  let id = base;
  let n = 2;
  const used = new Set(existing.values());
  while (used.has(id)) {
    id = `${base}_${n++}`;
  }
  return id;
}

/**
 * Quoted Mermaid label for flowchart nodes.
 * @param {string} text
 */
export function mermaidQuotedLabel(text) {
  return `"${mermaidSafeText(text).replace(/"/g, "'")}"`;
}

/**
 * Sequence participant display name (must be quoted when complex).
 * @param {string} text
 */
export function mermaidParticipantAlias(text) {
  return `"${mermaidSafeText(text).replace(/"/g, "'")}"`;
}