import { mermaidSafeText } from "./mermaid-sanitize.js";
import { walkPatchLines } from "./patch-review.js";

const MAX_SUBGRAPH_NODES = 8;

/**
 * @param {string} patch
 */
export function collectReadablePatchText(patch) {
  if (!patch?.trim()) return { text: "", lineCount: 0, added: 0, removed: 0, fromDiffOnly: true };
  const chunks = [];
  let lineCount = 0;
  let added = 0;
  let removed = 0;
  let hadContext = false;
  let hadAdd = false;
  for (const row of walkPatchLines(patch)) {
    if (row.kind === "del") {
      removed += 1;
      continue;
    }
    const t = row.text;
    lineCount += 1;
    if (row.kind === "context") hadContext = true;
    if (row.kind === "add") {
      hadAdd = true;
      added += 1;
    }
    chunks.push(t);
  }
  return {
    text: chunks.join("\n"),
    lineCount,
    added,
    removed,
    fromDiffOnly: Boolean(hadAdd && hadContext),
  };
}

/**
 * @param {string} path
 */
export function fileFlowKind(path) {
  const base = (path.split("/").pop() ?? path).toLowerCase();
  if (/^dockerfile$/i.test(base) || base === "containerfile") return "container";
  if (/\.(ya?ml)$/i.test(path)) return "config";
  if (/\.(json|json5|jsonc|toml|ini|properties|env|cfg|conf)$/i.test(path)) return "config";
  if (/\.(tf|hcl)$/i.test(path)) return "terraform";
  if (/\.(md|mdx)$/i.test(path)) return "markdown";
  if (/\.(css|scss|sass|less)$/i.test(path)) return "stylesheet";
  if (/\.(html|htm|xhtml)$/i.test(path)) return "markup";
  if (/\.(vue|svelte|astro)$/i.test(path)) return "component";
  if (/\.(sh|bash|zsh|fish|ps1)$/i.test(path)) return "shell";
  if (/\.(tsx?|jsx?|mjs|cjs)$/i.test(path)) return "javascript";
  if (/\.(py|pyw|pyi)$/i.test(path)) return "python";
  if (/\.go$/i.test(path)) return "go";
  if (/\.(java|kt|kts|scala|groovy)$/i.test(path)) return "jvm";
  if (/\.(rs)$/i.test(path)) return "rust";
  if (/\.(cs|fs|vb)$/i.test(path)) return "dotnet";
  if (/\.(php|rb|swift|cpp|cc|c|h|hpp|m|mm)$/i.test(path)) return "code";
  if (/\.(graphql|gql)$/i.test(path)) return "graphql";
  if (/\.(proto)$/i.test(path)) return "proto";
  return "generic";
}

/**
 * @param {string} role
 * @param {string} path
 * @param {{ lineCount: number, added: number, removed: number, fromDiffOnly: boolean }} meta
 * @param {Record<string, string[]>} buckets
 * @param {string} intent
 */
export function buildPhasedOverviewMermaid(role, path, meta, buckets, intent) {
  const lines = ["flowchart TB"];
  lines.push(`  root(["${mermaidSafeText(role)}"])`);
  lines.push(`  file["${mermaidSafeText(shortName(path))}"]`);
  lines.push("  root --> file");

  const stats = [
    meta.lineCount ? `~${meta.lineCount} diff lines` : null,
    meta.added ? `+${meta.added} added` : null,
    meta.removed ? `−${meta.removed} removed` : null,
    meta.fromDiffOnly ? "hunk context included" : "new file hunks",
  ]
    .filter(Boolean)
    .join(" · ");

  lines.push(`  summary["${mermaidSafeText(stats)}"]`);
  lines.push("  file --> summary");

  let hub = "summary";
  const order = Object.keys(buckets);
  for (const key of order) {
    const items = buckets[key];
    if (!items?.length) continue;
    const sgId = `sg_${sanitizeId(key)}`;
    lines.push(`  subgraph ${sgId} ["${mermaidSafeText(key)}"]`);
    lines.push("    direction TB");
    const counts = countLabels(items);
    let shown = 0;
    for (const [label, n] of counts) {
      if (shown >= MAX_SUBGRAPH_NODES) break;
      const id = `n_${sanitizeId(key)}_${shown}`;
      const text = n > 1 ? `${label} ×${n}` : label;
      lines.push(`    ${id}["${mermaidSafeText(text)}"]`);
      shown += 1;
    }
    if (counts.length > shown) {
      lines.push(`    more_${sanitizeId(key)}["+${counts.length - shown} more…"]`);
    }
    lines.push("  end");
    lines.push(`  ${hub} --> ${sgId}`);
    hub = sgId;
  }

  lines.push(`  intent(["What this file does"])`);
  lines.push(`  purpose["${mermaidSafeText(intent)}"]`);
  lines.push(`  ${hub} --> intent`);
  lines.push("  intent --> purpose");
  return lines.join("\n");
}

