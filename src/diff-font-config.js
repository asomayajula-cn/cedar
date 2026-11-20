const PRESETS = {
  xs: { size: 8, line: 14 },
  sm: { size: 11, line: 18 },
  md: { size: 12, line: 20 },
  lg: { size: 13, line: 21 },
  xl: { size: 14, line: 22 },
};

/**
 * @returns {{ preset: string, sizePx: number, linePx: number }}
 */
export function resolveDiffFontConfig() {
  const raw = process.env.CEDAR_DIFF_FONT_SIZE?.trim();
  if (!raw) {
    return { preset: "xs", sizePx: 8, linePx: 14 };
  }
  const v = raw.toLowerCase();
  if (v in PRESETS) {
    const p = PRESETS[/** @type {keyof typeof PRESETS} */ (v)];
    return { preset: v, sizePx: p.size, linePx: p.line };
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 8 && n <= 16) {
    let preset = "md";
    if (n <= 8) preset = "xs";
    else if (n <= 10) preset = "sm";
    else if (n <= 12) preset = "md";
    else if (n <= 13) preset = "lg";
    else preset = "xl";
    return { preset, sizePx: n, linePx: Math.round(n * 1.67) };
  }
  return { preset: "xs", sizePx: 8, linePx: 14 };
}