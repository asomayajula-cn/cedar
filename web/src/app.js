import { cedarMarkSvg } from "./cedar-logo.js";
import { slicesIconSvg } from "./cedar-icons.js";
import {
  mountArchitectureGraphs,
  mountArchitectureLayoutGraphs,
  remountCytoscapeForTheme,
  wireArchitectureZoomControls,
} from "./architecture-canvas.js";
import { buildLayoutDiagramGraphs } from "../../src/architecture-layout-views.js";
import { buildDiagramGraph, isRenderableDiagramGraph } from "../../src/diagram-graph.js";
import {
  layerAccentForTheme,
  sliceStatusVisualForTheme,
} from "../../src/diagram-colors.js";
import { buildArchitectureDiagramMermaid } from "../../src/architecture-diagram.js";
import { buildCompleteLayoutViews } from "../../src/architecture-layout-views.js";
import {
  ARCHITECTURE_LAYER_STACK,
  ARCHITECTURE_MODEL_LABEL,
  normalizeSliceId,
} from "../../src/architecture-model.js";
import { buildPrArchitectureLayers } from "../../src/pr-architecture-layers.js";
import { microPrsForDiagram } from "../../src/test-path.js";
import {
  microDiffTotals,
  refreshDiffRendersForTheme,
  renderSliceFileReviews,
  wireFileReviewToggles,
} from "./diff-view.js";
import {
  buildFileFlowCatalogFromMicroPrs,
  ensureCodeMapToolbarIcons,
  refreshFileFlowRailTheme,
  setFileFlowCatalog,
  wireFileFlowRail,
} from "./file-flow-rail.js";
import { refitActiveCodeMap, remountFileCodeMapForTheme } from "./file-flow-canvas.js";
import { FULL_PR_SLICE_ID, isFullPrSliceId, mergeAllPrFiles } from "./full-pr-slice.js";
import { loadDiffReviewComments, repaintAllDiffComments, setCommentToast } from "./diff-comments.js";
import { applySliceNavTypography, getDiffFontSettings, initDiffFontFromServer } from "./diff-font.js";
import { getResolvedTheme, onAppThemeChange, wireAppThemeToggle } from "./theme.js";
import {
  renderArchitectureDiagramCard,
  renderArchitectureDiagramStack,
  renderArchitectureCyCard,
} from "./architecture-diagram-shell.js";
import {
  activateDiagramUx,
  wireDiagramResizeListeners,
  remountMermaidDiagrams,
  scheduleDiagramRefit,
} from "./diagram-ux.js";
import { applyReviewStreamEvent, postReviewStream } from "./review-stream.js";
import {
  hidePrStaleBanner,
  renderPrRefreshReviewButtonHtml,
  requestPrRefresh,
  setPrRefreshExecutor,
  setPrStaleNotifier,
  stopPrCommitRefresh,
  wirePrCommitRefresh,
} from "./pr-commit-refresh.js";
import { showOutlookNotification, showSimpleNotification } from "./review-notifications.js";
import { refreshCursorReviewSummary } from "./cursor-rollup-patch.js";
import { applyCursorBackgroundEvent, postCursorReviewStream } from "./cursor-review-stream.js";
import {
  hideReviewProgressDock,
  renderReviewProgressDockHtml,
  restoreReviewProgressDock,
  setReviewProgress,
  showReviewProgressDock,
} from "./review-progress-ui.js";
import { buildPrChatContext, ensurePrChatState, refreshPrChatUiFromSession, wirePrChatSidebar } from "./pr-chat.js";
import {
  countActiveFindings,
  ensureFindingSession,
  findingKey,
  findingsForSlice,
  isFindingIgnored,
  setFindingToast,
  wireFindingActions,
} from "./finding-actions.js";
import { syncReviewRailCollapseUi, wireReviewRailCollapse } from "./review-rail-collapse.js";
import {
  alertFindingsAvailableAfterReview,
  refreshFilesDrawerPanel,
  refreshFindingsDrawerPanel,
  wireReviewIconNav,
} from "./review-icon-nav.js";
import {
  renderLoadingReviewCenterMain,
  renderReviewMainTabsHeadHtml,
  renderThreeColumnReviewChrome,
} from "./review-three-col-shell.js";

/** Hero-stage utilities on #main-stage (removed in full-width review mode). */
const MAIN_STAGE_HERO_LAYOUT_CLASSES = ["mx-auto", "max-w-6xl", "px-4", "py-12", "sm:px-6", "sm:py-20"];

function enterReviewStageLayout() {
  const stage = document.getElementById("main-stage");
  if (!(stage instanceof HTMLElement)) return;
  stage.classList.add("cedar-review-wide");
  stage.classList.remove(...MAIN_STAGE_HERO_LAYOUT_CLASSES);
  document.body.classList.add("cedar-review-stage-active");
}

function exitReviewStageLayout() {
  const stage = document.getElementById("main-stage");
  if (!(stage instanceof HTMLElement)) return;
  stage.classList.remove("cedar-review-wide", "cedar-review-slices-focus");
  document.body.classList.remove("cedar-review-stage-active");
  for (const cls of MAIN_STAGE_HERO_LAYOUT_CLASSES) stage.classList.add(cls);
}

/**
 * @param {ParentNode} root
 */
function wireReviewChrome(root) {
  wireSlicesNavRailResize(root);
  wireFileFlowRailResize(root);
  wireReviewRailCollapse(root);
  wireReviewIconNav(root, (r, tab) => activateReviewMainTab(r, tab));
}

/**
 * @param {ParentNode} root
 * @param {"architecture" | "slices"} [mainTab]
 */
function focusReviewWorkspace(root, mainTab = "architecture") {
  activateReviewMainTab(root, mainTab);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      root.querySelector("#cedar-review-workspace")?.scrollIntoView({ block: "start", behavior: "smooth" });
      window.dispatchEvent(new Event("resize"));
    });
  });
}

/**
 * @param {string} [status]
 */
function renderSliceStatusDot(status) {
  const v = sliceStatusVisualForTheme(status, getResolvedTheme());
  return `<span class="cedar-slice-status-dot" style="background-color:${v.fill};border-color:${v.border};color:${v.border}" aria-hidden="true"></span>`;
}

/**
 * Review status pill on each slice (matches diagram slice badges).
 * @param {string} [status]
 */
function renderSliceReviewBadge(status) {
  const v = sliceStatusVisualForTheme(status, getResolvedTheme());
  const label = statusLabel[status] ?? status ?? "Pending";
  return `<span class="cedar-badge cedar-slice-review-badge inline-flex items-center gap-1.5" data-slice-status="${escapeHtml(status ?? "")}" style="border-color:${v.border}66;background-color:${v.fill};color:${v.text}">
    ${renderSliceStatusDot(status)}
    <span>${escapeHtml(label)}</span>
  </span>`;
}

/** @param {ParentNode} root */
function refreshThemeAwareChrome(root) {
  const theme = getResolvedTheme();
  root.querySelectorAll(".cedar-layer-chip[data-layer-id]").forEach((el) => {
    const layerId = el.dataset.layerId;
    if (!layerId) return;
    const accent = layerAccentForTheme(layerId, theme);
    el.style.setProperty("--cedar-layer-accent", accent.stroke);
    el.style.setProperty("--cedar-layer-fill", accent.fill);
    el.style.setProperty("--cedar-layer-text", accent.text);
    el.style.borderColor = "";
    el.style.background = "";
    const label = el.querySelector(".cedar-layer-chip-label");
    if (label) label.style.color = "";
  });
  root.querySelectorAll("[data-slice-status]").forEach((el) => {
    const status = el.dataset.sliceStatus ?? "";
    const v = sliceStatusVisualForTheme(status, theme);
    if (el.classList.contains("cedar-pipeline-slice-item")) {
      el.style.borderLeft = `3px solid ${v.border}`;
    }
    if (el.classList.contains("cedar-diagram-slice-badge")) {
      el.style.borderColor = `${v.border}44`;
    }
    if (el.classList.contains("cedar-slice-review-badge")) {
      el.style.borderColor = `${v.border}66`;
      el.style.backgroundColor = v.fill;
      el.style.color = v.text;
    }
    el.querySelectorAll(".cedar-slice-status-dot").forEach((dot) => {
      dot.style.backgroundColor = v.fill;
      dot.style.borderColor = v.border;
      dot.style.color = v.border;
    });
  });
}

const statusLabel = {
  passed: "Ready",
  failed: "Blocked",
  skipped: "Skipped",
};

function githubApiErrorMessage(body, fallback = "Request failed") {
  if (!body || typeof body !== "object") return fallback;
  if (body.code === "GITHUB_TOKEN_FORBIDDEN") {
    return `${body.error} Fine-grained PAT: Pull requests → Read and write on this repo. Classic PAT: repo scope. Org: authorize SSO.`;
  }
  const base = body.error ?? body.githubMessage ?? fallback;
  if (body.hint) return `${base}\n\n${body.hint}`;
  return base;
}

function showToast(message, tone = "neutral") {
  const t =
    tone === "error" ? "error" : tone === "success" ? "success" : tone === "warning" ? "warning" : "neutral";
  showSimpleNotification(message, t);
}

