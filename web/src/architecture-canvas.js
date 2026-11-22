import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { clampDiagramZoomForSlices } from "./diagram-ux.js";
import {
  capSparseDiagramRawFit,
  diagramFitMetrics,
  diagramFitPaddingForTheme,
  finalizeOverviewSlicesDiagramZoom,
  OVERVIEW_SLICES_ZOOM_MAX,
  OVERVIEW_SLICES_ZOOM_MIN,
  OVERVIEW_SLICES_ZOOM_STEP,
} from "./diagram-fit.js";
import { getResolvedTheme } from "./theme.js";
import { normalizeSliceId } from "../../src/architecture-model.js";
import { LAYER_ACCENT_COLORS, layerAccentForTheme, reviewStatusColorsForTheme } from "../../src/diagram-colors.js";

cytoscape.use(dagre);

/** @type {Map<string, cytoscape.Core>} */
const instances = new Map();

const BASE_NODE = {
  label: "data(label)",
  "text-wrap": "wrap",
  "text-max-width": "156px",
  "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
  "text-valign": "center",
  "text-halign": "center",
  "font-weight": 500,
  "line-height": 1.35,
  shape: "round-rectangle",
  width: "label",
  height: "label",
  "min-width": "104px",
  "min-height": "48px",
  padding: "18px",
  "corner-radius": "12px",
};

/** @type {{ container: HTMLElement, graph: object, statusByLayerId: Map<string, string> | undefined } | null} */
let lastCyMount = null;

/** @type {Map<string, { graph: object, statusByLayerId: Map<string, string> | undefined }>} */
const cyMountMetaByKey = new Map();

export const ARCHITECTURE_LAYOUT_CY_HOSTS = [
  { key: "components", hostId: "cedar-cy-components" },
  { key: "flow", hostId: "cedar-cy-flow" },
  { key: "events", hostId: "cedar-cy-events" },
  { key: "dataModel", hostId: "cedar-cy-datamodel" },
];

/**
 * @param {"day" | "night"} theme
 */
