/**
 * Path-based SQL → architecture slice (shared by components.yaml hints and heuristics).
 */

/** Flyway-style versioned migrations (V1__init.sql, etc.). */
export const SQL_FLYWAY_NAME_RE = /\/V\d+__[^/]+\.sql$/i;

/**
 * @param {string} filename
 */
export function isSqlFile(filename) {
  return /\.sql$/i.test(String(filename ?? ""));
}

/**
 * @param {string} filename
 * @returns {"migrations" | "repository" | "persistence" | null}
 */
export function sliceIdForSqlPath(filename) {
  const path = String(filename ?? "").replace(/\\/g, "/");
  if (!isSqlFile(path)) return null;

  const lower = path.toLowerCase();

  if (
    /(^|\/)(migrations?|db\/migration|db\/changelog|flyway|liquibase)(\/|$)/i.test(path) ||
    /(^|\/)(supabase\/migrations|prisma\/migrations|schema\/migrations|sql\/migrations)(\/|$)/i.test(
      lower
    ) ||
    SQL_FLYWAY_NAME_RE.test(path)
  ) {
    return "migrations";
  }

  if (/(^|\/)(seeds?|fixtures?|testdata|sample[-_]?data)(\/|$)/i.test(lower)) {
    return "repository";
  }

  if (/(^|\/)(schemas?|ddl|init)(\/|$)/i.test(lower)) {
    return "migrations";
  }

  if (/(^|\/)(db|persistence|storage)(\/|$)/i.test(lower)) {
    return "persistence";
  }

  return "persistence";
}