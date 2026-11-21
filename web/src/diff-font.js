const STORAGE_KEY = "cedar.diffFontPreset";

/** @type {Record<string, { size: number, line: number, label: string }>} */
export const DIFF_FONT_PRESETS = {
  xs: { size: 8, line: 14, label: "XS" },
  sm: { size: 11, line: 18, label: "S" },
  md: { size: 12, line: 20, label: "M" },
  lg: { size: 13, line: 21, label: "L" },
  xl: { size: 14, line: 22, label: "XL" },
};

/**
 * @param {{ preset?: string, sizePx?: number, linePx?: number } | undefined} serverDefault
 */
export function initDiffFontFromServer(serverDefault) {
  if (!serverDefault) return;
  window.__cedarDiffFontDefault = serverDefault;
}

/**
 * @returns {string}
 */
export function getActiveDiffFontPreset() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && DIFF_FONT_PRESETS[stored]) return stored;
  const fromServer = window.__cedarDiffFontDefault?.preset;
  if (fromServer && DIFF_FONT_PRESETS[fromServer]) return fromServer;
  return "xs";
}

/**
 * @returns {{ size: number, line: number, preset: string }}
 */
export function getDiffFontSettings() {
  const customPx = window.__cedarDiffFontDefault?.sizePx;
  const customLine = window.__cedarDiffFontDefault?.linePx;
  const preset = getActiveDiffFontPreset();
  const base = DIFF_FONT_PRESETS[preset] ?? DIFF_FONT_PRESETS.md;
  if (!localStorage.getItem(STORAGE_KEY) && Number.isFinite(customPx)) {
    return {
      preset,
      size: /** @type {number} */ (customPx),
      line: Number.isFinite(customLine) ? /** @type {number} */ (customLine) : Math.round(customPx * 1.67),
    };
  }
  return { preset, size: base.size, line: base.line };
}

/**
 * @param {HTMLElement} host
 */
export function applyDiffFontTo(host) {
  const { size, line } = getDiffFontSettings();
  host.style.setProperty("--cedar-diff-font-size", `${size}px`);
  host.style.setProperty("--cedar-diff-line-height", `${line}px`);
}

/** Keep left-rail slice labels readable and aligned with the active diff size preset. */
export function applySliceNavTypography() {
  const { size } = getDiffFontSettings();
  const labelPx = Math.min(13, Math.max(10, size + 2));
  const metaPx = Math.max(9, labelPx - 2);
  const indent = Math.round(8 + 6 + Math.max(0, labelPx - 11));
  const nav = document.getElementById("cedar-review-left-nav");
  if (!(nav instanceof HTMLElement)) return;
  nav.style.setProperty("--cedar-slice-nav-label-size", `${labelPx}px`);
  nav.style.setProperty("--cedar-slice-nav-meta-size", `${metaPx}px`);
  nav.style.setProperty("--cedar-slice-nav-files-size", `${metaPx}px`);
  nav.style.setProperty("--cedar-slice-nav-line-height", `${Math.round(metaPx * 1.45)}px`);
  nav.style.setProperty("--cedar-slice-nav-indent", `${indent}px`);
}

/**
 * @param {string} [activePreset]
 */
export function renderDiffFontControl(activePreset = getActiveDiffFontPreset()) {
  const buttons = Object.entries(DIFF_FONT_PRESETS)
    .map(
      ([id, p]) =>
        `<button type="button" class="cedar-gh-diff-font${activePreset === id ? " is-active" : ""}" data-diff-font="${id}" title="${p.size}px">${p.label}</button>`
    )
    .join("");
  return `<div class="cedar-gh-diff-font-toggle" role="group" aria-label="Diff font size">${buttons}</div>`;
}

/**
 * @param {ParentNode} root
 */
export function wireDiffFontControls(root) {
  root.querySelectorAll(".cedar-gh-files-changed").forEach((host) => {
    if (!(host instanceof HTMLElement)) return;
    applyDiffFontTo(host);

    host.querySelectorAll("[data-diff-font]").forEach((btn) => {
      if (btn.dataset.wiredFont) return;
      btn.dataset.wiredFont = "1";
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-diff-font");
        if (!id || !DIFF_FONT_PRESETS[id]) return;
        localStorage.setItem(STORAGE_KEY, id);
        document.querySelectorAll(".cedar-gh-files-changed").forEach((el) => {
          if (el instanceof HTMLElement) {
            applyDiffFontTo(el);
            el.querySelectorAll("[data-diff-font]").forEach((b) => {
              b.classList.toggle("is-active", b.getAttribute("data-diff-font") === id);
            });
          }
        });
        applySliceNavTypography();
        window.dispatchEvent(new CustomEvent("cedar-diff-font-change", { detail: { preset: id } }));
      });
    });
  });
  applySliceNavTypography();
}

/**
 * @param {string | undefined} raw
 */
export function parseDiffFontEnv(raw) {
  const fallback = { preset: "xs", sizePx: 8, linePx: 14 };
  if (!raw?.trim()) return fallback;
  const v = raw.trim().toLowerCase();
  if (v in DIFF_FONT_PRESETS) {
    const p = DIFF_FONT_PRESETS[v];
    return { preset: v, sizePx: p.size, linePx: p.line };
  }
  const n = Number(v);
  if (Number.isFinite(n) && n >= 8 && n <= 16) {
    let preset = "xs";
    if (n <= 8) preset = "xs";
    else if (n <= 10) preset = "sm";
    else if (n <= 11) preset = "md";
    else if (n <= 12) preset = "lg";
    else preset = "xl";
    return { preset, sizePx: n, linePx: Math.round(n * 1.67) };
  }
  return fallback;
}