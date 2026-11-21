import { collectReadablePatchText } from "./file-flow-semantic.js";
import { inferWhatItDoes, MAX_MAP_NODES } from "./code-map-render.js";
import {
  parseJavaForMap,
  findNodesNamed,
  typeIdentifierName,
  methodDeclaratorName,
  httpMappingFromMethod,
  typeHasRestController,
  callsFromMethodBody,
  walkJavaAst,
  inferJavaTypeNameFromPath,
  fieldDeclarationLabel,
} from "./java-ast-walk.js";

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildJavaCodeMap(path, patch) {
  const meta = collectReadablePatchText(patch);
  /** @type {import("./code-map-render.js").MapNode[]} */
  const nodes = [];
  /** @type {import("./code-map-render.js").MapEdge[]} */
  const edges = [];
  let uid = 0;
  const entryId = `entry_${uid++}`;
  const fileLeaf = String(path ?? "").split("/").pop() || "compilation unit";
  nodes.push({ id: entryId, label: fileLeaf.replace(/\.java$/i, ""), kind: "entry" });

  const parsed = parseJavaForMap(meta.text);
  if (parsed?.ast) {
    const map = buildFromJavaAst(parsed.ast, path, meta, meta.text, nodes, edges, entryId, uid);
    if (map.nodes.length > 1) return map;
  }
  return buildJavaCodeMapRegex(meta, path, nodes, edges, entryId, uid);
}

/**
 * @param {object} ast
 * @param {{ text: string, added?: number }} meta
 * @param {string} source
 * @param {import("./code-map-render.js").MapNode[]} nodes
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {string} entryId
 * @param {number} startUid
 */
function buildFromJavaAst(ast, path, meta, source, nodes, edges, entryId, startUid) {
  let uid = startUid;
  let classId = entryId;
  let methodScope = "module";

  for (const imp of findNodesNamed(ast, "importDeclaration")) {
    const parts = [];
    walkJavaAst(imp, (n) => {
      if (!n.image) return;
      if (n.name === "Identifier" || n.tokenType?.name === "Identifier") parts.push(n.image);
    });
    const fqn = parts.join(".");
    if (!fqn) continue;
    const id = `imp_${uid++}`;
    nodes.push({ id, label: fqn, kind: "import" });
    edges.push({ from: entryId, to: id, label: "imports", style: "dotted" });
  }

  const typeNodes = [
    ...findNodesNamed(ast, "normalClassDeclaration"),
    ...findNodesNamed(ast, "normalInterfaceDeclaration"),
  ];

  for (const typeDecl of typeNodes) {
    const name = typeIdentifierName(typeDecl);
    if (!name || name === "__CedarSynthetic__") continue;
    const isInterface = typeDecl.name === "normalInterfaceDeclaration";
    classId = `sym_${uid++}`;
    nodes.push({
      id: classId,
      label: `${isInterface ? "interface" : "class"} ${name}`,
      kind: "symbol",
    });
    edges.push({ from: entryId, to: classId, label: "defines" });
    methodScope = name;

    if (typeHasRestController(typeDecl)) {
      const rid = `ext_${uid++}`;
      nodes.push({ id: rid, label: "REST surface", kind: "external" });
      edges.push({ from: classId, to: rid, label: "exposes" });
    }

    const methods = findNodesNamed(typeDecl, "methodDeclaration");
    for (const methodDecl of methods) {
      const mName = methodDeclaratorName(methodDecl);
      if (!mName) continue;
      const http = httpMappingFromMethod(methodDecl);
      const label = http ? `${http.method} ${http.path} → ${mName}()` : `${mName}()`;
      const methodId = `sym_${uid++}`;
      nodes.push({ id: methodId, label, kind: "symbol", scope: methodScope });
      edges.push({ from: classId, to: methodId, label: "method" });

      const body = findNodesNamed(methodDecl, "methodBody")[0];
      if (body) {
        for (const callLabel of callsFromMethodBody(source, body, 24)) {
          const cid = `call_${uid++}`;
          nodes.push({ id: cid, label: callLabel, kind: "call", scope: methodScope });
          edges.push({ from: methodId, to: cid, label: "calls", style: "dotted" });
        }
      }
    }
  }

  if (typeNodes.length === 0) {
    const fields = findNodesNamed(ast, "fieldDeclaration");
    if (fields.length) {
      const inferred = inferJavaTypeNameFromPath(path) ?? "entity";
      classId = `sym_${uid++}`;
      nodes.push({ id: classId, label: `class ${inferred}`, kind: "symbol" });
      edges.push({ from: entryId, to: classId, label: "defines" });
      methodScope = inferred;
      for (const fd of fields.slice(0, 40)) {
        const label = fieldDeclarationLabel(fd);
        if (!label) continue;
        const fid = `sym_${uid++}`;
        nodes.push({ id: fid, label, kind: "symbol", scope: inferred });
        edges.push({ from: classId, to: fid, label: "field" });
      }
    }
  }

  const header = [`java-parser · ${nodes.length} nodes`, meta.added ? `+${meta.added} lines` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    header,
    whatItDoes: inferWhatItDoes(nodes, edges, "java"),
    nodes: nodes.slice(0, MAX_MAP_NODES),
    edges,
  };
}

