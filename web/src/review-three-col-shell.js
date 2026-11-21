import {
  architectureIconSvg,
  codeMapCloseExpandIconSvg,
  codeMapExpandIconSvg,
  findingsIconSvg,
  panelCollapseLeftIconSvg,
  panelCollapseRightIconSvg,
  panelExpandLeftIconSvg,
  panelExpandRightIconSvg,
  slicesIconSvg,
} from "./cedar-icons.js";
import { renderReviewIconRailHtml } from "./review-icon-nav.js";

/**
 * @param {string} text
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @deprecated Center restore controls removed — edge icon toggles on the workspace layout. */
export function renderReviewRailRestoreButtonsHtml() {
  return "";
}

function renderReviewRailEdgeToggle(side, variant = "in-rail") {
  const isLeft = side === "left";
  const collapseSvg = isLeft
    ? panelCollapseLeftIconSvg("cedar-rail-edge-icon")
    : panelCollapseRightIconSvg("cedar-rail-edge-icon");
  const expandSvg = isLeft
    ? panelExpandLeftIconSvg("cedar-rail-edge-icon")
    : panelExpandRightIconSvg("cedar-rail-edge-icon");
  const label = isLeft ? "Navigation panel" : "Code map panel";
  const variantClass =
    variant === "affordance"
      ? " cedar-review-rail-edge--affordance cedar-review-rail-edge--in-tabs"
      : " cedar-review-rail-edge--in-rail";
  return `<button type="button"
      class="cedar-review-rail-edge cedar-review-rail-edge--${side}${variantClass}"
      data-review-rail-toggle="${side}"
      aria-controls="${isLeft ? "cedar-review-left-nav" : "cedar-review-right-nav"}"
      aria-expanded="true"
      title="Hide ${label.toLowerCase()}"
      aria-label="Hide ${label.toLowerCase()}">
      <span class="cedar-rail-edge-icon-wrap cedar-rail-edge-icon-wrap--collapse" aria-hidden="true">${collapseSvg}</span>
      <span class="cedar-rail-edge-icon-wrap cedar-rail-edge-icon-wrap--expand" hidden aria-hidden="true">${expandSvg}</span>
    </button>`;
}

export function renderCodeMapFlyoutPanelHtml() {
  return `<aside id="cedar-review-right-nav" class="cedar-review-right-nav cedar-review-rail cedar-file-flow-rail-wrap cedar-code-map-flyout-panel min-h-0 min-w-0" aria-label="Code map" aria-hidden="true">
        <div
          class="cedar-code-map-flyout-splitter"
          data-code-map-flyout-splitter
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize code map flyout"
          tabindex="0"
          title="Drag to resize code map · double-click to reset"
        ></div>
        <header class="cedar-review-rail-toolbar cedar-review-rail-toolbar--code-map">
          <p class="cedar-review-rail-title cedar-rail-label mb-0 shrink-0">Code map</p>
          <div
            id="cedar-code-map-view-tablist"
            class="cedar-code-map-view-tabs cedar-code-map-view-tabs--toolbar min-w-0 flex-1"
            role="tablist"
            aria-label="Structure, behavior, and functionality"
            hidden
          ></div>
          <div class="cedar-code-map-zoom-controls shrink-0" role="group" aria-label="Zoom code map">
            <button type="button" class="cedar-code-map-zoom-btn" data-code-map-zoom="out" aria-label="Zoom out" title="Zoom out">−</button>
            <button type="button" class="cedar-code-map-zoom-btn" data-code-map-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>
            <button type="button" class="cedar-code-map-zoom-btn cedar-code-map-reset-btn" data-code-map-reset aria-label="Reset view" title="Reset zoom and pan">↺</button>
          </div>
          <button type="button"
            class="cedar-code-map-expand-btn cedar-review-rail-edge cedar-review-rail-edge--expand-map"
            data-code-map-expand
            aria-pressed="false"
            aria-label="Close code map"
            title="Close code map">
            <span class="cedar-rail-edge-icon-wrap cedar-code-map-expand-icon--open" hidden aria-hidden="true">${codeMapExpandIconSvg("cedar-rail-edge-icon")}</span>
            <span class="cedar-rail-edge-icon-wrap cedar-code-map-expand-icon--close" aria-hidden="true">${codeMapCloseExpandIconSvg("cedar-rail-edge-icon")}</span>
          </button>
        </header>
        <div class="cedar-review-rail-body cedar-file-flow-rail cedar-review-rail-section--map min-h-0 min-w-0 flex-1">
          <div class="cedar-code-map-meta">
            <p id="cedar-file-flow-profile" class="cedar-file-flow-profile" hidden></p>
            <p class="cedar-file-flow-hint">Choose a file, then switch Structure / Behavior / Functionality in the toolbar above the map.</p>
            <p id="cedar-file-flow-path" class="cedar-file-flow-path font-mono" aria-label="Selected file">Select a file in the diff</p>
            <div id="cedar-file-flow-overview" class="cedar-code-map-overview" hidden aria-live="polite"></div>
            <div id="cedar-file-flow-summary" class="cedar-code-map-summary" hidden aria-hidden="true"></div>
            <p id="cedar-file-flow-what" class="cedar-file-flow-what" hidden aria-hidden="true"></p>
          </div>
          <div id="cedar-file-flow-stage" class="cedar-file-flow-stage min-h-0 flex-1">
            <p class="cedar-file-flow-empty text-balance text-center">Open <strong>Slices</strong>, then use the <strong>[]</strong> control on a file header for its architecture map.</p>
          </div>
        </div>
      </aside>`;
}

