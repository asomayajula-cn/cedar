import svgPanZoom from "svg-pan-zoom";
import { renderArchitectureMermaid } from "./diagram-ux.js";
import { getResolvedTheme } from "./theme.js";
import { codeMapFitMetrics, defaultDiagramZoomAfterFit } from "./diagram-fit.js";
import {
  mountCodeMapCy,
  unmountCodeMapCy,
  getCodeMapCyApi,
} from "./code-map-cytoscape-mount.js";
import { enrichFlyoutArtifact } from "./code-map-flyout-enrich.js";
import { unmountCodeMapXyflow } from "./code-map-xyflow-mount.jsx";

/** @param {object[]} elements */
function countCodeMapCyNodes(elements) {
  return elements.filter((e) => e?.data && !Object.hasOwn(e.data, "source")).length;
}

/**
 * Graphviz (@viz-js/viz) precomputes non-overlapping layout on the server.
 * @param {{ elements?: object[], svg?: string }} artifact
 */
function preferServerGraphvizLayout(artifact) {
  const nodes = countCodeMapCyNodes(artifact.elements ?? []);
  return nodes >= 110 && Boolean(artifact.svg?.trim());
}

/** @type {ReturnType<import("./code-map-cytoscape-mount.js").createCodeMapCyControlApi> | null} */
let activeCyApi = null;
/** @type {ResizeObserver | null} */
let activeResizeObserver = null;
/** @type {ReturnType<typeof svgPanZoom> | null} */
let activePanZoom = null;

/** @type {WeakMap<HTMLElement, ReturnType<import("./code-map-cytoscape-mount.js").createCodeMapCyControlApi>>} */
const cyByHost = new WeakMap();

/** @type {WeakMap<HTMLElement, ReturnType<typeof svgPanZoom>>} */
const pzByHost = new WeakMap();

/** Minimum drawable height for the code-map viewport (px). */
const CODE_MAP_MIN_STAGE_H = 520;

/** @type {WeakMap<HTMLElement, () => void>} */
const reflowHandlerByStage = new WeakMap();

/** @type {WeakMap<HTMLElement, { w: number, h: number }>} */
const lastFitSizeByStage = new WeakMap();

/** @type {WeakMap<HTMLElement, Map<string, { elements: object[], rankdir: string, panel: HTMLElement, host: HTMLElement, mounted: boolean }>>} */
const triptychViewJobs = new WeakMap();

/**
 * @param {HTMLElement} stage
 * @param {HTMLElement} host
 */
function stageHostSizeChanged(stage, host) {
  const rect = host.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const prev = lastFitSizeByStage.get(stage);
  if (!prev) {
    lastFitSizeByStage.set(stage, { w, h });
    return true;
  }
  const changed = Math.abs(prev.w - w) > 10 || Math.abs(prev.h - h) > 10;
  if (changed) lastFitSizeByStage.set(stage, { w, h });
  return changed;
}

/**
 * @param {HTMLElement} stage
 */
function destroyStage(stage) {
  activeResizeObserver?.disconnect();
  activeResizeObserver = null;
  const reflow = reflowHandlerByStage.get(stage);
  if (reflow) {
    stage.removeEventListener("cedar-file-flow-resize", reflow);
    reflowHandlerByStage.delete(stage);
  }
  try {
    activePanZoom?.destroy();
  } catch {
    /* */
  }
  activePanZoom = null;
  activeCyApi = null;
  for (const host of stage.querySelectorAll(
    ".cedar-code-map-cy, .cedar-code-map-xyflow, .cedar-code-map-svg-host"
  )) {
    if (host instanceof HTMLElement) {
      unmountCodeMapCy(host);
      unmountCodeMapXyflow(host);
      cyByHost.delete(host);
      pzByHost.delete(host);
    }
  }
  stage.classList.remove("is-code-map-active", "is-code-map-triptych");
  delete stage.dataset.cedarActiveCodeMapView;
  triptychViewJobs.delete(stage);
  hideCodeMapViewTabBar();
  stage.style.position = "";
  stage.style.minHeight = "";
  lastFitSizeByStage.delete(stage);
  delete stage.dataset.cedarMapUserZoomed;
  delete stage.dataset.cedarMapNeedsFlyoutFit;
  delete /** @type {any} */ (stage).cedarMapEngines;
  stage.replaceChildren();
}

/**
 * @param {HTMLElement} stage
 */
function measureStageInner(stage) {
  const style = getComputedStyle(stage);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  let w = Math.max(Math.floor(stage.clientWidth - padX), 200);
  let h = Math.max(Math.floor(stage.clientHeight - padY), 0);

  const rail = stage.closest(".cedar-file-flow-rail");
  if (rail instanceof HTMLElement && h < CODE_MAP_MIN_STAGE_H - 48) {
    const railStyle = getComputedStyle(rail);
    const gap = parseFloat(railStyle.rowGap || railStyle.gap) || 0;
    let overhead = padY;
    for (const child of rail.children) {
      if (child === stage) continue;
      overhead += child.getBoundingClientRect().height + gap;
    }
    overhead += parseFloat(railStyle.paddingTop) + parseFloat(railStyle.paddingBottom);
    const railH = rail.clientHeight;
    if (railH > 0) h = Math.max(h, Math.floor(railH - overhead - 4));
  }

  const nav = stage.closest(".cedar-review-right-nav");
  if (nav instanceof HTMLElement && nav.clientHeight < 80) {
    const est = Math.max(320, Math.floor(window.innerHeight - nav.getBoundingClientRect().top - 16));
    if (est > h) h = est;
  }
  if (nav instanceof HTMLElement && h < CODE_MAP_MIN_STAGE_H - 48) {
    const navStyle = getComputedStyle(nav);
    let overhead = parseFloat(navStyle.paddingTop) + parseFloat(navStyle.paddingBottom);
    for (const child of nav.children) {
      if (child.contains(stage)) break;
      overhead += child.getBoundingClientRect().height;
    }
    const card = stage.closest(".cedar-file-flow-rail");
    if (card instanceof HTMLElement) {
      const cardStyle = getComputedStyle(card);
      overhead += parseFloat(cardStyle.paddingTop) + parseFloat(cardStyle.paddingBottom);
      for (const c of card.children) {
        if (c !== stage) overhead += c.getBoundingClientRect().height;
      }
    }
    const navH = nav.clientHeight;
    if (navH > 0) h = Math.max(h, Math.floor(navH - overhead - 8));
  }

  h = Math.max(h, CODE_MAP_MIN_STAGE_H);
  w = Math.max(w, 220);
  return {
    w,
    h,
    padLeft: parseFloat(style.paddingLeft),
    padTop: parseFloat(style.paddingTop),
    padY,
  };
}

