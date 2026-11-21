import { createRoot } from "react-dom/client";
import { SourceFlowMap } from "./SourceFlowMap.jsx";

/** @type {WeakMap<HTMLElement, import('react-dom/client').Root>} */
const roots = new WeakMap();

export function unmountSourceFlow(host) {
  const root = roots.get(host);
  if (!root) return;
  root.unmount();
  roots.delete(host);
}

/**
 * @param {HTMLElement} host
 * @param {import('./SourceFlowMap.jsx').SourceFlowMap extends (props: infer P) => unknown ? P : never} opts
 */
export function mountSourceFlow(host, opts) {
  unmountSourceFlow(host);
  if (opts.mapLang) host.dataset.codeMapLang = opts.mapLang;
  if (opts.rankdir) host.dataset.codeMapRankdir = opts.rankdir;
  const root = createRoot(host);
  roots.set(host, root);
  root.render(<SourceFlowMap {...opts} />);
}