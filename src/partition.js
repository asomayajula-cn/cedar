import { minimatch } from "minimatch";

/**
 * @typedef {import('./load-config.js').ComponentDef} ComponentDef
 */

/**
 * @param {string} filename
 * @param {ComponentDef[]} components
 * @param {string} defaultId
 * @returns {string} component id
 */
export function assignFileToComponent(filename, components, defaultId) {
  for (const c of components) {
    for (const pattern of c.paths) {
      if (minimatch(filename, pattern, { dot: true })) {
        return c.id;
      }
    }
  }
  return defaultId;
}

/**
 * @typedef {object} PrFile
 * @property {string} filename
 * @property {string} status
 * @property {number} additions
 * @property {number} deletions
 * @property {number} changes
 * @property {string} [patch]
 * @property {string} [previous_filename]
 */

/**
 * @typedef {object} MicroPr
 * @property {string} componentId
 * @property {string} componentName
 * @property {string[]} dependsOn
 * @property {string} [description]
 * @property {string} [rationale]
 * @property {PrFile[]} files
 * @property {number} additions
 * @property {number} deletions
 * @property {number} totalChanges
 */

/**
 * @param {PrFile[]} files
 * @param {ComponentDef[]} components
 * @param {string} defaultId
 * @returns {{ microPrs: MicroPr[], byFile: Map<string, string>, multiTagged: PrFile[] }}
 */
export function partitionPrByComponents(files, components, defaultId) {
  /** @type {Map<string, MicroPr>} */
  const buckets = new Map();
  /** @type {Map<string, string>} */
  const byFile = new Map();
  /** @type {PrFile[]} */
  const multiTagged = [];

  const componentById = new Map(components.map((c) => [c.id, c]));

  for (const file of files) {
    const name = file.previous_filename ?? file.filename;
    const matches = components
      .filter((c) => c.paths.some((p) => minimatch(name, p, { dot: true })))
      .map((c) => c.id);

    let componentId;
    if (matches.length > 1) {
      multiTagged.push(file);
      componentId = matches[0];
    } else if (matches.length === 1) {
      componentId = matches[0];
    } else {
      componentId = assignFileToComponent(name, components, defaultId);
    }

    byFile.set(file.filename, componentId);

    const def = componentById.get(componentId);
    const componentName = def?.name ?? componentId;
    const dependsOn = def?.depends_on ?? [];

    if (!buckets.has(componentId)) {
      buckets.set(componentId, {
        componentId,
        componentName,
        dependsOn,
        files: [],
        additions: 0,
        deletions: 0,
        totalChanges: 0,
      });
    }

    const bucket = buckets.get(componentId);
    bucket.files.push(file);
    bucket.additions += file.additions ?? 0;
    bucket.deletions += file.deletions ?? 0;
    bucket.totalChanges += file.changes ?? 0;
  }

  const microPrs = [...buckets.values()].sort((a, b) =>
    a.componentId.localeCompare(b.componentId)
  );

  return { microPrs, byFile, multiTagged };
}

/**
 * Partition using AI file→component assignments (from OpenRouter analysis).
 * @param {PrFile[]} files
 * @param {ComponentDef[]} components
 * @param {Record<string, string>} assignments
 * @param {string} defaultId
 */
export function partitionPrByAssignments(files, components, assignments, defaultId) {
  const componentById = new Map(components.map((c) => [c.id, c]));
  if (!componentById.has(defaultId)) {
    componentById.set(defaultId, {
      id: defaultId,
      name: defaultId,
      paths: [],
      depends_on: [],
    });
  }

  /** @type {Map<string, MicroPr>} */
  const buckets = new Map();
  /** @type {Map<string, string>} */
  const byFile = new Map();

  for (const file of files) {
    const componentId = assignments[file.filename] ?? defaultId;
    byFile.set(file.filename, componentId);

    const def = componentById.get(componentId) ?? componentById.get(defaultId);
    if (!buckets.has(componentId)) {
      buckets.set(componentId, {
        componentId,
        componentName: def?.name ?? componentId,
        dependsOn: def?.depends_on ?? [],
        description: def?.description,
        rationale: def?.rationale,
        files: [],
        additions: 0,
        deletions: 0,
        totalChanges: 0,
      });
    }

    const bucket = buckets.get(componentId);
    bucket.files.push(file);
    bucket.additions += file.additions ?? 0;
    bucket.deletions += file.deletions ?? 0;
    bucket.totalChanges += file.changes ?? 0;
  }

  const microPrs = [...buckets.values()].sort((a, b) =>
    a.componentId.localeCompare(b.componentId)
  );

  return { microPrs, byFile, multiTagged: [] };
}

/**
 * @param {PrFile[]} files
 * @returns {string[]}
 */
export function splitPatchIntoHunks(patch) {
  if (!patch) return [];
  const lines = patch.split("\n");
  const hunks = [];
  let current = [];
  for (const line of lines) {
    if (line.startsWith("@@") && current.length) {
      hunks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) hunks.push(current.join("\n"));
  return hunks;
}