import svgPanZoom from "svg-pan-zoom";
import { getResolvedTheme } from "./theme.js";
import {
  defaultDiagramZoomAfterFit,
  diagramFitMetrics,
  diagramFitPaddingForTheme,
} from "./diagram-fit.js";

/** @type {typeof import('mermaid').default | null} */
let mermaidApi = null;
let mermaidBooted = false;
/** @type {"day" | "night" | null} */
let mermaidThemeBound = null;
/** @type {number | null} */
let mermaidFontBound = null;

const MERMAID_THEME_NIGHT = {
  darkMode: true,
  background: "transparent",
  primaryColor: "#1e3a5f",
  primaryTextColor: "#dbeafe",
  primaryBorderColor: "#60a5fa",
  secondaryColor: "#134e4a",
  secondaryTextColor: "#ccfbf1",
  secondaryBorderColor: "#2dd4bf",
  tertiaryColor: "#422006",
  tertiaryTextColor: "#ffedd5",
  tertiaryBorderColor: "#fb923c",
  lineColor: "#94a3b8",
  edgeLabelBackground: "#0f0f0f",
  textColor: "#f5f5f5",
  mainBkg: "#161616",
  nodeBorder: "#64748b",
  clusterBkg: "#0c0c0c",
  clusterBorder: "#3f3f46",
  titleColor: "#fafafa",
  actorBkg: "#1a1a1a",
  actorBorder: "#60a5fa",
  actorTextColor: "#f5f5f5",
  actorLineColor: "#52525b",
  signalColor: "#a1a1aa",
  signalTextColor: "#f5f5f5",
  labelBoxBkgColor: "#171717",
  labelBoxBorderColor: "#52525b",
  labelTextColor: "#e5e5e5",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: "11px",
};

const MERMAID_THEME_DAY = {
  darkMode: false,
  background: "transparent",
  primaryColor: "#dbeafe",
  primaryTextColor: "#1e3a8a",
  primaryBorderColor: "#2563eb",
  secondaryColor: "#ccfbf1",
  secondaryTextColor: "#134e4a",
  secondaryBorderColor: "#0d9488",
  tertiaryColor: "#ffedd5",
  tertiaryTextColor: "#9a3412",
  tertiaryBorderColor: "#ea580c",
  lineColor: "#64748b",
  edgeLabelBackground: "#f8fafc",
  textColor: "#18181b",
  mainBkg: "#f1f5f9",
  nodeBorder: "#64748b",
  clusterBkg: "#f8fafc",
  clusterBorder: "#cbd5e1",
  titleColor: "#18181b",
  actorBkg: "#f4f4f5",
  actorBorder: "#71717a",
  actorTextColor: "#18181b",
  actorLineColor: "#a1a1aa",
  signalColor: "#52525b",
  signalTextColor: "#18181b",
  labelBoxBkgColor: "#e4e4e7",
  labelBoxBorderColor: "#a1a1aa",
  labelTextColor: "#18181b",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: "11px",
};

const panZoomByWrap = new WeakMap();
/** @type {WeakMap<HTMLElement, () => void>} */
const umlFitByWrap = new WeakMap();
/** @type {WeakMap<HTMLElement, number>} */
const umlZoomByWrap = new WeakMap();

/** Match Overview · slices (cytoscape toolbar + wheel). */
export const DIAGRAM_ZOOM_STEP = 1.12;
export const DIAGRAM_ZOOM_MIN = 0.15;
/** Max scale for +/-, scroll, fit, and pan-zoom */
export const DIAGRAM_ZOOM_MAX = 48;
export const DIAGRAM_ZOOM_FIT_MAX = DIAGRAM_ZOOM_MAX;
/** @deprecated use diagramFitPaddingForTheme() */
export const DIAGRAM_FIT_PADDING = 52;

export {
  defaultDiagramZoomAfterFit,
  diagramFitMetrics,
  diagramFitPaddingForTheme,
} from "./diagram-fit.js";

/** @deprecated use diagramFitMetrics().postScale */
export const DIAGRAM_FIT_SCALE = 0.88;

/** @type {Map<string, HTMLElement>} */
const mermaidWrapByHostId = new Map();

/**
 * @param {string} hostId
 * @param {HTMLElement} wrap
 */
