import fs from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cedar", "breakout-cache");

/**
 * @param {{ owner: string, repo: string, pr: number, headSha: string }} key
 */
export function breakoutCacheKey(key) {
  return `${key.owner}/${key.repo}#${key.pr}@${key.headSha}`;
}

function cacheEnabled() {
  return process.env.CEDAR_BREAKOUT_CACHE !== "false";
}

function cachePath(id) {
  const safe = id.replace(/[^a-zA-Z0-9#@._/-]+/g, "_");
  return path.join(CACHE_DIR, `${safe}.json`);
}

/**
 * @param {string} id
 * @returns {object | null}
 */
export function readBreakoutCache(id) {
  if (!cacheEnabled()) return null;
  try {
    const file = cachePath(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} id
 * @param {object} payload
 */
export function writeBreakoutCache(id, payload) {
  if (!cacheEnabled()) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(id), JSON.stringify(payload, null, 0), "utf8");
  } catch {
    /* ignore cache write errors */
  }
}