/**
 * @param {HTMLElement} stage
 * @param {HTMLElement} host
 */
/** @type {Record<string, string>} */
const CODE_MAP_VIEW_LABELS = {
  structure: "Structure",
  behavior: "Behavior",
  functionality: "Functionality",
};

const CODE_MAP_VIEW_ORDER = /** @type {const} */ (["structure", "behavior", "functionality"]);

/**
 * @param {string} activeKey
 */
function syncCodeMapViewTabButtons(activeKey) {
  for (const btn of document.querySelectorAll("[data-code-map-view-tab]")) {
    if (!(btn instanceof HTMLElement)) continue;
    const tabKey = btn.getAttribute("data-code-map-view-tab") ?? "";
    const on = tabKey === activeKey;
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.setAttribute("tabindex", on ? "0" : "-1");
    btn.classList.toggle("is-active", on);
  }
}

/** @param {string[]} viewKeys @param {string} activeKey */
function renderCodeMapViewTabBar(viewKeys, activeKey) {
  const bar = document.getElementById("cedar-code-map-view-tablist");
  if (!(bar instanceof HTMLElement)) return;
  if (!viewKeys.length) {
    bar.hidden = true;
    bar.replaceChildren();
    return;
  }
  bar.hidden = false;
  bar.replaceChildren();
  for (const viewKey of viewKeys) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cedar-code-map-view-tab";
    btn.dataset.codeMapViewTab = viewKey;
    btn.setAttribute("data-code-map-view-tab", viewKey);
    btn.setAttribute("role", "tab");
    btn.id = `cedar-code-map-tab-${viewKey}`;
    const on = viewKey === activeKey;
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.setAttribute("tabindex", on ? "0" : "-1");
    btn.setAttribute("aria-controls", `cedar-code-map-panel-${viewKey}`);
    if (on) btn.classList.add("is-active");
    btn.textContent = CODE_MAP_VIEW_LABELS[viewKey] ?? viewKey;
    bar.appendChild(btn);
  }
}

function hideCodeMapViewTabBar() {
  const bar = document.getElementById("cedar-code-map-view-tablist");
  if (bar instanceof HTMLElement) {
    bar.hidden = true;
    bar.replaceChildren();
  }
}

/**
 * @param {HTMLElement} stage
 */
function getActiveCodeMapViewKey(stage) {
  return stage.dataset.cedarActiveCodeMapView ?? "structure";
}

/**
 * @param {HTMLElement} stage
 */
function activeCodeMapViewPanel(stage) {
  const key = getActiveCodeMapViewKey(stage);
  const panel = stage.querySelector(`.cedar-code-map-view-stage[data-code-map-view="${key}"]`);
  return panel instanceof HTMLElement ? panel : null;
}

/**
 * Cytoscape control API for a specific flyout host (never another tab’s graph).
 * @param {HTMLElement} host
 */
function codeMapCyApiForHost(host) {
  if (!(host instanceof HTMLElement)) return null;
  return cyByHost.get(host) ?? getCodeMapCyApi(host) ?? null;
}

/**
 * @param {HTMLElement} stage
 */
function activeCodeMapCyHost(stage) {
  const panel = activeCodeMapViewPanel(stage);
  const host = panel?.querySelector(".cedar-code-map-cy");
  if (host instanceof HTMLElement) return host;
  return stage.querySelector(
    ".cedar-code-map-view-stage:not([hidden]) .cedar-code-map-cy, .cedar-code-map-cy"
  );
}

/**
 * @param {HTMLElement} stage
 */
function syncActiveCodeMapEngine(stage) {
  const host = activeCodeMapCyHost(stage);
  const api = host instanceof HTMLElement ? codeMapCyApiForHost(host) : null;
  activeCyApi = api;
  if (api) setStageMapEngines(stage, { cy: api });
  return api;
}

/**
 * @param {HTMLElement} panel
 * @param {HTMLElement} host
 */
function layoutViewPanelHost(panel, host) {
  if (getComputedStyle(panel).position === "static") {
    panel.style.position = "relative";
  }
  panel.style.minHeight = "0";
  const w = Math.max(panel.clientWidth, 220);
  const h = Math.max(panel.clientHeight, 200);
  host.style.position = "absolute";
  host.style.top = "0";
  host.style.right = "0";
  host.style.bottom = "0";
  host.style.left = "0";
  host.style.width = "auto";
  host.style.height = "100%";
  host.style.marginLeft = "10px";
  host.style.marginRight = "4px";
  host.style.minWidth = `${w}px`;
  host.style.minHeight = `${h}px`;
  host.style.boxSizing = "border-box";
  host.style.overflow = "hidden";
  return { w, h };
}