export function registerMermaidDiagramHost(hostId, wrap) {
  if (!hostId || !(wrap instanceof HTMLElement)) return;
  mermaidWrapByHostId.set(hostId, wrap);
}

/**
 * @param {string} hostId
 * @param {"in" | "out" | "fit"} action
 */
export function applyMermaidZoomByHostId(hostId, action) {
  let wrap = mermaidWrapByHostId.get(hostId);
  if (!wrap) {
    const anchor = document.getElementById(hostId);
    const candidate = anchor?.closest("[data-diagram-wrap]");
    if (candidate instanceof HTMLElement) {
      wrap = candidate;
      registerMermaidDiagramHost(hostId, wrap);
    }
  }
  if (!wrap) return false;

  const pz = panZoomByWrap.get(wrap);
  const svg = wrap.querySelector("svg");
  if (pz && svg instanceof SVGSVGElement) {
    if (action === "fit") {
      syncPanZoomViewport(wrap, { fit: true });
    } else if (action === "in") {
      syncPanZoomViewport(wrap);
      pz.zoom(clampDiagramZoom(pz.getZoom() * DIAGRAM_ZOOM_STEP));
    } else if (action === "out") {
      syncPanZoomViewport(wrap);
      pz.zoom(clampDiagramZoom(pz.getZoom() / DIAGRAM_ZOOM_STEP));
    }
    return true;
  }

  if (!umlFitByWrap.has(wrap)) return false;
  if (action === "in") nudgeDiagramZoom(wrap, "in");
  else if (action === "out") nudgeDiagramZoom(wrap, "out");
  else if (action === "fit") fitDiagramZoomToStage(wrap);
  return true;
}

/**
 * @param {number} z
 */
function clampDiagramZoom(z) {
  return Math.min(DIAGRAM_ZOOM_MAX, Math.max(DIAGRAM_ZOOM_MIN, z));
}

/**
 * @param {number} z
 */
function clampFitZoom(z) {
  return clampDiagramZoom(z);
}

/**
 * @param {HTMLElement} wrap
 * @param {"in" | "out"} dir
 */
function nudgeDiagramZoom(wrap, dir) {
  const current = umlZoomByWrap.get(wrap) ?? 1;
  const next =
    dir === "in" ? current * DIAGRAM_ZOOM_STEP : current / DIAGRAM_ZOOM_STEP;
  umlZoomByWrap.set(wrap, clampDiagramZoom(next));
  umlFitByWrap.get(wrap)?.();
}

/**
 * @param {HTMLElement} wrap
 */
/**
 * @param {SVGSVGElement} svg
 */
