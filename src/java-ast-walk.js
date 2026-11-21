import { parse } from "java-parser";

/**
 * @param {string} text
 * @returns {{ ast: object, wrapped: boolean } | null}
 */
export function parseJavaForMap(text) {
  const src = String(text ?? "").trim();
  if (!src) return null;
  try {
    return { ast: parse(src), wrapped: false };
  } catch {
    try {
      return { ast: parse(`class __CedarSynthetic__ {\n${src}\n}`), wrapped: true };
    } catch {
      return null;
    }
  }
}

/**
 * @param {object | null | undefined} node
 * @param {(n: object, parent: object | null) => void} fn
 * @param {object | null} [parent]
 */
export function walkJavaAst(node, fn, parent = null) {
  if (!node || typeof node !== "object") return;
  fn(node, parent);
  const ch = node.children;
  if (!ch) return;
  for (const v of Object.values(ch)) {
    if (Array.isArray(v)) v.forEach((c) => walkJavaAst(c, fn, node));
    else walkJavaAst(v, fn, node);
  }
}

/**
 * @param {object} node
 * @returns {string[]}
 */
export function collectIdentifierImages(node) {
  /** @type {string[]} */
  const out = [];
  walkJavaAst(node, (n) => {
    if (!n.image) return;
    if (n.name === "Identifier" || n.name === "typeIdentifier") out.push(n.image);
    if (n.tokenType?.name === "Identifier") out.push(n.image);
  });
  return out;
}

/**
 * @param {object} node
 * @returns {string | null}
 */
export function typeIdentifierName(node) {
  if (!node?.children?.typeIdentifier) return null;
  const ti = node.children.typeIdentifier;
  const block = Array.isArray(ti) ? ti[0] : ti;
  const id = block?.children?.Identifier;
  const leaf = Array.isArray(id) ? id[0] : id;
  return leaf?.image ?? null;
}

/**
 * @param {object} methodDecl
 * @returns {string | null}
 */
export function methodDeclaratorName(methodDecl) {
  const md = methodDecl.children?.methodHeader?.[0]?.children?.methodDeclarator?.[0]
    ?? methodDecl.children?.methodHeader?.children?.methodDeclarator?.[0];
  if (!md) return null;
  const id = md.children?.Identifier;
  const leaf = Array.isArray(id) ? id[0] : id;
  return leaf?.image ?? null;
}

/**
 * @param {object} methodDecl
 * @returns {{ method: string, path: string } | null}
 */
export function httpMappingFromMethod(methodDecl) {
  const imgs = [];
  walkJavaAst(methodDecl, (n) => {
    if (n.image) imgs.push(n.image);
  });
  for (let i = 0; i < imgs.length; i++) {
    const t = imgs[i];
    const m = t.match(/^(Get|Post|Put|Patch|Delete)Mapping$/i);
    if (!m) continue;
    let path = "";
    for (let j = i + 1; j < imgs.length && j < i + 6; j++) {
      const lit = imgs[j].replace(/^["']|["']$/g, "");
      if (lit.startsWith("/") || /^\/|^[a-zA-Z]/.test(lit)) {
        path = lit;
        break;
      }
    }
    return { method: m[1].toUpperCase(), path };
  }
  return null;
}

/**
 * @param {boolean} restController
 */
export function controllerSurfaceLabel(restController) {
  return restController ? "REST surface" : "HTTP surface";
}

/**
 * @param {object} typeDecl
 * @returns {boolean}
 */
export function typeHasRestController(typeDecl) {
  const imgs = [];
  walkJavaAst(typeDecl, (n) => {
    if (n.image) imgs.push(n.image);
  });
  return imgs.some((t) => /^(RestController|Controller)$/.test(t));
}

/**
 * @param {string} source
 * @param {object} methodBodyNode
 * @param {number} max
 */
export function callsFromMethodBody(source, methodBodyNode, max = 48) {
  /** @type {string[]} */
  const calls = [];
  const loc = methodBodyNode?.location;
  if (!loc || typeof loc.startOffset !== "number" || typeof loc.endOffset !== "number") return calls;
  const body = source.slice(loc.startOffset, loc.endOffset + 1);
  const re = /(?:([\w$]+(?:\.[\w$]+)+)\s*\(|\bnew\s+([\w$]+)\s*\(|(?<![.\w])([\w$]+)\s*\(\s*\))/g;
  let m;
  while ((m = re.exec(body)) && calls.length < max) {
    if (m[2]) {
      calls.push(`new ${m[2]}`);
      continue;
    }
    const chain = m[1] || m[3];
    if (!chain || /^(if|for|while|switch|catch|return|throw|super|this)$/.test(chain)) continue;
    if (m[1]) calls.push(`${m[1]}()`);
    else if (m[3] && !/^[A-Z]/.test(m[3])) calls.push(`${m[3]}()`);
    else if (m[3]) calls.push(`${m[3]}()`);
  }
  return [...new Set(calls)].slice(0, max);
}

/**
 * @param {object} ast
 * @returns {object[]}
 */
export function findNodesNamed(ast, name) {
  /** @type {object[]} */
  const out = [];
  walkJavaAst(ast, (n) => {
    if (n.name === name) out.push(n);
  });
  return out;
}

/**
 * @param {string} path
 */
export function inferJavaTypeNameFromPath(path) {
  const base = String(path ?? "").split("/").pop() ?? "";
  const m = base.match(/^([\w$]+)\.java$/i);
  return m?.[1] ?? null;
}

/**
 * @param {object} fieldDecl
 * @returns {string | null}
 */
export function fieldDeclarationLabel(fieldDecl) {
  /** @type {string[]} */
  const imgs = [];
  walkJavaAst(fieldDecl, (n) => {
    if (typeof n.image === "string" && n.image.trim()) imgs.push(n.image);
  });
  const KEYWORDS = new Set([
    "private", "protected", "public", "static", "final", "volatile", "transient",
    "String", "int", "long", "boolean", "void", "byte", "short", "char", "float", "double",
  ]);
  const ann = imgs.filter((t) => /^[A-Z]\w*$/.test(t) && /Mapping|Column|Entity|Table|Id/.test(t));
  const identifiers = imgs.filter((t) => /^[a-zA-Z_][\w$]*$/.test(t) && !KEYWORDS.has(t));
  const name = identifiers[identifiers.length - 1];
  const type =
    imgs.find((t) => /^[A-Z]\w*$/.test(t) && !ann.includes(t) && t !== name) ?? "field";
  if (!name) return null;
  const prefix = ann.length ? `@${ann[0]} ` : "";
  return `${prefix}${type} ${name}`;
}