/**
 * @param {HTMLElement} stage
 */
export function switchCodeMapFlyoutView(view) {
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement)) return;
  const allowed = new Set(["structure", "behavior", "functionality"]);
  const key = allowed.has(view) ? view : "structure";
  const sameTab = stage.dataset.cedarActiveCodeMapView === key;
  stage.dataset.cedarActiveCodeMapView = key;
  for (const panel of stage.querySelectorAll(".cedar-code-map-view-stage")) {
    if (!(panel instanceof HTMLElement)) continue;
    const on = panel.dataset.codeMapView === key;
    panel.hidden = !on;
    panel.classList.toggle("is-active", on);
    if (on) panel.setAttribute("tabindex", "0");
    else panel.removeAttribute("tabindex");
  }
  syncCodeMapViewTabButtons(key);

  const finishSwitch = () => {
    const panel2 = activeCodeMapViewPanel(stage);
    const host2 = panel2?.querySelector(".cedar-code-map-cy");
    syncActiveCodeMapEngine(stage);
    if (panel2 instanceof HTMLElement && host2 instanceof HTMLElement) {
      layoutViewPanelHost(panel2, host2);
      const rect = host2.getBoundingClientRect();
      if (rect.width >= 8 && rect.height >= 8) {
        fitCodeMapCy(stage, host2);
      } else {
        requestAnimationFrame(() => {
          layoutViewPanelHost(panel2, host2);
          fitCodeMapCy(stage, host2);
        });
      }
    }
    delete stage.dataset.cedarMapTabSwitching;
  };

  if (sameTab) {
    finishSwitch();
    return;
  }

  const jobs = triptychViewJobs.get(stage);
  const job = jobs?.get(key);
  const needsRemount =
    job?.mounted &&
    job.host instanceof HTMLElement &&
    job.host.getBoundingClientRect().width < 8;
  if (needsRemount && job) {
    job.mounted = false;
    unmountCodeMapCy(job.host);
    cyByHost.delete(job.host);
  }

  const needsMount = job && !job.mounted;
  if (needsMount) {
    stage.dataset.cedarMapTabSwitching = "1";
    requestAnimationFrame(() => {
      ensureCodeMapViewMounted(stage, key);
      requestAnimationFrame(finishSwitch);
    });
    return;
  }

  ensureCodeMapViewMounted(stage, key);
  finishSwitch();
}

/**
 * @param {HTMLElement} stage
 * @param {string} viewKey
 */
function ensureCodeMapViewMounted(stage, viewKey) {
  const jobs = triptychViewJobs.get(stage);
  const job = jobs?.get(viewKey);
  if (!job) return;

  const panelHidden =
    job.panel.hidden ||
    job.panel.getAttribute("hidden") !== null ||
    getComputedStyle(job.panel).display === "none";
  if (panelHidden && viewKey !== getActiveCodeMapViewKey(stage)) {
    return;
  }

  const registerJobCy = (api) => {
    if (!api) return;
    cyByHost.set(job.host, api);
    if (getActiveCodeMapViewKey(stage) === viewKey) {
      activeCyApi = api;
      setStageMapEngines(stage, { cy: api });
    }
  };

  if (job.mounted) {
    const api = codeMapCyApiForHost(job.host);
    registerJobCy(api);
    layoutViewPanelHost(job.panel, job.host);
    api?.resize?.();
    return;
  }

  layoutViewPanelHost(job.panel, job.host);
  const mounted = mountCodeMapCy(job.host, {
    elements: job.elements,
    rankdir: job.rankdir,
    viewKey,
    onReady: (api) => {
      registerJobCy(api);
      layoutViewPanelHost(job.panel, job.host);
      fitCodeMapCy(stage, job.host);
      if (getActiveCodeMapViewKey(stage) === viewKey) {
        syncActiveCodeMapEngine(stage);
      }
    },
  });
  job.mounted = Boolean(mounted);
  if (mounted) {
    registerJobCy(codeMapCyApiForHost(job.host));
  }
}

function activateCodeMapViewFromTabButton(btn) {
  const view = btn.getAttribute("data-code-map-view-tab");
  if (!view) return;
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement) || !stage.classList.contains("is-code-map-triptych")) return;
  delete stage.dataset.cedarMapUserZoomed;
  lastFitSizeByStage.delete(stage);
  switchCodeMapFlyoutView(view);
}

export function wireCodeMapTriptychTabs() {
  if (document.documentElement.dataset.cedarTriptychTabsWired === "1") return;
  document.documentElement.dataset.cedarTriptychTabsWired = "1";

  document.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("[data-code-map-view-tab]") : null;
    if (!(btn instanceof HTMLButtonElement)) return;
    e.preventDefault();
    activateCodeMapViewFromTabButton(btn);
  });

  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const bar = t.closest("#cedar-code-map-view-tablist, .cedar-code-map-view-tabs");
    if (!(bar instanceof HTMLElement) || bar.hidden) return;
    const tabs = [...bar.querySelectorAll("[data-code-map-view-tab]")].filter(
      (b) => b instanceof HTMLButtonElement
    );
    if (!tabs.length) return;
    const current = tabs.findIndex((b) => b === t || b.contains(t));
    const idx = current >= 0 ? current : tabs.findIndex((b) => b.getAttribute("aria-selected") === "true");
    if (idx < 0) return;

    const focusTab = (i) => {
      const next = tabs[Math.max(0, Math.min(tabs.length - 1, i))];
      if (!(next instanceof HTMLButtonElement)) return;
      next.focus();
      activateCodeMapViewFromTabButton(next);
    };

    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      focusTab((idx + delta + tabs.length) % tabs.length);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusTab(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusTab(tabs.length - 1);
    }
  });
}