function readSvgNaturalSize(svg) {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { w: vb.width, h: vb.height };
  }
  const aw = svg.width?.baseVal?.value ?? 0;
  const ah = svg.height?.baseVal?.value ?? 0;
  if (aw > 8 && ah > 8) return { w: aw, h: ah };
  try {
    const bb = svg.getBBox();
    if (bb.width > 0 && bb.height > 0) {
      if (!svg.getAttribute("viewBox")) {
        svg.setAttribute("viewBox", `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
      }
      return { w: bb.width, h: bb.height };
    }
  } catch {
    /* SVG not laid out yet */
  }
  return { w: 0, h: 0 };
}

/**
 * @param {SVGSVGElement} svg
 */
function normalizeSequenceSvg(svg) {
  svg.style.maxWidth = "none";
  svg.style.height = "auto";
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const { w, h } = readSvgNaturalSize(svg);
  if (w > 0 && h > 0 && !svg.getAttribute("viewBox")) {
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
}

function fitDiagramZoomToStage(wrap) {
  const stage = wrap.querySelector(".diagram-complete-layout");
  const svg = wrap.querySelector("svg");
  if (!(stage instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
    umlZoomByWrap.set(wrap, 1);
    umlFitByWrap.get(wrap)?.();
    return;
  }
  const stageH = stage.clientHeight;
  if (stageH < 200 && stage.offsetParent !== null) {
    requestAnimationFrame(() => fitDiagramZoomToStage(wrap));
    return;
  }
  const { w: naturalW, h: naturalH } = readSvgNaturalSize(svg);
  if (naturalW < 8 || naturalH < 8) {
    umlZoomByWrap.set(wrap, 1);
  } else {
    const pad = diagramFitPaddingForTheme();
    const zoomW = (Math.max(stage.clientWidth - pad * 2, 200)) / naturalW;
    const zoomH = (Math.max(stage.clientHeight - pad * 2, 280)) / naturalH;
    const raw = Math.min(zoomW, zoomH);
  const capped = defaultDiagramZoomAfterFit(raw, getResolvedTheme());
    umlZoomByWrap.set(wrap, clampFitZoom(capped));
  }
  umlFitByWrap.get(wrap)?.();
}

/** @type {WeakSet<HTMLElement>} */
const wheelZoomByWrap = new WeakSet();

/**
 * @param {HTMLElement} wrap
 * @param {HTMLElement} stage
 */
function wireDiagramWheelZoom(wrap, stage) {
  if (wheelZoomByWrap.has(wrap)) return;
  wheelZoomByWrap.add(wrap);
  stage.addEventListener(
    "wheel",
    (e) => {
      if (!umlFitByWrap.has(wrap)) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / DIAGRAM_ZOOM_STEP : DIAGRAM_ZOOM_STEP;
      const next = clampDiagramZoom((umlZoomByWrap.get(wrap) ?? 1) * factor);
      umlZoomByWrap.set(wrap, next);
      umlFitByWrap.get(wrap)?.();
    },
    { passive: false }
  );
}

/** @type {WeakSet<HTMLElement>} */
const dragPanByStage = new WeakSet();

/**
 * Pointer-drag pan on scrollable diagram stages (like Cytoscape overview pan).
 * @param {HTMLElement} stage
 */
function wireDiagramDragPan(stage) {
  if (dragPanByStage.has(stage)) return;
  dragPanByStage.add(stage);

  let panning = false;
  let startX = 0;
  let startY = 0;
  let scrollLeft0 = 0;
  let scrollTop0 = 0;
  /** @type {number | null} */
  let pointerId = null;

  stage.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest("a, button, input, textarea")) return;
      panning = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      scrollLeft0 = stage.scrollLeft;
      scrollTop0 = stage.scrollTop;
      stage.classList.add("is-diagram-panning");
      stage.setPointerCapture(e.pointerId);
    },
    { passive: true }
  );

  stage.addEventListener(
    "pointermove",
    (e) => {
      if (!panning || pointerId !== e.pointerId) return;
      stage.scrollLeft = scrollLeft0 - (e.clientX - startX);
      stage.scrollTop = scrollTop0 - (e.clientY - startY);
    },
    { passive: true }
  );

  const endPan = (e) => {
    if (!panning || (pointerId !== null && e.pointerId !== pointerId)) return;
    panning = false;
    pointerId = null;
    stage.classList.remove("is-diagram-panning");
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
  };

  stage.addEventListener("pointerup", endPan);
  stage.addEventListener("pointercancel", endPan);
  stage.addEventListener("lostpointercapture", () => {
    panning = false;
    pointerId = null;
    stage.classList.remove("is-diagram-panning");
  });
}

function mermaidThemeVariables() {
  const theme = getResolvedTheme();
  const base = theme === "day" ? MERMAID_THEME_DAY : MERMAID_THEME_NIGHT;
  const { mermaidFontPx } = diagramFitMetrics(theme);
  return { ...base, fontSize: `${mermaidFontPx}px` };
}

export function invalidateMermaidTheme() {
  mermaidThemeBound = null;
  mermaidFontBound = null;
}

async function ensureMermaid() {
  const theme = getResolvedTheme();
  const { mermaidFontPx, flowNodeSpacing, flowRankSpacing } = diagramFitMetrics(theme);
  if (mermaidBooted && mermaidApi && mermaidThemeBound === theme && mermaidFontBound === mermaidFontPx) {
    return mermaidApi;
  }
  const mod = await import("mermaid");
  mermaidApi = mod.default;
  mermaidApi.initialize({
    startOnLoad: false,
    theme: "base",
    flowchart: {
      htmlLabels: false,
      useMaxWidth: true,
      padding: Math.round(14 + mermaidFontPx * 0.6),
      curve: "basis",
      nodeSpacing: flowNodeSpacing,
      rankSpacing: flowRankSpacing,
    },
    class: { useMaxWidth: true },
    sequence: {
      useMaxWidth: false,
      wrap: true,
      diagramMarginX: 28,
      diagramMarginY: 16,
      actorMargin: 48,
      messageMargin: 40,
      boxMargin: 8,
    },
    themeVariables: mermaidThemeVariables(),
    securityLevel: "loose",
  });
  mermaidBooted = true;
  mermaidThemeBound = theme;
  mermaidFontBound = mermaidFontPx;
  window.__cedarMermaid = mermaidApi;
  return mermaidApi;
}

/**
 * Re-render Mermaid diagrams after day/night theme switch.
 * @param {ParentNode} [root]
 */
export async function remountMermaidDiagrams(root = document) {
  invalidateMermaidTheme();
  const pres = root.querySelectorAll("[data-mermaid-source]");
  if (!pres.length) return;
  await Promise.all(
    [...pres].map(async (pre) => {
      if (!(pre instanceof HTMLElement)) return;
      const source = pre.dataset.mermaidSource;
      if (!source?.trim()) return;
      const ok = await renderArchitectureMermaid(source, pre);
      const wrap = pre.closest("[data-diagram-wrap]");
      if (ok && wrap instanceof HTMLElement) {
        const svg = pre.querySelector("svg");
        if (svg instanceof SVGSVGElement) {
          if (wrap.classList.contains("diagram-stage-panzoom")) mountDiagramPanViewport(wrap, pre);
          else queuePanFit(wrap, svg);
        }
      }
    }),
  );
  scheduleDiagramRefit(root);
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
  pre.dataset.mermaidSource = source;
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
    const head = graph.trimStart();
    const isClassDiagram = head.startsWith("classDiagram");
    const isSequenceDiagram = head.startsWith("sequenceDiagram");
    if (svgEl instanceof SVGSVGElement) {
      svgEl.style.display = "block";
      svgEl.style.height = "auto";
      svgEl.style.minHeight = "120px";
      svgEl.style.minWidth = "200px";
      svgEl.style.margin = "0";
      svgEl.style.maxWidth = "none";
      svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
      if (isSequenceDiagram) {
        normalizeSequenceSvg(svgEl);
      } else if (!isClassDiagram) {
        svgEl.style.marginInline = "auto";
      }
    }
    if (pre.classList.contains("cedar-file-flow-mermaid")) {
      pre.style.minHeight = "0";
      pre.style.height = "auto";
      if (svgEl instanceof SVGSVGElement) {
        svgEl.style.width = "100%";
        svgEl.style.maxWidth = "100%";
        svgEl.style.height = "auto";
        svgEl.style.maxHeight = "none";
        svgEl.setAttribute("preserveAspectRatio", "xMidYMin meet");
      }
      const stage = pre.closest(".cedar-file-flow-stage");
      if (stage instanceof HTMLElement) {
        stage.style.height = "auto";
        stage.dispatchEvent(new CustomEvent("cedar-file-flow-resize", { bubbles: true }));
      }
    } else {
      pre.style.minHeight = "12rem";
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
  await Promise.all(
    panels.map(async ({ key, sel }) => {
      const source = views[key];
      const pre = root.querySelector(sel);
      if (!pre || !source?.trim()) return;
      const ok = await renderArchitectureMermaid(source, pre);
      const wrap = pre.closest("[data-diagram-wrap]");
      const svg = pre.querySelector("svg");
      if (ok && wrap instanceof HTMLElement && svg instanceof SVGSVGElement) {
        mountDiagramPanViewport(wrap, pre);
        activateDiagramUx(wrap);
        drawn += 1;
      } else if (!ok && pre instanceof HTMLElement) {
        pre.classList.add("cedar-mermaid-fallback", "cedar-mermaid-fallback-visible");
      }
    })
  );
  requestAnimationFrame(() => refitPanZoomDiagrams(root));
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
/**
 * @param {HTMLElement} stage
 */
function measureStageInnerSize(stage) {
  const style = getComputedStyle(stage);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const w = Math.max(Math.floor(stage.clientWidth - padX), 120);
  const h = Math.max(Math.floor(stage.clientHeight - padY), 120);
  return { w, h, padLeft: parseFloat(style.paddingLeft), padTop: parseFloat(style.paddingTop) };
}

/**
 * svg-pan-zoom viewport must match the visible stage box (outer div minus padding).
 *
 * @param {HTMLElement} stage
 * @param {SVGSVGElement} svg
 */
function syncSvgPanLayer(stage, svg) {
  const { w, h } = measureStageInnerSize(stage);
  if (w < 8 || h < 8) return { w, h };
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.style.width = `${w}px`;
  svg.style.height = `${h}px`;
  svg.style.display = "block";
  svg.style.maxWidth = "none";
  svg.style.maxHeight = "none";
  svg.style.margin = "0";
  if (!svg.getAttribute("preserveAspectRatio")) {
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }
  return { w, h };
}

/**
 * @param {HTMLElement} stage
 * @param {HTMLElement} host
 */
function sizeDiagramStageHost(stage, host) {
  if (!(stage instanceof HTMLElement) || !(host instanceof HTMLElement)) {
    return { w: 0, h: 0 };
  }
  const { w, h, padLeft, padTop } = measureStageInnerSize(stage);

  if (getComputedStyle(stage).position === "static") {
    stage.style.position = "relative";
  }
  host.style.position = "absolute";
  host.style.inset = "auto";
  host.style.left = `${padLeft}px`;
  host.style.top = `${padTop}px`;
  host.style.width = `${w}px`;
  host.style.height = `${h}px`;
  host.style.minHeight = "0";
  host.style.minWidth = "0";
  host.style.maxWidth = "none";
  host.style.maxHeight = "none";
  host.style.boxSizing = "border-box";
  host.style.margin = "0";
  return { w, h };
}

/**
 * @param {HTMLElement} wrap
 * @param {{ fit?: boolean }} [opts]
 */
function syncPanZoomViewport(wrap, opts = {}) {
  const stage = wrap.querySelector(".diagram-complete-layout");
  const host = wrap.querySelector(".cedar-mermaid-source, .mermaid-rendered");
  const svg = wrap.querySelector("svg");
  const pz = panZoomByWrap.get(wrap);
  if (!(stage instanceof HTMLElement) || !(host instanceof HTMLElement) || !(svg instanceof SVGSVGElement) || !pz) {
    return;
  }
  const { w, h } = sizeDiagramStageHost(stage, host);
  if (w > 0 && h > 0) syncSvgPanLayer(stage, svg);
  pz.resize();
  if (opts.fit) {
    fitDiagramInStage(wrap, svg, pz, defaultFitOptsForWrap(wrap));
  }
}

/**
 * Default zoom-to-stage policy (theme padding + fill when maximized).
 * @param {HTMLElement} wrap
 */
function defaultFitOptsForWrap(wrap) {
  const maximized = wrap.classList.contains("is-diagram-maximized");
  return {
    fill: maximized,
    fillWidth: false,
    fillHeight: maximized,
    maxGrow: maximized ? 1.12 : 1,
    padding: diagramFitMetrics().padding,
    postScale: maximized ? Math.min(0.96, diagramFitMetrics().postScale + 0.06) : diagramFitMetrics().postScale,
  };
}

/**
 * After theme or layout changes, refit when the browser has applied new metrics.
 * @param {ParentNode} [root]
 */
export function scheduleDiagramRefit(root = document) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      refitPanZoomDiagrams(root);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cedar-diagram-stage-change", { detail: { root } }));
      }
    });
  });
}

function bindPanZoom(wrap, svg, opts = {}) {
  if (!(wrap instanceof HTMLElement)) return null;
  const prev = panZoomByWrap.get(wrap);
  if (prev) {
    try {
      prev.destroy();
    } catch {
      /* */
    }
  }
  const stage = wrap.querySelector(".diagram-complete-layout");
  const host = svg.parentElement;
  if (stage instanceof HTMLElement && host instanceof HTMLElement) {
    const { w, h } = sizeDiagramStageHost(stage, host);
    if (w > 0 && h > 0) syncSvgPanLayer(stage, svg);
  }
  try {
    const pz = svgPanZoom(svg, {
      zoomScaleSensitivity: 0.22,
      minZoom: DIAGRAM_ZOOM_MIN,
      maxZoom: DIAGRAM_ZOOM_MAX,
      fit: true,
      center: true,
      controlIconsEnabled: false,
      panEnabled: true,
      zoomEnabled: true,
      mouseWheelZoomEnabled: true,
      preventMouseEventsDefault: true,
    });
    panZoomByWrap.set(wrap, pz);
    fitDiagramInStage(wrap, svg, pz, {
      ...defaultFitOptsForWrap(wrap),
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
function wireDiagramStageResize(wrap, svg) {
  if (resizeObserverByWrap.has(wrap)) return;
  const stage = wrap.querySelector(".diagram-complete-layout");
  if (!(stage instanceof HTMLElement)) return;
  const ro = new ResizeObserver(() => {
    if (panZoomByWrap.has(wrap)) syncPanZoomViewport(wrap, { fit: true });
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
  const finishFit = () => {
    const maximized =
      opts.fill === true || wrap.classList.contains("is-diagram-maximized");
    const z = defaultDiagramZoomAfterFit(pz.getZoom(), getResolvedTheme(), { maximized });
    if (z > 0) {
      pz.zoom(z);
      pz.center();
    }
  };

  const stage = wrap.querySelector(".diagram-complete-layout");
  if (!(stage instanceof HTMLElement)) {
    pz.resize();
    pz.fit();
    pz.center();
    finishFit();
    return;
  }

  const host = svg.parentElement;
  if (host instanceof HTMLElement) {
    sizeDiagramStageHost(stage, host);
    syncSvgPanLayer(stage, svg);
  }
  pz.resize();
  pz.fit();
  pz.center();

  if (opts.fill) {
    const pad = (opts.padding ?? diagramFitPaddingForTheme()) / 2;
    const { w: stageW, h: stageH } = measureStageInnerSize(stage);
    const fitW = Math.max(stageW - pad, 120);
    const fitH = Math.max(stageH - pad, 120);
    const { w: svgW, h: svgH } = readSvgNaturalSize(svg);
    const laidW = svg.getBoundingClientRect().width || svgW;
    const laidH = svg.getBoundingClientRect().height || svgH;
    const boxW = laidW > 8 ? laidW : svgW;
    const boxH = laidH > 8 ? laidH : svgH;
    if (boxW >= 8 && boxH >= 8 && fitW >= 8 && fitH >= 8) {
      const growW = fitW / boxW;
      const growH = fitH / boxH;
      const maxGrow = opts.maxGrow ?? 1;
      const grow = opts.fillWidth
        ? Math.min(growW, maxGrow)
        : opts.fillHeight
          ? Math.min(growH, maxGrow)
          : Math.min(growW, growH, maxGrow, DIAGRAM_ZOOM_FIT_MAX);
      if (grow > 1.005) {
        pz.zoom(pz.getZoom() * grow);
        pz.center();
      }
    }
  }

  finishFit();
}

/**
 * Refit pan/zoom for every Complete layout panel after layout changes.
 * @param {ParentNode} root
 */
export function refitPanZoomDiagrams(root) {
  root.querySelectorAll("[data-diagram-wrap]").forEach((wrap) => {
    if (!(wrap instanceof HTMLElement)) return;
    if (umlFitByWrap.has(wrap)) {
      fitDiagramZoomToStage(wrap);
      return;
    }
    const pz = panZoomByWrap.get(wrap);
    const svg = wrap.querySelector("svg");
    if (pz && svg instanceof SVGSVGElement) {
      syncPanZoomViewport(wrap, { fit: true });
    }
  });
}

/**
 * @param {HTMLElement} wrap
 */
function teardownDiagramZoomMounts(wrap) {
  const pz = panZoomByWrap.get(wrap);
  if (pz) {
    try {
      pz.destroy();
    } catch {
      /* */
    }
    panZoomByWrap.delete(wrap);
  }
  umlFitByWrap.delete(wrap);
  umlZoomByWrap.delete(wrap);
  resizeObserverByWrap.delete(wrap);
}

/**
 * Complete layout Mermaid — fixed viewport pan/zoom (same feel as Overview · Cytoscape).
 * @param {HTMLElement} wrap
 * @param {HTMLElement} pre
 */
export function mountDiagramPanViewport(wrap, pre) {
  const stage = wrap.querySelector(".diagram-complete-layout");
  const svg = pre.querySelector("svg");
  if (!(stage instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) return;

  teardownDiagramZoomMounts(wrap);

  stage.classList.add("diagram-stage-panzoom");
  stage.classList.remove("diagram-stage-sequence");

  const layoutView = wrap.getAttribute("data-layout-view");
  if (layoutView === "events") {
    normalizeSequenceSvg(svg);
    stage.classList.add("diagram-stage-sequence");
  }

  pre.style.display = "block";
  pre.style.margin = "0";
  pre.style.minHeight = "0";

  svg.style.display = "block";
  svg.style.maxWidth = "none";
  svg.style.margin = "0";

  if (pre.id) registerMermaidDiagramHost(pre.id, wrap);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sizeDiagramStageHost(stage, pre);
      try {
        const pz = bindPanZoom(wrap, svg, { fillViewport: false, fillWidth: false });
        if (pz) wireDiagramStageResize(wrap, svg);
      } catch (err) {
        console.warn("[cedar] diagram pan/zoom mount failed", err);
      }
    });
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

  if (!umlZoomByWrap.has(wrap)) umlZoomByWrap.set(wrap, 1);

  const fit = () => {
    const pad = 12;
    const zoom = umlZoomByWrap.get(wrap) ?? 1;
    const stageW = Math.max(stage.clientWidth - pad * 2, 280) * zoom;
    if (stageW < 50) return;

    const vb = svg.viewBox?.baseVal;
    const naturalW = vb?.width > 0 ? vb.width : svg.width?.baseVal?.value || 0;
    const naturalH = vb?.height > 0 ? vb.height : svg.height?.baseVal?.value || 0;
    if (naturalW > 0 && naturalH > 0) {
      const scale = stageW / naturalW;
      const h = Math.max(Math.round(naturalH * scale), 120);
      svg.setAttribute("width", String(Math.round(stageW)));
      svg.setAttribute("height", String(h));
    } else {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
    }
    svg.style.width = "100%";
    svg.style.maxWidth = "none";
    svg.style.minHeight = "120px";
    svg.style.display = "block";
    svg.style.margin = "0";
    svg.style.visibility = "visible";
  };

  umlFitByWrap.set(wrap, fit);
  requestAnimationFrame(() => {
    requestAnimationFrame(fit);
  });

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
  const refitRoot =
    root.querySelector("#architecture-read-mermaid") ??
    (root instanceof HTMLElement && root.id === "architecture-read-mermaid" ? root : root);

  root.querySelectorAll("[data-diagram-wrap]").forEach((wrap) => {
    const bar = wrap.querySelector("[data-diagram-toolbar]");
    if (!bar || bar.dataset.wired) return;
    bar.dataset.wired = "1";

    bar.querySelectorAll("[data-diagram-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const layoutHost =
          wrap.closest("#architecture-read") ??
          wrap.closest("#architecture-read-mermaid, .cedar-complete-layout-views");
        const action = btn.getAttribute("data-diagram-action");

        if (action === "collapse") {
          const collapsed = wrap.classList.toggle("is-diagram-collapsed");
          const canvas = wrap.querySelector(".diagram-stage-canvas");
          if (canvas instanceof HTMLElement) canvas.hidden = collapsed;
          btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
          btn.textContent = collapsed ? "▸" : "▾";
          scheduleDiagramRefit(refitRoot);
          return;
        }

        if (action === "maximize") {
          const on = wrap.classList.toggle("is-diagram-maximized");
          btn.setAttribute("aria-pressed", on ? "true" : "false");
          if (layoutHost instanceof HTMLElement) {
            layoutHost.classList.toggle("has-maximized-panel", on);
            layoutHost.querySelectorAll("[data-diagram-wrap]").forEach((peer) => {
              if (!(peer instanceof HTMLElement) || peer === wrap) return;
              peer.classList.toggle("is-diagram-minimized", on);
            });
          }
          if (!on && layoutHost instanceof HTMLElement) {
            const anyMax = layoutHost.querySelector(".is-diagram-maximized");
            if (!anyMax) layoutHost.classList.remove("has-maximized-panel");
            layoutHost.querySelectorAll(".is-diagram-minimized").forEach((el) => {
              el.classList.remove("is-diagram-minimized");
            });
          }
          scheduleDiagramRefit(refitRoot);
          return;
        }

      });
    });
  });
}