export function mountApp(root) {
  setCommentToast((message, tone) => showToast(message, tone === "error" ? "error" : "neutral"));
  setFindingToast((message, tone) => showToast(message, tone === "error" ? "error" : "neutral"));

  root.innerHTML = `
    <div class="cedar-shell">
      <header class="sticky top-0 z-40 border-b border-white/[0.06] bg-black/40 backdrop-blur-xl">
        <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <a href="/" class="group flex items-center gap-2.5" aria-label="Cedar home">
            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-black shadow-lg shadow-black/40 transition group-hover:scale-105 group-hover:shadow-white/10">
              ${cedarMarkSvg("h-[22px] w-[22px]")}
            </span>
            <span class="text-sm font-semibold tracking-tight text-white">cedar</span>
          </a>
          <nav class="hidden items-center gap-1 text-xs font-medium text-zinc-500 sm:flex">
            <span class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-zinc-300">${slicesIconSvg("h-3.5 w-3.5 opacity-80")}<span>Micro slices</span></span>
            <span class="text-zinc-700">·</span>
            <span class="px-3 py-1.5">Architecture</span>
            <span class="text-zinc-700">·</span>
            <span class="px-3 py-1.5">Approve</span>
          </nav>
          <div class="flex items-center gap-2">
            <button
              type="button"
              id="cedar-theme-toggle"
              class="cedar-btn-secondary cedar-btn-compact"
              data-cedar-theme-toggle
              aria-pressed="false"
              aria-label="Toggle day or night theme"
              title="Switch to day theme"
            >
              <span class="cedar-theme-icon-sun" aria-hidden="true">Day</span>
              <span class="cedar-theme-icon-moon" aria-hidden="true">Night</span>
            </button>
            <div id="health-pill" class="cedar-badge cedar-badge-muted">Checking…</div>
          </div>
        </div>
      </header>

      <main id="main-stage" class="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
        <section id="hero" class="cedar-hero cedar-fade-in">
          <header class="cedar-hero-intro">
            <div class="cedar-hero-mark" aria-hidden="true">
              ${cedarMarkSvg("h-8 w-8")}
            </div>
            <p class="cedar-hero-eyebrow">Architecture-first review</p>
            <h1 class="cedar-hero-title">
              Review the architecture,<br class="cedar-hero-title-break" /> not just the diff
            </h1>
            <p class="cedar-hero-lede">
              Cedar partitions each pull request into micro slices, reviews them independently, and returns a composite read with diagrams.
            </p>
          </header>

          <form id="review-form" class="cedar-hero-form cedar-glass" autocomplete="on">
            <div class="cedar-hero-form-block cedar-hero-form-block--credentials">
              <div class="cedar-hero-form-block-head">
                <div class="cedar-hero-form-block-copy">
                  <h2 class="cedar-hero-form-title">Workspace credentials</h2>
                  <p class="cedar-hero-form-hint">Saved to <span class="font-mono">.env</span> on this machine and loaded by the API.</p>
                </div>
                <button type="button" id="save-env-btn" class="cedar-btn-secondary cedar-hero-save-btn">Save to .env</button>
              </div>
              <div class="cedar-hero-field-grid">
                <label class="cedar-hero-field">
                  <span class="cedar-hero-field-label">
                    GitHub PAT
                    <span id="config-github-status" class="cedar-hero-field-status">Checking…</span>
                  </span>
                  <input name="githubToken" type="password" autocomplete="off" spellcheck="false"
                    placeholder="ghp_… or github_pat_…"
                    class="cedar-input cedar-hero-input font-mono" />
                </label>
                <label class="cedar-hero-field">
                  <span class="cedar-hero-field-label">
                    Cursor API key
                    <span id="config-cursor-status" class="cedar-hero-field-status">Checking…</span>
                  </span>
                  <input name="cursorApiKey" type="password" autocomplete="off" spellcheck="false"
                    placeholder="crsr_…"
                    class="cedar-input cedar-hero-input font-mono" />
                </label>
              </div>
              <p id="env-save-status" class="cedar-hero-form-status hidden" role="status"></p>
            </div>

            <div class="cedar-hero-form-divider" role="presentation"></div>

            <div class="cedar-hero-form-block cedar-hero-form-block--primary">
              <label class="cedar-hero-field cedar-hero-field--url">
                <span class="cedar-hero-field-label cedar-hero-field-label--primary">GitHub pull request</span>
                <input name="prUrl" required inputmode="url" autocomplete="url"
                  placeholder="https://github.com/owner/repo/pull/42"
                  class="cedar-input cedar-hero-input cedar-hero-input--url font-mono" />
              </label>
            </div>

            <details class="cedar-hero-advanced">
              <summary class="cedar-hero-advanced-summary">
                <span class="cedar-hero-advanced-label-closed">Advanced options</span>
                <span class="cedar-hero-advanced-label-open">Hide options</span>
              </summary>
              <div class="cedar-hero-advanced-body">
                <p class="cedar-hero-form-hint">One-off GitHub token for this run only, when it differs from <span class="font-mono">.env</span>.</p>
                <label class="cedar-hero-field">
                  <span class="cedar-hero-field-label">GitHub token override</span>
                  <input name="token" type="password" autocomplete="off" placeholder="Uses GITHUB_TOKEN from .env if empty"
                    class="cedar-input cedar-hero-input font-mono" />
                </label>
                <fieldset class="cedar-hero-checks">
                  <legend class="sr-only">GitHub posting</legend>
                  <label class="cedar-hero-check"><input type="checkbox" name="postMicro" /> Post micro-reviews</label>
                  <label class="cedar-hero-check"><input type="checkbox" name="post" /> Post composite review</label>
                </fieldset>
              </div>
            </details>

            <footer class="cedar-hero-form-footer">
              <button type="submit" id="submit-btn" class="cedar-btn-primary cedar-hero-submit">
                <span id="submit-label">Start review</span>
              </button>
              <p class="cedar-hero-form-footnote">Typical run: 30–90 seconds · scales with PR size</p>
            </footer>
          </form>
          <p id="form-error" class="cedar-hero-error hidden" role="alert"></p>
        </section>

        <section id="results" class="hidden cedar-fade-in"></section>
      </main>
    </div>
  `;

  void refreshHealth();
  document.getElementById("review-form").addEventListener("submit", onSubmit);
  document.getElementById("save-env-btn")?.addEventListener("click", onSaveEnvConfig);

  const params = new URLSearchParams(window.location.search);
  const prFromQuery = params.get("pr") ?? params.get("url");
  if (prFromQuery) {
    const input = document.querySelector('input[name="prUrl"]');
    if (input) input.value = prFromQuery;
  }

  wireAppThemeToggle(root);

  const applyDiagramFontCssVar = () => {
    const { size } = getDiffFontSettings();
    document.documentElement.style.setProperty("--cedar-diagram-font-size", `${Math.min(14, Math.max(9, size + 2))}px`);
  };
  applyDiagramFontCssVar();

  const refitDiagramsForUi = () => {
    const results = document.getElementById("results");
    if (!results) return;
    applyDiagramFontCssVar();
    refreshThemeAwareChrome(results);
    remountCytoscapeForTheme();
    refreshCompleteLayoutCyGraphs(results);
    void remountFileCodeMapForTheme();
    refreshFileFlowRailTheme();
    void remountMermaidDiagrams(results);
  };

  onAppThemeChange(() => {
    ensureCodeMapToolbarIcons();
    const results = document.getElementById("results");
    if (results) {
      refreshDiffRendersForTheme(results);
      repaintAllDiffComments(results);
    } else {
      refreshDiffRendersForTheme(root);
    }
    refitDiagramsForUi();
  });

  window.addEventListener("cedar-diff-font-change", () => {
    applySliceNavTypography();
    refitDiagramsForUi();
    const stage = document.getElementById("cedar-file-flow-stage");
    if (stage?.classList.contains("is-code-map-active")) {
      delete stage.dataset.cedarMapUserZoomed;
      refitActiveCodeMap();
    }
  });
}

function updateConfigStatus(data) {
  const gh = document.getElementById("config-github-status");
  const cur = document.getElementById("config-cursor-status");
  if (gh) {
    gh.textContent = data.hasToken ? "In .env / API · set" : "Not on API";
    gh.className = data.hasToken
      ? "font-mono text-[10px] text-emerald-400/90"
      : "font-mono text-[10px] text-amber-400/90";
  }
  if (cur) {
    const on = data.hasCursor && data.sliceReviewAvailable;
    cur.textContent = on ? "In .env / API · set" : "Not on API";
    cur.className = on
      ? "font-mono text-[10px] text-emerald-400/90"
      : "font-mono text-[10px] text-amber-400/90";
  }
}

async function onSaveEnvConfig() {
  const form = document.getElementById("review-form");
  const statusEl = document.getElementById("env-save-status");
  if (!(form instanceof HTMLFormElement) || !statusEl) return;
  const fd = new FormData(form);
  const githubToken = String(fd.get("githubToken") ?? "").trim();
  const cursorApiKey = String(fd.get("cursorApiKey") ?? "").trim();
  if (!githubToken && !cursorApiKey) {
    showToast("Enter a GitHub PAT and/or Cursor API key, then Save to .env", "error");
    return;
  }
  const btn = document.getElementById("save-env-btn");
  if (btn instanceof HTMLButtonElement) btn.disabled = true;
  try {
    const res = await fetch("/api/config/env", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubToken: githubToken || undefined, cursorApiKey: cursorApiKey || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? res.statusText);
    statusEl.textContent = json.message ?? `Saved: ${(json.applied ?? []).join(", ")}`;
    statusEl.classList.remove("hidden");
    statusEl.classList.remove("text-rose-400");
    statusEl.classList.add("text-emerald-300/90");
    showToast("Saved to .env", "neutral");
    const ghInput = form.querySelector('input[name="githubToken"]');
    const curInput = form.querySelector('input[name="cursorApiKey"]');
    if (githubToken && ghInput instanceof HTMLInputElement) ghInput.value = "";
    if (cursorApiKey && curInput instanceof HTMLInputElement) curInput.value = "";
    await refreshHealth();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statusEl.textContent = msg;
    statusEl.classList.remove("hidden", "text-emerald-300/90");
    statusEl.classList.add("text-rose-400");
    showToast(msg, "error");
  } finally {
    if (btn instanceof HTMLButtonElement) btn.disabled = false;
  }
}

async function refreshHealth() {
  const pill = document.getElementById("health-pill");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    window.__cedarServerHealth = data;
    updateConfigStatus(data);
    initDiffFontFromServer(data.diffFont);
    if (data.hasToken && data.aiProvider === "cursor") {
      pill.textContent = "Cursor ready";
      pill.className = "cedar-badge cedar-badge-ok";
    } else if (data.hasToken && data.aiProvider === "openrouter") {
      pill.textContent = "OpenRouter";
      pill.className = "cedar-badge cedar-badge-ok";
    } else if (data.hasToken && (data.hasCursor || data.hasOpenRouter)) {
      pill.textContent = "Ready";
      pill.className = "cedar-badge cedar-badge-ok";
    } else if (data.hasToken) {
      pill.textContent = "GitHub only";
      pill.className = "cedar-badge cedar-badge-warn";
    } else {
      pill.textContent = "Needs token";
      pill.className = "cedar-badge cedar-badge-warn";
    }
  } catch {
    pill.textContent = "API offline";
    pill.className = "cedar-badge border-rose-500/30 bg-rose-500/10 text-rose-200";
  }
}