function layoutCodeMapViewport(stage, host) {
  const { w, h, padLeft, padTop, padY } = measureStageInner(stage);
  if (getComputedStyle(stage).position === "static") {
    stage.style.position = "relative";
  }
  stage.style.minHeight = `${h + padY}px`;
  host.style.position = "absolute";
  host.style.left = `${padLeft}px`;
  host.style.top = `${padTop}px`;
  host.style.width = `${w}px`;
  host.style.height = `${h}px`;
  host.style.minWidth = `${w}px`;
  host.style.minHeight = `${h}px`;
  host.style.maxWidth = "none";
  host.style.maxHeight = "none";
  host.style.boxSizing = "border-box";
  host.style.margin = "0";
  host.style.overflow = "hidden";
  return { w, h };
}

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
    /* */
  }
  return { w: 0, h: 0 };
}

/**
 * @param {HTMLElement} stage
 * @param {SVGSVGElement} svg
 * @param {{ w: number, h: number }} size
 */
function syncCodeMapSvgViewport(stage, svg, size) {
  svg.setAttribute("width", String(size.w));
  svg.setAttribute("height", String(size.h));
  svg.style.width = `${size.w}px`;
  svg.style.height = `${size.h}px`;
  svg.style.display = "block";
  svg.style.maxWidth = "none";
  svg.style.maxHeight = "none";
  svg.style.margin = "0";
  if (!svg.getAttribute("preserveAspectRatio")) {
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }
}

/**
 * @param {HTMLElement} stage
 * @param {HTMLElement} host
 * @param {SVGSVGElement} svg
 * @param {ReturnType<typeof svgPanZoom>} pz
 */
function userAdjustedCodeMapZoom(stage) {
  return stage instanceof HTMLElement && stage.dataset.cedarMapUserZoomed === "1";
}

function markCodeMapUserZoom(stage) {
  if (stage instanceof HTMLElement) stage.dataset.cedarMapUserZoomed = "1";
}

function fitCodeMapSvg(stage, host, svg, pz) {
  const size = layoutCodeMapViewport(stage, host);
  syncCodeMapSvgViewport(stage, svg, size);
  const shouldRefit = stageHostSizeChanged(stage, host);
  pz.resize();
  if (!shouldRefit || userAdjustedCodeMapZoom(stage)) return;

  pz.fit();
  pz.center();

  const theme = getResolvedTheme();
  const z = defaultDiagramZoomAfterFit(pz.getZoom(), theme, { variant: "code-map" });
  if (z > 0) {
    pz.zoom(z);
    pz.center();
  }
}

/**
 * @param {HTMLElement} stage
 * @param {HTMLElement} host
 * @param {SVGSVGElement} svg
 * @param {ReturnType<typeof svgPanZoom>} pz
 */
function wireCodeMapSvgResize(stage, host, svg, pz) {
  activeResizeObserver?.disconnect();
  const rail = stage.closest(".cedar-file-flow-rail");
  const nav = stage.closest(".cedar-review-right-nav");
  const layout = stage.closest(".cedar-review-layout--three-col");
  const ro = new ResizeObserver(() => {
    fitCodeMapSvg(stage, host, svg, pz);
  });
  ro.observe(stage);
  if (rail instanceof HTMLElement) ro.observe(rail);
  if (nav instanceof HTMLElement) ro.observe(nav);
  if (layout instanceof HTMLElement) ro.observe(layout);
  activeResizeObserver = ro;
  const reflow = () => fitCodeMapSvg(stage, host, svg, pz);
  reflowHandlerByStage.set(stage, reflow);
  stage.addEventListener("cedar-file-flow-resize", reflow);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => fitCodeMapSvg(stage, host, svg, pz));
  });
}

/**
 * @param {HTMLElement} stage
 * @param {HTMLElement} host
 */
function fitCodeMapCy(stage, host) {
  const flyoutStage = host.closest("#cedar-file-flow-stage");
  const panel = host.closest(".cedar-code-map-view-stage");
  if (panel instanceof HTMLElement && flyoutStage instanceof HTMLElement) {
    layoutViewPanelHost(panel, host);
    stage = flyoutStage;
  } else {
    layoutCodeMapViewport(stage, host);
  }
  const api = cyByHost.get(host) ?? activeCyApi;
  if (!api) return;
  const sizeHost = panel instanceof HTMLElement ? panel : host;
  if (!stageHostSizeChanged(stage, sizeHost) || userAdjustedCodeMapZoom(stage)) {
    api.resize?.();
    return;
  }
  api.fitView?.();
}

/**
 * @param {HTMLElement} stage
 * @param {HTMLElement} host
 */
function wireCodeMapCyResize(stage, host) {
  activeResizeObserver?.disconnect();
  const rail = stage.closest(".cedar-file-flow-rail");
  const nav = stage.closest(".cedar-review-right-nav");
  const layout = stage.closest(".cedar-review-layout--three-col");
  const ro = new ResizeObserver(() => {
    fitCodeMapCy(stage, host);
  });
  ro.observe(stage);
  if (rail instanceof HTMLElement) ro.observe(rail);
  if (nav instanceof HTMLElement) ro.observe(nav);
  if (layout instanceof HTMLElement) ro.observe(layout);
  activeResizeObserver = ro;
  const reflow = () => fitCodeMapCy(stage, host);
  reflowHandlerByStage.set(stage, reflow);
  stage.addEventListener("cedar-file-flow-resize", reflow);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => fitCodeMapCy(stage, host));
  });
}

