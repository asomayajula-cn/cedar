import { getResolvedTheme } from "./theme.js";
import { getDiffFontSettings } from "./diff-font.js";

/**
 * @param {number} min
 * @param {number} max
 * @param {number} v
 */
function clamp(min, max, v) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Fit padding, post-fit scale, and diagram label sizes from day/night + diff font preset.
 * @param {"day" | "night"} [theme]
 */
export function diagramFitMetrics(theme = getResolvedTheme()) {
  const { size: fontPx } = getDiffFontSettings();
  const fontNorm = fontPx / 11;
  const themePad = theme === "day" ? 76 : 88;
  const padding = Math.round(themePad + (fontPx - 8) * 3.1);
  const postScale = clamp(
    0.7,
    0.88,
    0.86 - (fontNorm - 1) * 0.1 - (theme === "day" ? 0.025 : 0)
  );
  const maxFitZoom = clamp(
    0.66,
    0.9,
    0.76 + (fontNorm - 1) * 0.05 - (theme === "day" ? 0.03 : 0)
  );
  const mermaidFontPx = Math.round(clamp(9, 14, fontPx + 2));
  const cyFontSize = Math.round(clamp(9, 13, fontPx + 1));
  const cyPrFontSize = Math.round(clamp(10, 14, fontPx + 2));
  const flowNodeSpacing = Math.round(38 + fontPx * 0.9);
  const flowRankSpacing = Math.round(52 + fontPx * 1.1);
  return {
    fontPx,
    padding,
    postScale,
    maxFitZoom,
    mermaidFontPx,
    cyFontSize,
    cyPrFontSize,
    flowNodeSpacing,
    flowRankSpacing,
  };
}

/**
 * After cy.fit / pan-zoom fit: apply theme font policy so graphs are not oversized.
 * @param {number} fitZoom
 * @param {"day" | "night"} [theme]
 * @param {{ variant?: "diagram" | "code-map", maximized?: boolean, sparse?: { componentCount?: number, naturalW?: number, naturalH?: number, stageW?: number, stageH?: number, graphW?: number, graphH?: number } }} [opts]
 */
export function defaultDiagramZoomAfterFit(fitZoom, theme = getResolvedTheme(), opts = {}) {
  if (!Number.isFinite(fitZoom) || fitZoom <= 0) return fitZoom;
  const variant = opts.variant === "code-map" ? "code-map" : "diagram";
  const metrics = variant === "code-map" ? codeMapFitMetrics(theme) : diagramFitMetrics(theme);
  let post = opts.postScale ?? metrics.postScale;
  let cap = opts.maxFitZoom ?? metrics.maxFitZoom;
  if (opts.maximized && variant !== "code-map") {
    post = Math.min(0.9, post + 0.04);
    cap = Math.min(1.02, cap + 0.1);
  }
  let z = fitZoom * post;
  if (cap > 0) z = Math.min(z, cap);
  z = sparseDiagramFitCap(z, opts.sparse);
  return z > 0 ? z : fitZoom;
}

/**
 * Tiny graphs (few nodes / small SVG) should not scale up to fill a tall stage.
 * @param {number} zoom
 * @param {{ componentCount?: number, naturalW?: number, naturalH?: number, stageW?: number, stageH?: number, graphW?: number, graphH?: number } | undefined} sparse
 */
export function sparseDiagramFitCap(zoom, sparse) {
  if (!sparse || !Number.isFinite(zoom) || zoom <= 0) return zoom;
  let cap = zoom;
  const n = sparse.componentCount ?? 0;
  if (n > 0) {
    if (n <= 2) cap = Math.min(cap, 0.58);
    else if (n <= 4) cap = Math.min(cap, 0.72);
    else if (n <= 6) cap = Math.min(cap, 0.84);
    else if (n <= 10) cap = Math.min(cap, 0.94);
  }
  const nw = sparse.naturalW ?? sparse.graphW ?? 0;
  const nh = sparse.naturalH ?? sparse.graphH ?? 0;
  const sw = sparse.stageW ?? 0;
  const sh = sparse.stageH ?? 0;
  if (nw > 8 && nh > 8 && sw > 8 && sh > 8) {
    const occupy = Math.max(nw / sw, nh / sh);
    if (occupy < 0.5) {
      cap = Math.min(cap, 0.52 + occupy * 0.75);
    } else if (occupy < 0.72) {
      cap = Math.min(cap, 0.62 + occupy * 0.45);
    }
  }
  return Math.min(zoom, cap);
}

/** Overview · slices — shared zoom constants for Cytoscape + Mermaid architecture diagrams. */
export const OVERVIEW_SLICES_ZOOM_STEP = 1.12;
export const OVERVIEW_SLICES_ZOOM_MIN = 0.15;
export const OVERVIEW_SLICES_ZOOM_MAX = 48;
/** Default open: theme fit, then N toolbar steps (−2 ≈ two “−” clicks). */
export const OVERVIEW_SLICES_DEFAULT_MAGNIFY_STEPS = -2;

