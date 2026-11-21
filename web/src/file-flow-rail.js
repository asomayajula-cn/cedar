import { codeMapCloseExpandIconSvg } from "./cedar-icons.js";
import { scheduleDiagramRefit } from "./diagram-ux.js";
import { patchFromB64 } from "./diff-view.js";
import { codeMapFileOverview } from "./code-map-file-overview.js";
import { renderCodeMapOverviewHtml } from "./code-map-overview-render.js";
import { enrichFlyoutArtifact } from "./code-map-flyout-enrich.js";
import {
  destroyFileCodeMap,
  mountFileCodeMap,
  switchCodeMapFlyoutView,
  wireCodeMapFlyoutWheel,
  nudgeCodeMapZoom,
  resetCodeMapView,
  refitActiveCodeMap,
  resizeActiveCodeMapViewport,
  stabilizeCodeMapForFlyout,
  wireCodeMapTriptychTabs,
} from "./file-flow-canvas.js";

/**
 * @param {object | null | undefined} artifact
 */
function fileHasBuiltCodeMap(artifact) {
  if (!artifact) return false;
  return Boolean(
    artifact.svg ||
      artifact.mermaid ||
      artifact.elements?.length ||
      artifact.behaviorElements?.length ||
      artifact.functionalityElements?.length
  );
}

/** Full flyout needs Structure + Behavior + Functionality from the server (not structure-only cache). */
function needsServerCodeMapBuild(stub) {
  if (!stub) return true;
  if (stub.lazy) return true;
  if (!fileHasBuiltCodeMap(stub)) return true;
  const hasBehavior = (stub.behaviorElements?.length ?? 0) > 0;
  const hasFunctionality = (stub.functionalityElements?.length ?? 0) > 0;
  return !hasBehavior || !hasFunctionality;
}

/**
 * One catalog row per PR file; graphs are built on flyout open (lazy).
 * @param {object[]} microPrs
 */
export function buildFileFlowCatalogFromMicroPrs(microPrs) {
  const map = {};
  for (const m of microPrs ?? []) {
    for (const f of m.files ?? []) {
      const path = f.path ?? f.filename;
      if (!path) continue;
      const built = {
        mermaid: typeof f.flowMermaid === "string" ? f.flowMermaid : null,
        svg: typeof f.codeMapSvg === "string" ? f.codeMapSvg : null,
        whatItDoes: typeof f.codeMapWhat === "string" ? f.codeMapWhat : null,
        elements: Array.isArray(f.codeMapElements) ? f.codeMapElements : null,
        behaviorElements: Array.isArray(f.codeMapBehaviorElements) ? f.codeMapBehaviorElements : null,
        functionalityElements: Array.isArray(f.codeMapFunctionalityElements)
          ? f.codeMapFunctionalityElements
          : null,
        detail: typeof f.codeMapDetail === "string" ? f.codeMapDetail : null,
        profile: typeof f.codeMapProfile === "string" ? f.codeMapProfile : null,
        profileLabel: typeof f.codeMapProfileLabel === "string" ? f.codeMapProfileLabel : null,
        profileHint: typeof f.codeMapProfileHint === "string" ? f.codeMapProfileHint : null,
        summary:
          f.codeMapSummary && typeof f.codeMapSummary === "object"
            ? f.codeMapSummary
            : null,
        structure: typeof f.codeMapStructure === "string" ? f.codeMapStructure : null,
        layout:
          f.codeMapLayout && typeof f.codeMapLayout === "object"
            ? f.codeMapLayout
            : f.summary?.layout && typeof f.summary.layout === "object"
              ? f.summary.layout
              : null,
        moduleDeps:
          f.codeMapModuleDeps && typeof f.codeMapModuleDeps === "object" ? f.codeMapModuleDeps : null,
        aiDirected: Boolean(f.codeMapAiDirected),
        source:
          f.codeMapSource === "ai" || f.codeMapAiDirected
            ? "ai"
            : typeof f.codeMapSource === "string"
              ? f.codeMapSource
              : "parser",
        lazy: false,
        patch: typeof f.patch === "string" ? f.patch : null,
        status: typeof f.status === "string" ? f.status : "modified",
      };
      if (fileHasBuiltCodeMap(built)) {
        map[path] = built;
      } else {
        map[path] = {
          lazy: true,
          patch: typeof f.patch === "string" ? f.patch : "",
          status: typeof f.status === "string" ? f.status : "modified",
        };
      }
    }
  }
  return map;
}

