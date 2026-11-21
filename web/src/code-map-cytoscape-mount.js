import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import {
  DIAGRAM_ZOOM_MAX,
  DIAGRAM_ZOOM_MIN,
  DIAGRAM_ZOOM_STEP,
} from "./diagram-ux.js";
import {
  codeMapFitMetrics,
  codeMapViewFitMetrics,
  defaultDiagramZoomAfterFit,
  diagramFitPaddingForTheme,
} from "./diagram-fit.js";
import { getResolvedTheme } from "./theme.js";
import { layerAccentForTheme } from "../../src/diagram-colors.js";

cytoscape.use(dagre);

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

/** @type {WeakMap<HTMLElement, cytoscape.Core>} */
const cyByHost = new WeakMap();

/** @type {WeakMap<HTMLElement, { elements: object[], rankdir: "TB" | "LR", viewKey: string }>} */
const mountStateByHost = new WeakMap();

/** Muted layer ids only (infrastructure / config / misc — no saturated accents). */
/** @type {Record<string, string>} */
const CODE_KIND_LAYER = {
  definition: "infrastructure",
  symbol: "infrastructure",
  field: "infrastructure",
  method: "infrastructure",
  property: "infrastructure",
  import: "infrastructure",
  module: "infrastructure",
  export: "config",
  external: "infrastructure",
  call: "config",
  step: "misc",
  table: "config",
  config: "config",
  key: "misc",
  query: "misc",
};

/**
 * @param {object[]} elements
 * @returns {object[]}
 */
function enrichCodeMapElements(elements) {
  return elements.map((el) => {
    const d = el?.data;
    if (!d) return el;
    if (Object.hasOwn(d, "source")) {
      const edgeKind = d.lineStyle === "dashed" || d.kind === "depends" ? "depends" : "contains";
      return { data: { ...d, kind: edgeKind } };
    }
    const kind = String(d.kind ?? "symbol");
    if (kind === "entry") {
      return { data: { ...d, mapType: "pr" } };
    }
    if (kind === "symbol" || kind === "definition") {
      const layerId = CODE_KIND_LAYER[kind] ?? "application";
      return { data: { ...d, mapType: "slice", layerId } };
    }
    return { data: { ...d, layerId: CODE_KIND_LAYER[kind] ?? "misc" } };
  });
}

/**
 * @param {"day" | "night"} theme
 * @param {string} [viewKey]
 */
