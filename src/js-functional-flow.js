import { parse } from "@babel/parser";
import { collectReadablePatchText, fileFlowKind } from "./file-flow-semantic.js";
import { capFunctionalSteps, outcomeFromSteps, renderFunctionalWorkflowMermaid } from "./functional-flow-render.js";

/**
 * @param {string} path
 * @param {string} patch
 * @returns {import("./functional-flow-render.js").FunctionalStep[]}
 */
export function collectJsFunctionalSteps(path, patch) {
  const meta = collectReadablePatchText(patch);
  if (!meta.text.trim()) return [];
  const micro = extractJsMicroSteps(meta.text, path);
  const steps = micro.map((m) => ({
    phase: m.phase,
    headline: m.headline,
    functional: m.functional || guessFromHeadline(m),
  }));
  return capFunctionalSteps(steps.length ? steps : fallbackPatchSteps(meta));
}

export function buildJsFunctionalWorkflowMermaid(path, patch) {
  const kind = fileFlowKind(path);
  const meta = collectReadablePatchText(patch);
  const role =
    kind === "component"
      ? "UI module workflow"
      : /\.tsx?$/.test(path)
        ? "TypeScript workflow"
        : "JavaScript workflow";

  if (!meta.text.trim()) {
    return renderFunctionalWorkflowMermaid({
      title: role,
      header: "No source in diff",
      steps: [],
      outcome: "No readable source in patch",
    });
  }

  const micro = extractJsMicroSteps(meta.text, path);
  const steps = micro.map((m) => ({
    phase: m.phase,
    headline: m.headline,
    functional: m.functional || guessFromHeadline(m),
  }));
  const header = [
    `${steps.length} workflow steps`,
    meta.added ? `+${meta.added} lines` : null,
    meta.lineCount ? `${meta.lineCount} in diff` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return renderFunctionalWorkflowMermaid({
    title: shortName(path),
    header,
    steps: steps.length ? steps : fallbackPatchSteps(meta),
    outcome: outcomeFromSteps(steps) || "Adjusts runtime behavior in this module",
  });
}

/**
 * @param {string} text
 * @param {string} path
 */
function extractJsMicroSteps(text, path) {
  /** @type {object[]} */
  const micro = [];
  const plugins = ["jsx"];
  if (/\.tsx?$/i.test(path)) plugins.push("typescript");

  try {
    const ast = parse(text, {
      sourceType: "module",
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins,
    });
    for (const node of ast.program.body) {
      const step = describeJsNode(node);
      if (!step) continue;
      if (Array.isArray(step)) micro.push(...step);
      else micro.push(step);
    }
    return micro;
  } catch {
    return lineScanJs(text);
  }
}

/**
 * @param {import("@babel/parser").ParseResult<import("@babel/types").File>["program"]["body"][number]} node
 */
function describeJsNode(node) {
  switch (node.type) {
    case "ImportDeclaration":
      return {
        phase: "dependencies",
        headline: `Import from ${node.source.value}`,
        functional: "Bring external modules into scope for this file",
        specifiers: node.specifiers.map((s) => s.local?.name).filter(Boolean),
      };
    case "ExportNamedDeclaration":
    case "ExportDefaultDeclaration":
      return describeExport(node);
    case "FunctionDeclaration":
      return {
        phase: "behavior",
        headline: `Function ${node.id?.name ?? "anonymous"}`,
        functional: guessFunctionPurpose(node.id?.name),
      };
    case "ClassDeclaration":
      return {
        phase: "contract",
        headline: `Class ${node.id?.name ?? "anonymous"}`,
        functional: guessClassPurpose(node.id?.name),
      };
    case "VariableDeclaration":
      return describeVarDecl(node);
    case "ExpressionStatement":
      return describeExprStmt(node);
    default:
      return null;
  }
}

/**
 * @param {object} node
 */
function describeExport(node) {
  const decl = node.declaration;
  if (decl?.type === "FunctionDeclaration") {
    return {
      phase: "api",
      headline: `Export ${decl.id?.name ?? "function"}`,
      functional: "Expose callable API to other modules",
    };
  }
  if (decl?.type === "ClassDeclaration") {
    return {
      phase: "api",
      headline: `Export class ${decl.id?.name ?? ""}`.trim(),
      functional: "Expose type implementation to consumers",
    };
  }
  return { phase: "api", headline: "Export binding", functional: "Publish module surface area" };
}

/**
 * @param {object} node
 */
function describeVarDecl(node) {
  const specs = [];
  for (const d of node.declarations ?? []) {
    const name = d.id?.name ?? d.id?.type;
    if (!name) continue;
    if (d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression") {
      specs.push({
        phase: "behavior",
        headline: `Handler ${name}`,
        functional: guessFunctionPurpose(name),
      });
    } else if (d.init?.type === "CallExpression") {
      const callee = calleeName(d.init.callee);
      specs.push({
        phase: "integration",
        headline: `Call ${callee}`,
        functional: guessCallPurpose(callee),
      });
    } else {
      specs.push({
        phase: "behavior",
        headline: `Define ${name}`,
        functional: "Hold configuration or state used downstream",
      });
    }
  }
  return specs.length ? specs : null;
}

/**
 * @param {object} node
 */
function describeExprStmt(node) {
  const e = node.expression;
  if (e?.type !== "CallExpression") return null;
  const callee = calleeName(e.callee);
  const route = extractRouteFromArgs(e.arguments);
  if (route) {
    return {
      phase: "api",
      headline: `${callee} ${route.method} ${route.path}`,
      functional: "Register HTTP route handled in this file",
    };
  }
  return {
    phase: "integration",
    headline: `Invoke ${callee}`,
    functional: guessCallPurpose(callee),
  };
}

/**
 * @param {object} m
 */
function guessFromHeadline(m) {
  if (m.phase === "dependencies") return "Resolve dependency required by code below";
  if (m.phase === "api") return "Expose callable surface to other modules or HTTP clients";
  if (m.phase === "contract") return "Define structure used across this feature";
  return "Execute behavior when this module is loaded or called";
}

/**
 * @param {string} text
 */
function lineScanJs(text) {
  /** @type {object[]} */
  const micro = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^import\s/.test(t)) {
      micro.push({
        phase: "dependencies",
        headline: t.slice(0, 72),
        functional: "Import module used by this file",
      });
    } else if (/^export\s+(async\s+)?function\s+(\w+)/.test(t)) {
      const name = t.match(/function\s+(\w+)/)?.[1];
      micro.push({ phase: "api", headline: `Export ${name}`, functional: guessFunctionPurpose(name) });
    } else if (/\.(get|post|put|patch|delete)\s*\(/.test(t)) {
      micro.push({ phase: "api", headline: t.slice(0, 56), functional: "Register HTTP route" });
    }
  }
  return micro;
}