/** @type {string | null} */
let activePath = null;

/** @type {Map<string, Promise<object>>} */
const codeMapBuildInflight = new Map();

/** @type {number} */
let codeMapFlyoutGeneration = 0;

/**
 * @param {"idle" | "building" | "ready" | "error"} state
 * @param {string} [message]
 */
/**
 * @param {string} path
 * @param {boolean} busy
 */
function syncFileCodeMapButtons(path, busy) {
  if (!path) return;
  const buttons = document.querySelectorAll(
    `[data-file-code-map="${CSS.escape(path)}"]`
  );
  buttons.forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.classList.toggle("is-processing", busy);
    btn.disabled = busy;
    btn.setAttribute("aria-busy", busy ? "true" : "false");
    if (busy) {
      btn.title = "Processing code map…";
      btn.setAttribute("aria-label", `Processing code map for ${path}`);
    } else {
      btn.title = "Code map";
      btn.setAttribute("aria-label", `Open code map for ${path}`);
    }
  });
  const flyoutTab = document.querySelector("[data-code-map-flyout-tab]");
  if (flyoutTab instanceof HTMLButtonElement) {
    flyoutTab.classList.toggle("is-processing", busy);
    flyoutTab.setAttribute("aria-busy", busy ? "true" : "false");
  }
}

export function setCodeMapBuildStatus(state, message = "") {
  const panel = document.getElementById("cedar-review-right-nav");
  const statusEl = document.getElementById("cedar-code-map-build-status");
  const progressEl = document.getElementById("cedar-code-map-build-progress");
  const hintEl = document.querySelector(".cedar-code-map-meta .cedar-file-flow-hint");
  const path = activePath;
  document.body.classList.toggle("cedar-code-map-building", state === "building");

  if (panel instanceof HTMLElement) {
    panel.dataset.codeMapBuildState = state;
  }

  syncFileCodeMapButtons(path ?? "", state === "building");

  if (progressEl instanceof HTMLElement) {
    progressEl.hidden = state !== "building";
    progressEl.setAttribute("aria-busy", state === "building" ? "true" : "false");
    if (state === "building") {
      progressEl.setAttribute("aria-valuetext", message || "Processing code map");
    }
  }

  if (statusEl instanceof HTMLElement) {
    if (state === "idle" || !message.trim()) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.removeAttribute("data-state");
    } else {
      statusEl.hidden = false;
      statusEl.dataset.state = state;
      const prefix =
        state === "building" ? "Processing" : state === "ready" ? "Ready" : "Error";
      statusEl.textContent = message.trim() ? `${prefix} — ${message}` : prefix;
    }
  }

  if (hintEl instanceof HTMLElement) {
    if (state === "building") {
      hintEl.hidden = false;
      hintEl.classList.add("cedar-file-flow-hint--building");
      hintEl.textContent =
        message || "Processing — building Structure, Behavior, and Functionality. This may take a few seconds.";
    } else if (state === "ready") {
      hintEl.classList.remove("cedar-file-flow-hint--building");
      hintEl.hidden = false;
      hintEl.textContent =
        "Structure / Behavior / Functionality drawn for this file. Switch tabs above the canvas.";
    } else if (state === "error") {
      hintEl.classList.remove("cedar-file-flow-hint--building");
      hintEl.hidden = false;
      hintEl.textContent = message;
    } else if (state === "idle") {
      hintEl.classList.remove("cedar-file-flow-hint--building");
      if (!hintEl.textContent.includes("flyout")) {
        hintEl.textContent =
          "Maps build when you open this flyout for a file — not during slice review.";
      }
    }
  }
}

/**
 * @param {string} path
 */
function patchForFileFromDom(path) {
  const article = document.querySelector(`.cedar-gh-file[data-file-path="${CSS.escape(path)}"]`);
  if (!(article instanceof HTMLElement)) return "";
  const b64 = article.getAttribute("data-patch-b64");
  if (!b64) return "";
  try {
    return patchFromB64(b64);
  } catch {
    return "";
  }
}

/**
 * @param {string} path
 */
function resolveCatalogStub(path) {
  const catalog = window.__cedarFileFlows ?? {};
  const hit = catalog[path];
  if (hit) {
    if (!hit.patch?.trim()) {
      const patch = patchForFileFromDom(path);
      if (patch) return { ...hit, patch };
    }
    return hit;
  }
  const patch = patchForFileFromDom(path);
  if (!patch.trim()) return null;
  const article = document.querySelector(`.cedar-gh-file[data-file-path="${CSS.escape(path)}"]`);
  const status = article?.getAttribute("data-file-status") ?? "modified";
  return { lazy: true, patch, status };
}

