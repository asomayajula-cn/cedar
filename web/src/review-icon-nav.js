import {
  architectureIconSvg,
  chatIconSvg,
  codeMapExpandIconSvg,
  filesIconSvg,
  findingsIconSvg,
  slicesIconSvg,
} from "./cedar-icons.js";
import { normalizeReviewFile, renderGhFilesSidebar, wireGhFilesSidebar } from "./diff-view.js";
import { findingKey, findingsForSlice, isFindingIgnored, wireFindingActions } from "./finding-actions.js";
import { buildFindingsListHtml } from "./review-findings-ui.js";

const LEFT_DRAWER_KEY = "cedar.reviewLeftDrawerPanel";

/**
 * @param {typeof window.__cedarSession | undefined} session
 */
export function countPrActiveFindings(session) {
  const data = session?.data;
  if (!data?.microResults?.length) return 0;
  let n = 0;
  for (const r of data.microResults) {
    if (r.status === "skipped") continue;
    const list = findingsForSlice(r.componentId, r);
    list.forEach((f, i) => {
      if (!isFindingIgnored(findingKey(r.componentId, f, i))) n += 1;
    });
  }
  return n;
}

/**
 * @param {HTMLElement} layout
 * @param {typeof window.__cedarSession | undefined} session
 */
function syncFindingsRailAlert(layout, session) {
  const findingsBtn = layout.querySelector('[data-left-drawer-tab="findings"]');
  if (!(findingsBtn instanceof HTMLButtonElement)) return;

  const total = countPrActiveFindings(session);
  const pending = Boolean(session?.data?.cursorReviewPending);
  const drawerOpen = layout.dataset.leftDrawer === "findings";
  const countLabel = findingsBtn.querySelector(".cedar-review-icon-rail-count");

  const showAlert = total > 0 && !pending && !drawerOpen;
  findingsBtn.classList.toggle("is-findings-available", showAlert);
  findingsBtn.classList.toggle("has-findings-count", total > 0 && !pending);

  if (countLabel instanceof HTMLElement) {
    if (total > 0 && !pending) {
      countLabel.textContent = total > 99 ? "99+" : String(total);
      countLabel.hidden = false;
    } else {
      countLabel.textContent = "";
      countLabel.hidden = true;
    }
  }

  if (total > 0 && !pending) {
    findingsBtn.setAttribute("title", `Code findings (${total} in PR)`);
    findingsBtn.setAttribute("aria-label", `Code findings, ${total} in pull request`);
  } else if (pending) {
    findingsBtn.setAttribute("title", "Code findings — after Cursor review");
    findingsBtn.setAttribute("aria-label", "Code findings, pending review");
  } else {
    findingsBtn.setAttribute("title", "Code findings");
    findingsBtn.setAttribute("aria-label", "Code findings");
  }
}

/** @typedef {"slices" | "files" | "findings" | "chat" | null} LeftDrawerPanel */

/**
 * @param {HTMLElement} layout
 * @param {LeftDrawerPanel} panel
 */
export function setLeftDrawerPanel(layout, panel) {
  if (!(layout instanceof HTMLElement)) return;
  const drawer = layout.querySelector("#cedar-review-left-drawer");
  layout.classList.toggle("is-left-drawer-closed", panel === null);
  layout.dataset.leftDrawer = panel ?? "";
  if (panel) localStorage.setItem(LEFT_DRAWER_KEY, panel);
  else localStorage.removeItem(LEFT_DRAWER_KEY);

  layout.querySelectorAll("[data-left-drawer-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    const tab = btn.getAttribute("data-left-drawer-tab");
    const on = panel !== null && tab === panel;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  if (drawer instanceof HTMLElement) {
    drawer.querySelectorAll("[data-left-drawer-panel]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const on = panel !== null && el.getAttribute("data-left-drawer-panel") === panel;
      el.hidden = !on;
      el.classList.toggle("is-active", on);
    });
  }

  if (layout.classList.contains("cedar-review-layout--icon-nav")) {
    syncFindingsRailAlert(layout, window.__cedarSession);
  }

  window.dispatchEvent(new Event("resize"));
}

/**
 * @param {ParentNode} root
 */
