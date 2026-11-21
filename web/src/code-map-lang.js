/**
 * @param {string} [path]
 */
export function inferCodeMapLang(path) {
  const p = String(path ?? "").toLowerCase();
  const base = (p.split("/").pop() ?? p).toLowerCase();
  if (/^dockerfile$/i.test(base) || base === "containerfile") return "container";
  if (/(?:^|\/)db\/changelog\//i.test(p) || /\.(?:sql|ddl)$/i.test(p)) return "sql";
  if (/\.java$/i.test(p)) return "java";
  if (/\.(kt|kts|scala|groovy)$/i.test(p)) return "jvm";
  if (/\.ya?ml$/i.test(p)) return "yaml";
  if (/\.(json|json5|jsonc)$/i.test(p)) return "json";
  if (/\.(tsx?|jsx?|mjs|cjs)$/i.test(p)) return "js";
  if (/\.(vue|svelte|astro)$/i.test(p)) return "component";
  if (/\.(py|pyw|pyi)$/i.test(p)) return "python";
  if (/\.go$/i.test(p)) return "go";
  if (/\.rs$/i.test(p)) return "rust";
  if (/\.(cs|fs|vb)$/i.test(p)) return "dotnet";
  if (/\.(tf|hcl)$/i.test(p)) return "terraform";
  if (/\.(md|mdx)$/i.test(p)) return "markdown";
  if (/\.(css|scss|sass|less)$/i.test(p)) return "stylesheet";
  if (/\.(html|htm|xhtml)$/i.test(p)) return "markup";
  if (/\.(sh|bash|zsh|fish|ps1)$/i.test(p)) return "shell";
  if (/\.(graphql|gql)$/i.test(p)) return "graphql";
  if (/\.proto$/i.test(p)) return "proto";
  if (/\.(toml|ini|properties|env|cfg|conf)$/i.test(p)) return "config";
  if (/\.(php|rb|swift|cpp|cc|c|h|hpp|m|mm)$/i.test(p)) return "code";
  return "generic";
}

/**
 * @param {string} [lang]
 */
export function codeMapLangLabel(lang) {
  const labels = {
    sql: "SQL",
    java: "Java",
    jvm: "JVM",
    yaml: "YAML",
    json: "JSON",
    js: "JS/TS",
    component: "Component",
    python: "Python",
    go: "Go",
    rust: "Rust",
    dotnet: ".NET",
    terraform: "Terraform",
    markdown: "Markdown",
    stylesheet: "CSS",
    markup: "HTML",
    shell: "Shell",
    graphql: "GraphQL",
    proto: "Protobuf",
    config: "Config",
    container: "Docker",
    code: "Source",
    generic: "File",
  };
  return labels[lang] ?? "Code";
}