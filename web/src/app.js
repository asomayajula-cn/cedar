import { cedarMarkSvg } from "./cedar-logo.js";
import { slicesIconSvg } from "./cedar-icons.js";
import { mountArchitectureGraphs, remountCytoscapeForTheme, wireArchitectureZoomControls } from "./architecture-canvas.js";
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
import { refreshDiffThemeClasses, renderSliceFileReviews, wireFileReviewToggles } from "./diff-view.js";
import {
  buildFileFlowCatalogFromMicroPrs,
  refreshFileFlowRailTheme,
  setFileFlowCatalog,
  wireFileFlowRail,
} from "./file-flow-rail.js";
import { refitActiveCodeMap } from "./file-flow-canvas.js";
import { remountCodeMapCyForTheme } from "./code-map-cytoscape-mount.js";
import { FULL_PR_SLICE_ID, isFullPrSliceId, mergeAllPrFiles } from "./full-pr-slice.js";
import { loadDiffReviewComments, repaintAllDiffComments, setCommentToast } from "./diff-comments.js";
import { applySliceNavTypography, getDiffFontSettings, initDiffFontFromServer } from "./diff-font.js";
import { getResolvedTheme, onAppThemeChange, wireAppThemeToggle } from "./theme.js";
import {
  mountCompleteLayoutViews,
  activateDiagramUx,
  wireDiagramResizeListeners,
  refitPanZoomDiagrams,
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
import { buildFindingsListHtml } from "./review-findings-ui.js";
import { wireReviewRailCollapse } from "./review-rail-collapse.js";
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
}

/**
 * @param {ParentNode} root
 * @param {"architecture" | "slices"} [mainTab]
 */
