import { collectReadablePatchText } from "./file-flow-semantic.js";
import { capFunctionalSteps, outcomeFromSteps, renderFunctionalWorkflowMermaid } from "./functional-flow-render.js";

/**
 * @param {string} path
 * @param {string} patch
 * @returns {import("./functional-flow-render.js").FunctionalStep[]}
 */
export function collectJavaFunctionalSteps(path, patch) {
  const meta = collectReadablePatchText(patch);
  const micro = scanJavaConstructs(meta.text);
  const steps = micro.map((m) => ({
    phase: mapJavaPhase(m.phase),
    headline: m.headline,
    functional: m.functional || "Participate in application request or domain flow",
  }));
  if (steps.length) return capFunctionalSteps(steps);
  if (!meta.text.trim()) return [];
  return capFunctionalSteps([
    {
      phase: "behavior",
      headline: `${meta.added || meta.lineCount || 0} lines in diff`,
      functional: "Source edits not matched to JVM patterns in diff",
    },
  ]);
}

/**
 * @param {string} path
 * @param {string} patch
 */
export function buildJavaFunctionalWorkflowMermaid(path, patch) {
  const meta = collectReadablePatchText(patch);
  const role = /\.(kt|kts)$/i.test(path) ? "Kotlin workflow" : "Java workflow";

  const micro = scanJavaConstructs(meta.text);
  const steps = micro.map((m) => ({
    phase: mapJavaPhase(m.phase),
    headline: m.headline,
    functional: m.functional || "Participate in application request or domain flow",
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
    steps: steps.length ? steps : [{
      phase: "behavior",
      headline: `${meta.added} lines added`,
      functional: "Source edits not matched to JVM patterns in diff",
    }],
    outcome: outcomeFromSteps(steps) || "Adjusts JVM application behavior",
  });
}

/**
 * @param {string} text
 */
function scanJavaConstructs(text) {
  /** @type {object[]} */
  const micro = [];
  let pendingMapping = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;

    const mapping = line.match(/@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(([^)]*)\)/i);
    if (mapping) {
      pendingMapping = {
        method: mapping[1].toUpperCase(),
        path: extractMappingPath(mapping[2]),
      };
      continue;
    }

    if (/^import\s+/.test(line)) {
      const pkg = line.replace(/^import\s+(static\s+)?/, "").replace(/;$/, "");
      micro.push({ phase: "dependencies", import: pkg, headline: `Import ${lastSegment(pkg)}` });
      continue;
    }

    if (/^public\s+(class|interface|enum|record)\s+(\w+)/.test(line)) {
      const kind = line.match(/^(?:public\s+)?(class|interface|enum|record)/)?.[1] ?? "class";
      const name = line.match(/(class|interface|enum|record)\s+(\w+)/)?.[2];
      micro.push({
        phase: kind === "interface" ? "contract" : "contract",
        kind,
        name,
        headline: `${capitalize(kind)} ${name}`,
        functional: guessJavaTypePurpose(name, kind),
      });
      continue;
    }

    if (/^\s*public\s+[\w<>\[\],\s]+\s+(\w+)\s*\(/.test(line)) {
      const name = line.match(/(\w+)\s*\(/)?.[1];
      if (name === "class" || name === "interface") continue;
      micro.push({
        phase: pendingMapping ? "api" : "behavior",
        name,
        mapping: pendingMapping,
        headline: pendingMapping
          ? `${pendingMapping.method} ${pendingMapping.path} → ${name}`
          : `Method ${name}`,
        functional: pendingMapping
          ? "Handle HTTP request for this endpoint"
          : guessJavaMethodPurpose(name),
      });
      pendingMapping = null;
      continue;
    }

    if (/@Entity\b|@Table\s*\(/.test(line)) {
      micro.push({ phase: "persistence", headline: "JPA entity mapping", functional: "Map class to database table" });
    }
    if (/@Repository\b|extends\s+JpaRepository/.test(line)) {
      const name = line.match(/interface\s+(\w+)/)?.[1];
      micro.push({
        phase: "persistence",
        headline: name ? `Repository ${name}` : "Repository",
        functional: "Load and store aggregates through persistence API",
      });
    }
    if (/@Service\b/.test(line)) {
      micro.push({ phase: "behavior", headline: "@Service bean", functional: "Host transactional business operations" });
    }
    if (/@RestController\b|@Controller\b/.test(line)) {
      micro.push({ phase: "api", headline: "Web controller", functional: "Translate HTTP to application calls" });
    }
  }
  return micro;
}

/**
 * @param {string} phase
 */
function mapJavaPhase(phase) {
  return phase || "behavior";
}

function extractMappingPath(raw) {
  const quoted = raw.match(/["']([^"']+)["']/);
  if (quoted) return quoted[1];
  return raw.split(",")[0]?.trim() || "/";
}

function guessJavaTypePurpose(name, kind) {
  const n = String(name ?? "").toLowerCase();
  if (/controller/.test(n)) return "Receive HTTP and delegate to services";
  if (/service/.test(n)) return "Coordinate domain use cases";
  if (/repository|dao/.test(n)) return "Abstract data access";
  if (kind === "interface") return "Define contract implemented elsewhere";
  return "Group related fields and methods";
}

function guessJavaMethodPurpose(name) {
  const n = String(name ?? "").toLowerCase();
  if (/^get|^find|^list|^search/.test(n)) return "Read data for caller";
  if (/^create|^save|^add/.test(n)) return "Persist new state";
  if (/^update|^patch/.test(n)) return "Apply changes to existing state";
  if (/^delete|^remove/.test(n)) return "Remove entities";
  return "Execute domain logic";
}

function lastSegment(pkg) {
  const p = String(pkg ?? "").split(".");
  return p[p.length - 1] || pkg;
}

function truncateList(items) {
  const uniq = [...new Set(items.filter(Boolean))];
  if (uniq.length <= 3) return uniq.join(" · ");
  return `${uniq.slice(0, 3).join(" · ")} +${uniq.length - 3}`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function shortName(path) {
  const p = path.split("/");
  return p.length > 2 ? `…/${p.slice(-2).join("/")}` : path;
}