async function ensureCredentialsBeforeReview(fd) {
  const githubToken = String(fd.get("githubToken") ?? "").trim();
  const cursorApiKey = String(fd.get("cursorApiKey") ?? "").trim();
  if (!githubToken && !cursorApiKey) return;
  const res = await fetch("/api/config/env", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      githubToken: githubToken || undefined,
      cursorApiKey: cursorApiKey || undefined,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Could not save .env");
  await refreshHealth();
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);

  const errorEl = document.getElementById("form-error");
  try {
    await ensureCredentialsBeforeReview(fd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
    showToast(msg, "error");
    return;
  }

  const cursorFromForm = String(fd.get("cursorApiKey") ?? "").trim();
  /** @type {{ prUrl: string, token?: string, cursorApiKey?: string, post: boolean, postMicro: boolean }} */
  const payload = {
    prUrl: String(fd.get("prUrl")).trim(),
    token: String(fd.get("token") || "").trim() || undefined,
    post: fd.get("post") === "on",
    postMicro: fd.get("postMicro") === "on",
  };
  if (cursorFromForm) payload.cursorApiKey = cursorFromForm;
  const btn = document.getElementById("submit-btn");
  const label = document.getElementById("submit-label");
  const hero = document.getElementById("hero");
  const results = document.getElementById("results");

  errorEl.classList.add("hidden");
  btn.disabled = true;
  label.innerHTML = '<span class="cedar-spinner"></span><span class="ml-2">Connecting…</span>';
  hero.classList.add("hidden");
  results.classList.remove("hidden");
  enterReviewStageLayout();
  results.classList.add("cedar-review-results--mounted");
  results.innerHTML = loadingSkeleton();
  wireReviewChrome(results);
  window.scrollTo({ top: 0, behavior: "smooth" });
  showReviewProgressDock();
  setReviewProgress(4, "Starting review", "Fetching PR from GitHub…");

  try {
    const data = await streamCedarReview(payload, (event) => {
      if (event?.type === "activity" && event.text) {
        label.innerHTML = `<span class="cedar-spinner"></span><span class="ml-2">${escapeHtml(String(event.text))}</span>`;
      } else if (event?.type === "phase" && event.status === "running") {
        label.innerHTML = `<span class="cedar-spinner"></span><span class="ml-2">${escapeHtml(String(event.label ?? "Working…"))}</span>`;
      }
    });

    try {
      const healthRes = await fetch("/api/health");
      window.__cedarServerHealth = await healthRes.json();
    } catch {
      /* keep prior health */
    }

    applyLoadedReviewSession(payload, data);

    renderResults(results, data);
    if (!data.cursorReviewPending) {
      setReviewProgress(100, "Review ready", "Architecture and slices loaded.");
      hideReviewProgressDock({ delayMs: 2000 });
    } else {
      const sliceTotal = (data.microPrs ?? []).filter((m) => (m.files?.length ?? m.fileCount ?? 0) > 0).length;
      showReviewProgressDock();
      setReviewProgress(
        55,
        "Cursor · macro review (entire PR)",
        `Macro first, then ${sliceTotal} slice(s) · layout ready`
      );
    }
  } catch (err) {
    results.innerHTML = "";
    results.classList.add("hidden");
    exitReviewStageLayout();
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.classList.remove("hidden");
    showToast(errorEl.textContent, "error");
  } finally {
    btn.disabled = false;
    label.textContent = "Start review";
  }
}

function loadingSkeleton() {
  return `${renderReviewProgressDockHtml()}
    <header class="cedar-pr-header cedar-pr-header--flat cedar-pr-header--pending cedar-review-stage-band">
      <div class="cedar-pr-header-id cedar-review-stage-band__body min-w-0 w-full">
        <p class="cedar-label cedar-pr-header-eyebrow">Pull request</p>
        <div class="cedar-review-progress-head">
          <span class="cedar-review-progress-status-dot" aria-hidden="true"></span>
          <p class="cedar-review-progress-label mb-0">Review running…</p>
        </div>
        <p class="cedar-review-progress-detail mb-0">Fetching &amp; partitioning</p>
      </div>
    </header>
    ${renderReviewMainTabsHeadHtml({ placeholder: true, activeTab: "slices", sliceCount: 0 })}
    ${renderThreeColumnReviewChrome({
      sidebarSliceList:
        '<p class="px-2 py-2 text-[11px] leading-snug text-zinc-600">Slices appear when partitioning finishes.</p>',
      gate: { ready: false, blockedReason: "Review in progress…" },
      centerMainHtml: renderLoadingReviewCenterMain(),
    })}`;
}

let sliceApprovals = new Set();

function finishReviewUi(container) {
  bindApproveHandlers(container);
  wireFindingActions(container, patchFindingsAndMetrics);
  wireFileReviewToggles(container);
  wireFileFlowRail(container);
  wireReviewChrome(container);
  syncReviewRailCollapseUi(container);
  refreshFilesDrawerPanel(container);
  refreshFindingsDrawerPanel(container);
  wirePrCommitRefresh(container);
  repaintAllDiffComments(container);
  void loadDiffReviewComments(container);
  if (window.__cedarSession?.data?.cursorReviewPending) showReviewProgressDock();
  void startBackgroundCursorReviewIfNeeded(container);
}

/**
 * @param {HTMLElement} container
 */
async function startBackgroundCursorReviewIfNeeded(container) {
  const session = window.__cedarSession;
  if (!session?.data?.cursorReviewPending) return;
  if (session.data.__cursorBgStarted) return;
  session.data.__cursorBgStarted = true;

  showReviewProgressDock();
  const sliceTotal = (session.data.microPrs ?? []).filter((m) => (m.files?.length ?? m.fileCount ?? 0) > 0).length;
  setReviewProgress(55, "Cursor · macro review (entire PR)", `Macro first, then ${sliceTotal} slice(s)`);

  const payload = {
    cursorApiKey: session.cursorApiKey,
    report: {
      microPrs: session.data.microPrs,
      microResults: session.data.microResults,
      pull: session.data.pull,
      breakouts: session.data.breakouts,
    },
  };

  const onEvent = (event) => {
    applyCursorBackgroundEvent(event, () => {
      if (event.type === "cursor_macro") {
        const results = document.getElementById("results");
        if (results) {
          patchCursorMacroComplete(results);
          finishReviewUiWithoutBackground(results);
          repaintAllDiffComments(results);
        }
        return;
      }
      if (event.type === "cursor_slice") {
        patchFindingsAndMetrics();
        repaintAllDiffComments(container);
      }
      if (event.type === "cursor_done") {
        const results = document.getElementById("results");
        if (results && session.data) {
          refreshReviewUi();
          finishReviewUiWithoutBackground(results);
          const findingCount = alertFindingsAvailableAfterReview(results);
          if (findingCount > 0) {
            const sliceCount = session.data.microResults?.filter((r) => r.status !== "skipped").length ?? 0;
            showToast(
              `Code findings ready · ${findingCount} across ${sliceCount} slice(s) — open Findings in the left rail`,
              "success"
            );
          }
        }
      }
    });
    applyReviewStreamEvent(event, null, null);
  };

  try {
    await postCursorReviewStream(payload, onEvent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (statusEl) statusEl.textContent = `Cursor review failed · ${msg}`;
    showToast(msg, "error");
    session.data.cursorReviewPending = false;
  }
}

/** Re-wire UI without re-entering background cursor loop. */
function finishReviewUiWithoutBackground(container) {
  bindApproveHandlers(container);
  wireFindingActions(container, patchFindingsAndMetrics);
  wireFileReviewToggles(container);
  wireFileFlowRail(container);
  wireReviewChrome(container);
  syncReviewRailCollapseUi(container);
  refreshFilesDrawerPanel(container);
  refreshFindingsDrawerPanel(container);
  wirePrCommitRefresh(container);
  repaintAllDiffComments(container);
}

/**
 * @param {ParentNode | null} container
 */
function captureReviewUiState(container) {
  if (!(container instanceof HTMLElement)) return null;
  const mainBtn = container.querySelector("[data-review-tab].is-active");
  const mainTab = mainBtn?.getAttribute("data-review-tab");
  const sliceBtn = container.querySelector("[data-slice-tab].is-active");
  const sliceId = sliceBtn?.getAttribute("data-slice-tab");
  return {
    mainTab: mainTab === "architecture" || mainTab === "slices" ? mainTab : null,
    sliceId: sliceId || null,
  };
}

/**
 * @param {ParentNode} container
 */
/**
 * @param {{ status?: string, count?: number, error?: string } | undefined} sliceRow
 */
function sliceCursorFindingCountLabel(sliceRow) {
  if (!sliceRow) {
    return { text: "—", title: "Cursor review pending", pending: true, failed: false };
  }
  const pending = sliceRow.status === "pending" && !sliceRow.count;
  const count = sliceRow.count ?? 0;
  const text = pending ? "—" : String(count);
  let title = `${count} Cursor finding${count === 1 ? "" : "s"}`;
  if (sliceRow.error) title = "Cursor review failed";
  else if (pending) title = "Cursor review pending";
  return { text, title, pending, failed: Boolean(sliceRow.error) };
}

/**
 * @param {Record<string, unknown> | null | undefined} summary
 */
function shouldShowCursorFindingCounts(summary) {
  if (!summary) return false;
  return Boolean(
    summary.enabled ||
    summary.requested ||
    summary.slicePassRan ||
    (summary.slice?.bySlice?.length ?? 0) > 0 ||
    (summary.totalFindings ?? 0) > 0
  );
}

/**
 * @param {Record<string, unknown> | null | undefined} summary
 */
function fullPrCursorFindingCountLabel(summary) {
  if (!summary) return sliceCursorFindingCountLabel(undefined);
  const sliceTotal = Number(summary.slice?.total) || 0;
  const macro = Number(summary.macro?.findingCount) || 0;
  const total = Number(summary.totalFindings) || sliceTotal + macro;
  const reviewPending = Boolean((summary.enabled || summary.requested) && !summary.slicePassRan && total === 0);
  if (reviewPending) return sliceCursorFindingCountLabel({ status: "pending", count: 0 });
  return {
    text: String(total),
    title: `${total} Cursor finding${total === 1 ? "" : "s"} on this PR`,
    pending: false,
    failed: false,
  };
}

/**
 * @param {ParentNode} container
 * @param {Record<string, unknown> | null | undefined} summary
 */
function patchSliceCursorFindingCounts(container, summary) {
  if (!(container instanceof HTMLElement) || !shouldShowCursorFindingCounts(summary)) return;
  const byId = new Map((summary.slice?.bySlice ?? []).map((s) => [s.componentId, s]));
  container.querySelectorAll("[data-slice-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const id = btn.getAttribute("data-slice-tab");
    if (!id) return;
    const span = btn.querySelector("[data-slice-cursor-findings]");
    if (!(span instanceof HTMLElement)) return;
    const label =
      id === FULL_PR_SLICE_ID
        ? fullPrCursorFindingCountLabel(summary)
        : sliceCursorFindingCountLabel(byId.get(id));
    span.textContent = label.text;
    span.title = label.title;
    span.classList.toggle("is-pending", label.pending);
    span.classList.toggle("is-failed", label.failed);
    span.setAttribute("aria-label", label.title);
  });
}

function patchCursorRollupCard(container) {
  const session = window.__cedarSession;
  if (!(container instanceof HTMLElement) || !session?.data) return;
  const summary = refreshCursorReviewSummary(session) ?? session.data.cursorReviewSummary;
  const rollupCard = container.querySelector(".cedar-cursor-rollup-card");
  if (rollupCard && summary) {
    rollupCard.innerHTML = renderCursorReviewRollup(summary);
    rollupCard.hidden = !shouldShowCursorFindingCounts(summary);
  }
  patchSliceCursorFindingCounts(container, summary);
}

function patchCursorMacroComplete(container) {
  const session = window.__cedarSession;
  if (!(container instanceof HTMLElement) || !session?.data) return;
  patchPrHeaderMetrics(session.data);
  patchCursorRollupCard(container);
}

function refreshReviewUi() {
  const session = window.__cedarSession;
  const results = document.getElementById("results");
  if (!session?.data || !results) return;
  ensureFindingSession(session);
  sliceApprovals = session.sliceApprovals ?? sliceApprovals;
  const uiRestore = captureReviewUiState(results);
  renderResults(results, session.data, { uiRestore });
}

window.__cedarPatchFindings = patchFindingsAndMetrics;
window.__cedarActivateSlice = (componentId) => {
  const results = document.getElementById("results");
  if (results && componentId) activateSliceTab(results, componentId);
};

function patchFindingsAndMetrics() {
  const results = document.getElementById("results");
  if (results) repaintAllDiffComments(results);
  const session = window.__cedarSession;
  const container = document.getElementById("results");
  if (!session?.data || !container) return;

  const { microResults } = session.data;

  for (const r of microResults.filter((res) => res.status !== "skipped" && !isFullPrSliceId(res.componentId))) {
    const panel = container.querySelector(`[data-slice-panel="${CSS.escape(r.componentId)}"]`);
    if (!panel) continue;

    patchSliceFindingBadges(panel, r, session);
  }

  patchCursorRollupCard(container);
  patchPrHeaderMetrics(session.data);
  refreshFindingsDrawerPanel(container);
  wireFindingActions(container, patchFindingsAndMetrics);
}

/**
 * @param {HTMLElement} panel
 */
function patchSliceFindingBadges(panel, r, session) {
  const row = panel.querySelector("[data-slice-badges]");
  if (!row) return;
  const sliceFindings = findingsForSlice(r.componentId, r);
  const activeFindings = sliceFindings.filter((f, fi) => !isFindingIgnored(findingKey(r.componentId, f, fi)));
  const blockers = activeFindings.filter((f) => f.severity === "blocker").length;
  const warnings = activeFindings.filter((f) => f.severity === "warning").length;
  row.querySelector("[data-slice-blockers]")?.remove();
  row.querySelector("[data-slice-warnings]")?.remove();
  if (blockers) {
    row.insertAdjacentHTML(
      "beforeend",
      `<span data-slice-blockers class="cedar-badge border-rose-500/30 bg-rose-500/10 text-rose-200">${blockers} blockers</span>`
    );
  }
  if (warnings) {
    row.insertAdjacentHTML(
      "beforeend",
      `<span data-slice-warnings class="cedar-badge cedar-badge-warn">${warnings} warnings</span>`
    );
  }
}

function patchPrHeaderMetrics(data) {
  const session = window.__cedarSession;
  sliceApprovals = session?.sliceApprovals ?? sliceApprovals;
  const { gate, microResults } = data;
  const touched = microResults.filter((r) => r.status !== "skipped");
  const approvedCount = touched.filter((r) => sliceApprovals.has(r.componentId)).length;
  const allSlicesApproved = touched.length > 0 && approvedCount === touched.length;
  const canApprovePr = gate.ready && allSlicesApproved;
  const approvePct = touched.length ? Math.round((approvedCount / touched.length) * 100) : 0;
  const approvalCopy = sliceApprovalHeaderCopy(approvedCount, touched.length, canApprovePr, gate.ready);

  const num = document.querySelector("[data-pr-approved-count]");
  const denom = document.querySelector("[data-pr-approved-total]");
  const caption = document.querySelector("[data-pr-approve-caption]");
  const valueEl = document.querySelector(".cedar-pr-stat-value--approval");
  if (num) num.textContent = String(approvedCount);
  if (denom) denom.textContent = ` / ${touched.length}`;
  if (caption) caption.textContent = approvalCopy.caption;
  if (valueEl) {
    valueEl.className = `cedar-pr-stat-value cedar-pr-stat-value--approval tabular-nums ${approvalCopy.tone}`;
  }

  const progress = document.querySelector(".cedar-pr-approval-progress");
  const fill = document.querySelector("[data-pr-approve-fill]");
  if (progress) progress.setAttribute("aria-valuenow", String(approvePct));
  if (fill) fill.style.width = `${approvePct}%`;

  const prBtn = document.getElementById("approve-pr-btn");
  if (prBtn instanceof HTMLButtonElement) {
    prBtn.disabled = !canApprovePr;
    prBtn.classList.toggle("is-ready", canApprovePr);
    prBtn.title = canApprovePr
      ? "Approve the full pull request on GitHub"
      : "Mark every slice approved in Cedar first";
  }
}

function patchSliceApprovalState(componentId) {
  const container = document.getElementById("results");
  if (!container) return;

  const panel = container.querySelector(`[data-slice-panel="${CSS.escape(componentId)}"]`);
  const btn = panel?.querySelector(`[data-approve-slice="${CSS.escape(componentId)}"]`);
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = true;
    btn.textContent = "Approved";
    btn.classList.remove("is-ready");
    btn.classList.add("is-done");
  }

  const metrics = panel?.querySelector("[data-slice-badges]");
  if (metrics && !metrics.querySelector("[data-slice-approved-badge]")) {
    metrics.insertAdjacentHTML(
      "beforeend",
      '<span class="cedar-badge cedar-badge-ok" data-slice-approved-badge>Approved</span>'
    );
  }

  container.querySelectorAll(`[data-slice-tab="${CSS.escape(componentId)}"]`).forEach((tab) => {
    if (tab.querySelector(".cedar-nav-item-check")) return;
    tab.insertAdjacentHTML("beforeend", '<span class="cedar-nav-item-check">✓</span>');
  });

  container.querySelectorAll(`[data-scroll-slice="${CSS.escape(componentId)}"]`).forEach((navBtn) => {
    const row = navBtn.querySelector(".cedar-nav-item-row");
    if (!row || row.querySelector(".cedar-nav-item-check")) return;
    row.insertAdjacentHTML("beforeend", '<span class="cedar-nav-item-check">✓</span>');
  });

  if (window.__cedarSession?.data) patchPrHeaderMetrics(window.__cedarSession.data);
}

/**
 * @param {number} approvedCount
 * @param {number} total
 * @param {boolean} canApprovePr
 * @param {boolean} gateReady
 */