/**
 * @param {string} path
 * @param {object} stub
 */
async function fetchCodeMapForFile(path, stub) {
  if (fileHasBuiltCodeMap(stub) && !needsServerCodeMapBuild(stub)) return stub;

  const patch = stub.patch?.trim() ? stub.patch : patchForFileFromDom(path);
  const workStub = { ...stub, patch, status: stub.status ?? "modified" };

  const key = path;
  const prior = codeMapBuildInflight.get(key);
  if (prior) return prior;

  const job = (async () => {
    const res = await fetch("/api/code-map/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        patch,
        status: workStub.status ?? "modified",
        parserOnly: true,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const merged = { ...stub, ...body, lazy: false };
    const catalog = window.__cedarFileFlows ?? {};
    catalog[path] = merged;
    window.__cedarFileFlows = catalog;
    return merged;
  })()
    .finally(() => {
      codeMapBuildInflight.delete(key);
    });

  codeMapBuildInflight.set(key, job);
  return job;
}

let codeMapExpandWired = false;

/** Keep flyout close control on the shared × icon (day/night, stale HTML). */
export function ensureCodeMapToolbarIcons() {
  const btn = document.querySelector(".cedar-code-map-expand-btn[data-code-map-expand]");
  if (!(btn instanceof HTMLButtonElement)) return;
  const closeWrap = btn.querySelector(".cedar-code-map-expand-icon--close");
  if (!(closeWrap instanceof HTMLElement)) return;
  const path = closeWrap.querySelector("path")?.getAttribute("d") ?? "";
  if (path.includes("M6 6l12 12")) return;
  closeWrap.innerHTML = codeMapCloseExpandIconSvg("cedar-rail-edge-icon");
}

const CODE_MAP_FLYOUT_WIDTH_KEY = "cedar.codeMapFlyoutWidth";
const CODE_MAP_FLYOUT_MIN = 380;
const CODE_MAP_FLYOUT_MAX = 1520;

function readCodeMapFlyoutWidth() {
  const raw = localStorage.getItem(CODE_MAP_FLYOUT_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  const max = Math.min(CODE_MAP_FLYOUT_MAX, Math.floor(window.innerWidth * 0.98));
  const fallback = Math.min(992, Math.floor(window.innerWidth * 0.94));
  if (Number.isFinite(n)) return Math.min(max, Math.max(CODE_MAP_FLYOUT_MIN, n));
  return fallback;
}

/**
 * @param {number} widthPx
 */
function applyCodeMapFlyoutWidth(widthPx) {
  const panel = document.getElementById("cedar-review-right-nav");
  if (!(panel instanceof HTMLElement)) return;
  const max = Math.min(CODE_MAP_FLYOUT_MAX, Math.floor(window.innerWidth * 0.98));
  const w = Math.min(max, Math.max(CODE_MAP_FLYOUT_MIN, widthPx));
  panel.style.setProperty("--cedar-code-map-flyout-width", `${w}px`);
  panel.dataset.flyoutWidthPx = String(Math.round(w));
}

/**
 * Put the code-map flyout back in the layout tree (in case an older build moved it).
 */
function ensureCodeMapFlyoutInWorkspace() {
  const panel = document.getElementById("cedar-review-right-nav");
  const workspace = document.getElementById("cedar-review-workspace");
  if (!(panel instanceof HTMLElement) || !(workspace instanceof HTMLElement)) return;
  if (panel.parentElement === document.body) return;
  if (panel.previousElementSibling !== workspace) {
    workspace.after(panel);
  }
}

/**
 * @param {boolean} on
 */
function parkCodeMapFlyoutOnBody(on) {
  const panel = document.getElementById("cedar-review-right-nav");
  const workspace = document.getElementById("cedar-review-workspace");
  if (!(panel instanceof HTMLElement) || !(workspace instanceof HTMLElement)) return;
  if (on) {
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    const backdrop = document.getElementById("cedar-code-map-backdrop");
    if (backdrop instanceof HTMLElement) backdrop.after(panel);
    return;
  }
  ensureCodeMapFlyoutInWorkspace();
}

/**
 * @returns {HTMLElement}
 */
function ensureCodeMapBackdrop() {
  let el = document.getElementById("cedar-code-map-backdrop");
  if (!(el instanceof HTMLElement)) {
    el = document.createElement("div");
    el.id = "cedar-code-map-backdrop";
    el.className = "cedar-code-map-backdrop";
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("click", () => setCodeMapExpanded(false));
    document.body.appendChild(el);
  }
  return el;
}

/**
 * @param {boolean} on
 */
export function setCodeMapExpanded(on) {
  ensureCodeMapToolbarIcons();
  document.body.classList.toggle("cedar-code-map-expanded", on);
  if (on) applyCodeMapFlyoutWidth(readCodeMapFlyoutWidth());
  if (!on) setCodeMapBuildStatus("idle");
  const backdrop = ensureCodeMapBackdrop();
  backdrop.hidden = !on;
  parkCodeMapFlyoutOnBody(on);
  const panel = document.getElementById("cedar-review-right-nav");
  if (panel instanceof HTMLElement) {
    panel.setAttribute("aria-hidden", on ? "false" : "true");
  }
  document.querySelectorAll("[data-code-map-expand], [data-code-map-flyout-tab]").forEach((el) => {
    if (!(el instanceof HTMLButtonElement)) return;
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.setAttribute("aria-label", on ? "Close code map flyout" : "Open code map flyout");
    el.title = on ? "Close map flyout" : "Open map flyout";
  });
  const railBtn = document.querySelector("[data-code-map-expand]");
  if (railBtn instanceof HTMLButtonElement) {
    const openIcon = railBtn.querySelector(".cedar-code-map-expand-icon--open");
    const closeIcon = railBtn.querySelector(".cedar-code-map-expand-icon--close");
    if (openIcon instanceof HTMLElement) openIcon.hidden = on;
    if (closeIcon instanceof HTMLElement) closeIcon.hidden = !on;
  }
  const stage = document.getElementById("cedar-file-flow-stage");
  if (stage instanceof HTMLElement) {
    wireCodeMapFlyoutWheel(stage);
    stage.dispatchEvent(new CustomEvent("cedar-file-flow-resize", { bubbles: true }));
  }
  if (on && activePath) {
    const path = activePath;
    const run = () => {
      void stabilizeCodeMapForFlyout({ path }).then(() => {
        refitActiveCodeMap();
      });
    };
    run();
    requestAnimationFrame(run);
    window.setTimeout(run, 120);
  }
}

function syncCodeMapExpandButton() {
  const on = document.body.classList.contains("cedar-code-map-expanded");
  const tabBtn = document.querySelector("[data-code-map-flyout-tab]");
  if (tabBtn instanceof HTMLButtonElement) {
    const workspace = document.getElementById("cedar-review-workspace");
    tabBtn.hidden = !workspace;
    tabBtn.setAttribute("aria-pressed", on ? "true" : "false");
    tabBtn.setAttribute("aria-label", on ? "Close code map" : "Open code map");
    tabBtn.title = on ? "Close code map" : "Code map";
  }
}

/**
 * @param {ParentNode} root
 */
function wireCodeMapExpand(_root) {
  if (codeMapExpandWired) return;
  codeMapExpandWired = true;
  document.body.classList.remove("cedar-code-map-expanded");
  const staleBackdrop = document.getElementById("cedar-code-map-backdrop");
  if (staleBackdrop instanceof HTMLElement) staleBackdrop.hidden = true;
  ensureCodeMapFlyoutInWorkspace();
  applyCodeMapFlyoutWidth(readCodeMapFlyoutWidth());
  ensureCodeMapToolbarIcons();

  wireCodeMapFlyoutWheel();
  wireCodeMapTriptychTabs();

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const mapBtn = t.closest("[data-file-code-map]");
    if (mapBtn instanceof HTMLButtonElement) {
      ev.preventDefault();
      ev.stopPropagation();
      const path = mapBtn.getAttribute("data-file-code-map");
      if (path) openFileCodeMapForPath(path);
      return;
    }
    const zoomBtn = t.closest("[data-code-map-zoom]");
    if (zoomBtn instanceof HTMLButtonElement) {
      ev.preventDefault();
      ev.stopPropagation();
      const dir = zoomBtn.getAttribute("data-code-map-zoom") === "in" ? 1 : -1;
      void stabilizeCodeMapForFlyout({ path: activePath }).then(() => {
        nudgeCodeMapZoom(/** @type {1 | -1} */ (dir));
      });
      return;
    }
    const resetBtn = t.closest("[data-code-map-reset]");
    if (resetBtn instanceof HTMLButtonElement) {
      ev.preventDefault();
      ev.stopPropagation();
      void stabilizeCodeMapForFlyout({ path: activePath }).then(() => {
        resetCodeMapView();
      });
      return;
    }
    const toggle = t.closest("[data-code-map-expand], [data-code-map-flyout-tab]");
    if (!(toggle instanceof HTMLButtonElement)) return;
    if (!document.getElementById("cedar-review-workspace")) return;
    ev.preventDefault();
    ev.stopPropagation();
    const on = !document.body.classList.contains("cedar-code-map-expanded");
    setCodeMapExpanded(on);
  });

  document.addEventListener(
    "pointerdown",
    (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const splitter = t.closest("[data-code-map-flyout-splitter]");
      if (!(splitter instanceof HTMLElement)) return;
      if (!document.body.classList.contains("cedar-code-map-expanded")) return;
      ev.preventDefault();
      ev.stopPropagation();
      const panel = document.getElementById("cedar-review-right-nav");
      if (!(panel instanceof HTMLElement)) return;
      splitter.setPointerCapture(ev.pointerId);
      document.body.classList.add("cedar-is-resizing-code-map-flyout");
      const startX = ev.clientX;
      const startW = panel.getBoundingClientRect().width;

      const onMove = (moveEv) => {
        const next = startW - (moveEv.clientX - startX);
        applyCodeMapFlyoutWidth(next);
        resizeActiveCodeMapViewport();
      };

      const onUp = (upEv) => {
        splitter.releasePointerCapture(upEv.pointerId);
        document.body.classList.remove("cedar-is-resizing-code-map-flyout");
        splitter.removeEventListener("pointermove", onMove);
        splitter.removeEventListener("pointerup", onUp);
        splitter.removeEventListener("pointercancel", onUp);
        const w = panel.getBoundingClientRect().width;
        localStorage.setItem(CODE_MAP_FLYOUT_WIDTH_KEY, String(Math.round(w)));
        resizeActiveCodeMapViewport();
      };

      splitter.addEventListener("pointermove", onMove);
      splitter.addEventListener("pointerup", onUp);
      splitter.addEventListener("pointercancel", onUp);
    },
    true
  );

  document.addEventListener("dblclick", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (!t.closest("[data-code-map-flyout-splitter]")) return;
    localStorage.removeItem(CODE_MAP_FLYOUT_WIDTH_KEY);
    applyCodeMapFlyoutWidth(readCodeMapFlyoutWidth());
    refitActiveCodeMap();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!document.body.classList.contains("cedar-code-map-expanded")) return;
    setCodeMapExpanded(false);
  });
}