function focusReviewWorkspace(root, mainTab = "slices") {
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
    const bg =
      theme === "day"
        ? `linear-gradient(135deg, ${accent.fill} 0%, color-mix(in srgb, ${accent.fill} 82%, white) 100%)`
        : `linear-gradient(135deg, ${accent.fill}88 0%, #0a0a0a44 100%)`;
    el.style.borderColor = accent.stroke;
    el.style.background = bg;
    const label = el.querySelector(".cedar-layer-chip-label");
    if (label) label.style.color = accent.text;
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
    remountCodeMapCyForTheme();
    refreshFileFlowRailTheme();
    void remountMermaidDiagrams(results).then(() => {
      refreshFileFlowRailTheme();
      scheduleDiagramRefit(results);
    });
    scheduleDiagramRefit(results);
  };

  onAppThemeChange(() => {
    refreshDiffThemeClasses(root);
    const results = document.getElementById("results");
    if (results) repaintAllDiffComments(results);
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
    <header class="cedar-pr-header cedar-glass mb-4 cedar-pr-header--pending">
      <div class="cedar-pr-header-id">
        <p class="cedar-pr-header-eyebrow">Pull request</p>
        <p class="cedar-pr-header-title text-zinc-400">Review running…</p>
        <p class="cedar-pr-header-meta font-mono text-[10px] text-zinc-600">Fetching &amp; partitioning</p>
      </div>
    </header>
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
function patchCursorRollupCard(container) {
  const session = window.__cedarSession;
  if (!(container instanceof HTMLElement) || !session?.data) return;
  const summary = refreshCursorReviewSummary(session) ?? session.data.cursorReviewSummary;
  const rollupCard = container.querySelector(".cedar-cursor-rollup-card");
  if (rollupCard && summary) {
    rollupCard.innerHTML = renderCursorReviewRollup(summary);
    rollupCard.hidden = !summary.enabled;
  }
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

    const { html, activeCount, inlineOnly } = buildFindingsListHtml(r, session);
    const details = panel.querySelector(".cedar-findings-panel");
    if (details instanceof HTMLDetailsElement) {
      const hidePanel = inlineOnly;
      details.hidden = hidePanel;
      if (!hidePanel) {
        const body = details.querySelector(".cedar-findings-panel-body") ?? details.querySelector(":scope > div:not(summary)");
        if (body instanceof HTMLElement) body.innerHTML = html;
        const sum = details.querySelector("summary");
        if (sum) {
          sum.textContent = `Code findings${activeCount ? ` (${activeCount})` : ""}`;
        }
        if (activeCount) details.open = true;
      }
    }
    patchSliceFindingBadges(panel, r, session);
  }

  patchCursorRollupCard(container);
  patchPrHeaderMetrics(session.data);
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

function cyToolbar(targetId, badge = "") {
  return `<div class="diagram-toolbar flex flex-wrap items-center gap-1.5" data-diagram-toolbar>
    <span class="cedar-label mb-0">View</span>
    <button type="button" class="diagram-tool-btn" data-cy-action="in" data-cy-target="${targetId}" title="Zoom in">+</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="out" data-cy-target="${targetId}" title="Zoom out">−</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="fit" data-cy-target="${targetId}" title="Fit">Fit</button>
    <button type="button" class="diagram-tool-btn" data-diagram-action="maximize" title="Maximize panel" aria-pressed="false">⤢</button>
    ${badge}
  </div>`;
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
 * @param {{ view: string, label: string, id: string, aria: string, first?: boolean }} spec
 * @param {string} sliceBadgesHtml
 */
function completeLayoutMermaidArticle(spec, sliceBadgesHtml) {
  return `<article class="cedar-layout-view cedar-architecture-read-panel w-full min-w-0" data-layout-view="${escapeHtml(spec.view)}" data-diagram-wrap>
              <div class="architecture-read-mermaid-head">
                <p class="cedar-label mb-0">${escapeHtml(spec.label)}</p>
                ${architectureDiagramToolbar(spec.id, sliceBadgesHtml)}
              </div>
              <div class="cedar-cy-host diagram-overview-read diagram-complete-layout diagram-stage-canvas cedar-mermaid-scroll">
                <div id="${escapeHtml(spec.id)}" class="cedar-mermaid-source m-0" role="img" aria-label="${escapeHtml(spec.aria)}"></div>
              </div>
            </article>`;
}

function architectureDiagramToolbar(targetId, sliceBadgesHtml = "") {
  const id = escapeHtml(targetId);
  return `<div class="diagram-toolbar flex flex-wrap items-center gap-1.5" data-diagram-toolbar>
    ${sliceBadgesHtml}
    <span class="cedar-label mb-0">View</span>
    <button type="button" class="diagram-tool-btn" data-cy-action="in" data-cy-target="${id}" title="Zoom in">+</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="out" data-cy-target="${id}" title="Zoom out">−</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="fit" data-cy-target="${id}" title="Fit">Fit</button>
    <button type="button" class="diagram-tool-btn" data-diagram-action="collapse" title="Collapse diagram" aria-expanded="true">▾</button>
    <button type="button" class="diagram-tool-btn" data-diagram-action="maximize" title="Maximize panel" aria-pressed="false">⤢</button>
  </div>`;
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
      const bg =
        theme === "day"
          ? `linear-gradient(135deg, ${accent.fill} 0%, color-mix(in srgb, ${accent.fill} 82%, white) 100%)`
          : `linear-gradient(135deg, ${accent.fill}88 0%, #0a0a0a44 100%)`;
      return `<li class="cedar-layer-chip is-active" data-layer-id="${escapeHtml(layer.id)}" style="border-color:${accent.stroke};background:${bg}"><span class="cedar-layer-chip-label" style="color:${accent.text}">${escapeHtml(layer.label)}</span><span class="cedar-layer-chip-hint">${escapeHtml(layer.hint)}</span></li>`;
    })
    .join("");
  return `<div class="cedar-layer-stack mt-4" aria-label="${escapeHtml(ARCHITECTURE_MODEL_LABEL)}">
    <p class="cedar-label mb-2">Layers in this PR</p>
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
  if (mainTab === "architecture") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        refitPanZoomDiagrams(root);
        const host = root.querySelector("#cedar-cy-slices");
        if (host?.dataset.cyMountPending === "1" && window.__cedarOverviewGraph) {
          const { resolveGraph, getStatusMap } = window.__cedarOverviewGraph;
          mountArchitectureGraphs(root, resolveGraph(), getStatusMap(), {
            force: true,
            onFail: () => showToast("Architecture diagram could not render.", "error"),
          });
        }
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
  root.querySelectorAll("[data-slice-panel]").forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return;
    panel.hidden = panel.getAttribute("data-slice-panel") !== componentId;
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
const SLICES_NAV_RAIL_DEFAULT = 280;
const SLICES_NAV_RAIL_MIN = 240;
const SLICES_NAV_RAIL_MAX = 360;

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
  shell.style.removeProperty("--cedar-slices-nav-rail-width");
}

/**
 * @param {ParentNode} root
 */
function wireSlicesNavRailResize(root) {
  const shell = root.querySelector(".cedar-review-layout--three-col");
  const splitter = root.querySelector("[data-slices-nav-splitter]");
  const rail = root.querySelector(".cedar-review-left-nav");
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
const COMPLETE_LAYOUT_MERMAID_SLOTS = [
  { key: "components", sel: "#cedar-mermaid-components" },
  { key: "flow", sel: "#cedar-mermaid-flow" },
  { key: "events", sel: "#cedar-mermaid-events" },
];

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
    const panel = root.querySelector("#cedar-review-panel-architecture");
    if (panel instanceof HTMLElement && panel.hidden) return;
    const graph = payload.resolveGraph();
    if (!isRenderableDiagramGraph(graph)) {
      showToast("Architecture diagram could not render.", "error");
      return;
    }
    mountArchitectureGraphs(root, graph, payload.getStatusMap(), {
      force: true,
      onFail: () => showToast("Architecture diagram could not render.", "error"),
    });
    requestAnimationFrame(() => refitPanZoomDiagrams(root));
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

function wireCompleteLayoutViews(root, views) {
  if (!(root instanceof HTMLElement) || !views) return;
  const host = root.querySelector("#architecture-read-mermaid");
  if (!(host instanceof HTMLElement)) return;

  const allMounted = () =>
    COMPLETE_LAYOUT_MERMAID_SLOTS.every(({ key, sel }) => {
      const slot = host.querySelector(sel);
      return slot?.querySelector("svg") || !views[key]?.trim();
    });

  const draw = () => {
    const panel = root.querySelector("#cedar-review-panel-architecture");
    if (panel instanceof HTMLElement && panel.hidden) return;
    if (allMounted()) return;
    void mountCompleteLayoutViews(host, views).then((drew) => {
      if (!drew) showToast("Complete layout diagrams could not render.", "error");
      if (allMounted()) host.dataset.mermaidLayoutsMounted = "1";
      else delete host.dataset.mermaidLayoutsMounted;
      activateDiagramUx(host);
      wireArchitectureZoomControls(root);
      requestAnimationFrame(() => refitPanZoomDiagrams(host));
    });
  };

  wireArchitectureZoomControls(root);

  root.querySelectorAll("[data-review-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLElement) || btn.dataset.wiredMermaidTab) return;
    btn.dataset.wiredMermaidTab = "1";
    btn.addEventListener("click", () => {
      if (btn.getAttribute("data-review-tab") === "architecture") {
        requestAnimationFrame(draw);
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
  if (!summary?.enabled) return "";
  const sliceRows = (summary.slice?.bySlice ?? [])
    .map((s) => {
      const fail = s.error ? ' <span class="text-rose-400/90">· failed</span>' : "";
      const pending = s.status === "pending" ? ' <span class="text-zinc-600">· pending</span>' : "";
      const count =
        s.status === "pending" && !s.count ? "—" : String(s.count ?? 0);
      return `<li class="flex justify-between gap-2 text-[9px] text-zinc-500" data-slice-rollup-id="${escapeHtml(s.componentId)}">
        <span class="truncate">${escapeHtml(s.componentName)}${pending}${fail}</span>
        <span class="shrink-0 tabular-nums text-zinc-400" data-slice-finding-count>${count}</span>
      </li>`;
    })
    .join("");
  const macroCount = summary.macro?.findingCount ?? 0;
  return `<div class="cedar-cursor-rollup" aria-labelledby="cedar-cursor-rollup-heading">
    <p id="cedar-cursor-rollup-heading" class="text-[9px] font-medium uppercase tracking-wide text-zinc-500">Cursor findings</p>
    <p class="mt-1 text-[10px] font-medium text-zinc-300">${summary.totalFindings} on this PR</p>
    <p class="text-[9px] text-zinc-600">${summary.slice.total} slice · ${macroCount} macro</p>
    ${sliceRows ? `<ul class="mt-2 max-h-36 space-y-0.5 overflow-y-auto">${sliceRows}</ul>` : ""}
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

  let layoutViews = breakouts?.diagramLayoutViews ?? null;
  if (!layoutViews && diagramMicroPrs.length) {
    layoutViews = buildCompleteLayoutViews(
      diagramMicroPrs,
      breakouts,
      { number: pull.number, title: pull.title },
      { owner: target?.owner, repo: target?.repo },
      sliceNumberById
    );
  }
  const hasLayoutViews = Boolean(
    layoutViews &&
      (layoutViews.components?.trim() || layoutViews.flow?.trim() || layoutViews.events?.trim())
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
    showArchitectureSection ||
    architectureReadSummary ||
    architectureReadNotes.length ||
    Boolean(composite);

  const activeSlices = activeSlicesForDiagram;
  const fullPrFiles = mergeAllPrFiles(microPrs);
  const prFileCount = partition?.fileCount ?? fullPrFiles.length;
  const showFullPrSlice = fullPrFiles.length > 0;
  const firstSliceId = showFullPrSlice ? FULL_PR_SLICE_ID : (activeSlices[0]?.componentId ?? "");
  const hasArchitectureContent = Boolean(breakouts?.architectureSummary) || showArchitectureRead;
  const defaultMainTab = activeSlices.length > 0 ? "slices" : hasArchitectureContent ? "architecture" : "slices";
  const initialMainTab =
    uiRestore?.mainTab === "architecture" || uiRestore?.mainTab === "slices" ? uiRestore.mainTab : defaultMainTab;
  const initialSliceId = uiRestore?.sliceId ?? firstSliceId;
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
  const fullPrSidebarNav = showFullPrSlice
    ? (() => {
        const passedVis = sliceStatusVisualForTheme("passed", getResolvedTheme());
        return `<button type="button" role="tab" class="cedar-nav-item cedar-nav-item-stack cedar-pipeline-slice-item cedar-pipeline-slice-item--full-pr${fullPrTabActive ? " is-active" : ""}"
        data-slice-status="passed"
        style="border-left: 3px solid ${passedVis.border}"
        data-slice-tab="${escapeHtml(FULL_PR_SLICE_ID)}" data-scroll-slice="${escapeHtml(FULL_PR_SLICE_ID)}"
        aria-selected="${fullPrTabActive ? "true" : "false"}"
        title="All ${fullPrFiles.length} changed files on this pull request">
        <span class="cedar-nav-item-row">
          ${renderSliceStatusDot("passed")}
          <span class="cedar-nav-item-label">All files</span>
          <span class="cedar-pipeline-slice-files tabular-nums">${fullPrFiles.length}${prFileCount > fullPrFiles.length ? `/${prFileCount}` : ""}</span>
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
        const active = initialSliceId === r.componentId || (!showFullPrSlice && i === 0 && !uiRestore?.sliceId);
        const statusVis = sliceStatusVisualForTheme(r.status, getResolvedTheme());
        return `<button type="button" role="tab" class="cedar-nav-item cedar-nav-item-stack cedar-pipeline-slice-item${active ? " is-active" : ""}"
        data-slice-status="${escapeHtml(r.status)}"
        style="border-left: 3px solid ${statusVis.border}"
        data-slice-tab="${escapeHtml(r.componentId)}" data-scroll-slice="${escapeHtml(r.componentId)}"
        aria-selected="${active ? "true" : "false"}"
        title="${escapeHtml(r.componentName)} · ${sliceFileCount} file${sliceFileCount === 1 ? "" : "s"}">
        <span class="cedar-nav-item-row">
          ${renderSliceStatusDot(r.status)}
          <span class="cedar-nav-item-label">${escapeHtml(r.componentName)}</span>
          ${approved ? '<span class="cedar-nav-item-check">✓</span>' : ""}
          <span class="cedar-pipeline-slice-files tabular-nums" aria-label="${sliceFileCount} files">${sliceFileCount}</span>
        </span>
        <span class="cedar-nav-item-meta">${escapeHtml(vpr.id)} · ${sliceFileCount} file${sliceFileCount === 1 ? "" : "s"}</span>
      </button>`;
      })
      .join("");

  const fullPrPanelHtml = showFullPrSlice
    ? `<article id="slice-${escapeHtml(FULL_PR_SLICE_ID)}" class="cedar-slice-panel cedar-full-pr-slice" data-slice-panel="${escapeHtml(FULL_PR_SLICE_ID)}" data-full-pr-slice="1"${
          fullPrTabActive ? "" : " hidden"
        }>
          ${
            prFileCount > fullPrFiles.length
              ? `<p class="cedar-full-pr-slice-note mb-2 text-[10px] leading-snug text-zinc-600">${fullPrFiles.length} of ${prFileCount} files with diffs · large/binary files may omit patches</p>`
              : ""
          }
          ${renderSliceFileReviews(fullPrFiles, pull.url)}
        </article>`
    : "";

  const slicePanels =
    fullPrPanelHtml +
    activeSlices
      .map((r, i) => {
      const micro = microPrs.find((m) => m.componentId === r.componentId);
      const rationale = micro?.rationale ?? micro?.description;
      const session = window.__cedarSession;
      const { html: findings, activeCount, inlineOnly } = buildFindingsListHtml(r, session);
      const hideFindingsPanel = inlineOnly;
      const cursorCount = (r.reviewComments ?? []).length;
      const activeFindings = findingsForSlice(r.componentId, r).filter(
        (f, fi) => !isFindingIgnored(findingKey(r.componentId, f, fi))
      );
      const blockers = activeFindings.filter((f) => f.severity === "blocker").length;
      const warnings = activeFindings.filter((f) => f.severity === "warning").length;
      const approved = sliceApprovals.has(r.componentId);
      const vpr = virtualPrLabel(target, pull, r.componentId);
      const fileList = micro?.files ?? [];

      return `
        <article id="slice-${escapeHtml(r.componentId)}" class="cedar-slice-panel" data-slice-panel="${escapeHtml(r.componentId)}" data-virtual-pr="${escapeHtml(vpr.id)}"${
          initialSliceId === r.componentId || (!showFullPrSlice && i === 0 && !uiRestore?.sliceId) ? "" : " hidden"
        }>
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0 max-w-3xl">
              <p class="cedar-label">${escapeHtml(vpr.title)}</p>
              <h3 class="cedar-slice-panel-title">${escapeHtml(r.componentName)}</h3>
              <p class="mt-1 font-mono text-xs text-zinc-500">${escapeHtml(vpr.slug)}</p>
              <div class="mt-4 flex flex-wrap gap-2" data-slice-badges>
                ${renderSliceReviewBadge(r.status)}
                <span class="cedar-badge cedar-badge-muted">+${micro?.additions ?? 0} / −${micro?.deletions ?? 0}</span>
                <span class="cedar-badge cedar-badge-muted">${fileList.length} files</span>
                ${cursorCount ? `<span class="cedar-badge cedar-badge-ok cedar-badge-compact">${cursorCount} Cursor</span>` : ""}
                ${blockers ? `<span data-slice-blockers class="cedar-badge border-rose-500/30 bg-rose-500/10 text-rose-200">${blockers} blockers</span>` : ""}
                ${warnings ? `<span data-slice-warnings class="cedar-badge cedar-badge-warn">${warnings} warnings</span>` : ""}
                ${approved ? `<span class="cedar-badge cedar-badge-ok" data-slice-approved-badge>Approved</span>` : ""}
              </div>
              ${
                rationale
                  ? `<details class="cedar-slice-rationale mt-3">
                <summary class="cedar-slice-rationale-summary">Slice rationale</summary>
                <p class="cedar-slice-prose mt-2">${escapeHtml(rationale)}</p>
              </details>`
                  : ""
              }
            </div>
            <button type="button" data-approve-slice="${escapeHtml(r.componentId)}" data-component-name="${escapeHtml(r.componentName)}"
              ${approved ? "disabled" : ""}
              class="cedar-btn-signoff cedar-btn-slice${!approved ? " is-ready" : ""}${approved ? " is-done" : ""}"
              title="Mark this slice approved in Cedar (not sent to GitHub)">
              ${approved ? "Approved" : "Mark approved"}
            </button>
          </div>
          <details class="group cedar-findings-panel cedar-slice-findings-panel mt-3 border-t border-white/[0.06] pt-3"${hideFindingsPanel ? " hidden" : ""}>
            <summary class="cedar-findings-panel-summary"><span class="cedar-comment-marker-chip" aria-hidden="true"></span>Code findings${
              activeCount ? ` (${activeCount})` : ""
            }</summary>
            <div class="cedar-findings-panel-body mt-2">${findings}</div>
          </details>
          <div class="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
            ${renderSliceFileReviews(fileList, pull.url)}
          </div>
        </article>`;
    })
    .join("");

  container.innerHTML = `
    ${renderReviewProgressDockHtml()}
    <header class="cedar-pr-header cedar-glass mb-8">
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

    ${renderThreeColumnReviewChrome({
      sidebarSliceList,
      gate,
      cursorRollupHtml: renderCursorReviewRollup(cursorReviewSummary),
      cursorRollupVisible: Boolean(cursorReviewSummary?.enabled),
      centerMainHtml: `${renderReviewMainTabsHeadHtml({
        activeTab: initialMainTab,
        sliceCount: touched.length,
      })}

          <div role="tabpanel" class="cedar-main-tabpanel cedar-main-tabpanel--architecture cedar-review-stage space-y-6" data-review-panel="architecture" id="cedar-review-panel-architecture"${
            initialMainTab === "slices" ? " hidden" : ""
          }>
            ${
              breakouts?.architectureSummary
                ? `<section class="cedar-glass-subtle cedar-architecture-summary px-5 py-4">
            <p class="cedar-label">Summary · ${escapeHtml(String(breakouts.strategy ?? partition?.mode ?? ""))}</p>
            <p class="mt-2 text-sm leading-relaxed text-zinc-400">${escapeHtml(breakouts.architectureSummary)}</p>
          </section>`
                : ""
            }
            ${
              showArchitectureRead
                ? `<section class="cedar-glass p-6" id="architecture-read">
            <h2 class="text-sm font-semibold text-white">Architecture read</h2>
            ${prLayerStackHtml}
            ${
              architectureReadSummary
                ? `<p class="mt-4 max-w-3xl text-base leading-relaxed text-zinc-200">${escapeHtml(architectureReadSummary)}</p>`
                : !composite && !hasLayoutViews && archSliceCount === 0
                  ? `<p class="mt-4 text-sm text-zinc-500">Cursor can supply a one-paragraph visual read when <span class="font-mono text-zinc-600">CEDAR_AI_DIAGRAM</span> is on; the full narrative appears after every slice passes.</p>`
                  : ""
            }
            ${
              architectureReadNotes.length
                ? `<ul class="mt-4 list-inside list-disc space-y-1 text-sm text-zinc-400">${architectureReadNotes
                    .map((n) => `<li>${escapeHtml(n)}</li>`)
                    .join("")}</ul>`
                : ""
            }
            ${
              archSliceCount > 0
                ? `<div class="mt-6 cedar-layout-view w-full min-w-0" id="architecture-read-overview" data-diagram-wrap>
            <div class="architecture-read-mermaid-head">
              <p class="cedar-label mb-0">Overview · slices</p>
              ${cyToolbar(
                "cedar-cy-slices",
                `<span class="cedar-badge cedar-badge-muted">${archSliceCount} slices · ${
                  breakouts?.diagramVisualSource === "cursor" ? "Cursor" : "Minimal"
                }</span>`
              )}
            </div>
            <div id="cedar-cy-slices" class="cedar-cy-host diagram-overview-read diagram-stage-canvas" role="img" aria-label="Slice overview"></div>
          </div>`
                : ""
            }
            ${
              hasLayoutViews
                ? `<div class="mt-6 w-full min-w-0" id="architecture-read-layout" aria-labelledby="complete-layout-heading">
            <p id="complete-layout-heading" class="cedar-label mb-4">Complete layout</p>
            <div class="cedar-complete-layout-views w-full min-w-0" id="architecture-read-mermaid">
            ${[
              {
                view: "uml",
                label: "UML · components",
                id: "cedar-mermaid-components",
                aria: "UML components class diagram",
                first: true,
              },
              { view: "flow", label: "Flow", id: "cedar-mermaid-flow", aria: "Request flow diagram" },
              { view: "events", label: "Events", id: "cedar-mermaid-events", aria: "Domain events sequence diagram" },
            ]
              .map((spec) => completeLayoutMermaidArticle(spec, diagramSliceBadges))
              .join("")}
            </div>
          </div>`
                : ""
            }
          </section>`
                : !breakouts?.architectureSummary
                  ? `<p class="text-sm text-zinc-500">Architecture narrative and diagrams appear once partitioning finishes.</p>`
                  : ""
            }
          </div>

        <div role="tabpanel" class="cedar-main-tabpanel cedar-slices-stage cedar-slices-tabpanel" data-review-panel="slices" id="cedar-review-panel-slices"${
            initialMainTab === "architecture" ? " hidden" : ""
          }>
          <div class="cedar-slices-shell cedar-slices-shell--diffs">
            <div class="cedar-slice-panels cedar-slice-review-pane min-w-0 flex-1">${slicePanels}</div>
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

  if (hasLayoutViews && layoutViews) {
    wireCompleteLayoutViews(container, layoutViews);
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