function sliceApprovalHeaderCopy(approvedCount, total, canApprovePr, gateReady) {
  if (total === 0) {
    return { caption: "No slices in this review", tone: "text-zinc-400" };
  }
  if (canApprovePr && gateReady) {
    return { caption: "Every slice approved — ready for GitHub", tone: "text-emerald-400" };
  }
  const remaining = total - approvedCount;
  if (approvedCount === 0) {
    return {
      caption: `Mark each slice in the Slices tab (${total} total)`,
      tone: "text-zinc-200",
    };
  }
  if (remaining === 1) {
    return { caption: "1 slice left — mark approved on its review page", tone: "text-amber-200" };
  }
  return {
    caption: `${remaining} slices left — mark approved as you review`,
    tone: "text-amber-200",
  };
}

/**
 * @param {Array<{ componentId: string, componentName: string, status: string, sliceNumber: number, classNames?: string[] }>} slices
 */
function renderDiagramSliceBadges(slices) {
  if (!slices.length) return "";
  const dots = slices
    .map((r) => {
      const v = sliceStatusVisualForTheme(r.status, getResolvedTheme());
      const classes = (r.classNames ?? []).filter(Boolean);
      const classHint = classes.length ? classes.join(", ") : String(r.componentName ?? r.componentId ?? "").trim();
      const title = classHint || String(r.componentName ?? r.componentId ?? "").trim();
      return `<button type="button" class="cedar-diagram-slice-badge" data-jump-slice="${escapeHtml(r.componentId)}" data-slice-status="${escapeHtml(r.status)}"
        style="border-color:${v.border}44"
        title="${escapeHtml(title)}"
        aria-label="${escapeHtml(title)}">
        ${renderSliceStatusDot(r.status)}
      </button>`;
    })
    .join("");
  return `<div class="cedar-diagram-slice-badges flex flex-wrap items-center gap-1.5" role="list" aria-label="Micro slices in this PR">${dots}</div>`;
}

/**
 * @param {string[]} activeSliceIds
 */
function renderPrLayerStack(activeSliceIds) {
  const active = new Set(activeSliceIds);
  const layers = ARCHITECTURE_LAYER_STACK.filter((l) => active.has(l.id));
  if (!layers.length) return "";
  const theme = getResolvedTheme();
  const items = layers
    .map((layer) => {
      const accent = layerAccentForTheme(layer.id, theme);
      return `<li class="cedar-layer-chip cedar-layer-chip--pr is-active" data-layer-id="${escapeHtml(layer.id)}" style="--cedar-layer-accent:${accent.stroke};--cedar-layer-fill:${accent.fill};--cedar-layer-text:${accent.text}"><span class="cedar-layer-chip-label">${escapeHtml(layer.label)}</span><span class="cedar-layer-chip-hint">${escapeHtml(layer.hint)}</span></li>`;
    })
    .join("");
  return `<div class="cedar-layer-stack cedar-architecture-layer-stack" aria-label="${escapeHtml(ARCHITECTURE_MODEL_LABEL)}">
    <p class="cedar-label cedar-architecture-section-label mb-0">Layers in this PR</p>
    <ol class="cedar-layer-stack-list">${items}</ol>
  </div>`;
}

function virtualPrLabel(target, pull, componentId) {
  const repo = target?.owner && target?.repo ? `${target.owner}/${target.repo}` : "repository";
  return {
    id: `vpr-${pull.number}-${componentId}`,
    title: "Slice",
    slug: `${repo}#${pull.number} · slice \`${componentId}\``,
  };
}

/**
 * @param {ParentNode} root
 * @param {"architecture" | "slices"} [mainTab]
 */
function activateReviewMainTab(root, mainTab = "architecture") {
  root.querySelectorAll("[data-review-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const on = btn.getAttribute("data-review-tab") === mainTab;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  root.querySelectorAll("[data-review-panel]").forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return;
    panel.hidden = panel.getAttribute("data-review-panel") !== mainTab;
  });
  const layout = root.querySelector(".cedar-review-layout");
  const mainStage = document.getElementById("main-stage");
  if (layout instanceof HTMLElement) {
    layout.classList.toggle("cedar-review-slices-focus", mainTab === "slices");
  }
  if (mainStage instanceof HTMLElement) {
    mainStage.classList.toggle("cedar-review-slices-focus", mainTab === "slices");
  }
  const iconLayout = root.querySelector(".cedar-review-layout--icon-nav");
  if (iconLayout instanceof HTMLElement) {
    iconLayout.querySelectorAll(".cedar-review-icon-rail-btn").forEach((btn) => {
      if (!(btn instanceof HTMLButtonElement) || btn.hasAttribute("data-code-map-flyout-tab")) return;
      const arch = btn.getAttribute("data-review-tab") === "architecture";
      const active = arch ? mainTab === "architecture" : mainTab === "slices" && !arch;
      if (arch || btn.getAttribute("data-left-drawer-tab") === "slices") {
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      }
    });
  }

  if (mainTab === "architecture") {
    ensurePrArchitectureView(root);
    requestAnimationFrame(() => {
      ensurePrArchitectureView(root);
      requestAnimationFrame(() => {
        ensurePrArchitectureView(root);
        window.dispatchEvent(new Event("resize"));
      });
    });
  } else if (mainTab === "slices") {
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
}

/**
 * @param {ParentNode} root
 * @param {string} componentId
 */
function activateSliceTab(root, componentId) {
  if (!componentId) return;
  activateReviewMainTab(root, "slices");
  root.querySelectorAll("[data-slice-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const on = btn.getAttribute("data-slice-tab") === componentId;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
    if (on) btn.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  const layout = root.querySelector(".cedar-review-layout");
  const sliceQueueLayout =
    layout?.classList.contains("cedar-review-layout--slice-queue") ||
    layout?.classList.contains("cedar-review-layout--gh-pr");
  const scrollParent =
    root.querySelector(".cedar-slice-panel.is-active-slice .cedar-slice-queue-scroll") ??
    root.querySelector(".cedar-review-main-body > .cedar-slices-stage") ??
    root.querySelector(".cedar-slices-stage");
  root.querySelectorAll("[data-slice-panel]").forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return;
    const on = panel.getAttribute("data-slice-panel") === componentId;
    if (sliceQueueLayout) {
      panel.hidden = !on;
    } else {
      panel.hidden = false;
    }
    panel.classList.toggle("is-active-slice", on);
    if (on && sliceQueueLayout) {
      refreshFilesDrawerPanel(root);
      refreshFindingsDrawerPanel(root);
      requestAnimationFrame(() => {
        const queueScroll = panel.querySelector(".cedar-slice-queue-scroll");
        if (queueScroll instanceof HTMLElement) {
          queueScroll.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    } else if (on && !sliceQueueLayout) {
      requestAnimationFrame(() => {
        if (scrollParent instanceof HTMLElement) {
          const top =
            panel.getBoundingClientRect().top -
            scrollParent.getBoundingClientRect().top +
            scrollParent.scrollTop;
          scrollParent.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
        } else {
          panel.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      });
    }
  });
  root.querySelectorAll("[data-scroll-slice]").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    btn.classList.toggle(
      "is-active",
      btn.getAttribute("data-scroll-slice") === componentId
    );
  });
}

/**
 * @param {ParentNode} root
 */
function wireSliceKeyboardNav(root) {
  if (root instanceof HTMLElement && root.dataset.wiredSliceKeys) return;
  if (root instanceof HTMLElement) root.dataset.wiredSliceKeys = "1";

  const sliceIds = [...root.querySelectorAll("[data-slice-tab]")]
    .map((el) => el.getAttribute("data-slice-tab"))
    .filter(Boolean);

  document.addEventListener("keydown", (ev) => {
    if (ev.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    const slicesPanel = root.querySelector('[data-review-panel="slices"]');
    if (slicesPanel?.hidden) return;

    const active = root.querySelector("[data-slice-tab].is-active");
    const current = active?.getAttribute("data-slice-tab");
    const idx = current ? sliceIds.indexOf(current) : 0;
    if (idx < 0) return;

    if (ev.key === "[" && idx > 0) {
      ev.preventDefault();
      activateSliceTab(root, sliceIds[idx - 1]);
    } else if (ev.key === "]" && idx < sliceIds.length - 1) {
      ev.preventDefault();
      activateSliceTab(root, sliceIds[idx + 1]);
    }
  });
}

const SIDEBAR_WIDTH_KEY = "cedar.reviewSidebarWidthPx";
const SIDEBAR_WIDTH_DEFAULT = 432;
const SIDEBAR_WIDTH_MIN = 280;
const SIDEBAR_WIDTH_MAX = 560;

const SLICE_RAIL_WIDTH_KEY = "cedar.sliceRailWidthPx";
const SLICE_RAIL_DEFAULT = 108;
const SLICE_RAIL_MIN = 96;
const SLICE_RAIL_MAX = 220;

const FILE_FLOW_RAIL_WIDTH_KEY = "cedar.fileFlowRailWidthPx";
const FILE_FLOW_RAIL_DEFAULT = 520;
const FILE_FLOW_RAIL_MIN = 320;
const FILE_FLOW_RAIL_MAX = 880;

const SLICES_NAV_RAIL_WIDTH_KEY = "cedar.slicesNavRailWidthPx";
const SLICES_NAV_RAIL_USER_KEY = "cedar.slicesNavRailUserResized";
const SLICES_NAV_RAIL_DEFAULT = 336;
const SLICES_NAV_RAIL_MIN = 220;
const SLICES_NAV_RAIL_MAX = 640;

/**
 * @param {HTMLElement | null | undefined} layout
 */
function readStoredSidebarWidth() {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n));
  return SIDEBAR_WIDTH_DEFAULT;
}

/**
 * @param {HTMLElement | null | undefined} layout
 */
function applySidebarWidth(layout, widthPx) {
  if (!layout) return;
  layout.style.setProperty("--cedar-sidebar-width", `${widthPx}px`);
}

/**
 * @param {ParentNode} root
 */
function wireReviewLayoutResize(root) {
  const layout = root.querySelector(".cedar-review-layout");
  const splitter = root.querySelector("[data-review-splitter]");
  const sidebar = root.querySelector(".cedar-review-sidebar");
  if (!(layout instanceof HTMLElement) || !(splitter instanceof HTMLElement)) return;

  applySidebarWidth(layout, readStoredSidebarWidth());

  if (splitter.dataset.wiredSplitter) return;
  splitter.dataset.wiredSplitter = "1";

  const notifyMainResized = () => {
    window.dispatchEvent(new Event("resize"));
  };

  splitter.addEventListener("dblclick", () => {
    applySidebarWidth(layout, SIDEBAR_WIDTH_DEFAULT);
    localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    notifyMainResized();
  });

  splitter.addEventListener("pointerdown", (ev) => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    ev.preventDefault();
    splitter.setPointerCapture(ev.pointerId);
    document.body.classList.add("cedar-is-resizing-review");
    const startX = ev.clientX;
    const startW =
      sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : readStoredSidebarWidth();

    const onMove = (moveEv) => {
      const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, startW + (moveEv.clientX - startX)));
      applySidebarWidth(layout, next);
      notifyMainResized();
    };

    const onUp = (upEv) => {
      splitter.releasePointerCapture(upEv.pointerId);
      document.body.classList.remove("cedar-is-resizing-review");
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      splitter.removeEventListener("pointercancel", onUp);
      if (sidebar instanceof HTMLElement) {
        const px = Math.round(sidebar.getBoundingClientRect().width);
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(px));
      }
    };

    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);
  });

  splitter.addEventListener("keydown", (ev) => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    let delta = 0;
    if (ev.key === "ArrowLeft") delta = -16;
    else if (ev.key === "ArrowRight") delta = 16;
    else return;
    ev.preventDefault();
    const current = sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : SIDEBAR_WIDTH_DEFAULT;
    const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, current + delta));
    applySidebarWidth(layout, next);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(next)));
    notifyMainResized();
  });
}

function readStoredSliceRailWidth() {
  const raw = localStorage.getItem(SLICE_RAIL_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) return Math.min(SLICE_RAIL_MAX, Math.max(SLICE_RAIL_MIN, n));
  return SLICE_RAIL_DEFAULT;
}

/**
 * @param {HTMLElement | null | undefined} shell
 * @param {number} widthPx
 */
function applySliceRailWidth(shell, widthPx) {
  if (!shell) return;
  shell.style.setProperty("--cedar-slice-rail-width", `${widthPx}px`);
}

/**
 * @param {ParentNode} root
 */