/**
 * @param {Record<string, { mermaid?: string | null, svg?: string | null, whatItDoes?: string | null, elements?: object[] | null }>} map
 */
export function setFileFlowCatalog(map) {
  window.__cedarFileFlows = map ?? {};
}

/**
 * Select a file and open its per-file code map (flyout expanded by default).
 * @param {string} path
 * @param {{ expand?: boolean }} [opts]
 */
export function openFileCodeMapForPath(path, opts = {}) {
  const expand = opts.expand !== false;
  if (!path?.trim()) return;
  const leaf = path.split("/").pop() ?? path;
  activePath = path;
  const stub = resolveCatalogStub(path);
  if (!stub || needsServerCodeMapBuild(stub)) {
    setCodeMapBuildStatus("building", `Code map for ${leaf} — please wait…`);
  }
  document.querySelectorAll(".cedar-gh-file.is-file-flow-active").forEach((el) => {
    el.classList.remove("is-file-flow-active");
  });
  const article = document.querySelector(
    `.cedar-gh-file[data-file-path="${CSS.escape(path)}"]`
  );
  if (article instanceof HTMLElement) {
    article.classList.add("is-file-flow-active");
  }
  const start = () => setActiveFileFlow(path);
  if (expand) {
    setCodeMapExpanded(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        start();
      });
    });
  } else {
    start();
  }
}