export function refreshFilesDrawerPanel(root) {
  const layout = root.querySelector(".cedar-review-layout--icon-nav");
  if (!layout) return;
  const host = layout.querySelector("#cedar-files-drawer-host");
  if (!(host instanceof HTMLElement)) return;

  const slicePanel = root.querySelector(".cedar-slice-panel.is-active-slice");
  const sliceId = slicePanel?.getAttribute("data-slice-panel") ?? "slice";
  const session = window.__cedarSession?.data;
  const micro = session?.microPrs?.find((m) => m.componentId === sliceId);
  let files = (micro?.files ?? []).map((f) => normalizeReviewFile(f));

  if (!files.length && slicePanel) {
    slicePanel.querySelectorAll(".cedar-gh-file[data-file-path]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const path = el.getAttribute("data-file-path");
      if (!path) return;
      const additions = Number(el.dataset.fileAdditions);
      const deletions = Number(el.dataset.fileDeletions);
      files.push({
        path,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
        status: "modified",
      });
    });
  }

  if (!files.length) {
    const reviewing = Boolean(window.__cedarSession?.data?.cursorReviewPending);
    const sliceHint = slicePanel
      ? "This slice has no file list yet."
      : "Pick a slice in <strong>Slices</strong>, or wait for the review to finish partitioning.";
    host.innerHTML = `<p class="cedar-files-drawer-empty text-[11px] leading-snug text-zinc-500 px-1">${
      reviewing ? "Review in progress — file list fills in per slice." : sliceHint
    }</p>`;
    return;
  }

  host.innerHTML = renderGhFilesSidebar(files, `drawer-${sliceId}`).replace(
    'class="cedar-gh-files-sidebar"',
    'class="cedar-gh-files-sidebar cedar-gh-files-sidebar--drawer"'
  );
  const sidebar = host.querySelector("[data-gh-files-sidebar]");
  if (sidebar instanceof HTMLElement) delete sidebar.dataset.wiredGhSidebar;
  wireGhFilesSidebar(root);
}

/**
 * @param {ParentNode} root
 */
export function refreshFindingsDrawerPanel(root) {
  const layout = root.querySelector(".cedar-review-layout--icon-nav");
  if (!layout) return;
  const host = layout.querySelector("#cedar-findings-drawer-host");
  const meta = layout.querySelector("#cedar-findings-drawer-meta");
  if (!(host instanceof HTMLElement)) return;

  const slicePanel = root.querySelector(".cedar-slice-panel.is-active-slice");
  const sliceId = slicePanel?.getAttribute("data-slice-panel");
  const session = window.__cedarSession;
  const data = session?.data;
  const sliceResult =
    sliceId && data?.microResults
      ? data.microResults.find((m) => m.componentId === sliceId)
      : data?.microResults?.find((m) => m.status !== "skipped");

  if (meta instanceof HTMLElement) {
    const name = sliceResult?.componentName ?? slicePanel?.querySelector(".cedar-slice-queue-title")?.textContent?.trim();
    meta.textContent = name ? `${name} · Cursor & checklist` : "Active slice · Cursor & checklist items";
  }

  if (!sliceResult) {
    const reviewing = Boolean(data?.cursorReviewPending);
    host.innerHTML = `<p class="cedar-findings-drawer-empty text-[11px] leading-snug text-zinc-500 px-1">${
      reviewing
        ? "Findings appear after Cursor reviews each slice."
        : "Pick a slice in <strong>Slices</strong> to list code findings here."
    }</p>`;
    syncFindingsRailAlert(layout, session);
    return;
  }

  const { html } = buildFindingsListHtml(sliceResult, session);

  host.innerHTML = `<div class="cedar-findings-panel cedar-slice-findings-panel cedar-findings-drawer-body">
    <div class="cedar-findings-panel-body">${html}</div>
  </div>`;

  syncFindingsRailAlert(layout, session);
  wireFindingActions(root, () => window.__cedarPatchFindings?.());
}

/**
 * Refresh rail badge / pulse after Cursor review completes. Returns active finding count.
 * @param {ParentNode} root
 */
export function alertFindingsAvailableAfterReview(root) {
  const session = window.__cedarSession;
  if (!session?.data || session.data.cursorReviewPending) return 0;
  refreshFindingsDrawerPanel(root);
  return countPrActiveFindings(session);
}

function readStoredLeftDrawer() {
  const v = localStorage.getItem(LEFT_DRAWER_KEY);
  if (v === "slices" || v === "files" || v === "findings" || v === "chat") return v;
  return "slices";
}

