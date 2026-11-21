import { refreshReviewIconSvg } from "./cedar-icons.js";

/** Poll interval while review UI is mounted (ms). */
const PR_HEAD_POLL_MS = 45_000;

export const PR_REFRESH_REVIEW_LABEL = "Refresh review";

/**
 * @param {string} [extraClass]
 */
export function renderPrRefreshReviewButtonHtml(extraClass = "") {
  const cls = ["cedar-btn-secondary", "cedar-btn-compact", "cedar-pr-refresh-btn", extraClass]
    .filter(Boolean)
    .join(" ");
  return `<button type="button" class="${cls}" data-pr-refresh-review
    title="Re-fetch this PR at the latest commit (diffs, maps, architecture)"
    aria-label="${PR_REFRESH_REVIEW_LABEL}">
    <span class="cedar-pr-refresh-icon" data-pr-refresh-icon aria-hidden="true">${refreshReviewIconSvg()}</span>
    <span data-pr-refresh-label>${PR_REFRESH_REVIEW_LABEL}</span>
  </button>`;
}

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {boolean} */
let wiredDoc = false;
/** @type {() => Promise<void> | null} */
let refreshExecutor = null;
/** @type {boolean} */
let refreshInFlight = false;
/** @type {((info: { reviewedShort: string, headShort: string }) => void) | null} */
let staleNotifier = null;
/** @type {string | null} */
let lastStaleToastHead = null;

/**
 * @param {() => Promise<void>} fn
 */
export function setPrRefreshExecutor(fn) {
  refreshExecutor = fn;
}

/**
 * One-shot toast when PR head advances (not on every poll tick).
 * @param {(info: { reviewedShort: string, headShort: string }) => void} fn
 */
export function setPrStaleNotifier(fn) {
  staleNotifier = fn;
}

export function isPrRefreshInFlight() {
  return refreshInFlight;
}

/**
 * @param {ParentNode} container
 */
function ensureStaleBanner(container) {
  let el = document.getElementById("cedar-pr-stale-banner");
  if (el instanceof HTMLElement) return el;
  const header = container.querySelector(".cedar-pr-header");
  if (!(header instanceof HTMLElement)) return null;
  el = document.createElement("aside");
  el.id = "cedar-pr-stale-banner";
  el.className = "cedar-pr-stale-banner";
  el.hidden = true;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `<div class="cedar-pr-stale-banner-inner">
    <p class="cedar-pr-stale-banner-text">
      <span class="cedar-pr-stale-banner-label">Stale PR — new commits</span>
      <span class="cedar-pr-stale-banner-shas font-mono" data-pr-stale-shas title="Reviewed commit → current PR head"></span>
    </p>
    ${renderPrRefreshReviewButtonHtml("cedar-pr-refresh-btn--banner")}
  </div>`;
  header.insertAdjacentElement("afterend", el);
  return el;
}

/**
 * @param {{ reviewedShort?: string, headShort?: string }} info
 */
function showStaleBanner(info) {
  const banner = document.getElementById("cedar-pr-stale-banner");
  if (!(banner instanceof HTMLElement)) return;
  const shaEl = banner.querySelector("[data-pr-stale-shas]");
  if (shaEl instanceof HTMLElement) {
    const from = info.reviewedShort ?? "…";
    const to = info.headShort ?? "…";
    shaEl.textContent = `${from} → ${to}`;
  }
  banner.hidden = false;
  document.getElementById("results")?.classList.add("cedar-pr-has-stale-banner");
  document.querySelector(".cedar-pr-header")?.classList.add("cedar-pr-header--stale");
  const headKey = String(info.headShort ?? "");
  if (headKey && headKey !== lastStaleToastHead) {
    lastStaleToastHead = headKey;
    staleNotifier?.({
      reviewedShort: info.reviewedShort ?? "…",
      headShort: info.headShort ?? headKey,
    });
  }
}

export function hidePrStaleBanner() {
  const banner = document.getElementById("cedar-pr-stale-banner");
  if (banner instanceof HTMLElement) banner.hidden = true;
  document.getElementById("results")?.classList.remove("cedar-pr-has-stale-banner");
  document.querySelector(".cedar-pr-header")?.classList.remove("cedar-pr-header--stale");
  lastStaleToastHead = null;
}

async function checkPrHead() {
  if (refreshInFlight) return;
  const session = window.__cedarSession;
  const reviewedSha = session?.data?.gate?.headSha ?? session?.data?.pull?.headSha;
  if (!session?.prUrl || !reviewedSha) return;

  const container = document.getElementById("results");
  if (!(container instanceof HTMLElement) || container.classList.contains("hidden")) return;

  try {
    const res = await fetch("/api/pr/head", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prUrl: session.prUrl,
        reviewedSha,
        token: session.token,
      }),
    });
    if (!res.ok) return;
    const json = await res.json();
    if (!json?.stale) {
      hidePrStaleBanner();
      return;
    }
    if (container instanceof HTMLElement) ensureStaleBanner(container);
    showStaleBanner({
      reviewedShort: json.reviewedShort ?? reviewedSha.slice(0, 7),
      headShort: json.headShort ?? json.headSha?.slice(0, 7),
    });
  } catch {
    /* ignore transient network errors */
  }
}

function onVisibilityRefresh() {
  if (document.visibilityState === "visible") void checkPrHead();
}

function wireDocOnce() {
  if (wiredDoc) return;
  wiredDoc = true;
  document.addEventListener("click", (ev) => {
    const btn = ev.target instanceof Element ? ev.target.closest("[data-pr-refresh-review]") : null;
    if (!btn || refreshInFlight) return;
    ev.preventDefault();
    void runPrRefresh();
  });
  document.addEventListener("visibilitychange", onVisibilityRefresh);
}

function syncRefreshButtons(updating) {
  for (const btn of document.querySelectorAll("[data-pr-refresh-review]")) {
    if (!(btn instanceof HTMLButtonElement)) continue;
    btn.disabled = updating;
    const label = btn.querySelector("[data-pr-refresh-label]");
    if (label instanceof HTMLElement) {
      label.textContent = updating ? "Refreshing…" : PR_REFRESH_REVIEW_LABEL;
    }
    btn.querySelector("[data-pr-refresh-icon]")?.classList.toggle("is-spinning", updating);
    btn.setAttribute("aria-busy", updating ? "true" : "false");
    btn.setAttribute("aria-label", updating ? "Refreshing review" : PR_REFRESH_REVIEW_LABEL);
  }
}

export function requestPrRefresh() {
  void runPrRefresh();
}

async function runPrRefresh() {
  if (!refreshExecutor || refreshInFlight) return;
  refreshInFlight = true;
  syncRefreshButtons(true);
  try {
    await refreshExecutor();
    hidePrStaleBanner();
  } catch {
    /* executor surfaces errors (toast, form error, etc.) */
  } finally {
    refreshInFlight = false;
    syncRefreshButtons(false);
  }
}

export function stopPrCommitRefresh() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  hidePrStaleBanner();
}

/**
 * @param {ParentNode} container
 */
export function wirePrCommitRefresh(container) {
  wireDocOnce();
  stopPrCommitRefresh();
  ensureStaleBanner(container);
  pollTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void checkPrHead();
  }, PR_HEAD_POLL_MS);
  window.setTimeout(() => void checkPrHead(), 8_000);
}