function buildCedarStyle(theme) {
  const isDay = theme === "day";
  const statusColors = reviewStatusColorsForTheme(theme);
  const { cyFontSize, cyPrFontSize, fontPx } = diagramFitMetrics(theme);
  const padBump = Math.max(0, Math.round((fontPx - 8) * 0.4));
  return [
    {
      selector: "node",
      style: {
        ...BASE_NODE,
        "font-size": cyFontSize,
        padding: `${16 + padBump}px`,
        "min-width": `${104 + padBump * 2}px`,
        color: isDay ? "#18181b" : "#f5f5f5",
        "background-color": isDay ? "#fafafa" : "#121212",
        "border-width": 2,
        "border-color": isDay ? "#d4d4d8" : "#404040",
        "background-opacity": 1,
        "overlay-opacity": 0,
      },
    },
    {
      selector: 'node[type = "pr"]',
      style: isDay
        ? {
            shape: "ellipse",
            "font-size": cyPrFontSize,
            "font-weight": 600,
            color: "#0c4a6e",
            "background-color": "#e0f2fe",
            "border-width": 3,
            "border-color": "#0284c7",
            padding: `${20 + padBump}px`,
            "min-width": `${76 + padBump * 2}px`,
            "min-height": `${76 + padBump * 2}px`,
            "text-max-width": "128px",
          }
        : {
            shape: "ellipse",
            "font-size": cyPrFontSize,
            "font-weight": 600,
            color: "#e0f2fe",
            "background-color": "#0c4a6e",
            "border-width": 3,
            "border-color": "#38bdf8",
            padding: `${20 + padBump}px`,
            "min-width": `${76 + padBump * 2}px`,
            "min-height": `${76 + padBump * 2}px`,
            "text-max-width": "128px",
          },
    },
    {
      selector: 'node[type = "slice"]',
      style: {
        color: isDay ? "#27272a" : "#e5e5e5",
        "background-color": isDay ? "#e4e4e7" : "#141414",
        "border-color": isDay ? "#71717a" : "#737373",
      },
    },
    ...Object.keys(LAYER_ACCENT_COLORS).map((layerId) => {
      const c = layerAccentForTheme(layerId, theme);
      return {
        selector: `node[layerId = "${layerId}"]`,
        style: {
          color: c.text,
          "background-color": c.fill,
          "border-color": c.stroke,
          "border-width": 2,
        },
      };
    }),
    ...Object.entries(statusColors).map(([status, c]) => ({
      selector: `node[reviewStatus = "${status}"]`,
      style: {
        color: c.text,
        "background-color": c.fill,
        "border-color": c.border,
        "border-width": 2,
      },
    })),
    {
      selector: "node[highlight]",
      style: isDay
        ? {
            "border-width": 2,
            "border-color": "#18181b",
            "background-color": "#e4e4e7",
            color: "#09090b",
          }
        : {
            "border-width": 2,
            "border-color": "#fafafa",
            "background-color": "#1f1f1f",
            color: "#ffffff",
          },
    },
    {
      selector: "edge",
      style: {
        width: 1.75,
        "line-color": isDay ? "#94a3b8" : "#52525b",
        "line-cap": "round",
        "curve-style": "unbundled-bezier",
        "control-point-step-size": 44,
        opacity: isDay ? 0.92 : 0.88,
      },
    },
    {
      selector: 'edge[kind = "contains"]',
      style: {
        "target-arrow-shape": "triangle",
        "target-arrow-color": isDay ? "#71717a" : "#737373",
        "arrow-scale": 0.85,
        "line-color": isDay ? "#d4d4d8" : "#404040",
      },
    },
    {
      selector: 'edge[kind = "depends"]',
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [5, 5],
        "line-color": isDay ? "#71717a" : "#a3a3a3",
        "target-arrow-shape": "vee",
        "target-arrow-color": isDay ? "#52525b" : "#d4d4d4",
        opacity: 0.95,
      },
    },
    {
      selector: 'node[type = "layer"]',
      style: {
        color: isDay ? "#18181b" : "#f5f5f5",
        "background-color": isDay ? "#f4f4f5" : "#141414",
        "border-color": isDay ? "#71717a" : "#737373",
      },
    },
    {
      selector: 'node[type = "class"]',
      style: {
        "text-max-width": "180px",
        "font-size": Math.max(8, cyFontSize - 1),
      },
    },
    {
      selector: 'node[type = "ops"], node[type = "actor"]',
      style: {
        shape: "round-rectangle",
        "background-color": isDay ? "#fafafa" : "#0a0a0a",
        "border-color": isDay ? "#a1a1aa" : "#525252",
        color: isDay ? "#52525b" : "#a3a3a3",
      },
    },
    {
      selector: 'node[type = "file"]',
      style: {
        "text-max-width": "200px",
        "font-size": Math.max(8, cyFontSize - 1),
        "background-color": isDay ? "#f8fafc" : "#171717",
        "border-color": isDay ? "#64748b" : "#57534e",
        color: isDay ? "#334155" : "#e7e5e4",
      },
    },
    {
      selector: 'node[type = "table"]',
      style: {
        shape: "barrel",
        "text-max-width": "200px",
        "background-color": isDay ? "#ecfdf5" : "#14532d",
        "border-color": isDay ? "#059669" : "#34d399",
        color: isDay ? "#065f46" : "#d1fae5",
      },
    },
    {
      selector: "edge[label]",
      style: {
        label: "data(label)",
        "font-size": Math.max(8, cyFontSize - 2),
        color: isDay ? "#52525b" : "#a3a3a3",
        "text-rotation": "autorotate",
        "text-margin-y": -8,
      },
    },
  ];
}

/**
 * @param {object} graph
 * @param {Map<string, string> | undefined} statusByLayerId
 */
function toElements(graph, statusByLayerId) {
  const part = graph.overview ?? graph;
  if (!part?.nodes?.length) return [];

  const nodeIds = new Set(part.nodes.map((n) => n.id));

  const nodes = part.nodes.map((n) => {
    const layerKey = n.layerId ? normalizeSliceId(n.layerId) : "";
    const reviewStatus =
      layerKey && (n.type === "slice" || n.type === "layer" || n.type === "class")
        ? statusByLayerId?.get(layerKey) ?? statusByLayerId?.get(n.layerId)
        : undefined;
    return {
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        ...(n.layerId ? { layerId: layerKey || n.layerId } : {}),
        ...(reviewStatus ? { reviewStatus } : {}),
        ...(n.highlight ? { highlight: true } : {}),
      },
    };
  });

  const edges = (part.edges ?? [])
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind ?? "rel",
        ...(e.label ? { label: e.label } : {}),
      },
    }));

  return [...nodes, ...edges];
}

/**
 * @param {object} graph
 * @returns {"TB" | "LR"}
 */
function resolveRankDir(graph) {
  if (graph.meta?.layout === "LR") return "LR";
  if (graph.meta?.layout === "TB") return "TB";
  const slices = graph.overview?.nodes?.filter((n) => n.type === "slice").length ?? 0;
  return slices >= 2 ? "LR" : "TB";
}

/**
 * @param {cytoscape.Core} cy
 * @param {HTMLElement} container
 */