/**
 * @param {HTMLElement} stage
 */
function getStageMapEngines(stage) {
  return /** @type {{ cy?: ReturnType<import("./code-map-cytoscape-mount.js").createCodeMapCyControlApi>, pz?: ReturnType<typeof svgPanZoom> } | undefined} */ (
    /** @type {any} */ (stage).cedarMapEngines
  );
}

/**
 * @param {HTMLElement} stage
 * @param {{ cy?: ReturnType<import("./code-map-cytoscape-mount.js").createCodeMapCyControlApi>, pz?: ReturnType<typeof svgPanZoom> }} engines
 */
function setStageMapEngines(stage, engines) {
  /** @type {any} */ (stage).cedarMapEngines = engines;
}

/**
 * @param {WheelEvent} e
 */
function wheelDeltaY(e) {
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  else if (e.deltaMode === 2) dy *= window.innerHeight;
  return dy;
}

/**
 * @param {HTMLElement} stage
 */
function resolveEnginesFromDom(stage) {
  const resolvedCyHost = activeCodeMapCyHost(stage);
  if (resolvedCyHost instanceof HTMLElement) {
    const cy = codeMapCyApiForHost(resolvedCyHost);
    if (cy) return { cy, pz: null, host: resolvedCyHost, wrap: null };
  }
  const wrap = stage.querySelector(".cedar-code-map-svg-host");
  if (wrap instanceof HTMLElement) {
    const pz =
      /** @type {any} */ (wrap).__cedarPz ?? pzByHost.get(wrap) ?? activePanZoom ?? null;
    if (pz) return { cy: null, pz, host: null, wrap };
  }
  return {
    cy: null,
    pz: null,
    host: resolvedCyHost instanceof HTMLElement ? resolvedCyHost : null,
    wrap: wrap instanceof HTMLElement ? wrap : null,
  };
}

/**
 * @param {WheelEvent} e
 * @param {HTMLElement} stage
 */
function applyCodeMapWheelZoom(e, stage) {
  const viewKey = getActiveCodeMapViewKey(stage);
  if (stage.classList.contains("is-code-map-triptych") && viewKey) {
    ensureCodeMapViewMounted(stage, viewKey);
    syncActiveCodeMapEngine(stage);
  }

  const { cy, pz, host, wrap } = resolveEnginesFromDom(stage);
  if (!cy && !pz) return false;

  e.preventDefault();
  e.stopImmediatePropagation();
  const dy = wheelDeltaY(e);
  const factor = Math.exp(-dy * 0.0025);

  if (host instanceof HTMLElement) {
    const engine = codeMapCyApiForHost(host);
    if (engine?.zoomBy) {
      const rect = host.getBoundingClientRect();
      engine.zoomBy(factor, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      activeCyApi = engine;
      setStageMapEngines(stage, { cy: engine });
      markCodeMapUserZoom(stage);
      return true;
    }
  }

  if (pz && wrap instanceof HTMLElement) {
    const next = Math.min(10, Math.max(0.05, pz.getZoom() * factor));
    const ox = e.clientX - wrap.getBoundingClientRect().left;
    const oy = e.clientY - wrap.getBoundingClientRect().top;
    if (typeof pz.zoomAtPoint === "function") {
      pz.zoomAtPoint(next, { x: ox, y: oy });
    } else {
      pz.zoom(next);
    }
    setStageMapEngines(stage, { pz });
    markCodeMapUserZoom(stage);
    return true;
  }

  return false;
}

/**
 * @param {HTMLElement} stage
 */
export function wireCodeMapFlyoutWheel(_stage) {
  if (document.documentElement.dataset.cedarCodeMapFlyoutWheel === "1") return;
  document.documentElement.dataset.cedarCodeMapFlyoutWheel = "1";

  document.addEventListener(
    "wheel",
    (e) => {
      handleCodeMapFlyoutWheel(e);
    },
    { passive: false, capture: true }
  );
}

/**
 * Wheel over flyout map area (pointer position — not only event target).
 * @param {WheelEvent} e
 */
export function isCodeMapFlyoutWheelTarget(e) {
  if (!document.body.classList.contains("cedar-code-map-expanded")) return false;
  const panel = document.getElementById("cedar-review-right-nav");
  if (!(panel instanceof HTMLElement)) return false;
  if (getComputedStyle(panel).display === "none") return false;
  const pr = panel.getBoundingClientRect();
  if (pr.width < 8 || pr.height < 8) return false;
  if (e.clientX < pr.left || e.clientX > pr.right || e.clientY < pr.top || e.clientY > pr.bottom) {
    return false;
  }
  const stage = document.getElementById("cedar-file-flow-stage");
  const activeKey =
    stage instanceof HTMLElement ? stage.dataset.cedarActiveCodeMapView ?? "structure" : "structure";
  const cySurface =
    stage?.querySelector(
      `.cedar-code-map-view-stage[data-code-map-view="${activeKey}"] .cedar-code-map-cy`
    ) ??
    panel.querySelector(".cedar-code-map-cy, .cedar-code-map-svg-host");
  if (cySurface instanceof HTMLElement) {
    const sr = cySurface.getBoundingClientRect();
  if (sr.width < 8 || sr.height < 8) return false;
    if (e.clientX < sr.left || e.clientX > sr.right || e.clientY < sr.top || e.clientY > sr.bottom) {
      return false;
    }
  }
  const meta = panel.querySelector(".cedar-code-map-meta");
  if (meta instanceof HTMLElement) {
    const mr = meta.getBoundingClientRect();
    if (
      e.clientX >= mr.left &&
      e.clientX <= mr.right &&
      e.clientY >= mr.top &&
      e.clientY <= mr.bottom
    ) {
      return false;
    }
  }
  return true;
}

/**
 * @param {HTMLElement} stage
 * @param {{ svg?: string, mermaid?: string, elements?: object[], whatItDoes?: string }} artifact
 */
/**
 * @param {HTMLElement} stage
 * @param {{ svg?: string }} artifact
 */
async function mountCodeMapSvgStage(stage, artifact) {
  if (!artifact.svg?.trim()) return false;
  const wrap = document.createElement("div");
  wrap.className = "cedar-code-map-svg-host";
  wrap.dataset.codeMapLayout = "graphviz";
  wrap.innerHTML = artifact.svg;
  stage.appendChild(wrap);
  const svg = wrap.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) return false;
  svg.classList.add("cedar-code-map-svg");
  layoutCodeMapViewport(stage, wrap);
  syncCodeMapSvgViewport(stage, svg, measureStageInner(stage));
  try {
    const pz = svgPanZoom(svg, {
      zoomScaleSensitivity: 0.35,
      maxZoom: 10,
      minZoom: 0.05,
      fit: true,
      center: true,
      controlIconsEnabled: false,
      panEnabled: true,
      zoomEnabled: true,
      mouseWheelZoomEnabled: false,
      preventMouseEventsDefault: true,
    });
    activePanZoom = pz;
    /** @type {any} */ (wrap).__cedarPz = pz;
    pzByHost.set(wrap, pz);
    setStageMapEngines(stage, { pz });
    if (!document.body.classList.contains("cedar-code-map-expanded")) {
      stage.dataset.cedarMapNeedsFlyoutFit = "1";
    }
    wireCodeMapFlyoutWheel(stage);
    wireCodeMapSvgResize(stage, wrap, svg, pz);
  } catch (err) {
    console.warn("[cedar] code map pan/zoom failed, showing static svg", err);
    wrap.style.position = "relative";
    wrap.style.overflow = "auto";
    wrap.style.inset = "auto";
    wrap.style.width = "100%";
    wrap.style.height = "auto";
    wrap.style.minHeight = `${CODE_MAP_MIN_STAGE_H}px`;
    svg.style.width = "100%";
    svg.style.height = "auto";
  }
  return true;
}

