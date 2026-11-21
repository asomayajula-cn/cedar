import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { collectReadablePatchText } from "./file-flow-semantic.js";
import { inferWhatItDoes, MAX_MAP_NODES } from "./code-map-render.js";

const traverse = traverseModule.default ?? traverseModule;

/** Per-function / method call nodes from AST */
const MAX_CALLS_PER_SYMBOL = 48;
/** Total call nodes across the file */
const MAX_CALLS_FILE = 220;

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildJsCodeMap(path, patch) {
  const meta = collectReadablePatchText(patch);
  /** @type {import("./code-map-render.js").MapNode[]} */
  const nodes = [];
  /** @type {import("./code-map-render.js").MapEdge[]} */
  const edges = [];
  let uid = 0;
  const entryId = `entry_${uid++}`;
  const fileLeaf = (path.split("/").pop() ?? path).replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "") || "module";
  nodes.push({ id: entryId, label: fileLeaf, kind: "entry" });
  let usedAst = false;
  const budget = { fileCalls: 0 };

  if (!meta.text.trim()) {
    return { header: "No source", whatItDoes: "Cannot map empty diff", nodes, edges };
  }

  const plugins = ["jsx"];
  if (/\.tsx?$/i.test(path)) plugins.push("typescript");

  try {
    const program = parse(meta.text, {
      sourceType: "module",
      allowImportOutsideModule: true,
      errorRecovery: true,
      plugins,
    });
    usedAst = true;

    traverse(program, {
      ImportDeclaration(p) {
        const id = `imp_${uid++}`;
        const names = p.node.specifiers.map((s) => s.local.name).join(", ");
        nodes.push({
          id,
          label: `${names} ← ${p.node.source.value}`,
          kind: "import",
        });
        edges.push({ from: entryId, to: id, label: "imports", style: "dotted" });
      },
      ExportNamedDeclaration(p) {
        if (p.node.declaration) {
          const id = `exp_${uid++}`;
          const decl = p.node.declaration;
          let name = "export";
          if (decl?.type === "VariableDeclaration") {
            name = decl.declarations[0]?.id?.name ?? name;
          } else if (decl?.id?.name) name = decl.id.name;
          nodes.push({ id, label: `export ${name}`, kind: "export" });
          edges.push({ from: entryId, to: id, label: "exports" });
          if (decl?.type === "FunctionDeclaration" && decl.id?.name) {
            mapCallable(
              p.get("declaration"),
              decl.id.name,
              "function",
              entryId,
              nodes,
              edges,
              () => `sym_${uid++}`,
              () => `call_${uid++}`,
              budget
            );
          }
          if (decl?.type === "ClassDeclaration" && decl.id?.name) {
            mapClass(p.get("declaration"), decl.id.name, entryId, nodes, edges, () => uid++, budget);
          }
          return;
        }
        if (p.node.source) {
          const id = `exp_${uid++}`;
          const names =
            p.node.specifiers?.map((s) => (s.exported.type === "Identifier" ? s.exported.name : "…")).join(", ") ||
            "*";
          nodes.push({ id, label: `export { ${names} } from ${p.node.source.value}`, kind: "export" });
          edges.push({ from: entryId, to: id, label: "re-export", style: "dotted" });
          return;
        }
        const id = `exp_${uid++}`;
        const names = p.node.specifiers?.map((s) => s.local?.name ?? "…").join(", ") ?? "export";
        nodes.push({ id, label: `export ${names}`, kind: "export" });
        edges.push({ from: entryId, to: id, label: "exports" });
      },
      ExportDefaultDeclaration(p) {
        const id = `exp_${uid++}`;
        nodes.push({ id, label: "export default", kind: "export" });
        edges.push({ from: entryId, to: id, label: "exports" });
        const d = p.node.declaration;
        if (d?.type === "FunctionDeclaration" && d.id?.name) {
          mapCallable(
            p.get("declaration"),
            d.id.name,
            "function",
            entryId,
            nodes,
            edges,
            () => `sym_${uid++}`,
            () => `call_${uid++}`,
            budget
          );
        } else if (d?.type === "ClassDeclaration" && d.id?.name) {
          mapClass(p.get("declaration"), d.id.name, entryId, nodes, edges, () => uid++, budget);
        }
      },
      ExportAllDeclaration(p) {
        const id = `exp_${uid++}`;
        nodes.push({ id, label: `export * from ${p.node.source.value}`, kind: "export" });
        edges.push({ from: entryId, to: id, label: "re-export", style: "dotted" });
      },
      FunctionDeclaration(p) {
        const parent = p.parentPath?.node?.type;
        if (parent === "ExportNamedDeclaration" || parent === "ExportDefaultDeclaration") return;
        mapCallable(p, p.node.id?.name ?? "fn", "function", entryId, nodes, edges, () => `sym_${uid++}`, () => `call_${uid++}`, budget);
      },
      ClassDeclaration(p) {
        const parent = p.parentPath?.node?.type;
        if (parent === "ExportNamedDeclaration" || parent === "ExportDefaultDeclaration") return;
        mapClass(p, p.node.id?.name ?? "Class", entryId, nodes, edges, () => uid++, budget);
      },
      TSInterfaceDeclaration(p) {
        const iname = p.node.id.name;
        const id = `def_${uid++}`;
        nodes.push({ id, label: `interface ${iname}`, kind: "definition" });
        edges.push({ from: entryId, to: id, label: "defines" });
      },
      TSTypeAliasDeclaration(p) {
        const id = `def_${uid++}`;
        nodes.push({ id, label: `type ${p.node.id.name}`, kind: "definition" });
        edges.push({ from: entryId, to: id, label: "defines" });
      },
      TSEnumDeclaration(p) {
        const id = `def_${uid++}`;
        const members = p.node.members?.map((m) => m.id?.name).filter(Boolean) ?? [];
        const detail = members.length ? ` { ${members.slice(0, 8).join(", ")}${members.length > 8 ? ", …" : ""} }` : "";
        nodes.push({ id, label: `enum ${p.node.id.name}${detail}`, kind: "definition" });
        edges.push({ from: entryId, to: id, label: "defines" });
      },
      TSModuleDeclaration(p) {
        const id = `def_${uid++}`;
        const name = p.node.id?.name ?? "namespace";
        nodes.push({ id, label: `namespace ${name}`, kind: "definition" });
        edges.push({ from: entryId, to: id, label: "defines" });
      },
      VariableDeclarator(p) {
        const name = p.node.id?.type === "Identifier" ? p.node.id.name : null;
        const init = p.node.init;
        if (!name || !init) return;
        if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
          mapCallable(p.get("init"), name, "const fn", entryId, nodes, edges, () => `sym_${uid++}`, () => `call_${uid++}`, budget);
        } else if (init.type === "ClassExpression" && init.id?.name) {
          mapClass(p.get("init"), init.id.name, entryId, nodes, edges, () => uid++, budget);
        }
      },
      ObjectProperty(p) {
        if (!p.parentPath.isObjectExpression?.()) return;
        const key = p.node.key?.name ?? p.node.key?.value;
        const val = p.node.value;
        if (!key || !val) return;
        if (val.type === "ArrowFunctionExpression" || val.type === "FunctionExpression") {
          mapCallable(p.get("value"), key, "method", entryId, nodes, edges, () => `sym_${uid++}`, () => `call_${uid++}`, budget);
        }
      },
    });
  } catch {
    lineScanMap(meta.text, entryId, nodes, edges, () => uid++);
  }

  if (nodes.length <= 1 && meta.text.trim()) {
    const id = `sym_${uid++}`;
    nodes.push({
      id,
      label: meta.added ? `+${meta.added} lines in diff` : "source in diff",
      kind: "symbol",
    });
    edges.push({ from: entryId, to: id, label: "patch" });
  }

  const parts = [
    usedAst ? "AST" : "heuristic",
    `${nodes.length} nodes`,
    meta.added ? `+${meta.added} lines` : null,
  ].filter(Boolean);
  const header = parts.join(" · ");
  return {
    header,
    whatItDoes: inferWhatItDoes(nodes, edges, "js"),
    nodes: nodes.slice(0, MAX_MAP_NODES),
    edges: filterEdgesForNodes(edges, nodes.slice(0, MAX_MAP_NODES)),
  };
}