function buildCodeMapCyStyle(theme, viewKey = "structure") {
  const isDay = theme === "day";
  const metrics = codeMapViewFitMetrics(viewKey, theme);
  const { cyFontSize, cyPrFontSize, fontPx, nodeMinWidth, nodeMinHeight, nodePadBase, textMaxWidth } = metrics;
  const padBump = viewKey === "behavior" ? 1 : Math.max(0, Math.round((fontPx - 8) * 0.35));
  const textMax = textMaxWidth ?? (viewKey === "behavior" ? "200px" : viewKey === "functionality" ? "240px" : "220px");
  return [
    {
      selector: "node",
      style: {
        ...BASE_NODE,
        "text-max-width": textMax,
        "font-size": cyFontSize,
        padding: `${nodePadBase + padBump}px`,
        "min-width": `${nodeMinWidth + padBump * 2}px`,
        "min-height": `${nodeMinHeight + padBump}px`,
        color: isDay ? "#18181b" : "#f5f5f5",
        "text-margin-x": 5,
        "text-margin-y": 2,
        "background-color": isDay ? "#fafafa" : "#121212",
        "border-width": 2,
        "border-color": isDay ? "#d4d4d8" : "#404040",
        "background-opacity": 1,
        "overlay-opacity": 0,
      },
    },
    {
      selector: 'node[mapType = "pr"]',
      style: isDay
        ? {
            shape: "ellipse",
            "font-size": cyPrFontSize,
            "font-weight": 600,
            color: "#18181b",
            "background-color": "#f4f4f5",
            "border-width": 2,
            "border-color": "#a1a1aa",
            padding: `${20 + padBump}px`,
            "min-width": `${76 + padBump * 2}px`,
            "min-height": `${76 + padBump * 2}px`,
            "text-max-width": "128px",
          }
        : {
            shape: "ellipse",
            "font-size": cyPrFontSize,
            "font-weight": 600,
            color: "#fafafa",
            "background-color": "#27272a",
            "border-width": 2,
            "border-color": "#71717a",
            padding: `${20 + padBump}px`,
            "min-width": `${76 + padBump * 2}px`,
            "min-height": `${76 + padBump * 2}px`,
            "text-max-width": "128px",
          },
    },
    {
      selector: 'node[mapType = "slice"]',
      style: {
        color: isDay ? "#27272a" : "#e5e5e5",
        "background-color": isDay ? "#e4e4e7" : "#141414",
        "border-color": isDay ? "#71717a" : "#737373",
      },
    },
    ...["infrastructure", "config", "misc"].map((layerId) => {
      const c = layerAccentForTheme(layerId, theme);
      return {
        selector: `node[layerId = "${layerId}"]:not([mapType = "slice"]):not([mapType = "pr"])`,
        style: {
          color: c.text,
          "background-color": c.fill,
          "border-color": c.stroke,
          "border-width": 2,
        },
      };
    }),
    {
      selector: 'node[kind = "call"]',
      style: {
        shape: "ellipse",
        "font-size": Math.max(10, cyFontSize - 1),
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
        label: "data(label)",
        "font-size": Math.max(8, cyFontSize - 2),
        color: isDay ? "#52525b" : "#a3a3a3",
        "text-background-color": isDay ? "rgba(255,255,255,0.92)" : "rgba(9,9,11,0.88)",
        "text-background-opacity": 1,
        "text-background-padding": "2px",
        "text-background-shape": "roundrectangle",
        "text-rotation": "autorotate",
        "text-margin-y": -6,
      },
    },
    {
      selector: "edge[label = '']",
      style: {
        label: "",
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
 * @param {cytoscape.Core} cy
 */
function viewKeyForCy(cy) {
  const host = cy?.container?.();
  if (host instanceof HTMLElement) {
    return mountStateByHost.get(host)?.viewKey ?? host.dataset.codeMapView ?? "structure";
  }
  return "structure";
}

export function fitCodeMapCyViewport(cy) {
  if (!cy) return;
  const theme = getResolvedTheme();
  const viewKey = viewKeyForCy(cy);
  const metrics = codeMapViewFitMetrics(viewKey, theme);
  cy.resize();
  cy.fit(cy.elements(), metrics.fitPadding ?? diagramFitPaddingForTheme(theme));
  cy.center(cy.elements());
  const z = defaultDiagramZoomAfterFit(cy.zoom(), theme, {
    variant: "code-map",
    postScale: metrics.postScale,
    maxFitZoom: metrics.maxFitZoom,
  });
  if (z > 0) {
    cy.zoom(z);
    cy.center(cy.elements());
  }
}

/**
 * @param {cytoscape.Core} cy
 */
export function createCodeMapCyControlApi(cy) {
  return {
    resize() {
      cy.resize();
    },
    fitView() {
      fitCodeMapCyViewport(cy);
    },
    zoomIn() {
      cy.zoom(Math.min(DIAGRAM_ZOOM_MAX, cy.zoom() * DIAGRAM_ZOOM_STEP));
    },
    zoomOut() {
      cy.zoom(Math.max(DIAGRAM_ZOOM_MIN, cy.zoom() / DIAGRAM_ZOOM_STEP));
    },
    /**
     * @param {number} factor
     * @param {{ x: number, y: number }} [renderedPosition]
     */
    zoomBy(factor, renderedPosition) {
      const next = Math.min(DIAGRAM_ZOOM_MAX, Math.max(DIAGRAM_ZOOM_MIN, cy.zoom() * factor));
      if (renderedPosition) {
        cy.zoom({ level: next, renderedPosition });
      } else {
        cy.zoom(next);
      }
    },
    /** @returns {cytoscape.Core} */
    getCy() {
      return cy;
    },
  };
}

/**
 * @param {HTMLElement} host
 */
export function unmountCodeMapCy(host) {
  const cy = cyByHost.get(host);
  if (cy) {
    try {
      cy.destroy();
    } catch {
      /* */
    }
    cyByHost.delete(host);
  }
  mountStateByHost.delete(host);
}

/**
 * @param {HTMLElement} host
 * @param {{ elements: object[], rankdir?: "TB" | "LR", viewKey?: string, onReady?: (api: ReturnType<typeof createCodeMapCyControlApi>) => void }} opts
 * @returns {cytoscape.Core | null}
 */
export function mountCodeMapCy(host, opts) {
  if (!(host instanceof HTMLElement)) return null;
  unmountCodeMapCy(host);

  const raw = opts.elements ?? [];
  const elements = enrichCodeMapElements(raw);
  const nodes = elements.filter((e) => e?.data && !Object.hasOwn(e.data, "source"));
  if (!nodes.length) return null;

  const viewKey = opts.viewKey ?? "structure";
  const rankdir = opts.rankdir === "LR" ? "LR" : "TB";
  const isLr = rankdir === "LR";
  const theme = getResolvedTheme();
  const { flowNodeSpacing, flowRankSpacing } = codeMapViewFitMetrics(viewKey, theme);
  host.dataset.codeMapView = viewKey;

  const cy = cytoscape({
    container: host,
    elements,
    style: buildCodeMapCyStyle(theme, viewKey),
    minZoom: DIAGRAM_ZOOM_MIN,
    maxZoom: DIAGRAM_ZOOM_MAX,
    wheelSensitivity: 0.2,
    userPanningEnabled: true,
    userZoomingEnabled: false,
    boxSelectionEnabled: false,
    pixelRatio: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1),
  });

  cy.layout({
    name: "dagre",
    rankDir: rankdir,
    nodeSep: isLr ? flowNodeSpacing + 8 : flowNodeSpacing,
    rankSep: isLr ? flowRankSpacing + 12 : flowRankSpacing,
    edgeSep: 20,
    animate: false,
  }).run();

  cy.one("layoutstop", () => {
    fitCodeMapCyViewport(cy);
    const api = createCodeMapCyControlApi(cy);
    opts.onReady?.(api);
  });

  cyByHost.set(host, cy);
  mountStateByHost.set(host, { elements: raw, rankdir, viewKey });
  return cy;
}

/** Re-mount code maps on a host after day/night theme change. */
export function remountCodeMapCyForTheme() {
  let last = null;
  for (const [host, state] of mountStateByHost.entries()) {
    if (!host.isConnected) {
      mountStateByHost.delete(host);
      continue;
    }
    last =
      mountCodeMapCy(host, {
        elements: state.elements,
        rankdir: state.rankdir,
        viewKey: state.viewKey ?? "structure",
        onReady: (api) => {
          api.fitView();
        },
      }) ?? last;
  }
  return last;
}

/**
 * @param {HTMLElement} host
 * @returns {ReturnType<typeof createCodeMapCyControlApi> | null}
 */
export function getCodeMapCyApi(host) {
  const cy = cyByHost.get(host);
  return cy ? createCodeMapCyControlApi(cy) : null;
}