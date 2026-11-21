import { createRoot } from "react-dom/client";
import { CodeMapArborist } from "./code-map-arborist.jsx";

/** @type {WeakMap<HTMLElement, import('react-dom/client').Root>} */
const roots = new WeakMap();

/**
 * @param {HTMLElement} host
 */
export function unmountCodeMapArborist(host) {
  const root = roots.get(host);
  if (!root) return;
  root.unmount();
  roots.delete(host);
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   elements: object[],
 *   filePath?: string,
 *   isDay?: boolean,
 *   onEngineReady?: (api: object) => void,
 * }} opts
 */
export function mountCodeMapArborist(host, opts) {
  unmountCodeMapArborist(host);
  const root = createRoot(host);
  roots.set(host, root);
  root.render(
    <CodeMapArborist
      elements={opts.elements}
      filePath={opts.filePath}
      isDay={opts.isDay}
      onEngineReady={opts.onEngineReady}
    />
  );
}