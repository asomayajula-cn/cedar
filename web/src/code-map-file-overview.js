/**
 * Flyout copy for one file: structure outline, what it does, layout.
 *
 * @param {{
 *   whatItDoes?: string | null,
 *   structure?: string | null,
 *   layout?: { line?: string, title?: string, rankdir?: string } | null,
 *   summary?: { lead?: string, structure?: string, layout?: { line?: string }, bullets?: string[] } | null,
 *   elements?: object[] | null,
 * }} artifact
 */
export function codeMapFileOverview(artifact) {
  const summary = artifact?.summary;
  const what =
    (typeof artifact?.whatItDoes === "string" && artifact.whatItDoes.trim()) ||
    (typeof summary?.lead === "string" && summary.lead.trim()) ||
    "";

  const structure =
    (typeof artifact?.structure === "string" && artifact.structure.trim()) ||
    (typeof summary?.structure === "string" && summary.structure.trim()) ||
    structureFromElements(artifact?.elements) ||
    "";

  const layoutLine =
    artifact?.layout?.line ||
    summary?.layout?.line ||
    (Array.isArray(summary?.bullets)
      ? summary.bullets.find((b) => /^Layout:/i.test(String(b)))
      : "") ||
    "";

  /** @type {string[]} */
  const details = [];
  const bullets = Array.isArray(summary?.bullets) ? summary.bullets : [];
  for (const b of bullets) {
    const t = String(b).trim();
    if (!t) continue;
    if (/^Structure:/i.test(t)) continue;
    if (/^Layout:/i.test(t) || t.startsWith("Layout:")) continue;
    if (t === layoutLine) continue;
    details.push(t);
  }

  return { what, structure, layoutLine, details };
}

/** @param {object[] | null | undefined} elements */
function structureFromElements(elements) {
  const nodes = (elements ?? []).filter((el) => el?.data && !Object.hasOwn(el.data, "source"));
  if (!nodes.length) return "";
  /** @type {string[]} */
  const parts = ["file"];
  const kindCount = (k) => nodes.filter((n) => n.data?.kind === k).length;
  const imp = kindCount("import");
  const steps = kindCount("step");
  const tables = kindCount("table");
  const symbols = kindCount("symbol") + kindCount("definition");
  const modules = kindCount("module") + kindCount("module-focus");
  if (imp) parts.push(imp === 1 ? "import" : `${imp} imports`);
  if (steps) {
    parts.push(steps === 1 ? "SQL step" : `${steps} SQL steps`);
    if (tables) parts.push(tables === 1 ? "table" : `${tables} tables`);
    return parts.join(" → ");
  }
  if (symbols) parts.push(symbols === 1 ? "type/member" : `${symbols} types/members`);
  if (modules) parts.push(modules === 1 ? "module link" : `${modules} module links`);
  return parts.join(" → ");
}