/**
 * @param {string[]} items
 */
function countLabels(items) {
  const map = new Map();
  for (const raw of items) {
    const label = String(raw).slice(0, 72).trim();
    if (!label) continue;
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * @param {string} s
 */
function sanitizeId(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24) || "x";
}

/**
 * @param {string} path
 */
function shortName(path) {
  const p = path.split("/");
  return p.length > 2 ? `…/${p.slice(-2).join("/")}` : path;
}

/**
 * @param {string} text
 * @param {Array<{ re: RegExp, bucket: string, label: (m: RegExpExecArray, line: string) => string }>} rules
 */
export function scanLinesIntoBuckets(text, rules) {
  /** @type {Record<string, string[]>} */
  const buckets = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.length < 2) continue;
    if (/^\s*(\/\/|#|\/\*|\*|--)/.test(t)) continue;
    for (const rule of rules) {
      const m = rule.re.exec(t);
      if (!m) continue;
      const label = rule.label(m, t);
      if (!label) continue;
      buckets[rule.bucket] ??= [];
      buckets[rule.bucket].push(label);
      break;
    }
  }
  return buckets;
}

/** @type {Array<{ re: RegExp, bucket: string, label: (m: RegExpExecArray) => string }>} */
export const JS_RULES = [
  {
    re: /^import\s+.+from\s+['"][^'"]+['"]/,
    bucket: "Imports",
    label: (m) => m[0].replace(/\s+/g, " ").slice(0, 56),
  },
  {
    re: /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
    bucket: "Exports",
    label: (m) => `export function ${m[1]}`,
  },
  {
    re: /^export\s+(?:default\s+)?class\s+(\w+)/,
    bucket: "Exports",
    label: (m) => `export class ${m[1]}`,
  },
  {
    re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    bucket: "Functions",
    label: (m) => `function ${m[1]}`,
  },
  {
    re: /^(?:export\s+)?class\s+(\w+)/,
    bucket: "Types & classes",
    label: (m) => `class ${m[1]}`,
  },
  {
    re: /^(?:export\s+)?(?:type|interface)\s+(\w+)/,
    bucket: "Types & classes",
    label: (m, t) => t.split("{")[0].trim().slice(0, 56),
  },
  {
    re: /\.(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)/,
    bucket: "HTTP / routes",
    label: (m, t) => t.trim().slice(0, 56),
  },
  {
    re: /^\s*(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)/,
    bucket: "Tests",
    label: (m) => m[0].trim().slice(0, 56),
  },
];

export const PY_RULES = [
  { re: /^(?:from\s+\S+\s+)?import\s+.+/, bucket: "Imports", label: (m) => m[0].slice(0, 56) },
  { re: /^(?:async\s+)?def\s+(\w+)/, bucket: "Functions", label: (m) => `def ${m[1]}` },
  { re: /^class\s+(\w+)/, bucket: "Types & classes", label: (m) => `class ${m[1]}` },
  { re: /^@\w+/, bucket: "Decorators", label: (m, t) => t.slice(0, 48) },
  { re: /^\s*def\s+test_/, bucket: "Tests", label: (m, t) => t.slice(0, 56) },
];

export const GO_RULES = [
  { re: /^func\s+(?:\([^)]*\)\s*)?(\w+)/, bucket: "Functions", label: (m) => `func ${m[1]}` },
  { re: /^type\s+(\w+)/, bucket: "Types & classes", label: (m, t) => t.slice(0, 56) },
  { re: /^import\s+/, bucket: "Imports", label: (m, t) => t.slice(0, 56) },
];