/**
 * @param {import("@babel/traverse").NodePath} p
 * @param {string} cname
 * @param {string} parentId
 * @param {import("./code-map-render.js").MapNode[]} nodes
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {() => number} uid
 * @param {{ fileCalls: number }} budget
 */
function mapClass(p, cname, parentId, nodes, edges, uid, budget) {
  const classId = `sym_${uid()}`;
  nodes.push({ id: classId, label: `class ${cname}`, kind: "symbol" });
  edges.push({ from: parentId, to: classId, label: "defines" });

  p.get("body.body").forEach((memberPath) => {
    const member = memberPath.node;
    if (
      memberPath.isClassMethod() ||
      memberPath.isClassPrivateMethod?.() ||
      member.type === "ClassMethod" ||
      member.type === "ClassPrivateMethod"
    ) {
      const mName = member.key?.name ?? member.key?.value ?? "method";
      const mid = `sym_${uid()}`;
      const prefix = member.static ? "static " : member.kind && member.kind !== "method" ? `${member.kind} ` : "";
      nodes.push({ id: mid, label: `${cname}.${prefix}${mName}`, kind: "symbol", scope: cname });
      edges.push({ from: classId, to: mid, label: "member" });
      traceCalls(memberPath, mName, mid, nodes, edges, () => `call_${uid()}`, budget);
    }
    if (member.type === "ClassProperty" || member.type === "PropertyDefinition") {
      const prop = member.key?.name ?? member.key?.value;
      if (!prop) return;
      const pid = `sym_${uid()}`;
      nodes.push({ id: pid, label: `${cname}.${prop}`, kind: "symbol", scope: cname });
      edges.push({ from: classId, to: pid, label: "field" });
      const init = memberPath.get("value");
      if (init.node && (init.isArrowFunctionExpression() || init.isFunctionExpression())) {
        traceCalls(init, prop, pid, nodes, edges, () => `call_${uid()}`, budget);
      }
    }
    if (member.type === "TSParameterProperty" && member.parameter?.name) {
      const pid = `sym_${uid()}`;
      nodes.push({ id: pid, label: `${cname}.ctor(${member.parameter.name})`, kind: "symbol", scope: cname });
      edges.push({ from: classId, to: pid, label: "ctor" });
    }
  });
}