function cyFitPadding() {
  return diagramFitPaddingForTheme(getResolvedTheme());
}

/**
 * @param {HTMLElement | null | undefined} container
 */
function cyWrapMaximized(container) {
  return container instanceof HTMLElement && Boolean(container.closest(".is-diagram-maximized"));
}

/**
 * @param {cytoscape.Core} cy
 * @param {"in" | "out"} dir
 */
function nudgeCyZoomAtViewportCenter(cy, dir) {
  const el = cy.container();
  const w = el instanceof HTMLElement ? el.clientWidth : cy.width();
  const h = el instanceof HTMLElement ? el.clientHeight : cy.height();
  const factor = dir === "in" ? OVERVIEW_SLICES_ZOOM_STEP : 1 / OVERVIEW_SLICES_ZOOM_STEP;
  const next = clampDiagramZoomForSlices(cy.zoom() * factor);
  cy.zoom({
    level: next,
    renderedPosition: { x: w / 2, y: h / 2 },
  });
  cy.center(cy.elements());
}

function fitCyViewport(cy, opts = {}) {
  const maximized =
    opts.maximized === true || cyWrapMaximized(cy.container() instanceof HTMLElement ? cy.container() : null);
  cy.resize();
  cy.fit(cy.elements(), cyFitPadding());
  cy.center(cy.elements());
  const container = cy.container();
  const bb = cy.elements().boundingBox();
  const cw = container instanceof HTMLElement ? container.clientWidth : 0;
  const ch = container instanceof HTMLElement ? container.clientHeight : 0;
  const componentCount = cy.nodes().length;
  const fitZoom = capSparseDiagramRawFit(cy.zoom(), componentCount, maximized);
  const z = finalizeOverviewSlicesDiagramZoom(fitZoom, {
    maximized,
    sparse: {
      componentCount,
      graphW: bb.w,
      graphH: bb.h,
      stageW: cw,
      stageH: ch,
    },
  });
  if (z > 0) {
    cy.zoom(z);
    cy.center(cy.elements());
    requestAnimationFrame(() => {
      try {
        if (!cy.destroyed()) cy.center(cy.elements());
      } catch {
        /* */
      }
    });
  }
}

function wireCyResize(cy, container) {
  const resize = () => {
    if (!container.isConnected) return;
    fitCyViewport(cy);
  };
  requestAnimationFrame(() => requestAnimationFrame(resize));
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => resize());
    ro.observe(container);
  }
}

/**
 * @param {HTMLElement} container
 * @param {object} graph
 * @param {Map<string, string> | undefined} statusByLayerId
 */
function mountCy(container, graph, statusByLayerId) {
  if (!container.id) container.id = "cedar-cy-slices";
  const key = container.id;
  const prev = instances.get(key);
  if (prev) prev.destroy();

  const elements = toElements(graph, statusByLayerId);
  if (!elements.length) {
    container.innerHTML =
      '<p class="p-6 text-center text-sm text-zinc-500">No slices to show.</p>';
    return null;
  }

  const rankDir = resolveRankDir(graph);
  const isLr = rankDir === "LR";

  try {
    container.innerHTML = "";
    const cy = cytoscape({
      container,
      elements,
      style: buildCedarStyle(getResolvedTheme()),
      minZoom: OVERVIEW_SLICES_ZOOM_MIN,
      maxZoom: OVERVIEW_SLICES_ZOOM_MAX,
      wheelSensitivity: 0.2,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: false,
      pixelRatio: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1),
    });

    cy.layout({
      name: "dagre",
      rankDir,
      nodeSep: isLr ? 56 : 48,
      rankSep: isLr ? 100 : 88,
      edgeSep: 20,
      animate: false,
    }).run();

    cy.one("layoutstop", () => {
      fitCyViewport(cy);
    });

    wireCyResize(cy, container);
    instances.set(key, cy);
    cyMountMetaByKey.set(key, { graph, statusByLayerId });
    if (key === "cedar-cy-slices") {
      lastCyMount = { container, graph, statusByLayerId };
    }
    return cy;
  } catch (err) {
    console.error("[cedar] cytoscape mount failed", err);
    container.innerHTML = `<p class="p-4 text-center text-sm text-rose-300">Diagram failed: ${escapeMsg(err)}</p>`;
    return null;
  }
}

/**
 * @param {HTMLElement} root
 * @param {object} diagramGraph
 */
/**
 * Shared + / − / Fit for Overview (Cytoscape) and Complete layout (Mermaid).
 * @param {ParentNode} root
 */
