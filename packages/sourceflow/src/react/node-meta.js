/** @type {Record<string, { short: string, title: string }>} */
export const KIND_META = {
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

/** @param {string} [kind] */
export function kindMeta(kind) {
  const k = String(kind ?? "symbol");
  return KIND_META[k] ?? { short: k.slice(0, 4), title: k };
}