function wireSliceRailResize(root) {
  const shell = root.querySelector(".cedar-slices-shell");
  const splitter = root.querySelector("[data-slice-splitter]");
  const rail = root.querySelector(".cedar-slice-rail-wrap");
  if (!(shell instanceof HTMLElement) || !(splitter instanceof HTMLElement)) return;

  applySliceRailWidth(shell, readStoredSliceRailWidth());

  if (splitter.dataset.wiredSliceSplit) return;
  splitter.dataset.wiredSliceSplit = "1";

  const notifyResized = () => window.dispatchEvent(new Event("resize"));

  splitter.addEventListener("dblclick", () => {
    applySliceRailWidth(shell, SLICE_RAIL_DEFAULT);
    localStorage.removeItem(SLICE_RAIL_WIDTH_KEY);
    notifyResized();
  });

  splitter.addEventListener("pointerdown", (ev) => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    ev.preventDefault();
    splitter.setPointerCapture(ev.pointerId);
    document.body.classList.add("cedar-is-resizing-slices");
    const startX = ev.clientX;
    const startW = rail instanceof HTMLElement ? rail.getBoundingClientRect().width : readStoredSliceRailWidth();

    const onMove = (moveEv) => {
      // Rail on the right: drag left → narrower rail → wider diff pane
      const next = Math.min(SLICE_RAIL_MAX, Math.max(SLICE_RAIL_MIN, startW - (moveEv.clientX - startX)));
      applySliceRailWidth(shell, next);
      notifyResized();
    };

    const onUp = (upEv) => {
      splitter.releasePointerCapture(upEv.pointerId);
      document.body.classList.remove("cedar-is-resizing-slices");
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      splitter.removeEventListener("pointercancel", onUp);
      if (rail instanceof HTMLElement) {
        localStorage.setItem(SLICE_RAIL_WIDTH_KEY, String(Math.round(rail.getBoundingClientRect().width)));
      }
    };

    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);
  });

  splitter.addEventListener("keydown", (ev) => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    let delta = 0;
    if (ev.key === "ArrowLeft") delta = 16;
    else if (ev.key === "ArrowRight") delta = -16;
    else return;
    ev.preventDefault();
    const current = rail instanceof HTMLElement ? rail.getBoundingClientRect().width : SLICE_RAIL_DEFAULT;
    const next = Math.min(SLICE_RAIL_MAX, Math.max(SLICE_RAIL_MIN, current - delta));
    applySliceRailWidth(shell, next);
    localStorage.setItem(SLICE_RAIL_WIDTH_KEY, String(Math.round(next)));
    notifyResized();
  });
}

function readStoredFileFlowRailWidth() {
  const raw = localStorage.getItem(FILE_FLOW_RAIL_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) return Math.min(FILE_FLOW_RAIL_MAX, Math.max(FILE_FLOW_RAIL_MIN, n));
  return FILE_FLOW_RAIL_DEFAULT;
}

/**
 * @param {HTMLElement | null | undefined} shell
 * @param {number} widthPx
 */
function applyFileFlowRailWidth(shell, widthPx) {
  if (!shell) return;
  shell.style.setProperty("--cedar-file-flow-rail-width", `${widthPx}px`);
}

/**
 * @param {ParentNode} root
 */
function wireFileFlowRailResize(root) {
  const shell = root.querySelector(".cedar-review-layout--three-col");
  const splitter = root.querySelector("[data-file-flow-splitter]");
  const rail = root.querySelector(".cedar-review-right-nav");
  if (!(shell instanceof HTMLElement) || !(splitter instanceof HTMLElement)) return;

  applyFileFlowRailWidth(shell, readStoredFileFlowRailWidth());

  if (splitter.dataset.wiredFileFlowSplit) return;
  splitter.dataset.wiredFileFlowSplit = "1";

  const notifyResized = () => {
    window.dispatchEvent(new Event("resize"));
    scheduleDiagramRefit(root);
  };

  splitter.addEventListener("dblclick", () => {
    applyFileFlowRailWidth(shell, FILE_FLOW_RAIL_DEFAULT);
    localStorage.removeItem(FILE_FLOW_RAIL_WIDTH_KEY);
    notifyResized();
  });

  splitter.addEventListener("pointerdown", (ev) => {
    if (!root.querySelector(".cedar-review-layout--three-col")) return;
    ev.preventDefault();
    splitter.setPointerCapture(ev.pointerId);
    document.body.classList.add("cedar-is-resizing-file-flow");
    const startX = ev.clientX;
    const startW = rail instanceof HTMLElement ? rail.getBoundingClientRect().width : readStoredFileFlowRailWidth();

    const onMove = (moveEv) => {
      const next = Math.min(FILE_FLOW_RAIL_MAX, Math.max(FILE_FLOW_RAIL_MIN, startW - (moveEv.clientX - startX)));
      applyFileFlowRailWidth(shell, next);
      notifyResized();
    };

    const onUp = (upEv) => {
      splitter.releasePointerCapture(upEv.pointerId);
      document.body.classList.remove("cedar-is-resizing-file-flow");
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      splitter.removeEventListener("pointercancel", onUp);
      if (rail instanceof HTMLElement) {
        localStorage.setItem(FILE_FLOW_RAIL_WIDTH_KEY, String(Math.round(rail.getBoundingClientRect().width)));
      }
    };

    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);
  });

  splitter.addEventListener("keydown", (ev) => {
    if (!root.querySelector(".cedar-review-layout--three-col")) return;
    let delta = 0;
    if (ev.key === "ArrowLeft") delta = 16;
    else if (ev.key === "ArrowRight") delta = -16;
    else return;
    ev.preventDefault();
    const current = rail instanceof HTMLElement ? rail.getBoundingClientRect().width : FILE_FLOW_RAIL_DEFAULT;
    const next = Math.min(FILE_FLOW_RAIL_MAX, Math.max(FILE_FLOW_RAIL_MIN, current + delta));
    applyFileFlowRailWidth(shell, next);
    localStorage.setItem(FILE_FLOW_RAIL_WIDTH_KEY, String(Math.round(next)));
    notifyResized();
  });
}

function readStoredSlicesNavRailWidth() {
  if (localStorage.getItem(SLICES_NAV_RAIL_USER_KEY) !== "1") {
    return SLICES_NAV_RAIL_DEFAULT;
  }
  const raw = localStorage.getItem(SLICES_NAV_RAIL_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) {
    const clamped = Math.min(SLICES_NAV_RAIL_MAX, Math.max(SLICES_NAV_RAIL_MIN, n));
    if (Math.round(clamped) !== Math.round(n)) {
      localStorage.setItem(SLICES_NAV_RAIL_WIDTH_KEY, String(Math.round(clamped)));
    }
    return clamped;
  }
  return SLICES_NAV_RAIL_DEFAULT;
}

/**
 * @param {HTMLElement | null | undefined} shell
 * @param {number} widthPx
 */
function applySlicesNavRailWidth(shell, widthPx) {
  if (!shell) return;
  shell.style.setProperty("--cedar-slices-nav-rail-width", `${widthPx}px`);
}

/**
 * @param {HTMLElement | null | undefined} shell
 */
function syncSlicesNavRailWidthFromPrefs(shell) {
  if (!shell) return;
  if (localStorage.getItem(SLICES_NAV_RAIL_USER_KEY) === "1") {
    applySlicesNavRailWidth(shell, readStoredSlicesNavRailWidth());
    return;
  }
  applySlicesNavRailWidth(shell, SLICES_NAV_RAIL_DEFAULT);
}

/**
 * @param {ParentNode} root
 */
function wireSlicesNavRailResize(root) {
  const shell = root.querySelector(".cedar-review-layout--three-col");
  const splitter = root.querySelector("[data-slices-nav-splitter]");
  const rail =
    root.querySelector(".cedar-review-left-drawer") ?? root.querySelector(".cedar-review-left-nav");
  if (!(shell instanceof HTMLElement) || !(splitter instanceof HTMLElement)) return;

  syncSlicesNavRailWidthFromPrefs(shell);

  if (splitter.dataset.wiredSlicesNavSplit) return;
  splitter.dataset.wiredSlicesNavSplit = "1";

  const notifyResized = () => {
    window.dispatchEvent(new Event("resize"));
    scheduleDiagramRefit(root);
  };

  splitter.addEventListener("dblclick", () => {
    localStorage.removeItem(SLICES_NAV_RAIL_WIDTH_KEY);
    localStorage.removeItem(SLICES_NAV_RAIL_USER_KEY);
    syncSlicesNavRailWidthFromPrefs(shell);
    notifyResized();
  });

  splitter.addEventListener("pointerdown", (ev) => {
    if (!root.querySelector(".cedar-review-layout--three-col")) return;
    ev.preventDefault();
    splitter.setPointerCapture(ev.pointerId);
    document.body.classList.add("cedar-is-resizing-slices-nav");
    const startX = ev.clientX;
    const startW = rail instanceof HTMLElement ? rail.getBoundingClientRect().width : readStoredSlicesNavRailWidth();

    const onMove = (moveEv) => {
      const next = Math.min(SLICES_NAV_RAIL_MAX, Math.max(SLICES_NAV_RAIL_MIN, startW + (moveEv.clientX - startX)));
      applySlicesNavRailWidth(shell, next);
      notifyResized();
    };

    const onUp = (upEv) => {
      splitter.releasePointerCapture(upEv.pointerId);
      document.body.classList.remove("cedar-is-resizing-slices-nav");
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      splitter.removeEventListener("pointercancel", onUp);
      if (rail instanceof HTMLElement) {
        localStorage.setItem(SLICES_NAV_RAIL_USER_KEY, "1");
        localStorage.setItem(SLICES_NAV_RAIL_WIDTH_KEY, String(Math.round(rail.getBoundingClientRect().width)));
      }
    };

    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);
  });

  splitter.addEventListener("keydown", (ev) => {
    if (!root.querySelector(".cedar-review-layout--three-col")) return;
    let delta = 0;
    if (ev.key === "ArrowRight") delta = 16;
    else if (ev.key === "ArrowLeft") delta = -16;
    else return;
    ev.preventDefault();
    const current = rail instanceof HTMLElement ? rail.getBoundingClientRect().width : SLICES_NAV_RAIL_DEFAULT;
    const next = Math.min(SLICES_NAV_RAIL_MAX, Math.max(SLICES_NAV_RAIL_MIN, current + delta));
    applySlicesNavRailWidth(shell, next);
    localStorage.setItem(SLICES_NAV_RAIL_USER_KEY, "1");
    localStorage.setItem(SLICES_NAV_RAIL_WIDTH_KEY, String(Math.round(next)));
    notifyResized();
  });
}

/**
 * @param {ParentNode} root
 * @param {"architecture" | "slices"} defaultMainTab
 */
/**
 * @param {ParentNode} root
 * @param {string} source
 * @param {() => void} [onRetry]
 */
/**
 * @param {ParentNode} root
 * @param {{ components?: string, flow?: string, events?: string }} views
 */
/** @type {WeakMap<HTMLElement, () => void>} */
const completeLayoutDrawByHost = new WeakMap();

/**
 * PR-level Architecture tab — Cytoscape layout graphs (UML / Flow / Events).
 */
function resolveSessionLayoutGraphs() {
  const session = window.__cedarSession;
  if (!session) return null;
  if (session.layoutGraphs) return session.layoutGraphs;
  const b = session.layoutViewsBuild;
  if (!b?.diagramMicroPrs?.length) return null;
  const graphs = buildLayoutDiagramGraphs(
    b.diagramMicroPrs,
    b.breakouts,
    b.pull,
    b.target,
    b.sliceNumberById
  );
  session.layoutGraphs = graphs;
  return graphs;
}

function architectureLayoutStatusMap() {
  const payload = window.__cedarOverviewGraph;
  return payload?.getStatusMap?.() ?? new Map();
}

/**
 * @param {ParentNode} scope
 * @param {object} layoutGraphs
 * @param {{ force?: boolean }} [opts]
 */
function mountPrLayoutCyGraphs(scope, layoutGraphs, opts = {}) {
  if (!layoutGraphs) return Promise.resolve(0);
  const mounted = mountArchitectureLayoutGraphs(scope, layoutGraphs, architectureLayoutStatusMap(), opts);
  activateDiagramUx(scope);
  wireArchitectureZoomControls(scope);
  return Promise.resolve(mounted);
}

/**
 * @param {ParentNode} root
 */
function ensurePrArchitectureView(root) {
  const panel = root.querySelector("#cedar-review-panel-architecture");
  if (panel instanceof HTMLElement && panel.hidden) return;

  const scope =
    root instanceof HTMLElement && root.id === "results"
      ? root
      : (root.querySelector("#results") ?? root);

  const layoutGraphs = resolveSessionLayoutGraphs();
  const stackHost = scope.querySelector("#architecture-read-mermaid");
  if (stackHost instanceof HTMLElement && layoutGraphs) {
    let draw = completeLayoutDrawByHost.get(stackHost);
    if (!draw) {
      wireArchitectureLayoutCy(scope, layoutGraphs);
      draw = completeLayoutDrawByHost.get(stackHost);
    }
    void mountPrLayoutCyGraphs(scope, layoutGraphs, { force: true });
  }

  const payload = window.__cedarOverviewGraph;
  if (payload) {
    const graph = payload.resolveGraph();
    if (isRenderableDiagramGraph(graph)) {
      mountArchitectureGraphs(scope, graph, payload.getStatusMap(), {
        force: true,
        onFail: () => showToast("Architecture diagram could not render.", "error"),
      });
    }
  }

  wireArchitectureZoomControls(scope);
}