/**
 * @param {HTMLElement} stage
 * @param {object} artifact
 * @param {string} [filePath]
 */
export async function mountFileCodeMap(stage, artifact, filePath = "") {
  if (!(stage instanceof HTMLElement) || !artifact) {
    destroyStage(stage);
    return false;
  }

  destroyStage(stage);
  stage.classList.add("is-code-map-active");
  wireCodeMapStageInteraction(stage);

  const enriched = enrichFlyoutArtifact(artifact);
  const structureEls = enriched.elements ?? [];
  const behaviorEls = enriched.behaviorElements ?? [];
  const functionalityEls = enriched.functionalityElements ?? [];

  if (structureEls.length || behaviorEls.length || functionalityEls.length) {
    stage.classList.add("is-code-map-triptych");
    stage.dataset.cedarActiveCodeMapView = getActiveCodeMapViewKey(stage);

    const stack = document.createElement("div");
    stack.className = "cedar-code-map-view-stack";

    const views = /** @type {const} */ ([
      ["structure", structureEls, artifact?.layout?.rankdir === "LR" ? "LR" : "TB"],
      ["behavior", behaviorEls, "LR"],
      ["functionality", functionalityEls, "TB"],
    ]);

    const activeKey = getActiveCodeMapViewKey(stage);
    const allowedActive = CODE_MAP_VIEW_ORDER.includes(/** @type {any} */ (activeKey))
      ? activeKey
      : "structure";
    /** @type {Map<string, { elements: object[], rankdir: string, panel: HTMLElement, host: HTMLElement, mounted: boolean }>} */
    const jobs = new Map();
    /** @type {string[]} */
    const tabKeys = [];

    for (const [viewKey, rawElements, rankdir] of views) {
      if (viewKey === "structure" && !rawElements?.length) continue;
      let elements = rawElements ?? [];
      if (!elements.length) {
        elements = [
          {
            data: {
              id: `${viewKey}_placeholder`,
              label: "Re-run review for a full map",
              kind: "symbol",
            },
          },
        ];
      }

      tabKeys.push(viewKey);

      const panel = document.createElement("div");
      panel.className = "cedar-code-map-view-stage";
      panel.dataset.codeMapView = viewKey;
      panel.id = `cedar-code-map-panel-${viewKey}`;
      panel.hidden = viewKey !== allowedActive;
      panel.classList.toggle("is-active", viewKey === allowedActive);
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `cedar-code-map-tab-${viewKey}`);
      panel.setAttribute("aria-label", CODE_MAP_VIEW_LABELS[viewKey] ?? viewKey);
      if (viewKey !== allowedActive) panel.setAttribute("tabindex", "-1");

      const host = document.createElement("div");
      host.className = "cedar-code-map-cy cedar-cy-host cedar-code-map-cy--flyout";
      host.dataset.codeMapLayout = "cytoscape";
      host.setAttribute("role", "img");
      const leaf = filePath ? filePath.split("/").pop() : "file";
      host.setAttribute("aria-label", `${CODE_MAP_VIEW_LABELS[viewKey]} map for ${leaf}`);
      panel.appendChild(host);
      stack.appendChild(panel);
      jobs.set(viewKey, { elements, rankdir, panel, host, mounted: false });
    }

    if (!jobs.size) return false;

    stage.dataset.cedarActiveCodeMapView = allowedActive;
    triptychViewJobs.set(stage, jobs);
    renderCodeMapViewTabBar(tabKeys, allowedActive);
    stage.appendChild(stack);
    stage.style.position = "relative";
    stage.style.display = "flex";
    stage.style.flexDirection = "column";
    stage.style.minHeight = "0";

    if (!document.body.classList.contains("cedar-code-map-expanded")) {
      stage.dataset.cedarMapNeedsFlyoutFit = "1";
    }

    ensureCodeMapViewMounted(stage, allowedActive);
    const first = jobs.get(allowedActive);
    if (!first?.mounted) {
      destroyStage(stage);
      return false;
    }
    activeCyApi = cyByHost.get(first.host) ?? null;
    if (activeCyApi) setStageMapEngines(stage, { cy: activeCyApi });

    wireCodeMapFlyoutWheel(stage);
    wireCodeMapTriptychTabs();

    let reflowQueued = false;
    const reflow = () => {
      if (reflowQueued) return;
      reflowQueued = true;
      requestAnimationFrame(() => {
        reflowQueued = false;
        if (stage.dataset.cedarMapTabSwitching === "1") return;
        const panel = activeCodeMapViewPanel(stage);
        const host = panel?.querySelector(".cedar-code-map-cy");
        if (panel instanceof HTMLElement && host instanceof HTMLElement) {
          layoutViewPanelHost(panel, host);
          const api = cyByHost.get(host);
          api?.resize?.();
          fitCodeMapCy(stage, host);
        }
      });
    };
    activeResizeObserver?.disconnect();
    const rail = stage.closest(".cedar-file-flow-rail");
    const nav = stage.closest(".cedar-review-right-nav");
    const layout = stage.closest(".cedar-review-layout--three-col");
    const ro = new ResizeObserver(() => reflow());
    ro.observe(stage);
    ro.observe(stack);
    if (rail instanceof HTMLElement) ro.observe(rail);
    if (nav instanceof HTMLElement) ro.observe(nav);
    if (layout instanceof HTMLElement) ro.observe(layout);
    activeResizeObserver = ro;
    reflowHandlerByStage.set(stage, reflow);
    stage.addEventListener("cedar-file-flow-resize", reflow);
    requestAnimationFrame(() => requestAnimationFrame(reflow));

    return true;
  }

  if (artifact.svg?.trim()) {
    return mountCodeMapSvgStage(stage, artifact);
  }

  if (artifact.mermaid?.trim()) {
    const host = document.createElement("div");
    host.className = "cedar-file-flow-mermaid cedar-mermaid-source";
    host.dataset.mermaidSource = artifact.mermaid;
    stage.appendChild(host);
    layoutCodeMapViewport(stage, host);
    const ok = await renderArchitectureMermaid(artifact.mermaid, host);
    if (ok) {
      host.classList.add("cedar-file-flow-mermaid--fill");
    }
    return ok;
  }

  return false;
}

