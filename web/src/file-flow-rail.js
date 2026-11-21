import { scheduleDiagramRefit } from "./diagram-ux.js";
import { codeMapFileOverview } from "./code-map-file-overview.js";
import { renderCodeMapOverviewHtml } from "./code-map-overview-render.js";
import { enrichFlyoutArtifact } from "./code-map-flyout-enrich.js";
import {
  destroyFileCodeMap,
  mountFileCodeMap,
  wireCodeMapFlyoutWheel,
  nudgeCodeMapZoom,
  resetCodeMapView,
  refitActiveCodeMap,
  resizeActiveCodeMapViewport,
  stabilizeCodeMapForFlyout,
  wireCodeMapTriptychTabs,
} from "./file-flow-canvas.js";

/**
 * @param {object[]} microPrs
 * @returns {Record<string, { mermaid?: string | null, svg?: string | null, whatItDoes?: string | null, elements?: object[] | null }>}
 */
export function buildFileFlowCatalogFromMicroPrs(microPrs) {
  const map = {};
  for (const m of microPrs ?? []) {
    for (const f of m.files ?? []) {
      const path = f.path ?? f.filename;
      if (!path) continue;
      const artifact = {
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
      };
      if (
        artifact.svg ||
        artifact.mermaid ||
        artifact.elements?.length ||
        artifact.behaviorElements?.length ||
        artifact.functionalityElements?.length
      ) {
        map[path] = artifact;
      }
    }
  }
  return map;
}

/** @type {string | null} */
let activePath = null;

let codeMapExpandWired = false;

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
  document.body.classList.toggle("cedar-code-map-expanded", on);
  if (on) applyCodeMapFlyoutWidth(readCodeMapFlyoutWidth());
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

  wireCodeMapFlyoutWheel();
  wireCodeMapTriptychTabs();

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
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
    profileEl.innerHTML = `<span class="cedar-code-map-profile cedar-code-map-profile--${escapeHtml(profile)}">${escapeHtml(label)}</span>`;
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
    destroyFileCodeMap();
    syncCodeMapExpandButton();
    stage.innerHTML = `<p class="cedar-file-flow-empty">Click a file to open its code map — symbols, calls, and dependencies.</p>`;
    return;
  }

  pathEl.textContent = path;
  const catalog = window.__cedarFileFlows ?? {};
  const artifact = catalog[path];
  if (
    !artifact?.svg &&
    !artifact?.mermaid &&
    !artifact?.elements?.length &&
    !artifact?.behaviorElements?.length &&
    !artifact?.functionalityElements?.length
  ) {
    if (whatEl instanceof HTMLElement) whatEl.textContent = "";
    setProfile(null);
    setFileOverview(null);
    destroyFileCodeMap();
    syncCodeMapExpandButton();
    stage.innerHTML = `<p class="cedar-file-flow-empty">No code map for this file yet — re-run review if the file was just changed.</p>`;
    return;
  }

  const baseArtifact = enrichFlyoutArtifact(artifact);
  setProfile(baseArtifact);
  setFileOverview(baseArtifact);

  void loadFlyoutArtifactWithModuleDeps(path, baseArtifact)
    .then((loaded) => {
      const merged = enrichFlyoutArtifact(loaded ?? baseArtifact);
      setFileOverview(merged);
      return mountFileCodeMap(stage, merged, path);
    })
    .then((ok) => {
    if (!ok && artifact.mermaid) {
      stage.innerHTML = `<pre class="cedar-file-flow-fallback">${escapeHtml(artifact.mermaid)}</pre>`;
      return;
    }
    wireCodeMapFlyoutWheel(stage);
    syncCodeMapExpandButton();
    scheduleDiagramRefit(stage.closest("#results") ?? document);
    refitActiveCodeMap();
    requestAnimationFrame(() => {
      refitActiveCodeMap();
      stage.dispatchEvent(new CustomEvent("cedar-file-flow-resize", { bubbles: true }));
    });
  });
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
        root: root.querySelector(".cedar-slice-review-pane"),
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
  const path = activePath;
  if (path) setActiveFileFlow(path);
  else setActiveFileFlow(null);
}