/**
 * Rebuild layout Cytoscape graphs after theme / slice status changes.
 * @param {ParentNode} root
 */
function refreshCompleteLayoutCyGraphs(root) {
  const session = window.__cedarSession;
  const b = session?.layoutViewsBuild;
  if (!b?.diagramMicroPrs?.length) return null;
  const graphs = buildLayoutDiagramGraphs(
    b.diagramMicroPrs,
    b.breakouts,
    b.pull,
    b.target,
    b.sliceNumberById
  );
  const host = root.querySelector("#architecture-read-mermaid");
  if (session) session.layoutGraphs = graphs;
  completeLayoutDrawByHost.get(host)?.();
  return graphs;
}

/**
 * @param {object} breakouts
 * @param {object[]} diagramMicroPrs
 * @param {{ number?: number, title?: string }} pull
 * @param {{ owner?: string, repo?: string }} target
 */
function resolveOverviewDiagramGraph(breakouts, diagramMicroPrs, pull, target) {
  const built = buildDiagramGraph(diagramMicroPrs, breakouts, pull, target);
  const fromApi = breakouts?.diagramGraph;
  if (isRenderableDiagramGraph(fromApi)) return fromApi;
  return built;
}

/**
 * @param {HTMLElement} root
 * @param {{ resolveGraph: () => object, getStatusMap: () => Map<string, string> }} payload
 */
function wireArchitectureOverviewGraph(root, payload) {
  const draw = () => {
    const graph = payload.resolveGraph();
    if (!isRenderableDiagramGraph(graph)) {
      return;
    }
    const panel = root.querySelector("#cedar-review-panel-architecture");
    const panelHidden = panel instanceof HTMLElement && panel.hidden;
    mountArchitectureGraphs(root, graph, payload.getStatusMap(), {
      force: !panelHidden,
      onFail: () => {
        if (!panelHidden) showToast("Architecture diagram could not render.", "error");
      },
    });
    if (!panelHidden) {
      requestAnimationFrame(() => {
        const graphs = resolveSessionLayoutGraphs();
        if (graphs) mountArchitectureLayoutGraphs(root, graphs, payload.getStatusMap(), { force: true });
      });
    }
  };

  root.querySelectorAll("[data-review-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLElement) || btn.dataset.wiredCyOverview) return;
    btn.dataset.wiredCyOverview = "1";
    btn.addEventListener("click", () => {
      if (btn.getAttribute("data-review-tab") === "architecture") {
        requestAnimationFrame(() => requestAnimationFrame(draw));
      }
    });
  });

  requestAnimationFrame(() => requestAnimationFrame(draw));
}

function wireArchitectureLayoutCy(root, layoutGraphs) {
  if (!(root instanceof HTMLElement) || !layoutGraphs) return;
  const host = root.querySelector("#architecture-read-mermaid");
  if (!(host instanceof HTMLElement)) return;

  const draw = () => {
    const panel = root.querySelector("#cedar-review-panel-architecture");
    const panelHidden = panel instanceof HTMLElement && panel.hidden;
    const graphs = resolveSessionLayoutGraphs() ?? layoutGraphs;
    void mountPrLayoutCyGraphs(root, graphs, { force: !panelHidden }).then((drew) => {
      if (!drew && !panelHidden) {
        showToast("Architecture layout diagrams could not render.", "error");
      }
    });
  };

  completeLayoutDrawByHost.set(host, draw);
  wireArchitectureZoomControls(root);

  root.querySelectorAll("[data-review-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLElement) || btn.dataset.wiredLayoutCyTab) return;
    btn.dataset.wiredLayoutCyTab = "1";
    btn.addEventListener("click", () => {
      if (btn.getAttribute("data-review-tab") === "architecture") {
        requestAnimationFrame(() => requestAnimationFrame(draw));
      }
    });
  });

  requestAnimationFrame(() => requestAnimationFrame(draw));
}

function wireReviewTabs(root, defaultMainTab) {
  root.querySelectorAll("[data-review-tab]").forEach((btn) => {
    if (btn.dataset.wiredReviewTab) return;
    btn.dataset.wiredReviewTab = "1";
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-review-tab");
      if (tab === "architecture" || tab === "slices") activateReviewMainTab(root, tab);
    });
  });
  activateReviewMainTab(root, defaultMainTab);
}

/**
 * @param {ParentNode} root
 * @param {string} [initialSliceId]
 */
function wireSliceTabs(root, initialSliceId = "") {
  root.querySelectorAll("[data-slice-tab]").forEach((btn) => {
    if (btn.dataset.wiredSliceTab) return;
    btn.dataset.wiredSliceTab = "1";
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-slice-tab");
      if (id) activateSliceTab(root, id);
    });
  });
  if (initialSliceId) activateSliceTab(root, initialSliceId);
}

function renderCursorReviewRollup(summary) {
  if (!shouldShowCursorFindingCounts(summary)) return "";
  const macroCount = summary.macro?.findingCount ?? 0;
  const sliceTotal = summary.slice?.total ?? 0;
  return `<div class="cedar-cursor-rollup cedar-cursor-rollup--compact" aria-labelledby="cedar-cursor-rollup-heading">
    <p id="cedar-cursor-rollup-heading" class="cedar-cursor-rollup-total">
      <span class="cedar-cursor-rollup-label">Cursor findings</span>
      <span class="cedar-cursor-rollup-num tabular-nums">${summary.totalFindings}</span>
      <span class="cedar-cursor-rollup-on">on this PR</span>
    </p>
    <p class="cedar-cursor-rollup-meta tabular-nums">${sliceTotal} slice · ${macroCount} macro</p>
  </div>`;
}

/**
 * @param {HTMLElement} container
 * @param {object} data
 * @param {{ uiRestore?: { mainTab?: string | null, sliceId?: string | null } | null }} [opts]
 */
