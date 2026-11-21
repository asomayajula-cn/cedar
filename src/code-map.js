import { isSqlFile } from "./sql-slice.js";
import { fileFlowKind } from "./file-flow-semantic.js";
import { buildSqlCodeMap } from "./code-map-sql.js";
import { buildJsCodeMap } from "./code-map-js.js";
import { buildJavaCodeMap } from "./code-map-java.js";
import { buildGenericCodeMap } from "./code-map-generic.js";
import { buildYamlCodeMap, isYamlPath } from "./code-map-yaml.js";
import { buildJsonCodeMap, isJsonPath } from "./code-map-json.js";
/** @typedef {import("./code-map-render.js").MapNode} MapNode */
/** @typedef {import("./code-map-render.js").MapEdge} MapEdge */

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildCodeMapData(path, patch) {
  const fileLabel = shortName(path);
  let inner;
  if (isSqlFile(path)) inner = buildSqlCodeMap(path, patch);
  else if (isYamlPath(path)) inner = buildYamlCodeMap(path, patch);
  else if (isJsonPath(path)) inner = buildJsonCodeMap(path, patch);
  else {
    const kind = fileFlowKind(path);
    if (kind === "javascript" || kind === "component") inner = buildJsCodeMap(path, patch);
    else if (kind === "jvm") inner = buildJavaCodeMap(path, patch);
    else if (kind === "dotnet") inner = buildGenericCodeMap(path, patch, kind);
    else inner = buildGenericCodeMap(path, patch, kind);
  }
  return {
    fileLabel,
    header: inner.header,
    whatItDoes: inner.whatItDoes,
    nodes: inner.nodes,
    edges: inner.edges,
  };
}

function shortName(path) {
  const p = path.split("/");
  return p.length > 2 ? `…/${p.slice(-2).join("/")}` : path;
}