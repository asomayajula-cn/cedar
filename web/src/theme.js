const STORAGE_KEY = "cedar.uiTheme";

/** @typedef {"night" | "day"} AppTheme */

/**
 * @returns {AppTheme}
 */
export function getStoredTheme() {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "day" || v === "night") return v;
  return "night";
}

/**
 * @returns {AppTheme}
 */
export function getResolvedTheme() {
  return document.documentElement.dataset.theme === "day" ? "day" : "night";
}

/**
 * @param {AppTheme} theme
 */
export function applyAppTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "day" ? "#f4f4f5" : "#050505");
  window.dispatchEvent(new CustomEvent("cedar-theme-change", { detail: { theme } }));
  syncThemeToggleUi();
}

export function initAppTheme() {
  applyAppTheme(getStoredTheme());
}

export function toggleAppTheme() {
  applyAppTheme(getResolvedTheme() === "day" ? "night" : "day");
}

function syncThemeToggleUi() {
  const theme = getResolvedTheme();
  document.querySelectorAll("[data-cedar-theme-toggle]").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.setAttribute("aria-pressed", theme === "day" ? "true" : "false");
    btn.title = theme === "day" ? "Switch to night theme" : "Switch to day theme";
  });
}

export function wireAppThemeToggle(root = document) {
  root.querySelectorAll("[data-cedar-theme-toggle]").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement) || btn.dataset.wiredTheme) return;
    btn.dataset.wiredTheme = "1";
    btn.addEventListener("click", () => toggleAppTheme());
  });
  syncThemeToggleUi();
}

/**
 * @param {(theme: AppTheme) => void} fn
 */
export function onAppThemeChange(fn) {
  window.addEventListener("cedar-theme-change", (ev) => {
    const theme = ev instanceof CustomEvent && ev.detail?.theme === "day" ? "day" : "night";
    fn(theme);
  });
}