/**
 * @param {string | null} path
 */
function setActiveFileFlow(path) {
  activePath = path;
  const pathEl = document.getElementById("cedar-file-flow-path");
  const whatEl = document.getElementById("cedar-file-flow-what");
  const profileEl = document.getElementById("cedar-file-flow-profile");
  const summaryEl = document.getElementById("cedar-file-flow-summary");
  const stage = document.getElementById("cedar-file-flow-stage");
  if (!(pathEl instanceof HTMLElement) || !(stage instanceof HTMLElement)) return;

  const setFileOverview = (artifact) => {
    const overviewEl = document.getElementById("cedar-file-flow-overview");
    const hintEl = document.querySelector(".cedar-code-map-meta .cedar-file-flow-hint");
    const overview = codeMapFileOverview(artifact ?? {});
    const html = renderCodeMapOverviewHtml(overview);

    if (whatEl instanceof HTMLElement) {
      whatEl.hidden = true;
      whatEl.textContent = "";
    }
    if (summaryEl instanceof HTMLElement) {
      summaryEl.hidden = true;
      summaryEl.replaceChildren();
    }

    if (overviewEl instanceof HTMLElement) {
      if (!html) {
        overviewEl.hidden = true;
        overviewEl.replaceChildren();
      } else {
        overviewEl.hidden = false;
        overviewEl.innerHTML = html;
      }
    }
    if (hintEl instanceof HTMLElement) {
      hintEl.hidden = Boolean(html);
    }
  };

  const setProfile = (artifact) => {
    if (!(profileEl instanceof HTMLElement)) return;
    const label = artifact?.profileLabel;
    const profile = artifact?.profile;
    const hint = artifact?.profileHint;
    const detail = artifact?.detail;
    if (!label || !profile) {
      profileEl.hidden = true;
      profileEl.replaceChildren();
      return;
    }
    profileEl.hidden = false;
    profileEl.dataset.codeMapDetail = detail ?? "";
    profileEl.dataset.codeMapProfile = profile;
    const source = artifact?.source === "ai" || artifact?.aiDirected ? "ai" : "parser";
    const sourceLabel = source === "ai" ? "AI-directed" : "Parser (AST/diff)";
    profileEl.innerHTML = `<span class="cedar-code-map-profile cedar-code-map-profile--${escapeHtml(profile)}">${escapeHtml(label)}</span> <span class="cedar-code-map-source cedar-code-map-source--${escapeHtml(source)}" title="How Structure / Behavior / Functionality graphs were built">${escapeHtml(sourceLabel)}</span>`;
    if (hint) {
      profileEl.insertAdjacentHTML(
        "beforeend",
        ` <span class="cedar-code-map-profile-hint">${escapeHtml(hint)}</span>`
      );
    }
  };

  if (!path) {
    pathEl.textContent = "Select a file in the diff";
    if (whatEl instanceof HTMLElement) whatEl.textContent = "";
    setProfile(null);
    setFileOverview(null);
    setCodeMapBuildStatus("idle");
    destroyFileCodeMap();
    syncCodeMapExpandButton();
    stage.innerHTML = `<p class="cedar-file-flow-empty">Click a file to open its code map — symbols, calls, and dependencies.</p>`;
    return;
  }

  pathEl.textContent = path;
  const stub = resolveCatalogStub(path);
  if (!stub) {
    if (whatEl instanceof HTMLElement) whatEl.textContent = "";
    setProfile(null);
    setFileOverview(null);
    destroyFileCodeMap();
    setCodeMapBuildStatus("idle");
    syncCodeMapExpandButton();
    stage.innerHTML = `<p class="cedar-file-flow-empty">This file isn’t in the current review slices — re-run review after it appears in the diff.</p>`;
    return;
  }

  const flyoutGen = ++codeMapFlyoutGeneration;
  const isStale = () => flyoutGen !== codeMapFlyoutGeneration || activePath !== path;
  const leaf = path.split("/").pop() ?? path;

  const showLoading = (label) => {
    destroyFileCodeMap();
    setProfile(null);
    setFileOverview(null);
    setCodeMapBuildStatus("building", label);
    stage.innerHTML = `<div class="cedar-file-flow-empty cedar-file-flow-loading cedar-code-map-drawing" role="status" aria-live="polite" aria-busy="true">
      <span class="cedar-code-map-drawing-spinner" aria-hidden="true"></span>
      <p class="cedar-code-map-drawing-title">${escapeHtml(label)}</p>
      <p class="cedar-code-map-drawing-detail cedar-code-map-drawing-wait">Processing on the server — Structure, Behavior, and Functionality for <span class="font-mono">${escapeHtml(leaf)}</span></p>
      <p class="cedar-code-map-drawing-eta">Usually a few seconds. The <strong>[]</strong> button stays disabled until the map is ready.</p>
    </div>`;
  };

  const mountArtifact = (artifact) => {
    if (isStale()) return;
    const baseArtifact = enrichFlyoutArtifact(artifact);
    setProfile(baseArtifact);
    setFileOverview(baseArtifact);

    const runMount = async () => {
      if (!document.body.classList.contains("cedar-code-map-expanded")) {
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      }
      const loaded = await loadFlyoutArtifactWithModuleDeps(path, baseArtifact);
      if (isStale()) return false;
      const merged = enrichFlyoutArtifact(loaded ?? baseArtifact);
      setFileOverview(merged);
      return mountFileCodeMap(stage, merged, path);
    };

    void runMount().then((ok) => {
        if (isStale()) return;
        if (!ok) {
          if (artifact.mermaid) {
            setCodeMapBuildStatus("error", "Canvas mount failed — showing Mermaid fallback");
            stage.innerHTML = `<pre class="cedar-file-flow-fallback">${escapeHtml(artifact.mermaid)}</pre>`;
            return;
          }
          setCodeMapBuildStatus("error", "Could not draw the code map in the flyout");
          stage.innerHTML = `<p class="cedar-file-flow-empty">Could not layout the map. Widen the flyout or click <strong>[]</strong> again.</p>`;
          return;
        }
        setCodeMapBuildStatus("ready", `Code map drawn for ${leaf}`);
        syncFileCodeMapButtons(path, false);
        const activeView = stage.dataset.cedarActiveCodeMapView ?? "structure";
        switchCodeMapFlyoutView(activeView);
        wireCodeMapFlyoutWheel(stage);
        syncCodeMapExpandButton();
        scheduleDiagramRefit(stage.closest("#results") ?? document);
        refitActiveCodeMap();
        requestAnimationFrame(() => {
          refitActiveCodeMap();
          stage.dispatchEvent(new CustomEvent("cedar-file-flow-resize", { bubbles: true }));
        });
      });
  };

  if (fileHasBuiltCodeMap(stub) && !needsServerCodeMapBuild(stub)) {
    setCodeMapBuildStatus("ready", `Showing cached map for ${leaf}`);
    mountArtifact(stub);
  } else if (fileHasBuiltCodeMap(stub) && needsServerCodeMapBuild(stub)) {
    showLoading(`Drawing Structure, Behavior & Functionality for ${leaf}…`);
    void fetchCodeMapForFile(path, stub)
      .then((artifact) => {
        if (isStale()) return;
        if (!fileHasBuiltCodeMap(artifact)) {
          setCodeMapBuildStatus("error", "Server returned an empty map");
          stage.innerHTML = `<p class="cedar-file-flow-empty">Could not build a code map for this file.</p>`;
          return;
        }
        mountArtifact(artifact);
      })
      .catch((err) => {
        if (isStale()) return;
        const msg = err instanceof Error ? err.message : String(err);
        setCodeMapBuildStatus("error", msg);
        syncFileCodeMapButtons(path, false);
        stage.innerHTML = `<p class="cedar-file-flow-empty">Code map failed: ${escapeHtml(msg)}</p>`;
      });
  } else {
    showLoading(`Drawing code map for ${leaf}…`);
    void fetchCodeMapForFile(path, stub)
      .then((artifact) => {
        if (isStale()) return;
        if (!fileHasBuiltCodeMap(artifact)) {
          setCodeMapBuildStatus("error", "Server returned an empty map");
          stage.innerHTML = `<p class="cedar-file-flow-empty">Could not build a code map for this file.</p>`;
          return;
        }
        mountArtifact(artifact);
      })
      .catch((err) => {
        if (isStale()) return;
        const msg = err instanceof Error ? err.message : String(err);
        setCodeMapBuildStatus("error", msg);
        syncFileCodeMapButtons(path, false);
        stage.innerHTML = `<p class="cedar-file-flow-empty">Code map failed: ${escapeHtml(msg)}</p>`;
      });
  }
  syncCodeMapExpandButton();
}