export const JVM_RULES = [
  { re: /^(?:public|private|protected).*\bclass\s+(\w+)/, bucket: "Types & classes", label: (m, t) => t.slice(0, 56) },
  { re: /^\s*@\w+/, bucket: "Annotations", label: (m, t) => t.slice(0, 48) },
  { re: /^(?:public|private|protected).*\b(\w+)\s*\([^;]*\)\s*\{?$/, bucket: "Methods", label: (m, t) => t.slice(0, 56) },
];

export const CONFIG_RULES = [
  { re: /^[\w.-]+\s*[:=]/, bucket: "Keys & values", label: (m, t) => t.split(/[:=]/)[0]?.trim().slice(0, 40) || t.slice(0, 40) },
  { re: /^\s*-\s+[\w.-]+\s*:/, bucket: "Keys & values", label: (m, t) => t.trim().slice(0, 48) },
];

export const DOCKER_RULES = [
  { re: /^FROM\s+/i, bucket: "Image", label: (m, t) => t.slice(0, 56) },
  { re: /^RUN\s+/i, bucket: "Build steps", label: (m, t) => t.slice(0, 56) },
  { re: /^(COPY|ADD)\s+/i, bucket: "Artifacts", label: (m, t) => t.slice(0, 56) },
  { re: /^(ENV|ARG)\s+/i, bucket: "Configuration", label: (m, t) => t.slice(0, 56) },
  { re: /^(EXPOSE|CMD|ENTRYPOINT)\s+/i, bucket: "Runtime", label: (m, t) => t.slice(0, 56) },
];

export const TF_RULES = [
  { re: /^resource\s+"([^"]+)"\s+"([^"]+)"/, bucket: "Resources", label: (m) => `${m[1]} ${m[2]}` },
  { re: /^module\s+"([^"]+)"/, bucket: "Modules", label: (m) => `module ${m[1]}` },
  { re: /^data\s+"([^"]+)"\s+"([^"]+)"/, bucket: "Data sources", label: (m) => `data ${m[1]}` },
];

