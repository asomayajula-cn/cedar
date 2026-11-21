/** Review status → diagram fills (Cytoscape / badges). */
export const REVIEW_STATUS_COLORS = {
  passed: { fill: "#14532d", border: "#34d399", text: "#d1fae5" },
  failed: { fill: "#450a0a", border: "#f87171", text: "#fecaca" },
  warning: { fill: "#422006", border: "#fbbf24", text: "#fef3c7" },
  pending: { fill: "#1c1917", border: "#f59e0b", text: "#fde68a" },
  skipped: { fill: "#18181b", border: "#71717a", text: "#d4d4d4" },
};

/** Day theme — light node fills with dark label text. */
export const REVIEW_STATUS_COLORS_DAY = {
  passed: { fill: "#d1fae5", border: "#059669", text: "#065f46" },
  failed: { fill: "#fee2e2", border: "#dc2626", text: "#991b1b" },
  warning: { fill: "#fef3c7", border: "#d97706", text: "#92400e" },
  pending: { fill: "#fef9c3", border: "#ca8a04", text: "#713f12" },
  skipped: { fill: "#f4f4f5", border: "#71717a", text: "#3f3f46" },
};

/**
 * @param {"day" | "night"} [theme]
 */
export function reviewStatusColorsForTheme(theme = "night") {
  return theme === "day" ? REVIEW_STATUS_COLORS_DAY : REVIEW_STATUS_COLORS;
}

/** Canonical layer accents for flow / layer chips. */
export const LAYER_ACCENT_COLORS = {
  web: { fill: "#172554", stroke: "#60a5fa", text: "#dbeafe" },
  api: { fill: "#3b0764", stroke: "#c084fc", text: "#f3e8ff" },
  application: { fill: "#134e4a", stroke: "#2dd4bf", text: "#ccfbf1" },
  domain: { fill: "#422006", stroke: "#fb923c", text: "#ffedd5" },
  repository: { fill: "#1e3a5f", stroke: "#38bdf8", text: "#e0f2fe" },
  infrastructure: { fill: "#27272a", stroke: "#a1a1aa", text: "#f4f4f5" },
  persistence: { fill: "#312e81", stroke: "#818cf8", text: "#e0e7ff" },
  config: { fill: "#1f2937", stroke: "#9ca3af", text: "#f3f4f6" },
  build_deploy: { fill: "#4a044e", stroke: "#e879f9", text: "#fae8ff" },
  integration: { fill: "#164e63", stroke: "#22d3ee", text: "#cffafe" },
  migrations: { fill: "#365314", stroke: "#a3e635", text: "#ecfccb" },
  misc: { fill: "#171717", stroke: "#737373", text: "#f5f5f5" },
};

/** @param {string} layerId */
export function layerAccent(layerId) {
  return layerAccentForTheme(layerId, "night");
}

/** Pastel layer fills for day theme diagrams and chips. */
export const LAYER_ACCENT_COLORS_DAY = {
  web: { fill: "#dbeafe", stroke: "#2563eb", text: "#1e3a8a" },
  api: { fill: "#ede9fe", stroke: "#7c3aed", text: "#4c1d95" },
  application: { fill: "#ccfbf1", stroke: "#0d9488", text: "#134e4a" },
  domain: { fill: "#ffedd5", stroke: "#ea580c", text: "#9a3412" },
  repository: { fill: "#e0f2fe", stroke: "#0284c7", text: "#0c4a6e" },
  infrastructure: { fill: "#e4e4e7", stroke: "#52525b", text: "#27272a" },
  persistence: { fill: "#e0e7ff", stroke: "#4f46e5", text: "#312e81" },
  config: { fill: "#f3f4f6", stroke: "#6b7280", text: "#1f2937" },
  build_deploy: { fill: "#fae8ff", stroke: "#c026d3", text: "#86198f" },
  integration: { fill: "#cffafe", stroke: "#0891b2", text: "#164e63" },
  migrations: { fill: "#ecfccb", stroke: "#65a30d", text: "#365314" },
  misc: { fill: "#f4f4f5", stroke: "#71717a", text: "#27272a" },
};

/**
 * @param {string} layerId
 * @param {"day" | "night"} [theme]
 */
export function layerAccentForTheme(layerId, theme = "night") {
  const key = String(layerId ?? "").toLowerCase();
  const table = theme === "day" ? LAYER_ACCENT_COLORS_DAY : LAYER_ACCENT_COLORS;
  return table[key] ?? table.misc;
}

/** Slice index palette for badge #n (1-based). */
export const SLICE_INDEX_COLORS = [
  "#60a5fa",
  "#c084fc",
  "#34d399",
  "#fb923c",
  "#f472b6",
  "#2dd4bf",
  "#facc15",
  "#818cf8",
];

/**
 * @param {number} index1
 */
export function sliceIndexColor(index1) {
  const i = Math.max(1, index1) - 1;
  return SLICE_INDEX_COLORS[i % SLICE_INDEX_COLORS.length];
}

/**
 * @param {string} [status]
 */
export function sliceStatusVisual(status) {
  return sliceStatusVisualForTheme(status, "night");
}

/**
 * @param {string} [status]
 * @param {"day" | "night"} [theme]
 */
export function sliceStatusVisualForTheme(status, theme = "night") {
  const colors = reviewStatusColorsForTheme(theme);
  const key = status && Object.prototype.hasOwnProperty.call(colors, status) ? status : "pending";
  return colors[key];
}