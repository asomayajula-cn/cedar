import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { collectReadablePatchText } from "./file-flow-semantic.js";
import { renderAstTraceMermaid, traceOutcome, MAX_CALLS_PER_SCOPE } from "./ast-trace-mermaid.js";

const traverse = traverseModule.default ?? traverseModule;

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildJsAstTraceMermaid(path, patch) {
  const meta = collectReadablePatchText(patch);
  const title = shortName(path);

  if (!meta.text.trim()) {
    return renderAstTraceMermaid({
      title,
      header: "No source in diff",
      nodes: [],
      edges: [],
      outcome: "Cannot build AST without source lines",
    });
  }

  const graph = extractJsTraceGraph(meta.text, path);
  const header = [
    `${graph.nodes.length} AST nodes`,
    `${graph.edges.length} links`,
    meta.added ? `+${meta.added} lines` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return renderAstTraceMermaid({
    title,
    header,
    nodes: graph.nodes,
    edges: graph.edges,
    outcome: traceOutcome(graph.nodes, graph.edges),
  });
}

/**
 * @param {string} text
 * @param {string} path
 */
function extractJsTraceGraph(text, path) {
  /** @type {import("./ast-trace-mermaid.js").TraceNode[]} */
  const nodes = [];
  /** @type {import("./ast-trace-mermaid.js").TraceEdge[]} */
  const edges = [];
  let uid = 0;
  const nextId = (p) => `${p}_${uid++}`;

  const plugins = ["jsx"];
  if (/\.tsx?$/i.test(path)) plugins.push("typescript");

  let program;
  try {
    program = parse(text, {
      sourceType: "module",
      allowImportOutsideModule: true,
      errorRecovery: true,
      plugins,
    });
  } catch {
    return lineFallbackTrace(text);
  }

  const moduleId = nextId("mod");
  nodes.push({ id: moduleId, label: "Module body", kind: "definition", scope: "__module__" });

  traverse(program, {
    ImportDeclaration(p) {
      const specs = p.node.specifiers.map((s) => s.local.name).join(", ");
      const from = p.node.source.value;
      const id = nextId("imp");
      nodes.push({
        id,
        label: `import { ${specs} } from '${from}'`,
        kind: "import",
        scope: "__module__",
      });
      edges.push({ from: moduleId, to: id, label: "uses", style: "dotted" });
    },
    ExportNamedDeclaration(p) {
      const decl = p.node.declaration;
      const name =
        decl?.id?.name ??
        p.node.specifiers?.[0]?.exported?.name ??
        "export";
      const id = nextId("exp");
      nodes.push({ id, label: `export ${name}`, kind: "export", scope: "__module__" });
      edges.push({ from: moduleId, to: id, label: "exports" });
    },
    FunctionDeclaration(p) {
      const name = p.node.id?.name ?? "anonymous";
      traceCallable(p, name, "function", nodes, edges, nextId, moduleId);
    },
    ClassDeclaration(p) {
      const name = p.node.id?.name ?? "Anonymous";
      const defId = nextId("def");
      nodes.push({ id: defId, label: `class ${name}`, kind: "definition", scope: "__module__" });
      edges.push({ from: moduleId, to: defId, label: "defines" });
      for (const member of p.node.body.body) {
        if (member.type !== "ClassMethod" && member.type !== "ClassPrivateMethod") continue;
        const mName = member.key?.name ?? member.key?.value ?? "method";
        const methodPath = p.get("body").get(member === p.node.body.body[0] ? "body.0" : undefined);
        if (!methodPath) {
          traceMethodBody(member, name, `${name}.${mName}`, nodes, edges, nextId, defId);
          continue;
        }
        traceCallableBody(member, `${name}.${mName}`, "method", nodes, edges, nextId, defId);
      }
    },
    VariableDeclarator(p) {
      const name = p.node.id?.name;
      const init = p.node.init;
      if (!name || !init) return;
      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
        traceCallable(p.get("init"), name, "function", nodes, edges, nextId, moduleId);
      }
    },
  });

  return { nodes, edges };
}

/**
 * @param {object} path
 * @param {string} name
 * @param {string} kind
 * @param {import("./ast-trace-mermaid.js").TraceNode[]} nodes
 * @param {import("./ast-trace-mermaid.js").TraceEdge[]} edges
 * @param {Function} nextId
 * @param {string} parentId
 */
function traceCallable(path, name, kind, nodes, edges, nextId, parentId) {
  const defId = nextId("def");
  nodes.push({
    id: defId,
    label: `${kind} ${name}`,
    kind: "definition",
    scope: "__module__",
  });
  edges.push({ from: parentId, to: defId, label: "defines" });
  traceCallsInPath(path, name, nodes, edges, nextId, defId);
}

/**
 * @param {object} member
 * @param {string} className
 * @param {string} scopeName
 */
