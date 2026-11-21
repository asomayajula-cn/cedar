import { renderCodeMapMermaid as render } from "./code-map-render.js";

export const COMPACT_MERMAID_INIT = `%%{init: {"themeVariables": {"fontSize": "10px", "fontFamily": "ui-monospace, monospace"}, "flowchart": {"diagramPadding": 10, "nodeSpacing": 18, "rankSpacing": 28, "padding": 12, "curve": "curve", "useMaxWidth": true}}}%%`;

export function renderCodeMapMermaid(map) {
  return render(map);
}