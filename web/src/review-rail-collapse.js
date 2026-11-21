import { scheduleDiagramRefit } from "./diagram-ux.js";

const LEFT_COLLAPSED_KEY = "cedar.reviewLeftNavCollapsed";
const RIGHT_COLLAPSED_KEY = "cedar.reviewRightNavCollapsed";

/**
 * @param {HTMLElement} layout
 * @param {"left" | "right"} side
 * @param {boolean} collapsed
 */
export function setReviewRailCollapsed(layout, side, collapsed) {
  if (!(layout instanceof HTMLElement)) return;
  if (side === "left") {
    layout.classList.toggle("is-left-nav-collapsed", collapsed);
  } else if (side === "right") {
    layout.classList.toggle("is-right-nav-collapsed", collapsed);
  } else {
    return;
  }
  const key = side === "left" ? LEFT_COLLAPSED_KEY : RIGHT_COLLAPSED_KEY;
  if (collapsed) localStorage.setItem(key, "1");
  else localStorage.removeItem(key);
  syncRailCollapseControls(layout);
  layout.scrollLeft = 0;
  window.dispatchEvent(new Event("resize"));
  scheduleDiagramRefit(layout);
}

/**
 * @param {HTMLElement} layout
 */
function syncRailCollapseControls(layout) {
  const leftCollapsed = layout.classList.contains("is-left-nav-collapsed");
  const rightCollapsed = layout.classList.contains("is-right-nav-collapsed");

  layout.querySelectorAll("[data-review-rail-toggle]").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    const side = btn.getAttribute("data-review-rail-toggle");
    if (side !== "left" && side !== "right") return;
    const collapsed = side === "left" ? leftCollapsed : rightCollapsed;
    if (side === "right" && layout.classList.contains("cedar-review-layout--code-map-flyout-only")) {
      btn.hidden = true;
      return;
    }
    const panelLabel = side === "left" ? "navigation panel" : "code map panel";
    const inTabs = btn.classList.contains("cedar-review-rail-edge--in-tabs");
    btn.hidden = inTabs ? collapsed === false : collapsed;
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.title = collapsed ? `Show ${panelLabel}` : `Hide ${panelLabel}`;
    btn.setAttribute("aria-label", collapsed ? `Show ${panelLabel}` : `Hide ${panelLabel}`);
    btn.classList.toggle("is-rail-collapsed", collapsed);
    const collapseWrap = btn.querySelector(".cedar-rail-edge-icon-wrap--collapse");
    const expandWrap = btn.querySelector(".cedar-rail-edge-icon-wrap--expand");
    if (collapseWrap instanceof HTMLElement) collapseWrap.hidden = collapsed;
    if (expandWrap instanceof HTMLElement) expandWrap.hidden = !collapsed;
  });
}

/**
 * @param {ParentNode} root
 */
function applyStoredRailCollapse(layout) {
  if (!(layout instanceof HTMLElement)) return;
  if (localStorage.getItem(LEFT_COLLAPSED_KEY) === "1") {
    layout.classList.add("is-left-nav-collapsed");
  }
  if (
    !layout.classList.contains("cedar-review-layout--code-map-flyout-only") &&
    localStorage.getItem(RIGHT_COLLAPSED_KEY) === "1"
  ) {
    layout.classList.add("is-right-nav-collapsed");
  }
  syncRailCollapseControls(layout);
}

/**
 * @param {ParentNode} root
 */
export function wireReviewRailCollapse(root) {
  const layout = root.querySelector(".cedar-review-layout--three-col");
  if (!(layout instanceof HTMLElement)) return;

  applyStoredRailCollapse(layout);

  if (layout.dataset.wiredRailCollapse) return;
  layout.dataset.wiredRailCollapse = "1";

  layout.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest("[data-review-rail-toggle]");
    if (!(btn instanceof HTMLButtonElement) || !layout.contains(btn)) return;
    const side = btn.getAttribute("data-review-rail-toggle");
    if (side !== "left" && side !== "right") return;
    if (side === "right" && layout.classList.contains("cedar-review-layout--code-map-flyout-only")) return;
    ev.preventDefault();
    ev.stopPropagation();
    const collapsed =
      side === "left"
        ? layout.classList.contains("is-left-nav-collapsed")
        : layout.classList.contains("is-right-nav-collapsed");
    setReviewRailCollapsed(layout, side, !collapsed);
  });
}