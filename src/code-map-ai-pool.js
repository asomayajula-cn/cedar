const DEFAULT_MAX = 2;

let active = 0;
/** @type {Array<() => void>} */
const queue = [];

function pump() {
  while (active < maxConcurrent() && queue.length) {
    const run = queue.shift();
    if (run) run();
  }
}

function maxConcurrent() {
  const n = Number.parseInt(String(process.env.CEDAR_AI_CODE_MAP_CONCURRENCY ?? ""), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(n, 6)) : DEFAULT_MAX;
}

/**
 * Run AI code-map work with a small concurrency cap (avoids stalling the whole review).
 * @template T
 * @param {() => Promise<T>} fn
 */
export function withCodeMapAiSlot(fn) {
  return new Promise((resolve, reject) => {
    const start = async () => {
      active += 1;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        active -= 1;
        pump();
      }
    };
    if (active < maxConcurrent()) start();
    else queue.push(start);
  });
}