export function wireArchitectureZoomControls(root) {
  const scope =
    root.querySelector("#cedar-review-panel-architecture") ??
    (root instanceof HTMLElement ? root : null);
  if (!(scope instanceof HTMLElement) || scope.dataset.cyZoomDelegate) return;
  scope.dataset.cyZoomDelegate = "1";
  scope.addEventListener("click", (e) => {
      const btn = e.target instanceof Element ? e.target.closest("[data-cy-action]") : null;
      if (!(btn instanceof HTMLElement)) return;
      const targetId = btn.getAttribute("data-cy-target");
      const action = btn.getAttribute("data-cy-action");
      if (!targetId || !action) return;
      const cy = instances.get(targetId);
      if (cy) {
        if (action === "fit") {
          fitCyViewport(cy);
        } else if (action === "in") {
          nudgeCyZoomAtViewportCenter(cy, "in");
        } else if (action === "out") {
          nudgeCyZoomAtViewportCenter(cy, "out");
        }
        return;
      }
    });
}

/**
 * @param {ParentNode} root
 * @param {object} diagramGraph
 * @param {Map<string, string> | undefined} [statusByLayerId]
 */
/**
 * @param {ParentNode} root
 * @param {object} diagramGraph
 * @param {Map<string, string> | undefined} statusByLayerId
 * @param {{ force?: boolean, onFail?: () => void }} [opts]
 */
export function mountArchitectureGraphs(root, diagramGraph, statusByLayerId, opts = {}) {
  if (!diagramGraph?.overview?.nodes?.length) return false;

  const host = root.querySelector("#cedar-cy-slices");
  if (!(host instanceof HTMLElement)) return false;

  const panel = root.querySelector("#cedar-review-panel-architecture");
  if (panel instanceof HTMLElement && panel.hidden && !opts.force) {
    host.dataset.cyMountPending = "1";
    wireArchitectureZoomControls(root);
    return true;
  }

  wireArchitectureZoomControls(root);

  const run = (attempt = 0) => {
    if (host.clientWidth < 16 || host.clientHeight < 16) {
      if (attempt < 24) {
        requestAnimationFrame(() => run(attempt + 1));
        return;
      }
    }
    delete host.dataset.cyMountPending;
    const ok = mountCy(host, diagramGraph, statusByLayerId) !== null;
    if (!ok) opts.onFail?.();
  };

  run();
  return true;
}

/**
 * @param {ParentNode} root
 * @param {{ components?: object, flow?: object, events?: object }} layoutGraphs
 * @param {Map<string, string> | undefined} [statusByLayerId]
 * @param {{ force?: boolean }} [opts]
 */
export function mountArchitectureLayoutGraphs(root, layoutGraphs, statusByLayerId, opts = {}) {
  if (!layoutGraphs) return 0;
  const panel = root.querySelector("#cedar-review-panel-architecture");
  const panelHidden = panel instanceof HTMLElement && panel.hidden;
  if (panelHidden && !opts.force) {
    wireArchitectureZoomControls(root);
    return 0;
  }

  wireArchitectureZoomControls(root);
  let mounted = 0;
  for (const { key, hostId } of ARCHITECTURE_LAYOUT_CY_HOSTS) {
    const graph = layoutGraphs[key];
    const host = root.querySelector(`#${hostId}`);
    if (!graph?.overview?.nodes?.length || !(host instanceof HTMLElement)) continue;
    const run = (attempt = 0) => {
      if (host.clientWidth < 16 || host.clientHeight < 16) {
        if (attempt < 24) {
          requestAnimationFrame(() => run(attempt + 1));
          return;
        }
      }
      if (mountCy(host, graph, statusByLayerId) !== null) mounted += 1;
    };
    run();
  }
  return mounted;
}

/**
 * @param {unknown} err
 */
function escapeMsg(err) {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/</g, "&lt;");
}

export function destroyArchitectureGraphs() {
  for (const cy of instances.values()) cy.destroy();
  instances.clear();
  cyMountMetaByKey.clear();
  lastCyMount = null;
}

/** Re-mount all architecture cytoscape diagrams when day/night theme changes. */
export function remountCytoscapeForTheme() {
  for (const [key, cy] of instances) {
    const meta = cyMountMetaByKey.get(key);
    const container = cy.container();
    if (!meta || !(container instanceof HTMLElement) || !container.isConnected) continue;
    mountCy(container, meta.graph, meta.statusByLayerId);
  }
}

/** Refit mounted overview graphs after stage resize / theme metrics change. */
export function refitCytoscapeDiagrams() {
  for (const cy of instances.values()) {
    try {
      fitCyViewport(cy);
    } catch {
      /* */
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("cedar-diagram-stage-change", () => {
    refitCytoscapeDiagrams();
  });
}