export const MARKUP_RULES = [
  { re: /^<\/?([a-z][\w-]*)/i, bucket: "Tags", label: (m) => `<${m[1]}>` },
  { re: /^#+\s+.+/, bucket: "Structure", label: (m, t) => t.slice(0, 56) },
];

export const STYLE_RULES = [
  { re: /^@[\w-]+/, bucket: "At-rules", label: (m, t) => t.split("{")[0].trim().slice(0, 48) },
  { re: /^--[\w-]+\s*:/, bucket: "Variables", label: (m, t) => t.split(":")[0].trim() },
  { re: /^[.#][\w-]+/, bucket: "Selectors", label: (m, t) => t.split("{")[0].trim().slice(0, 48) },
];

export const SHELL_RULES = [
  { re: /^(?:export\s+)?[\w_]+=/, bucket: "Variables", label: (m, t) => t.slice(0, 48) },
  { re: /^(?:if|elif|for|while|case)\b/, bucket: "Control flow", label: (m, t) => t.slice(0, 48) },
  { re: /^[\w./-]+\s+/, bucket: "Commands", label: (m, t) => t.slice(0, 56) },
];

export const GENERIC_RULES = [
  { re: /^(?:function|func|fn|def|class|struct|enum|interface|type)\s+(\w+)/i, bucket: "Definitions", label: (m, t) => t.slice(0, 56) },
  { re: /^(?:import|require|use|include)\b/i, bucket: "Imports", label: (m, t) => t.slice(0, 56) },
  { re: /^\s*[\w$.]+\s*\([^)]*\)\s*\{?$/, bucket: "Calls", label: (m, t) => t.slice(0, 48) },
];

export const RUST_RULES = [
  { re: /^use\s+/, bucket: "Imports", label: (m, t) => t.slice(0, 56) },
  { re: /^pub\s+fn\s+(\w+)/, bucket: "Functions", label: (m) => `pub fn ${m[1]}` },
  { re: /^fn\s+(\w+)/, bucket: "Functions", label: (m) => `fn ${m[1]}` },
  { re: /^pub\s+struct\s+(\w+)/, bucket: "Types & classes", label: (m) => `struct ${m[1]}` },
  { re: /^struct\s+(\w+)/, bucket: "Types & classes", label: (m) => `struct ${m[1]}` },
  { re: /^impl\s+/, bucket: "Types & classes", label: (m, t) => t.slice(0, 56) },
];

export const CS_RULES = [
  { re: /^using\s+/, bucket: "Imports", label: (m, t) => t.replace(/;$/, "").slice(0, 56) },
  {
    re: /^(?:public|private|protected|internal)?.*\b(?:class|interface|record|struct)\s+(\w+)/,
    bucket: "Types & classes",
    label: (m, t) => t.slice(0, 56),
  },
  { re: /^\s*\[.*\]/, bucket: "Annotations", label: (m, t) => t.slice(0, 48) },
  {
    re: /^(?:public|private|protected|internal).*\s+(\w+)\s*\([^;]*\)\s*\{?/,
    bucket: "Methods",
    label: (m, t) => t.slice(0, 56),
  },
];

export const GRAPHQL_RULES = [
  { re: /^(type|interface|enum|union|scalar)\s+(\w+)/, bucket: "Types & classes", label: (m, t) => t.slice(0, 56) },
  { re: /^(query|mutation|subscription)\s+(\w+)?/, bucket: "Operations", label: (m, t) => t.slice(0, 56) },
  { re: /^extend\s+/, bucket: "Definitions", label: (m, t) => t.slice(0, 56) },
];

export const PROTO_RULES = [
  { re: /^import\s+/, bucket: "Imports", label: (m, t) => t.replace(/;$/, "").slice(0, 56) },
  { re: /^(message|enum|service)\s+(\w+)/, bucket: "Types & classes", label: (m, t) => t.slice(0, 56) },
  { re: /^rpc\s+(\w+)/, bucket: "Methods", label: (m) => `rpc ${m[1]}` },
];

/**
 * Line scanners for structure maps and functional flows.
 * @param {string} kind from {@link fileFlowKind}
 * @param {string} [path]
 */
export function rulesForFileFlowKind(kind, path = "") {
  const base = (path.split("/").pop() ?? path).toLowerCase();
  if (/^dockerfile$/i.test(base) || base === "containerfile") return DOCKER_RULES;
  switch (kind) {
    case "python":
      return PY_RULES;
    case "go":
      return GO_RULES;
    case "javascript":
      return JS_RULES;
    case "component":
      return JS_RULES;
    case "config":
      return CONFIG_RULES;
    case "container":
      return DOCKER_RULES;
    case "terraform":
      return TF_RULES;
    case "shell":
      return SHELL_RULES;
    case "jvm":
      return JVM_RULES;
    case "dotnet":
      return CS_RULES;
    case "markdown":
      return MARKUP_RULES;
    case "markup":
      return MARKUP_RULES;
    case "stylesheet":
      return STYLE_RULES;
    case "rust":
      return RUST_RULES;
    case "graphql":
      return GRAPHQL_RULES;
    case "proto":
      return PROTO_RULES;
    case "code":
      return GENERIC_RULES;
    default:
      return GENERIC_RULES;
  }
}

/** @param {string} kind */
export function fileFlowKindRoleLabel(kind) {
  const map = {
    python: "Python",
    go: "Go",
    javascript: "JavaScript",
    component: "UI component",
    config: "Configuration",
    container: "Container image",
    terraform: "Terraform",
    shell: "Shell",
    jvm: "JVM",
    dotnet: ".NET",
    markdown: "Markdown",
    markup: "Markup",
    stylesheet: "Stylesheet",
    rust: "Rust",
    graphql: "GraphQL",
    proto: "Protobuf",
    code: "Source",
    generic: "File",
  };
  return map[kind] ?? kind;
}

/**
 * @param {Record<string, string[]>} buckets
 */
export function intentFromBuckets(buckets, fallback) {
  const parts = [];
  if (buckets.Imports?.length) parts.push("wires dependencies");
  if (buckets.Exports?.length || buckets.Functions?.length || buckets.Methods?.length) {
    parts.push("adds or changes behavior");
  }
  if (buckets["Types & classes"]?.length) parts.push("shapes data types");
  if (buckets["HTTP / routes"]?.length) parts.push("touches HTTP surface");
  if (buckets.Tests?.length) parts.push("updates tests");
  if (buckets["Keys & values"]?.length || buckets.Configuration?.length) parts.push("changes configuration");
  if (buckets.Resources?.length) parts.push("provisions infrastructure");
  if (buckets["Build steps"]?.length) parts.push("changes build pipeline");
  if (!parts.length) return fallback;
  return parts.join("; ").replace(/; ([^;]*)$/, ". $1");
}