/**
 * @param {number} z
 */
export function clampOverviewSlicesZoom(z) {
  return Math.min(OVERVIEW_SLICES_ZOOM_MAX, Math.max(OVERVIEW_SLICES_ZOOM_MIN, z));
}

/**
 * @param {number} zoom
 * @param {number} steps
 * @param {number} [step]
 */
export function applyOverviewSlicesMagnifySteps(
  zoom,
  steps,
  step = OVERVIEW_SLICES_ZOOM_STEP
) {
  if (!Number.isFinite(zoom) || zoom <= 0 || !steps) return zoom;
  let z = zoom;
  const n = Math.abs(steps);
  for (let i = 0; i < n; i += 1) {
    z = steps > 0 ? z * step : z / step;
  }
  return clampOverviewSlicesZoom(z);
}

/**
 * Post-fit policy for Overview · slices and every architecture diagram (UML / Flow / Events / chat).
 * @param {number} fitZoom
 * @param {Parameters<typeof defaultDiagramZoomAfterFit>[2] & { theme?: "day" | "night", magnifySteps?: number, sparse?: Parameters<typeof sparseDiagramFitCap>[1] }} [opts]
 */
export function finalizeOverviewSlicesDiagramZoom(fitZoom, opts = {}) {
  if (!Number.isFinite(fitZoom) || fitZoom <= 0) return fitZoom;
  const theme = opts.theme ?? getResolvedTheme();
  const variant = opts.variant === "code-map" ? "code-map" : "diagram";
  const maximized = opts.maximized === true;
  let z = defaultDiagramZoomAfterFit(fitZoom, theme, {
    maximized,
    variant,
    postScale: opts.postScale,
    maxFitZoom: opts.maxFitZoom,
  });
  const magnifySteps = maximized
    ? 0
    : variant === "code-map"
      ? 0
      : (opts.magnifySteps ?? OVERVIEW_SLICES_DEFAULT_MAGNIFY_STEPS);
  if (magnifySteps !== 0) {
    z = applyOverviewSlicesMagnifySteps(z, magnifySteps);
  }
  if (variant !== "code-map" && opts.sparse) {
    z = sparseDiagramFitCap(z, opts.sparse);
  }
  return z;
}

/** svg-pan-zoom options aligned with Overview · slices Cytoscape wheel. */
export const SVG_PAN_ZOOM_OVERVIEW_SLICES_OPTS = {
  zoomScaleSensitivity: 0.2,
  minZoom: OVERVIEW_SLICES_ZOOM_MIN,
  maxZoom: OVERVIEW_SLICES_ZOOM_MAX,
  /** Manual fit via computeDiagramFitZoom / finalizeOverviewSlicesDiagramZoom (pan-zoom .fit() breaks tight Mermaid viewBoxes). */
  fit: false,
  center: false,
  controlIconsEnabled: false,
  panEnabled: true,
  zoomEnabled: true,
  mouseWheelZoomEnabled: true,
  preventMouseEventsDefault: true,
};

/**
 * Center diagram in the pan viewport (architecture Mermaid / SVG). Matches cytoscape cy.center().
 * @param {{ resize?: () => void, getSizes?: () => { width?: number, height?: number, realZoom?: number, viewBox?: { x?: number, y?: number, width?: number, height?: number } }, pan?: (p: { x: number, y: number }) => void, center?: () => void, getZoom?: () => number } | null | undefined} pz
 * @param {{ x: number, y: number } | null | undefined} [contentCenter] SVG user-space center of visible graph (getBBox); flowcharts often have huge viewBoxes.
 */
export function centerOverviewSlicesPanZoom(pz, contentCenter) {
  if (!pz) return;
  try {
    pz.resize?.();
  } catch {
    /* */
  }

  try {
    const sizes = pz.getSizes?.();
    if (sizes) {
      const vw = sizes.width ?? 0;
      const vh = sizes.height ?? 0;
      const vb = sizes.viewBox ?? {};
      const vbX = vb.x ?? 0;
      const vbY = vb.y ?? 0;
      const vbW = vb.width ?? 0;
      const vbH = vb.height ?? 0;
      const rz = sizes.realZoom ?? pz.getZoom?.() ?? 1;
      if (vw > 0 && vh > 0 && vbW > 0 && vbH > 0 && typeof pz.pan === "function") {
        if (
          contentCenter &&
          Number.isFinite(contentCenter.x) &&
          Number.isFinite(contentCenter.y)
        ) {
          pz.pan({
            x: vw / 2 - contentCenter.x * rz,
            y: vh / 2 - contentCenter.y * rz,
          });
        } else {
          pz.pan({
            x: (vw - vbW * rz) / 2 - vbX * rz,
            y: (vh - vbH * rz) / 2 - vbY * rz,
          });
        }
        return;
      }
    }
  } catch {
    /* fall through */
  }

  try {
    pz.center?.();
  } catch {
    /* */
  }
}