export function renderPrChatCardHtml() {
  return `<div class="cedar-pr-chat-panel cedar-pr-chat-card cedar-pr-chat-card--compact">
          <p class="cedar-left-drawer-heading">Ask about this PR</p>
          <p class="cedar-left-drawer-hint mb-2">Composer · review context</p>
          <div class="cedar-pr-chat-log" id="cedar-pr-chat-log" aria-live="polite" aria-relevant="additions"></div>
          <form class="cedar-pr-chat-form">
            <label class="sr-only" for="cedar-pr-chat-input">Question about this pull request</label>
            <textarea id="cedar-pr-chat-input" class="cedar-pr-chat-input" rows="4" maxlength="2000"
              placeholder="Architecture, slices, blockers, what changed…"></textarea>
            <div class="cedar-pr-chat-actions">
              <button type="submit" class="cedar-pr-chat-send cedar-btn-secondary">Send</button>
            </div>
          </form>
          <p class="cedar-pr-chat-status" hidden></p>
        </div>`;
}

/**
 * @param {{
 *   centerMainHtml: string,
 *   sidebarSliceList: string,
 *   gate: { ready: boolean, blockedReason?: string },
 *   cursorRollupHtml?: string,
 *   cursorRollupVisible?: boolean,
 * }} opts
 */
export function renderThreeColumnReviewChrome(opts) {
  const gate = opts.gate ?? { ready: false };
  const gateMsg = gate.ready ? "Composite review is ready." : escapeHtml(gate.blockedReason ?? "Composite pending.");
  const gateClass = gate.ready ? "cedar-review-left-nav-gate--ready" : "cedar-review-left-nav-gate--pending";

  return `<div class="cedar-review-layout cedar-review-layout--three-col cedar-review-layout--slice-queue cedar-review-layout--icon-nav cedar-review-layout--code-map-flyout-only cedar-review-product" id="cedar-review-workspace" data-left-drawer="slices">
      <div class="cedar-review-left-cluster min-h-0 min-w-0" id="cedar-review-left-cluster">
        ${renderReviewIconRailHtml()}
        <aside id="cedar-review-left-drawer" class="cedar-review-left-drawer cedar-review-rail min-h-0 min-w-0" aria-label="Review panels">
          <div class="cedar-left-drawer-panel is-active" data-left-drawer-panel="slices" id="cedar-review-left-nav">
            <p class="cedar-left-drawer-heading cedar-rail-label-with-icon mb-2">${slicesIconSvg("cedar-rail-icon")}<span>Review queue</span></p>
            <div class="cedar-review-rail-body cedar-slices-nav-rail min-h-0 min-w-0 flex-1">
              <section class="cedar-review-rail-section cedar-review-rail-section--rollup cedar-cursor-rollup-card${
                opts.cursorRollupVisible ? "" : " hidden"
              }">${opts.cursorRollupHtml ?? ""}</section>
              <section class="cedar-review-rail-section cedar-review-rail-section--slices cedar-slices-nav-slices cedar-review-rail-slices" aria-label="Micro slices">
                <div class="cedar-pipeline-slice-list cedar-slice-tablist" role="tablist" aria-label="Micro slices">${opts.sidebarSliceList}</div>
              </section>
              <footer class="cedar-review-rail-footer cedar-review-left-rail-footer">
                <p class="cedar-review-left-nav-gate ${gateClass}">${gateMsg}</p>
                <button type="button" id="new-review-btn" class="cedar-review-left-nav-action cedar-btn-secondary w-full text-xs">New review</button>
              </footer>
            </div>
          </div>
          <div class="cedar-left-drawer-panel cedar-left-drawer-panel--files" data-left-drawer-panel="files" hidden>
            <p class="cedar-left-drawer-heading cedar-left-drawer-heading--files">Changed files</p>
            <p class="cedar-left-drawer-hint mb-2">Active slice · jump to diff in the center panel</p>
            <div id="cedar-files-drawer-host" class="cedar-files-drawer-host min-h-0 min-w-0 flex-1 w-full"></div>
          </div>
          <div class="cedar-left-drawer-panel cedar-left-drawer-panel--findings" data-left-drawer-panel="findings" hidden>
            <p class="cedar-left-drawer-heading cedar-left-drawer-heading--findings cedar-rail-label-with-icon">
              ${findingsIconSvg("cedar-rail-icon")}<span>Code findings</span>
            </p>
            <p id="cedar-findings-drawer-meta" class="cedar-left-drawer-hint mb-2">Active slice · Cursor &amp; checklist items</p>
            <div id="cedar-findings-drawer-host" class="cedar-findings-drawer-host min-h-0 min-w-0 flex-1 w-full"></div>
          </div>
          <div class="cedar-left-drawer-panel cedar-left-drawer-panel--chat" data-left-drawer-panel="chat" hidden>
            ${renderPrChatCardHtml()}
          </div>
        </aside>
      </div>
      <div
        class="cedar-col-splitter cedar-review-left-splitter cedar-slices-nav-splitter"
        data-slices-nav-splitter
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left navigation"
        tabindex="0"
        title="Drag to resize left panel · double-click to reset"
      ></div>
      <main class="cedar-review-center cedar-review-main cedar-review-main-body min-h-0 min-w-0 flex-1">
        ${opts.centerMainHtml}
      </main>
    </div>
    ${renderCodeMapFlyoutPanelHtml()}`;
}

