import svgPanZoom from "svg-pan-zoom";

/** @type {typeof import('mermaid').default | null} */
let mermaidApi = null;
let mermaidBooted = false;

const panZoomByWrap = new WeakMap();

async function ensureMermaid() {
  if (mermaidBooted && mermaidApi) return mermaidApi;
  const mod = await import("mermaid");
  mermaidApi = mod.default;
  mermaidApi.initialize({
    startOnLoad: false,
    theme: "base",
    flowchart: { htmlLabels: true, useMaxWidth: true, padding: 20, curve: "basis", nodeSpacing: 42, rankSpacing: 56 },
    themeVariables: {
      darkMode: true,
      background: "transparent",
      primaryColor: "#141414",
      primaryTextColor: "#f5f5f5",
      primaryBorderColor: "#737373",
      lineColor: "#525252",
      secondaryColor: "#0a0a0a",
      tertiaryColor: "#fafafa",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSize: "13px",
    },
    securityLevel: "loose",
  });
  mermaidBooted = true;
  window.__cedarMermaid = mermaidApi;
  return mermaidApi;
}

/**
 * @param {string} source
 * @param {HTMLElement} pre
 */
export async function renderArchitectureMermaid(source, pre) {
  if (!source?.trim() || !pre) return false;
  pre.textContent = source;
  pre.classList.add("mermaid");
  pre.removeAttribute("data-processed");
  const mermaid = await ensureMermaid();
  try {
    await mermaid.run({ nodes: [pre] });
    const svg = pre.querySelector("svg");
    if (svg) {
      svg.style.display = "block";
      svg.style.marginInline = "auto";
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
    }
    return true;
  } catch (err) {
    console.warn("[cedar] mermaid render failed", err);
    pre.classList.add("cedar-mermaid-fallback");
    return false;
  }
}

/**
 * @param {HTMLElement} wrap
 * @param {string} svgMarkup
 */
export function mountServerSvg(wrap, svgMarkup) {
  const host = wrap.querySelector("[data-diagram-host]");
  if (!host || !svgMarkup) return;
  host.innerHTML = svgMarkup;
  const svg = host.querySelector("svg");
  if (!svg) return;
  svg.style.display = "block";
  svg.style.marginInline = "auto";
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  if (!wrap.hasAttribute("data-diagram-panzoom")) return;
  queuePanFit(wrap, svg);
}

/**
 * @param {ParentNode} root
 */
export function activateDiagramUx(root) {
  wireDiagramToolbars(root);
}

/**
 * @param {ParentNode} root
 * @param {string} source
 */
export async function mountLayoutMermaid(root, source) {
  const pre = root.querySelector("#cedar-mermaid-layout");
  if (!pre || !source?.trim()) return false;
  const ok = await renderArchitectureMermaid(source, pre);
  const wrap = pre.closest("[data-diagram-wrap]");
  const svg = pre.querySelector("svg");
  if (ok && wrap instanceof HTMLElement && svg instanceof SVGSVGElement) {
    queuePanFit(wrap, svg);
    activateDiagramUx(wrap);
  }
  return ok;
}

/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 */
function queuePanFit(wrap, svg) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => bindPanZoom(wrap, svg));
  });
}

function bindPanZoom(wrap, svg) {
  const prev = panZoomByWrap.get(wrap);
  if (prev) {
    try {
      prev.destroy();
    } catch {
      /* */
    }
  }
  try {
    const pz = svgPanZoom(svg, {
      zoomScaleSensitivity: 0.3,
      minZoom: 0.35,
      maxZoom: 6,
      fit: true,
      center: true,
      controlIconsEnabled: false,
    });
    panZoomByWrap.set(wrap, pz);
    pz.resize();
    pz.fit();
    pz.center();
    return pz;
  } catch (err) {
    console.warn("[cedar] pan/zoom unavailable", err);
    return null;
  }
}

/**
 * @param {ParentNode} root
 */
function wireDiagramToolbars(root) {
  root.querySelectorAll("[data-diagram-wrap]").forEach((wrap) => {
    const bar = wrap.querySelector("[data-diagram-toolbar]");
    if (!bar || bar.dataset.wired) return;
    bar.dataset.wired = "1";

    bar.querySelectorAll("[data-diagram-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pz = panZoomByWrap.get(wrap);
        if (!pz) return;
        const action = btn.getAttribute("data-diagram-action");
        if (action === "in") pz.zoomIn();
        else if (action === "out") pz.zoomOut();
        else if (action === "reset") {
          pz.resetZoom();
          pz.resize();
          pz.fit();
          pz.center();
        }
      });
    });
  });
}