function renderResults(container, data, opts = {}) {
  enterReviewStageLayout();
  container.classList.add("cedar-review-results--mounted");
  const { pull, gate, microPrs, microResults, cursorReviewSummary, composite, breakouts, partition, target } = data;
  const cursorSummary = refreshCursorReviewSummary(window.__cedarSession) ?? cursorReviewSummary ?? null;
  const cursorBySlice = new Map((cursorSummary?.slice?.bySlice ?? []).map((s) => [s.componentId, s]));
  const showCursorFindingCounts = shouldShowCursorFindingCounts(cursorSummary);
  const uiRestore = opts.uiRestore ?? null;
  sliceApprovals = window.__cedarSession?.sliceApprovals ?? sliceApprovals;
  ensureFindingSession(window.__cedarSession);
  setFileFlowCatalog(buildFileFlowCatalogFromMicroPrs(microPrs));

  const touched = microResults.filter((r) => r.status !== "skipped");
  const approvedCount = touched.filter((r) => sliceApprovals.has(r.componentId)).length;
  const allSlicesApproved = touched.length > 0 && approvedCount === touched.length;
  const canApprovePr = gate.ready && allSlicesApproved;
  const approvePct = touched.length ? Math.round((approvedCount / touched.length) * 100) : 0;
  const approvalCopy = sliceApprovalHeaderCopy(approvedCount, touched.length, canApprovePr, gate.ready);
  const archSliceCount = microPrs.filter((m) => (m.files?.length ?? m.fileCount ?? 0) > 0).length;
  const diagramMicroPrs = microPrsForDiagram(microPrs).map((m) => ({
      componentId: m.componentId,
      componentName: m.componentName,
      additions: m.additions ?? 0,
      deletions: m.deletions ?? 0,
      dependsOn: m.dependsOn ?? [],
      files: (m.files ?? []).map((f) => ({
        filename: f.path ?? f.filename,
        path: f.path ?? f.filename,
        patch: typeof f.patch === "string" ? f.patch : "",
        status: f.status,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      })),
    }));
  let diagramMermaid = breakouts?.diagramMermaid ?? "";
  if (!diagramMermaid.trim() && diagramMicroPrs.length) {
    diagramMermaid = buildArchitectureDiagramMermaid(
      diagramMicroPrs,
      breakouts,
      { number: pull.number, title: pull.title },
      { owner: target?.owner, repo: target?.repo }
    );
  }
  const activeSlicesForDiagram = microResults.filter((r) => r.status !== "skipped");
  const sliceNumberById = Object.fromEntries(
    activeSlicesForDiagram.map((r, i) => [normalizeSliceId(r.componentId), i + 1])
  );
  const archLayersForBadges = diagramMicroPrs.length
    ? buildPrArchitectureLayers(diagramMicroPrs, breakouts)
    : [];
  const classNamesBySlice = new Map(
    archLayersForBadges.map((l) => [l.id, (l.classNames?.length ? l.classNames : [l.name || l.micro?.componentName]).filter(Boolean)])
  );

  let layoutGraphs = null;
  let layoutViews = breakouts?.diagramLayoutViews ?? null;
  if (diagramMicroPrs.length) {
    layoutGraphs = buildLayoutDiagramGraphs(
      diagramMicroPrs,
      breakouts,
      { number: pull.number, title: pull.title },
      { owner: target?.owner, repo: target?.repo },
      sliceNumberById
    );
    layoutViews = buildCompleteLayoutViews(
      diagramMicroPrs,
      breakouts,
      { number: pull.number, title: pull.title },
      { owner: target?.owner, repo: target?.repo },
      sliceNumberById,
      getResolvedTheme()
    );
    if (window.__cedarSession) {
      window.__cedarSession.layoutGraphs = layoutGraphs;
      window.__cedarSession.layoutViews = layoutViews;
      window.__cedarSession.layoutViewsBuild = {
        diagramMicroPrs,
        breakouts,
        pull: { number: pull.number, title: pull.title },
        target: { owner: target?.owner, repo: target?.repo },
        sliceNumberById,
      };
    }
  }
  const hasLayoutViews = Boolean(
    layoutGraphs &&
      (layoutGraphs.components?.overview?.nodes?.length ||
        layoutGraphs.flow?.overview?.nodes?.length ||
        layoutGraphs.events?.overview?.nodes?.length ||
        layoutGraphs.dataModel?.overview?.nodes?.length)
  );
  const showArchitectureSection = archSliceCount > 0 || hasLayoutViews;
  const architectureReadSummary = (
    breakouts?.architectureVisual?.summary ??
    breakouts?.diagramGraph?.meta?.visualSummary ??
    ""
  ).trim();
  const architectureReadNotes =
    breakouts?.architectureVisual?.conceptualNotes ?? breakouts?.diagramGraph?.meta?.conceptualNotes ?? [];
  const activeArchitectureIds = microPrs
    .filter((m) => (m.files?.length ?? m.fileCount ?? 0) > 0)
    .map((m) => m.componentId);
  const prLayerStackHtml = renderPrLayerStack(activeArchitectureIds);

  const showArchitectureRead =
    archSliceCount > 0 ||
    hasLayoutViews ||
    showArchitectureSection ||
    architectureReadSummary ||
    architectureReadNotes.length > 0 ||
    Boolean(breakouts?.architectureSummary) ||
    Boolean(composite);

  const activeSlices = activeSlicesForDiagram;
  const fullPrFiles = mergeAllPrFiles(microPrs);
  const prFileCount = partition?.fileCount ?? fullPrFiles.length;
  const showFullPrSlice = fullPrFiles.length > 0;
  const defaultSliceId = activeSlices[0]?.componentId ?? (showFullPrSlice ? FULL_PR_SLICE_ID : "");
  const hasArchitectureContent = Boolean(breakouts?.architectureSummary) || showArchitectureRead;
  const defaultMainTab =
    archSliceCount > 0 || hasLayoutViews || hasArchitectureContent ? "architecture" : "slices";
  const initialMainTab =
    uiRestore?.mainTab === "architecture" || uiRestore?.mainTab === "slices" ? uiRestore.mainTab : defaultMainTab;
  const initialSliceId = uiRestore?.sliceId ?? defaultSliceId;
  const diagramSliceBadges = renderDiagramSliceBadges(
    activeSlices.map((r, i) => {
      const id = normalizeSliceId(r.componentId);
      return {
        componentId: r.componentId,
        componentName: microPrs.find((m) => m.componentId === r.componentId)?.componentName ?? r.componentName,
        status: r.status,
        sliceNumber: sliceNumberById[id] ?? i + 1,
        classNames: classNamesBySlice.get(id) ?? [],
      };
    })
  );

  const fullPrTabActive = showFullPrSlice && initialSliceId === FULL_PR_SLICE_ID;
  const fullPrCursorCount = fullPrCursorFindingCountLabel(cursorSummary);
  const fullPrCursorHtml = showCursorFindingCounts
    ? `<span class="cedar-pipeline-slice-findings tabular-nums${fullPrCursorCount.pending ? " is-pending" : ""}${fullPrCursorCount.failed ? " is-failed" : ""}" data-slice-cursor-findings title="${escapeHtml(fullPrCursorCount.title)}" aria-label="${escapeHtml(fullPrCursorCount.title)}">${fullPrCursorCount.text}</span>`
    : "";
  const fullPrSidebarNav = showFullPrSlice
    ? (() => {
        const passedVis = sliceStatusVisualForTheme("passed", getResolvedTheme());
        return `<button type="button" role="tab" class="cedar-nav-item cedar-nav-item-stack cedar-pipeline-slice-item cedar-pipeline-slice-item--full-pr${fullPrTabActive ? " is-active" : ""}"
        data-slice-status="passed"
        style="border-left: 3px solid ${passedVis.border}"
        data-slice-tab="${escapeHtml(FULL_PR_SLICE_ID)}" data-scroll-slice="${escapeHtml(FULL_PR_SLICE_ID)}"
        aria-selected="${fullPrTabActive ? "true" : "false"}"
        title="All ${fullPrFiles.length} changed files on this pull request${showCursorFindingCounts ? ` · ${fullPrCursorCount.title}` : ""}">
        <span class="cedar-nav-item-row">
          ${renderSliceStatusDot("passed")}
          <span class="cedar-nav-item-label">All files</span>
          <span class="cedar-nav-item-row-aside">${fullPrCursorHtml}<span class="cedar-pipeline-slice-files tabular-nums">${fullPrFiles.length}${prFileCount > fullPrFiles.length ? `/${prFileCount}` : ""}</span></span>
        </span>
        <span class="cedar-nav-item-meta">Full pull request diff</span>
      </button>`;
      })()
    : "";

  const sidebarSliceList =
    fullPrSidebarNav +
    activeSlices
      .map((r, i) => {
        const approved = sliceApprovals.has(r.componentId);
        const micro = microPrs.find((m) => m.componentId === r.componentId);
        const sliceFileCount = micro?.files?.length ?? micro?.fileCount ?? r.filesReviewed ?? 0;
        const vpr = virtualPrLabel(target, pull, r.componentId);
        const active = initialSliceId === r.componentId;
        const statusVis = sliceStatusVisualForTheme(r.status, getResolvedTheme());
        const navFindings = findingsForSlice(r.componentId, r).filter(
          (f, fi) => !isFindingIgnored(findingKey(r.componentId, f, fi))
        );
        const navBlockers = navFindings.filter((f) => f.severity === "blocker").length;
        const navWarnings = navFindings.filter((f) => f.severity === "warning").length;
        const cursorCount = sliceCursorFindingCountLabel(cursorBySlice.get(r.componentId));
        const cursorCountHtml = showCursorFindingCounts
          ? `<span class="cedar-pipeline-slice-findings tabular-nums${cursorCount.pending ? " is-pending" : ""}${cursorCount.failed ? " is-failed" : ""}" data-slice-cursor-findings title="${escapeHtml(cursorCount.title)}" aria-label="${escapeHtml(cursorCount.title)}">${cursorCount.text}</span>`
          : "";
        return `<button type="button" role="tab" class="cedar-nav-item cedar-nav-item-stack cedar-pipeline-slice-item cedar-queue-nav-item${active ? " is-active" : ""}${approved ? " is-queue-approved" : ""}"
        data-slice-status="${escapeHtml(r.status)}"
        style="border-left: 3px solid ${statusVis.border}"
        data-slice-tab="${escapeHtml(r.componentId)}" data-scroll-slice="${escapeHtml(r.componentId)}"
        aria-selected="${active ? "true" : "false"}"
        title="${escapeHtml(r.componentName)} · ${sliceFileCount} file${sliceFileCount === 1 ? "" : "s"}${showCursorFindingCounts ? ` · ${cursorCount.title}` : ""}${navBlockers ? ` · ${navBlockers} blocker(s)` : ""}">
        <span class="cedar-nav-item-row">
          ${renderSliceStatusDot(r.status)}
          <span class="cedar-nav-item-label">${escapeHtml(r.componentName)}</span>
          ${approved ? '<span class="cedar-nav-item-check">✓</span>' : ""}
          ${navBlockers ? `<span class="cedar-queue-pill cedar-queue-pill--blocker" aria-label="${navBlockers} blockers">${navBlockers}</span>` : ""}
          ${!navBlockers && navWarnings ? `<span class="cedar-queue-pill cedar-queue-pill--warn" aria-label="${navWarnings} warnings">${navWarnings}</span>` : ""}
          <span class="cedar-nav-item-row-aside">${cursorCountHtml}<span class="cedar-pipeline-slice-files tabular-nums" aria-label="${sliceFileCount} files">${sliceFileCount}</span></span>
        </span>
        <span class="cedar-nav-item-meta">${escapeHtml(vpr.id)} · ${sliceFileCount} file${sliceFileCount === 1 ? "" : "s"}</span>
      </button>`;
      })
      .join("");

  const fullPrPanelHtml = showFullPrSlice
    ? `<article id="slice-${escapeHtml(FULL_PR_SLICE_ID)}" class="cedar-slice-panel cedar-full-pr-slice cedar-slice-panel--queue${
        fullPrTabActive ? " is-active-slice" : ""
      }" data-slice-panel="${escapeHtml(FULL_PR_SLICE_ID)}" data-full-pr-slice="1"${fullPrTabActive ? "" : " hidden"}>
          <header class="cedar-slice-queue-head">
            <div class="cedar-slice-queue-head-main min-w-0">
              <p class="cedar-label mb-0">Full pull request</p>
              <h3 class="cedar-slice-queue-title">All changed files</h3>
              <p class="cedar-slice-queue-meta">${fullPrFiles.length} file${fullPrFiles.length === 1 ? "" : "s"} with diffs${
                prFileCount > fullPrFiles.length ? ` · ${prFileCount} on GitHub` : ""
              }</p>
            </div>
          </header>
          <div class="cedar-slice-queue-scroll cedar-slice-review-pane cedar-slice-review-pane--diffs">
            ${renderSliceFileReviews(fullPrFiles, pull.url)}
          </div>
        </article>`
    : "";

  const slicePanels =
    fullPrPanelHtml +
    activeSlices
      .map((r, i) => {
      const micro = microPrs.find((m) => m.componentId === r.componentId);
      const rationale = micro?.rationale ?? micro?.description;
      const cursorCount = (r.reviewComments ?? []).length;
      const activeFindings = findingsForSlice(r.componentId, r).filter(
        (f, fi) => !isFindingIgnored(findingKey(r.componentId, f, fi))
      );
      const blockers = activeFindings.filter((f) => f.severity === "blocker").length;
      const warnings = activeFindings.filter((f) => f.severity === "warning").length;
      const approved = sliceApprovals.has(r.componentId);
      const vpr = virtualPrLabel(target, pull, r.componentId);
      const fileList = micro?.files ?? [];
      const sliceTotals = microDiffTotals(micro);

      const sliceActive = initialSliceId === r.componentId;
      return `
        <article id="slice-${escapeHtml(r.componentId)}" class="cedar-slice-panel cedar-slice-panel--queue${
          sliceActive ? " is-active-slice" : ""
        }" data-slice-panel="${escapeHtml(r.componentId)}" data-virtual-pr="${escapeHtml(vpr.id)}"${sliceActive ? "" : " hidden"}>
          <header class="cedar-slice-queue-head">
            <div class="cedar-slice-queue-head-main min-w-0">
              <p class="cedar-label mb-0">${escapeHtml(vpr.title)}</p>
              <h3 class="cedar-slice-queue-title">${escapeHtml(r.componentName)}</h3>
              <p class="cedar-slice-queue-meta font-mono">${escapeHtml(vpr.slug)}</p>
              ${
                rationale
                  ? `<div class="cedar-slice-rationale cedar-slice-rationale--in-head cedar-slice-rationale--visible">
              <p class="cedar-slice-rationale-label">Slice rationale</p>
              <p class="cedar-slice-prose cedar-slice-rationale-body">${escapeHtml(rationale)}</p>
            </div>`
                  : ""
              }
            </div>
            <div class="cedar-slice-queue-head-aside">
              <div class="cedar-slice-queue-head-badges" data-slice-badges>
                ${renderSliceReviewBadge(r.status)}
                <span class="cedar-badge cedar-badge-muted">+${sliceTotals.additions} / −${sliceTotals.deletions}</span>
                <span class="cedar-badge cedar-badge-muted">${fileList.length} files</span>
                ${cursorCount ? `<span class="cedar-badge cedar-badge-ok cedar-badge-compact">${cursorCount} Cursor</span>` : ""}
                ${blockers ? `<span data-slice-blockers class="cedar-badge border-rose-500/30 bg-rose-500/10 text-rose-200">${blockers} blockers</span>` : ""}
                ${warnings ? `<span data-slice-warnings class="cedar-badge cedar-badge-warn">${warnings} warnings</span>` : ""}
                ${approved ? `<span class="cedar-badge cedar-badge-ok" data-slice-approved-badge>Approved</span>` : ""}
                <button type="button" data-approve-slice="${escapeHtml(r.componentId)}" data-component-name="${escapeHtml(r.componentName)}"
                  ${approved ? "disabled" : ""}
                  class="cedar-btn-signoff cedar-btn-slice cedar-slice-queue-approve${!approved ? " is-ready" : ""}${approved ? " is-done" : ""}"
                  title="Mark this slice approved in Cedar (not sent to GitHub)">
                  ${approved ? "Approved" : "Mark approved"}
                </button>
              </div>
            </div>
          </header>
          <div class="cedar-slice-queue-scroll cedar-slice-review-pane cedar-slice-review-pane--diffs">
            <section class="cedar-slice-queue-section cedar-slice-queue-section--diffs cedar-slice-diff-body">
              ${renderSliceFileReviews(fileList, pull.url)}
            </section>
          </div>
        </article>`;
    })
    .join("");

  container.innerHTML = `
    ${renderReviewProgressDockHtml()}
    <header class="cedar-pr-header cedar-pr-header--flat cedar-pr-header--product">
      <div class="cedar-pr-header-id">
        <p class="cedar-pr-header-eyebrow">Pull request</p>
        <a href="${escapeHtml(pull.url)}" target="_blank" rel="noreferrer"
          class="cedar-pr-header-title" title="${escapeHtml(pull.title)}">${escapeHtml(pull.title)}</a>
        <p class="cedar-pr-header-meta">#${pull.number} · ${gate.headSha.slice(0, 7)} · ${prFileCount} files · ${escapeHtml(breakouts?.strategy ?? partition?.mode ?? "review")}</p>
      </div>
      <div class="cedar-pr-header-metrics">
        <div class="cedar-pr-stats cedar-pr-stats--approval" role="group" aria-label="Slices approved">
          <div class="cedar-pr-approval-head">
            <p class="cedar-pr-stat-label cedar-pr-approval-label">Slices approved</p>
            <p class="cedar-pr-stat-value cedar-pr-stat-value--approval tabular-nums ${approvalCopy.tone}">
              <span class="cedar-pr-stat-num" data-pr-approved-count>${approvedCount}</span><span class="cedar-pr-stat-denom" data-pr-approved-total> / ${touched.length}</span>
            </p>
          </div>
          <div class="cedar-pr-stat-progress cedar-pr-approval-progress" role="progressbar" aria-valuenow="${approvePct}" aria-valuemin="0" aria-valuemax="100" aria-label="Slices approved">
            <div class="cedar-pr-stat-progress-fill cedar-pr-approval-progress-fill" data-pr-approve-fill style="width:${approvePct}%"></div>
          </div>
          <p class="cedar-pr-stat-caption cedar-pr-approval-caption" data-pr-approve-caption>${escapeHtml(approvalCopy.caption)}</p>
        </div>
        <div class="cedar-pr-header-actions">
          ${renderPrRefreshReviewButtonHtml()}
          <button type="button" id="approve-pr-btn" ${canApprovePr ? "" : "disabled"} class="cedar-btn-signoff cedar-btn-approve-pr${canApprovePr ? " is-ready" : ""}"
            title="${canApprovePr ? "Approve the full pull request on GitHub" : "Mark every slice approved in Cedar first"}">
            Approve full PR
          </button>
        </div>
      </div>
    </header>

    ${renderReviewMainTabsHeadHtml({
      activeTab: initialMainTab,
      sliceCount: touched.length,
    })}

    ${renderThreeColumnReviewChrome({
      sidebarSliceList,
      gate,
      cursorRollupHtml: renderCursorReviewRollup(cursorSummary),
      cursorRollupVisible: showCursorFindingCounts,
      centerMainHtml: `
          <div role="tabpanel" class="cedar-main-tabpanel cedar-main-tabpanel--architecture cedar-review-stage cedar-architecture-page" data-review-panel="architecture" id="cedar-review-panel-architecture"${
            initialMainTab === "slices" ? " hidden" : ""
          }>
            ${
              breakouts?.architectureSummary
                ? `<section class="cedar-architecture-section cedar-architecture-summary cedar-architecture-block">
            <p class="cedar-label cedar-architecture-section-label mb-0">Summary · ${escapeHtml(String(breakouts.strategy ?? partition?.mode ?? ""))}</p>
            <p class="cedar-architecture-prose">${escapeHtml(breakouts.architectureSummary)}</p>
          </section>`
                : ""
            }
            ${
              showArchitectureRead
                ? `<section class="cedar-architecture-section cedar-architecture-read" id="architecture-read">
            <header class="cedar-architecture-section-head">
              <p class="cedar-label cedar-architecture-section-label mb-0">Architecture read</p>
            </header>
            ${prLayerStackHtml}
            ${
              architectureReadSummary
                ? `<p class="cedar-architecture-prose cedar-architecture-prose--lead">${escapeHtml(architectureReadSummary)}</p>`
                : !composite && !hasLayoutViews && archSliceCount === 0
                  ? `<p class="cedar-architecture-prose cedar-architecture-prose--muted">Cursor can supply a one-paragraph visual read when <span class="font-mono">CEDAR_AI_DIAGRAM</span> is on; the full narrative appears after every slice passes.</p>`
                  : ""
            }
            ${
              architectureReadNotes.length
                ? `<ul class="cedar-architecture-notes">${architectureReadNotes
                    .map((n) => `<li>${escapeHtml(n)}</li>`)
                    .join("")}</ul>`
                : ""
            }
            ${
              archSliceCount > 0
                ? renderArchitectureDiagramCard({
                    cardId: "architecture-read-overview",
                    label: "Overview · slices",
                    toolbarTargetId: "cedar-cy-slices",
                    badgeHtml: `<span class="cedar-badge cedar-badge-muted">${archSliceCount} slices · ${
                      breakouts?.diagramVisualSource === "cursor" ? "Cursor" : "Minimal"
                    }</span>`,
                    stageAria: "Slice overview",
                    cytoscapeContainerId: "cedar-cy-slices",
                  })
                : ""
            }
            ${
              hasLayoutViews
                ? renderArchitectureDiagramStack(
                    [
                      {
                        view: "uml",
                        label: "UML · types",
                        cyId: "cedar-cy-components",
                        aria: "UML components class diagram",
                      },
                      { view: "flow", label: "Flow · files", cyId: "cedar-cy-flow", aria: "File import flow" },
                      {
                        view: "events",
                        label: "Events · calls",
                        cyId: "cedar-cy-events",
                        aria: "Call and message flow from diff",
                      },
                      {
                        view: "data",
                        label: "Data model",
                        cyId: "cedar-cy-datamodel",
                        aria: "Schema and migration changes",
                      },
                    ]
                      .map((spec) => renderArchitectureCyCard(spec, ""))
                      .join("")
                  )
                : ""
            }
          </section>`
                : !breakouts?.architectureSummary
                  ? `<p class="text-sm text-zinc-500">Architecture narrative and diagrams appear once partitioning finishes.</p>`
                  : ""
            }
          </div>

        <div role="tabpanel" class="cedar-main-tabpanel cedar-slices-stage cedar-slices-tabpanel cedar-slice-queue-stage" data-review-panel="slices" id="cedar-review-panel-slices"${
            initialMainTab === "architecture" ? " hidden" : ""
          }>
          <div class="cedar-slices-shell cedar-slices-shell--diffs cedar-slice-queue-shell">
            <div class="cedar-slice-panels cedar-slice-queue-panels min-w-0 flex-1">${slicePanels}</div>
          </div>
        </div>

        <p id="approve-status" class="mt-6 hidden text-sm font-medium text-emerald-400"></p>`,
    })}
  `;

  container.querySelectorAll("[data-scroll-slice], [data-jump-slice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-scroll-slice") ?? btn.getAttribute("data-jump-slice");
      if (id) activateSliceTab(container, id);
    });
  });

  wireReviewTabs(container, initialMainTab);
  wireSliceTabs(container, initialSliceId);
  wireSliceKeyboardNav(container);
  const layout = container.querySelector(".cedar-review-layout");
  if (layout instanceof HTMLElement && initialMainTab === "slices") {
    layout.classList.add("cedar-review-slices-focus");
    document.getElementById("main-stage")?.classList.add("cedar-review-slices-focus");
  }

  document.getElementById("new-review-btn")?.addEventListener("click", () => {
    stopPrCommitRefresh();
    document.getElementById("hero")?.classList.remove("hidden");
    exitReviewStageLayout();
    container.classList.remove("cedar-review-results--mounted");
    container.classList.add("hidden");
    container.innerHTML = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  if (hasLayoutViews && layoutGraphs) {
    if (window.__cedarSession) {
      window.__cedarSession.layoutGraphs = layoutGraphs;
      window.__cedarSession.layoutViews = layoutViews;
    }
    wireArchitectureLayoutCy(container, layoutGraphs);
    wireDiagramResizeListeners(container);
  }

  if (hasLayoutViews || archSliceCount > 0) {
    activateDiagramUx(container);
    const { size } = getDiffFontSettings();
    document.documentElement.style.setProperty(
      "--cedar-diagram-font-size",
      `${Math.min(14, Math.max(9, size + 2))}px`
    );
    scheduleDiagramRefit(container);
  }

  if (archSliceCount > 0) {
    const overviewPayload = {
      resolveGraph: () =>
        resolveOverviewDiagramGraph(breakouts, diagramMicroPrs, { number: pull.number, title: pull.title }, target),
      getStatusMap: () =>
        new Map(activeSlicesForDiagram.map((r) => [normalizeSliceId(r.componentId), r.status])),
    };
    window.__cedarOverviewGraph = overviewPayload;
    wireArchitectureOverviewGraph(container, overviewPayload);
  }

  wirePrChatSidebar(container, {
    getContext: () => buildPrChatContext(window.__cedarSession?.data ?? data),
    getToken: () => window.__cedarSession?.token,
    getSession: () => window.__cedarSession,
  });
  refreshPrChatUiFromSession();

  if (data.cursorReviewPending) restoreReviewProgressDock();
  applySliceNavTypography();
  finishReviewUi(container);
  if (!uiRestore?.mainTab) focusReviewWorkspace(container, initialMainTab);
  if (initialMainTab === "architecture") {
    requestAnimationFrame(() => ensurePrArchitectureView(container));
  }
}

function bindApproveHandlers(root) {
  if (!(root instanceof HTMLElement)) return;
  if (root.dataset.cedarApproveHandlersWired === "1") return;
  root.dataset.cedarApproveHandlersWired = "1";
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const sliceBtn = t.closest("[data-approve-slice]");
    if (sliceBtn instanceof HTMLButtonElement && !sliceBtn.disabled && root.contains(sliceBtn)) {
      void approveSlice(sliceBtn);
      return;
    }
    const prBtn = t.closest("#approve-pr-btn");
    if (prBtn instanceof HTMLButtonElement && root.contains(prBtn)) {
      void approveFullPr();
    }
  });
}