/**
 * @param {number} rawFitZoom
 * @param {{ componentCount?: number, maximized?: boolean }} sparse
 */
export function capSparseDiagramRawFit(rawFitZoom, componentCount, maximized = false) {
  if (maximized || !Number.isFinite(rawFitZoom) || rawFitZoom <= 0) return rawFitZoom;
  if (componentCount <= 0 || componentCount > 8) return rawFitZoom;
  const rawCap =
    componentCount <= 2 ? 1.08 : componentCount <= 4 ? 1.22 : componentCount <= 6 ? 1.38 : 1.52;
  return Math.min(rawFitZoom, rawCap);
}

/**
 * @param {"day" | "night"} [theme]
 */
export function diagramFitPaddingForTheme(theme = getResolvedTheme()) {
  return diagramFitMetrics(theme).padding;
}

/**
 * Shared initial fit / magnification for Overview · slices (Cytoscape) and Complete layout (Mermaid).
 * @param {boolean} [maximized]
 * @param {"day" | "night"} [theme]
 */
export function diagramViewportFitOpts(maximized = false, theme = getResolvedTheme()) {
  const metrics = diagramFitMetrics(theme);
  return {
    padding: metrics.padding,
    postScale: metrics.postScale,
    maxFitZoom: metrics.maxFitZoom,
    maximized,
  };
}

/**
 * Code-map fit — same padding / post-fit zoom as overview & slice diagrams; only node size differs.
 * @param {"day" | "night"} [theme]
 */
export function codeMapFitMetrics(theme = getResolvedTheme()) {
  const base = diagramFitMetrics(theme);
  const fontNorm = base.fontPx / 11;
  const expanded =
    typeof document !== "undefined" && document.body.classList.contains("cedar-code-map-expanded");
  const fitPadding = Math.round(base.padding * 1.18 + Math.max(0, base.fontPx - 8) * 2.6 + (expanded ? 18 : 8));
  const postScale = clamp(0.62, 0.82, base.postScale * 0.9);
  const maxFitZoom = clamp(
    0.6,
    0.84,
    base.maxFitZoom * 0.94 + (expanded ? 0.02 : 0) + (fontNorm - 1) * 0.03
  );
  return {
    ...base,
    /** Pixel padding for XY Flow fitView (matches cytoscape / svg-pan-zoom diagrams). */
    fitPadding,
    postScale,
    maxFitZoom,
    nodeFontPx: Math.round(clamp(9, 12, base.fontPx - 1)),
  };
}

/**
 * Per flyout tab — behavior uses 8px labels and a smaller default zoom.
 * @param {"structure" | "behavior" | "functionality" | string} [viewKey]
 * @param {"day" | "night"} [theme]
 */
export function codeMapViewFitMetrics(viewKey, theme = getResolvedTheme()) {
  const base = codeMapFitMetrics(theme);
  const expanded =
    typeof document !== "undefined" && document.body.classList.contains("cedar-code-map-expanded");
  /** Zoomed-out overview — users magnify for detail. */
  const overviewPost = clamp(0.44, 0.62, base.postScale * (expanded ? 0.72 : 0.78));
  const overviewMax = clamp(0.42, 0.58, base.maxFitZoom * (expanded ? 0.76 : 0.82));

  if (viewKey === "behavior") {
    return {
      ...base,
      cyFontSize: 9,
      cyPrFontSize: 10,
      fitPadding: Math.round(base.fitPadding * 1.35),
      postScale: overviewPost,
      maxFitZoom: overviewMax,
      flowNodeSpacing: Math.round(base.flowNodeSpacing * 0.72),
      flowRankSpacing: Math.round(base.flowRankSpacing * 0.78),
      nodeMinWidth: 64,
      nodeMinHeight: 32,
      nodePadBase: 8,
      textMaxWidth: "200px",
    };
  }
  if (viewKey === "functionality") {
    return {
      ...base,
      cyFontSize: Math.max(9, base.cyFontSize - 1),
      fitPadding: Math.round(base.fitPadding * 1.28),
      postScale: overviewPost,
      maxFitZoom: overviewMax,
      flowNodeSpacing: Math.round(base.flowNodeSpacing * 0.8),
      flowRankSpacing: Math.round(base.flowRankSpacing * 0.84),
      nodeMinWidth: 80,
      nodeMinHeight: 40,
      nodePadBase: 12,
      textMaxWidth: "240px",
    };
  }
  return {
    ...base,
    fitPadding: Math.round(base.fitPadding * 1.22),
    postScale: overviewPost,
    maxFitZoom: overviewMax,
    flowNodeSpacing: Math.round(base.flowNodeSpacing * 0.86),
    flowRankSpacing: Math.round(base.flowRankSpacing * 0.88),
    nodeMinWidth: 88,
    nodeMinHeight: 44,
    nodePadBase: 12,
    textMaxWidth: "220px",
  };
}