/**
 * @param {ReturnType<typeof collectReadablePatchText>} meta
 */
function fallbackPatchSteps(meta) {
  return [
    {
      phase: "behavior",
      headline: `${meta.added} lines added, ${meta.removed} removed`,
      functional: "Edit source without parseable structure in diff",
    },
  ];
}

function calleeName(callee) {
  if (callee?.type === "MemberExpression") {
    const prop = callee.property?.name ?? "method";
    const obj = callee.object?.name ?? "";
    return obj ? `${obj}.${prop}` : prop;
  }
  return callee?.name ?? "call";
}

function extractRouteFromArgs(args) {
  const methodMatch = (s) => s.match(/\.(get|post|put|patch|delete)/i);
  const first = args?.[0];
  if (first?.type === "StringLiteral") {
    return { path: first.value, method: "ROUTE" };
  }
  return null;
}

function guessFunctionPurpose(name) {
  const n = String(name ?? "").toLowerCase();
  if (/^(get|fetch|load|find)/.test(n)) return "Read data for callers";
  if (/^(create|insert|add|save)/.test(n)) return "Create or persist new entities";
  if (/^(update|patch|set)/.test(n)) return "Modify existing state";
  if (/^(delete|remove)/.test(n)) return "Remove entities or revoke access";
  if (/^(validate|assert|check)/.test(n)) return "Guard invariants before work proceeds";
  if (/^(handle|on)/.test(n)) return "React to an event or request";
  if (/^(init|bootstrap|configure|setup)/.test(n)) return "Initialize runtime configuration";
  return "Execute business logic for this file";
}

function guessClassPurpose(name) {
  const n = String(name ?? "").toLowerCase();
  if (/controller|resource|handler/.test(n)) return "Orchestrate requests and responses";
  if (/service/.test(n)) return "Coordinate domain operations";
  if (/repository|dao|store/.test(n)) return "Access persistence layer";
  if (/component|view|page/.test(n)) return "Render UI for a user-facing flow";
  return "Encapsulate related behavior and state";
}

function guessCallPurpose(callee) {
  const c = callee.toLowerCase();
  if (c.includes("listen") || c.includes("serve")) return "Start accepting traffic";
  if (c.includes("use") && c.includes("app")) return "Attach middleware or routers";
  if (c.includes("register") || c.includes("mount")) return "Connect plugin or route group";
  return "Run framework setup required for behavior below";
}

function truncateHeadlines(parts) {
  const uniq = [...new Set(parts.filter(Boolean))];
  if (uniq.length <= 2) return uniq.join(" · ");
  return `${uniq.slice(0, 2).join(" · ")} +${uniq.length - 2}`;
}

function shortName(path) {
  const p = path.split("/");
  return p.length > 2 ? `…/${p.slice(-2).join("/")}` : path;
}