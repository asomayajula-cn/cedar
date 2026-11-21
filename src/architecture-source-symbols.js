/**
 * Type / class names for architecture diagrams — from changed source (diff), not partition ids.
 * @typedef {import('./partition.js').MicroPr} MicroPr
 */

import { fileFlowKind, rulesForFileFlowKind } from "./file-flow-semantic.js";
import { walkPatchLines } from "./patch-review.js";

const MAX_NAMES_PER_SLICE = 12;

/**
 * @param {string} label
 */
function nameFromBucketLabel(label) {
  const s = String(label ?? "").trim();
  if (!s) return "";
  const tagged =
    s.match(/\b(?:class|struct|interface|enum|union|record|message|service)\s+(\w+)/i) ??
    s.match(/\b(?:type|interface)\s+(\w+)/i) ??
    s.match(/^export\s+class\s+(\w+)/i) ??
    s.match(/^export\s+(?:default\s+)?function\s+(\w+)/i);
  if (tagged) return tagged[1];
  if (s.includes(" ")) return s.split(/\s+/).pop().replace(/[^a-zA-Z0-9_$]/g, "") || "";
  return s.replace(/[^a-zA-Z0-9_$]/g, "").slice(0, 56);
}

/**
 * @param {string} path
 */
function typeNameFromFilename(path) {
  const base = (path?.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
  if (!base) return "";
  if (/^[A-Z][\w$]*$/.test(base)) return base;
  if (/^[a-z][\w$]*$/.test(base)) {
    const pascal = base.charAt(0).toUpperCase() + base.slice(1);
    if (/^[A-Z][\w$]*$/.test(pascal)) return pascal;
  }
  return "";
}

/**
 * @param {string} patch
 * @param {string} path
 */
function classNamesFromPatch(patch, path) {
  if (!patch?.trim()) return [];
  const kind = fileFlowKind(path);
  const rules = rulesForFileFlowKind(kind, path);
  /** @type {Set<string>} */
  const names = new Set();
  for (const row of walkPatchLines(patch)) {
    if (row.kind === "del") continue;
    const t = row.text.trim();
    if (!t || t.length < 2) continue;
    if (/^\s*(\/\/|#|\/\*|\*|--)/.test(t)) continue;
    for (const rule of rules) {
      if (rule.bucket === "Tests") break;
      const m = rule.re.exec(t);
      if (!m) continue;
      const label = rule.label(m, t);
      const isType =
        rule.bucket === "Types & classes" ||
        rule.bucket === "Definitions" ||
        rule.bucket === "Resources" ||
        rule.bucket === "Operations" ||
        (rule.bucket === "Exports" && /\bclass\s+/i.test(label));
      if (!isType) break;
      const n = nameFromBucketLabel(label);
      if (n && n.length > 1 && !/^(test|spec)$/i.test(n)) names.add(n);
      break;
    }
  }
  return [...names];
}

/**
 * @param {MicroPr} micro
 * @returns {string[]}
 */
export function extractClassNamesFromMicroPr(micro) {
  /** @type {Map<string, number>} */
  const score = new Map();
  const bump = (name, w = 1) => {
    const k = String(name).trim();
    if (!k || k.length < 2) return;
    score.set(k, (score.get(k) ?? 0) + w);
  };

  for (const file of micro?.files ?? []) {
    const path = file.filename ?? file.path ?? "";
    const fromFile = typeNameFromFilename(path);
    if (fromFile) bump(fromFile, 2);
    for (const n of classNamesFromPatch(file.patch ?? "", path)) bump(n, 3);
  }

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([n]) => n)
    .slice(0, MAX_NAMES_PER_SLICE);
}

/**
 * @param {{ classNames?: string[], name?: string, id?: string, micro?: MicroPr }} layer
 * @param {number} [maxLines]
 */
export function formatSourceClassDiagramLabel(layer, maxLines = 4) {
  const names = layer.classNames?.length
    ? layer.classNames
    : extractClassNamesFromMicroPr(layer.micro ?? { files: [] });
  if (names.length) {
    const head = names.slice(0, maxLines).join("\n");
    const extra = names.length > maxLines ? `\n+${names.length - maxLines} more` : "";
    return `${head}${extra}`.trim();
  }
  return String(layer.name ?? layer.id ?? "Source").trim().slice(0, 56);
}

/**
 * Single-line flowchart label from source types.
 * @param {{ classNames?: string[], name?: string, micro?: MicroPr }} layer
 */
export function formatSourceClassFlowLabel(layer) {
  const names = layer.classNames?.length
    ? layer.classNames
    : extractClassNamesFromMicroPr(layer.micro ?? { files: [] });
  if (!names.length) return String(layer.name ?? "Layer").trim().slice(0, 48);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}