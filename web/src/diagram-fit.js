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
 * @param {{ variant?: "diagram" | "code-map", maximized?: boolean }} [opts]
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
  return z > 0 ? z : fitZoom;
}

/**
 * @param {"day" | "night"} [theme]
 */
export function diagramFitPaddingForTheme(theme = getResolvedTheme()) {
  return diagramFitMetrics(theme).padding;
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