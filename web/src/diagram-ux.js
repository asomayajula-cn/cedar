import svgPanZoom from "svg-pan-zoom";

/** @type {typeof import('mermaid').default | null} */
let mermaidApi = null;
let mermaidBooted = false;

const panZoomByWrap = new WeakMap();
/** @type {WeakMap<HTMLElement, () => void>} */
const umlFitByWrap = new WeakMap();

async function ensureMermaid() {
  if (mermaidBooted && mermaidApi) return mermaidApi;
  const mod = await import("mermaid");
  mermaidApi = mod.default;
  mermaidApi.initialize({
    startOnLoad: false,
    theme: "base",
    flowchart: { htmlLabels: false, useMaxWidth: true, padding: 20, curve: "basis", nodeSpacing: 42, rankSpacing: 56 },
    class: { useMaxWidth: true },
    sequence: { useMaxWidth: true, wrap: true },
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
 */
export function normalizeMermaidSource(source) {
  let s = String(source ?? "").trim();
  if (!s) return "";
  const fence = /^```(?:mermaid)?\s*\n([\s\S]*?)```\s*$/im.exec(s);
  if (fence) s = fence[1].trim();
  const lines = s.split("\n");
  while (lines[0]?.startsWith("#")) lines.shift();
  return lines.join("\n").trim();
}

/**
 * @param {string} source
 * @param {HTMLElement} pre
 */
export async function renderArchitectureMermaid(source, pre) {
  if (!pre) return false;
  const graph = normalizeMermaidSource(source);
  if (!graph) return false;

  let mermaid;
  try {
    mermaid = await ensureMermaid();
  } catch (err) {
    console.warn("[cedar] mermaid load failed", err);
    pre.textContent = graph;
    pre.classList.add("cedar-mermaid-fallback");
    return false;
  }

  pre.classList.remove("cedar-mermaid-fallback");
  pre.replaceChildren();

  const renderId = `cedar-mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const { svg, bindFunctions } = await mermaid.render(renderId, graph);
    pre.innerHTML = svg;
    pre.classList.add("mermaid-rendered");
    bindFunctions?.(pre);
    const svgEl = pre.querySelector("svg");
    const isClassDiagram = graph.trimStart().startsWith("classDiagram");
    if (svgEl instanceof SVGSVGElement) {
      svgEl.style.display = "block";
      svgEl.style.height = "auto";
      if (isClassDiagram) {
        svgEl.style.margin = "0";
        svgEl.style.maxWidth = "none";
        svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
      } else {
        svgEl.style.marginInline = "auto";
        svgEl.style.maxWidth = "100%";
      }
    }
    return Boolean(svgEl);
  } catch (err) {
    console.warn("[cedar] mermaid render failed", err);
    pre.textContent = graph;
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
  if (!root || !source?.trim()) return false;
  const pre = root.querySelector("#cedar-mermaid-layout");
  if (!pre) return false;
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
 * @param {ParentNode} root
 * @param {{ components?: string, flow?: string, events?: string }} views
 */
export async function mountCompleteLayoutViews(root, views) {
  if (!root || !views) return 0;
  const panels = [
    { key: "components", sel: "#cedar-mermaid-components" },
    { key: "flow", sel: "#cedar-mermaid-flow" },
    { key: "events", sel: "#cedar-mermaid-events" },
  ];
  let drawn = 0;
  for (const { key, sel } of panels) {
    const source = views[key];
    const pre = root.querySelector(sel);
    if (!pre || !source?.trim()) continue;
    const ok = await renderArchitectureMermaid(source, pre);
    const wrap = pre.closest("[data-diagram-wrap]");
    const svg = pre.querySelector("svg");
    if (ok && wrap instanceof HTMLElement && svg instanceof SVGSVGElement) {
      mountDiagramStageFullWidth(wrap, pre);
      activateDiagramUx(wrap);
      drawn += 1;
    }
  }
  return drawn;
}

/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 */
/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {{ fillViewport?: boolean }} [opts]
 */
/**
 * @param {{ fillViewport?: boolean, fillWidth?: boolean }} [opts]
 */
function queuePanFit(wrap, svg, opts) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => bindPanZoom(wrap, svg, opts));
  });
}

/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {{ fillViewport?: boolean }} [opts]
 */
function bindPanZoom(wrap, svg, opts = {}) {
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
    fitDiagramInStage(wrap, svg, pz, {
      fill: opts.fillViewport === true,
      fillWidth: opts.fillWidth === true,
    });
    return pz;
  } catch (err) {
    console.warn("[cedar] pan/zoom unavailable", err);
    return null;
  }
}

/**
 * @param {ParentNode} root
 */
/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {ReturnType<typeof svgPanZoom>} pz
 * @param {boolean} fillViewport
 */
const resizeObserverByWrap = new WeakMap();

/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 */
/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {{ fillWidth?: boolean }} [opts]
 */
function wireDiagramStageResize(wrap, svg, opts = {}) {
  if (resizeObserverByWrap.has(wrap)) return;
  const stage = wrap.querySelector(".diagram-complete-layout");
  if (!(stage instanceof HTMLElement)) return;
  const ro = new ResizeObserver(() => {
    const pz = panZoomByWrap.get(wrap);
    if (pz) fitDiagramInStage(wrap, svg, pz, { fill: true, fillWidth: opts.fillWidth === true });
  });
  ro.observe(stage);
  resizeObserverByWrap.set(wrap, ro);
}

/**
 * @param {HTMLElement} wrap
 * @param {SVGSVGElement} svg
 * @param {ReturnType<typeof svgPanZoom>} pz
 * @param {{ fill?: boolean, fillWidth?: boolean }} [opts]
 */
function fitDiagramInStage(wrap, svg, pz, opts = {}) {
  const stage = wrap.querySelector(".diagram-complete-layout");
  if (!(stage instanceof HTMLElement)) {
    pz.resize();
    pz.fit();
    pz.center();
    return;
  }

  pz.resize();
  pz.fit();
  pz.center();

  if (!opts.fill) return;

  const pad = 16;
  const stageW = Math.max(stage.clientWidth - pad, 200);
  const stageH = Math.max(stage.clientHeight - pad, 200);
  const rect = svg.getBoundingClientRect();
  const svgW = rect.width || svg.width?.baseVal?.value || 0;
  const svgH = rect.height || svg.height?.baseVal?.value || 0;
  if (svgW < 8 || svgH < 8 || stageW < 8) return;

  const growW = (stageW / svgW) * 0.98;
  const growH = (stageH / svgH) * 0.94;
  const grow = opts.fillWidth ? growW : Math.min(growW, growH, 4);
  if (grow > 1.04) {
    pz.zoom(pz.getZoom() * grow);
    pz.center();
  }
}

/**
 * Refit pan/zoom for every Complete layout panel after layout changes.
 * @param {ParentNode} root
 */
export function refitPanZoomDiagrams(root) {
  root.querySelectorAll("[data-diagram-wrap]").forEach((wrap) => {
    if (!(wrap instanceof HTMLElement)) return;
    const umlFit = umlFitByWrap.get(wrap);
    if (umlFit) {
      umlFit();
      return;
    }
    const pz = panZoomByWrap.get(wrap);
    const svg = wrap.querySelector("svg");
    if (pz && svg instanceof SVGSVGElement) {
      fitDiagramInStage(wrap, svg, pz, { fill: true, fillWidth: true });
    }
  });
}

/**
 * Scale Mermaid SVG to the full diagram stage (matches Overview viewport sizing).
 * @param {HTMLElement} wrap
 * @param {HTMLElement} pre
 */
function mountDiagramStageFullWidth(wrap, pre) {
  const stage = wrap.querySelector(".diagram-complete-layout");
  const svg = pre.querySelector("svg");
  if (!(stage instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) return;

  const prevPz = panZoomByWrap.get(wrap);
  if (prevPz) {
    try {
      prevPz.destroy();
    } catch {
      /* */
    }
    panZoomByWrap.delete(wrap);
  }

  const fit = () => {
    const pad = 12;
    const stageW = Math.max(stage.clientWidth - pad * 2, 280);
    if (stageW < 50) return;

    const vb = svg.viewBox?.baseVal;
    const naturalW = vb?.width > 0 ? vb.width : svg.width?.baseVal?.value || 0;
    const naturalH = vb?.height > 0 ? vb.height : svg.height?.baseVal?.value || 0;
    if (naturalW > 0 && naturalH > 0) {
      const scale = stageW / naturalW;
      svg.setAttribute("width", String(Math.round(stageW)));
      svg.setAttribute("height", String(Math.round(naturalH * scale)));
    } else {
      svg.setAttribute("width", "100%");
      svg.removeAttribute("height");
    }
    svg.style.width = "100%";
    svg.style.maxWidth = "none";
    svg.style.display = "block";
    svg.style.margin = "0";
  };

  umlFitByWrap.set(wrap, fit);
  fit();

  if (!resizeObserverByWrap.has(wrap)) {
    const ro = new ResizeObserver(() => fit());
    ro.observe(stage);
    resizeObserverByWrap.set(wrap, ro);
  }
}

/**
 * Refit Mermaid diagrams when the review stage or window resizes (sidebar / slice rail drags).
 * @param {ParentNode} root
 */
export function wireDiagramResizeListeners(root) {
  if (!(root instanceof HTMLElement) || root.dataset.wiredDiagramResize) return;
  root.dataset.wiredDiagramResize = "1";

  let timer = 0;
  const refit = () => {
    clearTimeout(timer);
    timer = setTimeout(() => refitPanZoomDiagrams(root), 80);
  };

  window.addEventListener("resize", refit, { passive: true });

  const layout = root.querySelector(".cedar-review-layout");
  if (layout instanceof HTMLElement && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(refit);
    ro.observe(layout);
    const main = root.querySelector(".cedar-review-main");
    if (main instanceof HTMLElement) ro.observe(main);
  }
}

function wireDiagramToolbars(root) {
  root.querySelectorAll("[data-diagram-wrap]").forEach((wrap) => {
    const bar = wrap.querySelector("[data-diagram-toolbar]");
    if (!bar || bar.dataset.wired) return;
    bar.dataset.wired = "1";

    bar.querySelectorAll("[data-diagram-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const umlFit = umlFitByWrap.get(wrap);
        const pz = panZoomByWrap.get(wrap);
        const action = btn.getAttribute("data-diagram-action");
        if (umlFit) {
          if (action === "reset") umlFit();
          return;
        }
        if (!pz) return;
        if (action === "in") pz.zoomIn();
        else if (action === "out") pz.zoomOut();
        else if (action === "reset") {
          const umlFit = umlFitByWrap.get(wrap);
          if (umlFit) {
            umlFit();
            return;
          }
          pz.resetZoom();
          const sv = wrap.querySelector("svg");
          if (sv instanceof SVGSVGElement) {
            fitDiagramInStage(wrap, sv, pz, { fill: true, fillWidth: true });
          } else {
            pz.resize();
            pz.fit();
            pz.center();
          }
        }
      });
    });
  });
}