export function renderReviewIconRailHtml() {
  return `<nav class="cedar-review-icon-rail" aria-label="Open review panels">
    <button type="button" class="cedar-review-icon-rail-btn is-active" data-left-drawer-tab="slices"
      aria-pressed="true" title="Slices queue" aria-label="Slices queue">
      ${slicesIconSvg("cedar-review-icon-rail-svg")}
      <span class="cedar-review-icon-rail-label">Slices</span>
    </button>
    <button type="button" class="cedar-review-icon-rail-btn" data-left-drawer-tab="files"
      aria-pressed="false" title="Files in slice" aria-label="Files in slice">
      ${filesIconSvg("cedar-review-icon-rail-svg")}
      <span class="cedar-review-icon-rail-label">Files</span>
    </button>
    <button type="button" class="cedar-review-icon-rail-btn" data-left-drawer-tab="findings"
      aria-pressed="false" title="Code findings" aria-label="Code findings">
      ${findingsIconSvg("cedar-review-icon-rail-svg")}
      <span class="cedar-review-icon-rail-count" hidden aria-hidden="true"></span>
      <span class="cedar-review-icon-rail-label">Findings</span>
    </button>
    <button type="button" class="cedar-review-icon-rail-btn" data-left-drawer-tab="chat"
      aria-pressed="false" title="Ask about PR" aria-label="Ask about PR">
      ${chatIconSvg("cedar-review-icon-rail-svg")}
      <span class="cedar-review-icon-rail-label">Chat</span>
    </button>
    <button type="button" class="cedar-review-icon-rail-btn" data-review-tab="architecture"
      title="Architecture" aria-label="Architecture view">
      ${architectureIconSvg("cedar-review-icon-rail-svg")}
      <span class="cedar-review-icon-rail-label">Arch</span>
    </button>
    <button type="button" class="cedar-review-icon-rail-btn cedar-code-map-flyout-tab" data-code-map-flyout-tab
      aria-pressed="false" title="Code map" aria-label="Code map">
      ${codeMapExpandIconSvg("cedar-review-icon-rail-svg")}
      <span class="cedar-review-icon-rail-label">Map</span>
    </button>
  </nav>`;
}

/**
 * @param {ParentNode} root
 * @param {(root: ParentNode, tab: "architecture" | "slices") => void} [onMainTab]
 */
export function wireReviewIconNav(root, onMainTab) {
  const layout = root.querySelector(".cedar-review-layout--icon-nav");
  if (!(layout instanceof HTMLElement)) return;

  const initial = readStoredLeftDrawer();
  setLeftDrawerPanel(layout, initial);
  refreshFilesDrawerPanel(root);
  refreshFindingsDrawerPanel(root);

  if (layout.dataset.wiredIconNav) return;
  layout.dataset.wiredIconNav = "1";

  layout.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;

    const archBtn = t.closest(".cedar-review-icon-rail [data-review-tab='architecture']");
    if (archBtn instanceof HTMLButtonElement && layout.contains(archBtn)) {
      ev.preventDefault();
      setLeftDrawerPanel(layout, null);
      onMainTab?.(root, "architecture");
      layout.querySelectorAll(".cedar-review-icon-rail-btn").forEach((b) => {
        if (b instanceof HTMLButtonElement && !b.hasAttribute("data-code-map-flyout-tab")) {
          b.classList.remove("is-active");
          b.setAttribute("aria-pressed", "false");
        }
      });
      archBtn.classList.add("is-active");
      return;
    }

    const drawerBtn = t.closest("[data-left-drawer-tab]");
    if (!(drawerBtn instanceof HTMLButtonElement) || !layout.contains(drawerBtn)) return;
    if (drawerBtn.hasAttribute("data-review-tab")) return;
    ev.preventDefault();

    const tab = drawerBtn.getAttribute("data-left-drawer-tab");
    if (tab !== "slices" && tab !== "files" && tab !== "findings" && tab !== "chat") return;

    const current = layout.dataset.leftDrawer;
    const next = current === tab ? null : tab;
    setLeftDrawerPanel(layout, next);
    if (next === "files" || tab === "files") refreshFilesDrawerPanel(root);
    if (next === "findings" || tab === "findings") refreshFindingsDrawerPanel(root);
    /* Left rail drawers (slices list, files, etc.) do not change the center Architecture vs Review tab. */
    if (next === "findings" || tab === "findings") onMainTab?.(root, "slices");
  });
}