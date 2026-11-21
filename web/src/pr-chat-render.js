import { renderCommentBodyHtml } from "./comment-html.js";
import { mountDiagramPanViewport, renderArchitectureMermaid } from "./diagram-ux.js";

/**
 * @param {string} source
 */
function looksLikeMermaidSource(source) {
  const t = String(source ?? "").trimStart();
  if (!t) return false;
  return /^(graph\s|flowchart\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie\s|gitGraph|C4Context|mindmap|timeline|block-beta)/i.test(
    t,
  );
}

/**
 * @param {HTMLElement} host
 * @param {string} raw
 */
export async function mountAssistantChatBody(host, raw) {
  const text = String(raw ?? "").trim();
  host.replaceChildren();
  host.classList.add("cedar-comment-html", "cedar-pr-chat-rich");
  if (!text) return;

  const html = renderCommentBodyHtml(text);
  if (!html) {
    host.textContent = text;
    return;
  }

  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  host.append(...wrap.childNodes);

  const pres = [...host.querySelectorAll("pre")];
  await Promise.all(
    pres.map(async (pre) => {
      if (!(pre instanceof HTMLElement)) return;
      const code = pre.querySelector("code");
      const source = (code ?? pre).textContent ?? "";
      const lang = code?.className?.match(/language-([\w-]+)/i)?.[1]?.toLowerCase();
      if (lang !== "mermaid" && !looksLikeMermaidSource(source)) return;

      const wrap = document.createElement("div");
      wrap.className = "cedar-pr-chat-diagram-wrap";
      wrap.setAttribute("data-diagram-wrap", "");
      const stage = document.createElement("div");
      stage.className =
        "cedar-pr-chat-mermaid-stage diagram-complete-layout diagram-stage-panzoom diagram-overview-read diagram-stage-canvas";
      pre.replaceWith(wrap);
      wrap.append(stage);
      stage.append(pre);
      pre.classList.add("cedar-mermaid-scroll", "mermaid-rendered");

      const ok = await renderArchitectureMermaid(source, pre);
      if (ok) mountDiagramPanViewport(wrap, pre);
    }),
  );
}