export function destroyFileCodeMap() {
  activeResizeObserver?.disconnect();
  activeResizeObserver = null;
  try {
    activePanZoom?.destroy();
  } catch {
    /* */
  }
  activePanZoom = null;
  activeCyApi = null;
}

/**
 * Refit pan/zoom after layout changes (e.g. code map expand overlay).
 */
export function refitActiveCodeMap() {
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement) || !stage.classList.contains("is-code-map-active")) return;

  const forceFit = stage.dataset.cedarMapNeedsFlyoutFit === "1";
  if (forceFit) delete stage.dataset.cedarMapUserZoomed;
  if (forceFit) lastFitSizeByStage.delete(stage);

  const reflow = reflowHandlerByStage.get(stage);
  const run = () => {
    reflow?.();
    if (!reflow && activeCyApi) {
      const host = activeCodeMapCyHost(stage);
      if (host instanceof HTMLElement) fitCodeMapCy(stage, host);
    }
    if (forceFit) stage.dataset.cedarMapNeedsFlyoutFit = "0";
  };
  run();
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
}

/**
 * Flyout was hidden during mount — rebuild or relayout once when it opens.
 * @param {{ path?: string | null }} [opts]
 */
/** Resize drawable area without resetting zoom (flyout width drag). */
export function resizeActiveCodeMapViewport() {
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement) || !stage.classList.contains("is-code-map-active")) return;
  const cyHost = activeCodeMapCyHost(stage);
  if (cyHost instanceof HTMLElement) {
    layoutCodeMapViewport(stage, cyHost);
    const api = cyByHost.get(cyHost) ?? activeCyApi;
    api?.resize?.();
    return;
  }
  const wrap = stage.querySelector(".cedar-code-map-svg-host");
  const svg = wrap?.querySelector(".cedar-code-map-svg");
  const pz = wrap instanceof HTMLElement ? pzByHost.get(wrap) ?? activePanZoom : null;
  if (wrap instanceof HTMLElement && svg instanceof SVGSVGElement && pz) {
    layoutCodeMapViewport(stage, wrap);
    pz.resize();
  }
}