/**
 * @param {import("@babel/traverse").NodePath} path
 * @param {string} name
 * @param {string} kind
 * @param {string} parentId
 * @param {import("./code-map-render.js").MapNode[]} nodes
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {() => string} nextSym
 * @param {() => string} nextCall
 * @param {{ fileCalls: number }} budget
 */
function mapCallable(path, name, kind, parentId, nodes, edges, nextSym, nextCall, budget) {
  const symId = nextSym();
  nodes.push({ id: symId, label: `${kind} ${name}`, kind: "symbol" });
  edges.push({ from: parentId, to: symId, label: "defines" });
  traceCalls(path, name, symId, nodes, edges, nextCall, budget);
}

/**
 * @param {import("@babel/traverse").NodePath} fnPath
 * @param {string} scopeLabel
 * @param {string} symId
 * @param {import("./code-map-render.js").MapNode[]} nodes
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {() => string} nextCall
 * @param {{ fileCalls: number }} budget
 */
function traceCalls(fnPath, scopeLabel, symId, nodes, edges, nextCall, budget) {
  const body =
    fnPath.isFunction?.() || fnPath.isArrowFunctionExpression?.() || fnPath.isClassMethod?.()
      ? fnPath.get("body")
      : fnPath.get?.("body") ?? fnPath;
  if (!body?.node) return;

  let perScope = 0;
  body.traverse({
    CallExpression(p) {
      if (budget.fileCalls >= MAX_CALLS_FILE || perScope >= MAX_CALLS_PER_SYMBOL) {
        p.stop();
        return;
      }
      const id = nextCall();
      nodes.push({ id, label: formatCall(p.node), kind: "call", scope: scopeLabel });
      edges.push({ from: symId, to: id, label: "calls", style: "dotted" });
      budget.fileCalls += 1;
      perScope += 1;
    },
    OptionalCallExpression(p) {
      if (budget.fileCalls >= MAX_CALLS_FILE || perScope >= MAX_CALLS_PER_SYMBOL) {
        p.stop();
        return;
      }
      const id = nextCall();
      nodes.push({ id, label: formatCall(p.node), kind: "call", scope: scopeLabel });
      edges.push({ from: symId, to: id, label: "calls", style: "dotted" });
      budget.fileCalls += 1;
      perScope += 1;
    },
    NewExpression(p) {
      if (budget.fileCalls >= MAX_CALLS_FILE || perScope >= MAX_CALLS_PER_SYMBOL) {
        p.stop();
        return;
      }
      const id = nextCall();
      nodes.push({ id, label: `new ${calleeName(p.node.callee)}()`, kind: "call", scope: scopeLabel });
      edges.push({ from: symId, to: id, label: "creates", style: "dotted" });
      budget.fileCalls += 1;
      perScope += 1;
    },
    TaggedTemplateExpression(p) {
      if (budget.fileCalls >= MAX_CALLS_FILE || perScope >= MAX_CALLS_PER_SYMBOL) return;
      const id = nextCall();
      nodes.push({ id, label: `${calleeName(p.node.tag)} \`\` `, kind: "call", scope: scopeLabel });
      edges.push({ from: symId, to: id, label: "calls", style: "dotted" });
      budget.fileCalls += 1;
      perScope += 1;
    },
  });
}

