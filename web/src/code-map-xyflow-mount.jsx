import { mountSourceFlow, unmountSourceFlow } from "sourceflow/react";

export function unmountCodeMapXyflow(host) {
  unmountSourceFlow(host);
}

/**
 * @param {HTMLElement} host
 * @param {Parameters<typeof mountSourceFlow>[1]} opts
 */
export function mountCodeMapXyflow(host, opts) {
  mountSourceFlow(host, { classPrefix: "cedar-code-map", ...opts });
}