function traceMethodBody(member, className, scopeName, nodes, edges, nextId, parentId) {
  const defId = nextId("def");
  nodes.push({ id: defId, label: `method ${scopeName}`, kind: "definition", scope: className });
  edges.push({ from: parentId, to: defId, label: "member" });
  let calls = 0;
  walkSimpleCalls(member.body, (label) => {
    if (calls >= MAX_CALLS_PER_SCOPE) return;
    const cid = nextId("call");
    nodes.push({ id: cid, label: label, kind: "call", scope: scopeName });
    edges.push({ from: defId, to: cid, label: "calls", style: "dotted" });
    calls += 1;
  });
}

/**
 * @param {object} member
 * @param {string} scopeName
 * @param {string} kind
 */
function traceCallableBody(member, scopeName, kind, nodes, edges, nextId, parentId) {
  const defId = nextId("def");
  nodes.push({ id: defId, label: `${kind} ${scopeName}`, kind: "definition", scope: "__module__" });
  edges.push({ from: parentId, to: defId, label: "member" });
  walkSimpleCalls(member.body, (label) => {
    const cid = nextId("call");
    nodes.push({ id: cid, label, kind: "call", scope: scopeName });
    edges.push({ from: defId, to: cid, label: "calls", style: "dotted" });
  });
}

/**
 * @param {object} fnPath
 * @param {string} scopeName
 */
function traceCallsInPath(fnPath, scopeName, nodes, edges, nextId, defId) {
  let calls = 0;
  fnPath.traverse({
    CallExpression(p) {
      if (calls >= MAX_CALLS_PER_SCOPE) {
        p.stop();
        return;
      }
      const label = callLabel(p.node);
      if (!label) return;
      const cid = nextId("call");
      nodes.push({ id: cid, label, kind: "call", scope: scopeName });
      edges.push({ from: defId, to: cid, label: "calls", style: "dotted" });
      calls += 1;
    },
    NewExpression(p) {
      if (calls >= MAX_CALLS_PER_SCOPE) return;
      const label = `new ${calleeName(p.node.callee)}`;
      const cid = nextId("call");
      nodes.push({ id: cid, label, kind: "call", scope: scopeName });
      edges.push({ from: defId, to: cid, label: "instantiates", style: "dotted" });
      calls += 1;
    },
  });
}

/**
 * @param {object} body
 * @param {(label: string) => void} onCall
 */
function walkSimpleCalls(body, onCall) {
  if (!body) return;
  const stack = [body];
  let n = 0;
  while (stack.length && n < MAX_CALLS_PER_SCOPE) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (cur.type === "CallExpression") {
      const label = callLabel(cur);
      if (label) {
        onCall(label);
        n += 1;
      }
    }
    if (cur.type === "NewExpression") {
      onCall(`new ${calleeName(cur.callee)}`);
      n += 1;
    }
    for (const v of Object.values(cur)) {
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
}

/**
 * @param {object} node
 */
function callLabel(node) {
  const base = calleeName(node.callee);
  const arg0 = node.arguments?.[0];
  let hint = "";
  if (arg0?.type === "StringLiteral") hint = ` '${arg0.value}'`;
  else if (arg0?.type === "TemplateLiteral" && arg0.quasis?.[0]) hint = ` \`${arg0.quasis[0].value.raw}\``;
  return `${base}(${node.arguments?.length ?? 0} args)${hint}`.slice(0, 72);
}

/**
 * @param {object} callee
 */
function calleeName(callee) {
  if (!callee) return "call";
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") {
    const obj = calleeName(callee.object) || "obj";
    const prop =
      callee.property?.name ??
      callee.property?.value ??
      (callee.computed ? "[expr]" : "prop");
    return `${obj}.${prop}`;
  }
  return "call";
}

/**
 * @param {string} text
 */
function lineFallbackTrace(text) {
  /** @type {import("./ast-trace-mermaid.js").TraceNode[]} */
  const nodes = [];
  /** @type {import("./ast-trace-mermaid.js").TraceEdge[]} */
  const edges = [];
  let uid = 0;
  const mod = `mod_${uid++}`;
  nodes.push({ id: mod, label: "Module", kind: "definition", scope: "__module__" });
  let lastDef = mod;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^import\s/.test(t)) {
      const id = `imp_${uid++}`;
      nodes.push({ id, label: t.slice(0, 72), kind: "import", scope: "__module__" });
      edges.push({ from: mod, to: id, label: "import", style: "dotted" });
    } else if (/^(export\s+)?(async\s+)?function\s+(\w+)/.test(t)) {
      const name = t.match(/function\s+(\w+)/)?.[1] ?? "fn";
      const id = `def_${uid++}`;
      nodes.push({ id, label: `function ${name}`, kind: "definition", scope: "__module__" });
      edges.push({ from: lastDef, to: id, label: "defines" });
      lastDef = id;
    } else if (/(\w+(?:\.\w+)+)\s*\(/.test(t)) {
      const id = `call_${uid++}`;
      nodes.push({ id, label: t.match(/(\w+(?:\.\w+)*)\s*\(/)?.[1] + "()", kind: "call", scope: "__module__" });
      edges.push({ from: lastDef, to: id, label: "calls", style: "dotted" });
    }
  }
  return { nodes, edges };
}

function shortName(path) {
  const p = path.split("/");
  return p.length > 2 ? `…/${p.slice(-2).join("/")}` : path;
}