/**
 * @param {{ text: string, added?: number }} meta
 * @param {import("./code-map-render.js").MapNode[]} nodes
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {string} entryId
 * @param {number} startUid
 */
function buildJavaCodeMapRegex(meta, path, nodes, edges, entryId, startUid) {
  let uid = startUid;
  let classId = entryId;
  let methodId = entryId;
  let methodScope = "module";
  let pendingHttp = null;

  for (const raw of meta.text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;

    const mapping = line.match(/@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*["']([^"']+)["']/i);
    if (mapping) {
      pendingHttp = { method: mapping[1].toUpperCase(), path: mapping[2] };
      continue;
    }

    if (/^import\s+/.test(line)) {
      const id = `imp_${uid++}`;
      nodes.push({ id, label: line.replace(/^import\s+/, "").replace(/;$/, ""), kind: "import" });
      edges.push({ from: entryId, to: id, label: "imports", style: "dotted" });
      continue;
    }

    const cm = line.match(/^(?:public\s+)?(?:class|interface|record)\s+(\w+)/);
    if (cm) {
      classId = `sym_${uid++}`;
      nodes.push({ id: classId, label: `${/interface/.test(line) ? "interface" : "class"} ${cm[1]}`, kind: "symbol" });
      edges.push({ from: entryId, to: classId, label: "defines" });
      if (/@RestController|@Controller/.test(line)) {
        const rid = `ext_${uid++}`;
        nodes.push({ id: rid, label: "REST surface", kind: "external" });
        edges.push({ from: classId, to: rid, label: "exposes" });
      }
      methodId = classId;
      methodScope = cm[1];
      continue;
    }

    const mm = line.match(/^(?:public|private|protected).*\s+(\w+)\s*\(/);
    if (mm && mm[1] !== "class") {
      methodId = `sym_${uid++}`;
      const http = pendingHttp ? `${pendingHttp.method} ${pendingHttp.path} → ` : "";
      nodes.push({ id: methodId, label: `${http}${mm[1]}()`, kind: "symbol", scope: methodScope });
      edges.push({ from: classId, to: methodId, label: "method" });
      pendingHttp = null;
      traceCalls(line, methodScope, methodId, nodes, edges, () => `call_${uid++}`);
      continue;
    }

    if (methodId !== entryId) traceCalls(line, methodScope, methodId, nodes, edges, () => `call_${uid++}`);
  }

  if (nodes.length <= 1) {
    const inferred = inferJavaTypeNameFromPath(path);
    const classId = `sym_${uid++}`;
    nodes.push({ id: classId, label: `class ${inferred ?? "partial unit"}`, kind: "symbol" });
    edges.push({ from: entryId, to: classId, label: "inferred" });
    for (const raw of meta.text.split("\n")) {
      const fm = raw.trim().match(/^private\s+[\w<>,\s]+\s+(\w+)\s*;/);
      if (fm) {
        const fid = `sym_${uid++}`;
        nodes.push({ id: fid, label: fm[0].slice(0, 72), kind: "symbol", scope: inferred ?? "partial unit" });
        edges.push({ from: classId, to: fid, label: "field" });
      }
    }
  }

  const header = [`regex fallback · ${nodes.length} nodes`, meta.added ? `+${meta.added} lines` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    header,
    whatItDoes: inferWhatItDoes(nodes, edges, "java"),
    nodes: nodes.slice(0, MAX_MAP_NODES),
    edges,
  };
}

function traceCalls(line, scope, fromId, nodes, edges, nextCall) {
  const existing = nodes.filter((n) => n.scope === scope && n.kind === "call").length;
  if (existing >= 52) return;
  const re = /(\w+)\.(\w+)\s*\(|new\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(line)) !== null && existing < 52) {
    const label = m[3] ? `new ${m[3]}` : `${m[1]}.${m[2]}()`;
    if (/^(if|for|while|return|public)$/.test(m[1])) continue;
    const id = nextCall();
    nodes.push({ id, label, kind: "call", scope });
    edges.push({ from: fromId, to: id, label: "calls", style: "dotted" });
  }
}