function approveSlice(btn) {
  const session = window.__cedarSession;
  if (!session) return;
  const componentId = btn.dataset.approveSlice;
  if (!componentId || isFullPrSliceId(componentId)) return;

  if (session.sliceApprovals.has(componentId)) return;
  session.sliceApprovals.add(componentId);
  showToast(`Marked approved · ${btn.dataset.componentName ?? componentId}`, "success");
  patchSliceApprovalState(componentId);
}

async function approveFullPr() {
  const session = window.__cedarSession;
  if (!session) return;
  const btn = document.getElementById("approve-pr-btn");
  const status = document.getElementById("approve-status");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Approving…";
  }

  try {
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prUrl: session.prUrl,
        token: session.token,
        owner: session.data.target?.owner,
        repo: session.data.target?.repo,
        pr: session.data.target?.pr,
        scope: "pr",
        headSha: session.data.pull.headSha,
        event: "APPROVE",
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(githubApiErrorMessage(body, res.statusText));
    if (status) {
      status.textContent = `Approved on GitHub · review #${body.review?.id ?? ""}`;
      status.classList.remove("hidden");
    }
    if (btn) {
      btn.textContent =
        body.review?.state === "APPROVED" ? "Approved" : "Review posted";
    }
    showToast(
      body.hint ??
        (body.review?.state === "APPROVED"
          ? "Pull request approved on GitHub"
          : "Review posted on GitHub")
    );
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Approve full PR";
    }
    showToast(err instanceof Error ? err.message : String(err), "error");
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {{ prUrl: string, token?: string, cursorApiKey?: string, post?: boolean, postMicro?: boolean }} payload
 */
function applyLoadedReviewSession(payload, data) {
  const filePatches = new Map();
  for (const m of data.microPrs ?? []) {
    for (const f of m.files ?? []) {
      if (f.patch) filePatches.set(`${m.componentId}::${f.path}`, f.patch);
    }
  }

  const prior = window.__cedarSession;
  const samePr = prior?.prUrl === payload.prUrl;
  window.__cedarSession = {
    prUrl: payload.prUrl,
    token: payload.token,
    cursorApiKey: payload.cursorApiKey,
    data,
    serverHealth: window.__cedarServerHealth,
    sliceApprovals: samePr && prior?.sliceApprovals ? prior.sliceApprovals : new Set(),
    ignoredFindings: samePr && prior?.ignoredFindings ? prior.ignoredFindings : new Set(),
    findingCommentsPosted:
      samePr && prior?.findingCommentsPosted ? prior.findingCommentsPosted : new Set(),
    filePatches,
    prChat: samePr && prior?.prChat ? prior.prChat : undefined,
  };
  ensureFindingSession(window.__cedarSession);
  ensurePrChatState(window.__cedarSession);
}

/**
 * @param {{ prUrl: string, token?: string, cursorApiKey?: string, post?: boolean, postMicro?: boolean }} payload
 * @param {(event: object) => void} [onEvent]
 */
async function streamCedarReview(payload, onEvent) {
  const statusEl = document.getElementById("review-progress-status");
  const logEl = document.getElementById("review-progress-log");
  const onStream = (event) => {
    applyReviewStreamEvent(event, statusEl, logEl);
    onEvent?.(event);
  };
  return postReviewStream(payload, onStream);
}

async function rerunCurrentPrReview() {
  const session = window.__cedarSession;
  const results = document.getElementById("results");
  if (!session?.prUrl || !(results instanceof HTMLElement)) {
    throw new Error("No active review to refresh");
  }

  const uiRestore = captureReviewUiState(results);
  stopPrCommitRefresh();
  hidePrStaleBanner();

  showReviewProgressDock();
  setReviewProgress(4, "Refreshing review", "Fetching latest commits from GitHub…");
  results.classList.remove("hidden");
  enterReviewStageLayout();
  results.classList.add("cedar-review-results--mounted");
  results.innerHTML = loadingSkeleton();
  wireReviewChrome(results);

  const payload = {
    prUrl: session.prUrl,
    token: session.token,
    cursorApiKey: session.cursorApiKey,
  };

  const data = await streamCedarReview(payload);
  try {
    const healthRes = await fetch("/api/health");
    window.__cedarServerHealth = await healthRes.json();
  } catch {
    /* keep prior health */
  }
  applyLoadedReviewSession(payload, data);
  renderResults(results, data, { uiRestore });
  const refreshedHead = data?.pull?.headSha ?? data?.gate?.headSha ?? "";
  const refreshedShort = refreshedHead ? refreshedHead.slice(0, 7) : "latest";
  if (!data.cursorReviewPending) {
    setReviewProgress(100, "Review refreshed", `Now at ${refreshedShort} — diffs and code maps updated.`);
    showOutlookNotification({
      title: "Review updated",
      message: `Pull request refreshed at ${refreshedShort}. Diffs, code maps, and architecture match the latest commit.`,
      tone: "success",
      icon: "refresh",
      durationMs: 7000,
    });
    hideReviewProgressDock({ delayMs: 2000 });
  } else {
    showOutlookNotification({
      title: "Review reloaded",
      message: `At ${refreshedShort}. Cursor slice review is still running in the background.`,
      tone: "info",
      icon: "refresh",
      durationMs: 8000,
    });
    const sliceTotal = (data.microPrs ?? []).filter((m) => (m.files?.length ?? m.fileCount ?? 0) > 0).length;
    showReviewProgressDock();
    setReviewProgress(55, "Cursor · macro review (entire PR)", `Macro first, then ${sliceTotal} slice(s)`);
  }
}

setPrRefreshExecutor(rerunCurrentPrReview);
setPrStaleNotifier(({ reviewedShort, headShort }) => {
  showOutlookNotification({
    title: "Stale pull request",
    message: `New commits on GitHub. Cedar reviewed ${reviewedShort}; PR head is now ${headShort}.`,
    tone: "warning",
    icon: "refresh",
    durationMs: 14_000,
    actions: [{ label: "Refresh review", primary: true, onClick: () => requestPrRefresh() }],
  });
});