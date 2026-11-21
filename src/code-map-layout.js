import { isSqlFile } from "./sql-slice.js";
import { isYamlPath } from "./code-map-yaml.js";
import { isJsonPath } from "./code-map-json.js";

/**
 * One-line outline of how the file is organized (for the flyout).
 *
 * @param {{ nodes?: { kind: string, label: string, scope?: string }[] }} map
 */
export function structureOutline(map) {
  const nodes = map.nodes ?? [];
  /** @type {string[]} */
  const parts = ["file"];

  const imports = nodes.filter((n) => n.kind === "import");
  if (imports.length) parts.push(imports.length === 1 ? "import" : `${imports.length} imports`);

  const steps = nodes.filter((n) => n.kind === "step");
  if (steps.length) {
    parts.push(steps.length === 1 ? "SQL step" : `${steps.length} SQL steps`);
    const tables = nodes.filter((n) => n.kind === "table").length;
    if (tables) parts.push(tables === 1 ? "table" : `${tables} tables`);
    return parts.join(" → ");
  }

  const topTypes = nodes.filter(
    (n) =>
      (n.kind === "symbol" || n.kind === "definition") &&
      (!n.scope || n.scope === "module") &&
      /^(class|interface|enum|type)\s/i.test(n.label)
  );
  for (const t of topTypes.slice(0, 2)) {
    parts.push(shortTypeName(t.label));
  }
  if (topTypes.length > 2) parts.push(`+${topTypes.length - 2} types`);

  const scopes = new Set(
    nodes
      .filter((n) => n.scope && n.scope !== "module" && n.scope !== "__sql__")
      .map((n) => n.scope)
  );
  for (const scope of [...scopes].slice(0, 2)) {
    const members = nodes.filter((n) => n.scope === scope && (n.kind === "symbol" || n.kind === "definition"));
    if (members.length) {
      parts.push(`${scope} (${members.length} members)`);
    }
  }

  const mods = nodes.filter((n) => n.kind === "module" || n.kind === "module-focus").length;
  if (mods) parts.push(mods === 1 ? "module edge" : `${mods} module files`);

  const exports = nodes.filter((n) => n.kind === "export").length;
  if (exports) parts.push(exports === 1 ? "export" : `${exports} exports`);

  return parts.join(" → ");
}

/**
 * Graph layout + plain-language layout blurb.
 *
 * @param {{ nodes?: { kind: string, scope?: string }[] }} map
 * @param {string} [path]
 */
export function describeCodeMapLayout(map, path = "") {
  const nodes = map.nodes ?? [];
  const steps = nodes.filter((n) => n.kind === "step").length;
  const tables = nodes.filter((n) => n.kind === "table").length;
  const imports = nodes.filter((n) => n.kind === "import").length;
  const modules = nodes.filter((n) => n.kind === "module" || n.kind === "module-focus").length;
  const scoped = nodes.filter((n) => n.scope && n.scope !== "module" && n.scope !== "__sql__").length;

  if (isYamlPath(path)) {
    const sections = nodes.filter((n) => n.kind === "definition").length;
    return {
      rankdir: "TB",
      title: "Config tree",
      line: `Layout: top-down — YAML root, then ${sections || "nested"} sections and keys in hierarchy order.`,
    };
  }

  if (isJsonPath(path)) {
    const sections = nodes.filter((n) => n.kind === "definition").length;
    return {
      rankdir: "TB",
      title: "JSON tree",
      line: `Layout: top-down — JSON root, then ${sections || "nested"} objects and keys in hierarchy order.`,
    };
  }

  if (isSqlFile(path) || steps > 0) {
    return {
      rankdir: "TB",
      title: "Statement pipeline",
      line: `Layout: top-down pipeline — script entry, then each statement in order${
        tables ? `; ${tables} table node${tables === 1 ? "" : "s"} branch to the side` : ""
      }.`,
    };
  }

  if (imports >= 4 && scoped < 6) {
    return {
      rankdir: "LR",
      title: "Import fan-out",
      line: `Layout: left-to-right — file entry on the left, ${imports} imports fan out; types and members follow to the right.`,
    };
  }

  if (modules >= 3) {
    return {
      rankdir: "LR",
      title: "Module neighborhood",
      line: `Layout: module files (${modules}) shown beside this file's types; local structure stacks top-down inside the file.`,
    };
  }

  return {
    rankdir: "TB",
    title: "File stack",
    line: `Layout: top-down — file entry, then types${
      scoped ? ", then scoped methods/fields under each type" : ""
    }${imports ? `; imports hang from the file node` : ""}.`,
  };
}

/**
 * @param {string} label
 */
function shortTypeName(label) {
  const t = String(label ?? "").trim();
  const m = t.match(/^(class|interface|enum|type)\s+(\w+)/i);
  return m ? `${m[1]} ${m[2]}` : t.length > 36 ? `${t.slice(0, 33)}…` : t;
}