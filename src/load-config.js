import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * @typedef {object} ComponentDef
 * @property {string} id
 * @property {string} name
 * @property {string[]} paths
 * @property {string[]} [depends_on]
 * @property {string} [description]
 * @property {string} [rationale]
 */

/**
 * @param {string} configPath
 * @returns {{ components: ComponentDef[], defaultComponent: string }}
 */
export function loadComponentsConfig(configPath) {
  const resolved = path.resolve(configPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const doc = parseYaml(raw);
  if (!doc?.components?.length) {
    throw new Error(`No components defined in ${resolved}`);
  }
  return {
    components: doc.components,
    defaultComponent: doc.default_component ?? "default",
  };
}