const JS_PATH = /\.(cjs|mjs|jsx?|tsx?)$/i;

/**
 * @param {string} filePath
 * @param {object} artifact
 */
async function loadFlyoutArtifactWithModuleDeps(filePath, artifact) {
  if (!artifact || !JS_PATH.test(filePath)) return artifact;
  const meta = artifact.moduleDeps;
  const needsRefresh =
    meta?.skipped &&
    (meta.reason === "not-on-disk" || meta.reason === "cruise-error" || meta.reason === "empty-graph");
  const hasModuleNodes = (artifact.elements ?? []).some((el) => {
    const kind = el?.data?.kind;
    return kind === "module" || kind === "module-focus";
  });
  if (!needsRefresh && hasModuleNodes) return artifact;
  if (!needsRefresh && meta && !meta.skipped) return artifact;

  try {
    const res = await fetch(`/api/code-map/module-deps?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) return artifact;
    const layer = await res.json();
    if (!layer?.elements?.length) {
      if (layer?.bullets?.length && artifact.summary) {
        return {
          ...artifact,
          moduleDeps: layer.meta ?? meta,
          summary: mergeSummaryBullets(artifact.summary, layer.bullets),
        };
      }
      return { ...artifact, moduleDeps: layer?.meta ?? meta };
    }
    const next = {
      ...artifact,
      elements: [...(artifact.elements ?? []), ...layer.elements],
      moduleDeps: layer.meta ?? meta,
    };
    if (layer.bullets?.length) {
      next.summary = mergeSummaryBullets(artifact.summary, layer.bullets);
    }
    if (artifact.profileHint && layer.meta && !layer.meta.skipped) {
      next.profileHint = artifact.profileHint.includes("dependency-cruiser")
        ? artifact.profileHint
        : `${artifact.profileHint} Module imports overlaid (dependency-cruiser).`;
    }
    return next;
  } catch {
    return artifact;
  }
}

/**
 * @param {object | null | undefined} summary
 * @param {string[]} extra
 */
function mergeSummaryBullets(summary, extra) {
  const base = summary && typeof summary === "object" ? { ...summary } : { lead: "", bullets: [] };
  const bullets = Array.isArray(base.bullets) ? [...base.bullets] : [];
  for (const b of extra) {
    if (typeof b === "string" && b.trim() && !bullets.includes(b)) bullets.push(b);
  }
  base.bullets = bullets;
  return base;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {ParentNode} root
 */
export function wireFileFlowRail(root) {
  const stage = root.querySelector("#cedar-file-flow-stage");
  if (!(stage instanceof HTMLElement)) return;

  root.querySelectorAll(".cedar-gh-file[data-file-review]").forEach((article) => {
    if (!(article instanceof HTMLElement)) return;
    const path = article.getAttribute("data-file-path");
    if (!path) return;

    const markActive = () => {
      root.querySelectorAll(".cedar-gh-file.is-file-flow-active").forEach((el) => {
        el.classList.remove("is-file-flow-active");
      });
      article.classList.add("is-file-flow-active");
      setActiveFileFlow(path);
    };

    article.querySelectorAll(".d2h-file-header, .cedar-gh-file-actions").forEach((el) => {
      if (el.dataset.wiredFileFlow) return;
      el.dataset.wiredFileFlow = "1";
      el.addEventListener("click", (ev) => {
        if (ev.target.closest("a, button, input, textarea")) return;
        markActive();
      });
    });

    if (article.dataset.wiredFileFlowSelect) return;
    article.dataset.wiredFileFlowSelect = "1";
    article.addEventListener("click", (ev) => {
      if (ev.target.closest("a, button, input, textarea, .cedar-diff-comment")) return;
      markActive();
    });
  });

  if (typeof IntersectionObserver !== "undefined") {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible?.target) return;
        const article = visible.target.closest("[data-file-review]");
        if (!(article instanceof HTMLElement)) return;
        const path = article.getAttribute("data-file-path");
        if (path && path !== activePath) {
          root.querySelectorAll(".cedar-gh-file.is-file-flow-active").forEach((el) => {
            el.classList.remove("is-file-flow-active");
          });
          article.classList.add("is-file-flow-active");
          setActiveFileFlow(path);
        }
      },
      {
        root:
          root.querySelector(".cedar-slice-panel.is-active-slice .cedar-slice-queue-scroll") ??
          root.querySelector(".cedar-slice-review-pane"),
        rootMargin: "-8% 0px -35% 0px",
        threshold: [0.2, 0.45, 0.65],
      }
    );

    root.querySelectorAll(".cedar-gh-file[data-file-review]").forEach((el) => io.observe(el));
  }

  if (!activePath) setActiveFileFlow(null);
  wireCodeMapExpand(root);
  syncCodeMapExpandButton();
}

/**
 * @param {ParentNode} root
 */
export function refreshFileFlowRailTheme() {
  syncCodeMapExpandButton();
  refitActiveCodeMap();
}