/**
 * @param {{ activeTab?: "architecture" | "slices", sliceCount?: number, placeholder?: boolean }} [opts]
 */
export function renderReviewMainTabsHeadHtml(opts = {}) {
  const activeTab = opts.activeTab ?? "architecture";
  const sliceCount = opts.sliceCount ?? 0;
  const placeholder = opts.placeholder ?? false;
  const archActive = activeTab === "architecture";
  const slicesActive = activeTab === "slices";
  const placeholderClass = placeholder ? " cedar-review-tabs-head--placeholder" : "";
  const disabledAttr = placeholder ? ' disabled tabindex="-1" aria-disabled="true"' : ' type="button"';

  return `<div class="cedar-review-main-tabs cedar-review-view-band"${placeholder ? " data-review-pr-subnav-placeholder" : ""}>
        <header class="cedar-review-tabs-head cedar-review-tabs-head--saas cedar-review-view-band-head cedar-review-view-band-head--centered min-h-0 w-full shrink-0${placeholderClass}">
          <div class="cedar-main-tablist cedar-main-tablist--view-band min-w-0 shrink-0" role="tablist" aria-label="Pull request views">
            <button class="cedar-main-tab cedar-main-tab--saas${slicesActive ? " is-active" : ""}"${disabledAttr} role="tab" data-review-tab="slices"
              aria-selected="${slicesActive ? "true" : "false"}">
              ${slicesIconSvg("cedar-main-tab-icon")}
              <span>Review</span>
              ${sliceCount ? `<span class="cedar-main-tab-count cedar-main-tab-count--saas tabular-nums">${sliceCount}</span>` : ""}
            </button>
            <button class="cedar-main-tab cedar-main-tab--saas${archActive ? " is-active" : ""}"${disabledAttr} role="tab" data-review-tab="architecture"
              aria-selected="${archActive ? "true" : "false"}">
              ${architectureIconSvg("cedar-main-tab-icon")}
              <span>Architecture</span>
            </button>
          </div>
        </header>
      </div>`;
}

export function renderLoadingReviewCenterMain() {
  return `<div id="review-progress-panel" class="cedar-main-tabpanel cedar-review-stage cedar-review-loading-panel">
          <div class="cedar-review-progress-head cedar-review-loading-head">
            <span class="cedar-review-progress-status-dot" aria-hidden="true"></span>
            <p class="cedar-review-progress-label mb-0">Review in progress…</p>
          </div>
          <p id="review-progress-status" class="cedar-review-progress-status">Connecting…</p>
          <ul id="review-progress-log" class="review-progress-log cedar-review-progress-log" aria-live="polite"></ul>
        </div>`;
}