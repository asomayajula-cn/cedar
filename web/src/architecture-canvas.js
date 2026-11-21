import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import {
  applyMermaidZoomByHostId,
  DIAGRAM_ZOOM_MAX,
  DIAGRAM_ZOOM_MIN,
  DIAGRAM_ZOOM_STEP,
} from "./diagram-ux.js";
import { defaultDiagramZoomAfterFit, diagramFitMetrics, diagramFitPaddingForTheme } from "./diagram-fit.js";
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
  ];
}

/**
 * @param {object} graph
 * @param {Map<string, string> | undefined} statusByLayerId
 */
function toElements(graph, statusByLayerId) {
  const part = graph.overview;
  if (!part?.nodes?.length) return [];

  const sliceNodeIds = new Set(
    part.nodes.filter((n) => n.type === "pr" || n.type === "slice").map((n) => n.id)
  );

  const nodes = part.nodes
    .filter((n) => n.type === "pr" || n.type === "slice")
    .map((n) => {
      const layerKey = n.layerId ? normalizeSliceId(n.layerId) : "";
      const reviewStatus =
        n.type === "slice" && layerKey
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
    .filter((e) => sliceNodeIds.has(e.source) && sliceNodeIds.has(e.target))
    .map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
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

function fitCyViewport(cy, opts = {}) {
  const theme = getResolvedTheme();
  cy.resize();
  cy.fit(cy.elements(), cyFitPadding());
  cy.center(cy.elements());
  const z = defaultDiagramZoomAfterFit(cy.zoom(), theme, {
    maximized: opts.maximized === true,
  });
  if (z > 0) {
    cy.zoom(z);
    cy.center(cy.elements());
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
      minZoom: DIAGRAM_ZOOM_MIN,
      maxZoom: DIAGRAM_ZOOM_MAX,
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
    lastCyMount = { container, graph, statusByLayerId };
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
  root.querySelectorAll("[data-cy-action]").forEach((btn) => {
    if (btn.dataset.wiredCyZoom) return;
    btn.dataset.wiredCyZoom = "1";
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-cy-target");
      const action = btn.getAttribute("data-cy-action");
      if (!targetId || !action) return;
      const cy = instances.get(targetId);
      if (cy) {
        if (action === "fit") {
          fitCyViewport(cy);
        } else if (action === "in") cy.zoom(cy.zoom() * DIAGRAM_ZOOM_STEP);
        else if (action === "out") cy.zoom(cy.zoom() / DIAGRAM_ZOOM_STEP);
        return;
      }
      applyMermaidZoomByHostId(targetId, action);
    });
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
 * @param {unknown} err
 */
function escapeMsg(err) {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/</g, "&lt;");
}

export function destroyArchitectureGraphs() {
  for (const cy of instances.values()) cy.destroy();
  instances.clear();
  lastCyMount = null;
}

/** Re-mount overview cytoscape when day/night theme changes. */
export function remountCytoscapeForTheme() {
  if (!lastCyMount?.container.isConnected) return;
  const { container, graph, statusByLayerId } = lastCyMount;
  mountCy(container, graph, statusByLayerId);
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