function formatCall(node) {
  const base = calleeName(node.callee);
  const a0 = node.arguments?.[0];
  let hint = "";
  if (a0?.type === "StringLiteral") hint = ` '${a0.value}'`;
  else if (a0?.type === "TemplateLiteral" && a0.quasis[0]?.value?.raw) {
    hint = ` \`${String(a0.quasis[0].value.raw).slice(0, 24)}\``;
  }
  return `${base}()${hint}`.slice(0, 96);
}

function calleeName(callee) {
  if (!callee) return "fn";
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") {
    return `${calleeName(callee.object)}.${callee.property?.name ?? "…"}`;
  }
  return "fn";
}

/**
 * @param {import("./code-map-render.js").MapEdge[]} edges
 * @param {import("./code-map-render.js").MapNode[]} nodes
 */
function filterEdgesForNodes(edges, nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => ids.has(e.from) && ids.has(e.to));
}

function lineScanMap(text, entryId, nodes, edges, uid) {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^import\s/.test(t)) {
      const id = `imp_${uid()}`;
      nodes.push({ id, label: t.slice(0, 96), kind: "import" });
      edges.push({ from: entryId, to: id, style: "dotted" });
    } else if (/function\s+(\w+)/.test(t)) {
      const name = t.match(/function\s+(\w+)/)?.[1];
      const id = `sym_${uid()}`;
      nodes.push({ id, label: `function ${name}`, kind: "symbol" });
      edges.push({ from: entryId, to: id });
    } else if (/^(export\s+)?(interface|type|enum)\s+(\w+)/.test(t)) {
      const id = `def_${uid()}`;
      nodes.push({ id, label: t.replace(/^export\s+/, "").slice(0, 96), kind: "definition" });
      edges.push({ from: entryId, to: id });
    } else if (/(\w+)\.(\w+)\s*\(|new\s+(\w+)\s*\(/.test(t)) {
      const id = `call_${uid()}`;
      nodes.push({ id, label: t.match(/(\w+\([^)]*\)|new\s+\w+)/)?.[0]?.slice(0, 72) ?? t.slice(0, 72), kind: "call" });
      edges.push({ from: entryId, to: id, style: "dotted" });
    }
  }
}