export function layoutCodeMapForVisibleFlyout() {
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement) || !stage.classList.contains("is-code-map-active")) return;
  const cyHost = activeCodeMapCyHost(stage);
  const svgHost = stage.querySelector(".cedar-code-map-svg-host");
  const host =
    cyHost instanceof HTMLElement ? cyHost : svgHost instanceof HTMLElement ? svgHost : null;
  if (!(host instanceof HTMLElement)) return;
  layoutCodeMapViewport(stage, host);
  const eng = getStageMapEngines(stage);
  eng?.cy?.resize?.();
  if (eng?.pz) eng.pz.resize();
}

export async function stabilizeCodeMapForFlyout(opts = {}) {
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement)) return;
  if (!document.body.classList.contains("cedar-code-map-expanded")) return;

  const path = opts.path ?? null;
  if (!path) return;

  const catalog = window.__cedarFileFlows ?? {};
  const artifact = catalog[path];
  if (!artifact) return;

  const host =
    activeCodeMapCyHost(stage) ?? stage.querySelector(".cedar-code-map-svg-host");
  const box = host instanceof HTMLElement ? host.getBoundingClientRect() : null;
  const needsMount =
    !stage.classList.contains("is-code-map-active") ||
    !(host instanceof HTMLElement) ||
    !box ||
    box.width < 24 ||
    box.height < 24;

  if (needsMount) {
    delete stage.dataset.cedarMapUserZoomed;
    lastFitSizeByStage.delete(stage);
    const ok = await mountFileCodeMap(stage, artifact, path);
    if (!ok) return;
    stage.dataset.cedarMapNeedsFlyoutFit = "1";
  } else {
    layoutCodeMapForVisibleFlyout();
    stage.dataset.cedarMapNeedsFlyoutFit = "1";
  }
  refitActiveCodeMap();
}

/**
 * @param {WheelEvent} e
 */
export function handleCodeMapFlyoutWheel(e) {
  if (!(e instanceof WheelEvent)) return;
  if (!isCodeMapFlyoutWheelTarget(e)) return;
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement)) return;
  if (applyCodeMapWheelZoom(e, stage)) return;
  e.preventDefault();
}

/**
 * @param {1 | -1} direction
 */
function resolveActiveCodeMapEngines() {
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement)) return { cy: null, pz: null };
  syncActiveCodeMapEngine(stage);
  const cyHost = activeCodeMapCyHost(stage);
  const svgHost = stage.querySelector(".cedar-code-map-svg-host");
  const cy = cyHost instanceof HTMLElement ? codeMapCyApiForHost(cyHost) : null;
  const pz =
    getStageMapEngines(stage)?.pz ??
    (svgHost instanceof HTMLElement ? pzByHost.get(svgHost) : null) ??
    activePanZoom;
  return { cy: cy ?? null, pz: pz ?? null };
}

export function nudgeCodeMapZoom(direction) {
  const factor = direction > 0 ? 1.18 : 1 / 1.18;
  const stage = document.getElementById("cedar-file-flow-stage");
  const { cy, pz } = resolveActiveCodeMapEngines();
  if (cy) {
    if (direction > 0) cy.zoomIn?.();
    else cy.zoomOut?.();
    if (stage instanceof HTMLElement) markCodeMapUserZoom(stage);
    return;
  }
  if (pz) {
    const next = Math.min(10, Math.max(0.05, pz.getZoom() * factor));
    pz.zoom(next);
    if (stage instanceof HTMLElement) markCodeMapUserZoom(stage);
  }
}

/** Restore default fit/center after pan or zoom. */
export function resetCodeMapView() {
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement) || !stage.classList.contains("is-code-map-active")) return;

  delete stage.dataset.cedarMapUserZoomed;
  lastFitSizeByStage.delete(stage);

  const reflow = reflowHandlerByStage.get(stage);
  if (reflow) {
    reflow();
    requestAnimationFrame(() => reflow());
    return;
  }

  if (stage.classList.contains("is-code-map-triptych")) {
    const panel = activeCodeMapViewPanel(stage);
    const cyHost = panel?.querySelector(".cedar-code-map-cy");
    if (panel instanceof HTMLElement && cyHost instanceof HTMLElement) {
      fitCodeMapCy(panel, cyHost);
      return;
    }
  }
  const cyHost = stage.querySelector(".cedar-code-map-cy");
  if (cyHost instanceof HTMLElement) {
    const panel = cyHost.closest(".cedar-code-map-view-stage");
    if (panel instanceof HTMLElement) fitCodeMapCy(panel, cyHost);
    else fitCodeMapCy(stage, cyHost);
    return;
  }

  const wrap = stage.querySelector(".cedar-code-map-svg-host");
  const svg = wrap?.querySelector(".cedar-code-map-svg");
  const pz = wrap instanceof HTMLElement ? pzByHost.get(wrap) ?? activePanZoom : null;
  if (wrap instanceof HTMLElement && svg instanceof SVGSVGElement && pz) {
    fitCodeMapSvg(stage, wrap, svg, pz);
  }
}

/**
 * @param {HTMLElement} stage
 */
export function wireCodeMapStageInteraction(stage) {
  if (!(stage instanceof HTMLElement) || stage.dataset.cedarMapInteractionWired === "1") return;
  stage.dataset.cedarMapInteractionWired = "1";
  stage.addEventListener(
    "pointerdown",
    (e) => {
      if (!stage.classList.contains("is-code-map-active")) return;
      const t = e.target;
      if (!(t instanceof Element) || !stage.contains(t)) return;
      if (
        t.closest(
          ".cedar-code-map-svg, .cedar-code-map-svg-host, .cedar-code-map-cy, .cedar-code-map-xyflow"
        )
      ) {
        e.stopPropagation();
      }
    },
    { capture: true }
  );
}