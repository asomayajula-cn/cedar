/** @typedef {{ short: string, title: string }} KindMeta */

/** @type {Record<string, KindMeta>} */
export const CODE_MAP_KIND_META = {
  entry: { short: "file", title: "Compilation unit / script entry" },
  symbol: { short: "def", title: "Class, method, or function" },
  definition: { short: "type", title: "Type or export definition" },
  import: { short: "imp", title: "Import dependency" },
  export: { short: "exp", title: "Export surface" },
  call: { short: "call", title: "Invocation" },
  step: { short: "sql", title: "SQL statement step" },
  table: { short: "tbl", title: "Table touched" },
  external: { short: "api", title: "External / REST surface" },
  module: { short: "mod", title: "Module file" },
  "module-focus": { short: "here", title: "Current file" },
};

/**
 * @param {string} [kind]
 */
export function codeMapKindMeta(kind) {
  const k = String(kind ?? "symbol");
  return CODE_MAP_KIND_META[k] ?? { short: k.slice(0, 4), title: k };
}

/**
 * @param {string} [mapLang]
 */
export function codeMapLegendRows(mapLang) {
  const lang = String(mapLang ?? "generic");
  if (lang === "sql") {
    return [
      ["step", "SQL statements in order"],
      ["table", "Tables created or touched"],
      ["call", "Cross-object calls when present"],
    ];
  }
  if (lang === "yaml") {
    return [
      ["definition", "Sections & grouped keys"],
      ["symbol", "Scalar fields & list items"],
      ["external", "K8s kind / overflow"],
    ];
  }
  if (lang === "java") {
    return [
      ["symbol", "Types and methods (java-parser AST)"],
      ["import", "Classpath imports"],
      ["call", "Calls inside method bodies"],
      ["external", "Controllers / REST"],
    ];
  }
  if (lang === "js") {
    return [
      ["symbol", "Functions & class members (@babel)"],
      ["import", "Module imports"],
      ["call", "AST-traced calls"],
      ["module", "dependency-cruiser edges"],
    ];
  }
  return [
    ["symbol", "Symbols in this file"],
    ["call", "Calls & data flow"],
    ["import", "Dependencies"],
  ];
}