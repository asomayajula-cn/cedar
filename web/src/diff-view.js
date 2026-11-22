import { html as diff2html } from "diff2html";
import {
  getActiveDiffFontPreset,
  getDiffFontSettings,
  renderDiffFontControl,
  wireDiffFontControls,
} from "./diff-font.js";
import { codeMapExpandIconSvg } from "./cedar-icons.js";
import { defaultInlineCommentsVisible, wireDiffComments } from "./diff-comments.js";
import { getResolvedTheme } from "./theme.js";

/**
 * @param {string} patch
 */
function countPatchAddDel(patch) {
  let added = 0;
  let removed = 0;
  for (const raw of patch.split("\n")) {
    if (!raw) continue;
    if (
      raw.startsWith("+++") ||
      raw.startsWith("---") ||
      raw.startsWith("@@") ||
      raw.startsWith("diff ") ||
      raw.startsWith("\\")
    ) {
      continue;
    }
    if (raw.startsWith("+")) added += 1;
    else if (raw.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

function renderFileCodeMapButton(path) {
  const p = escapeHtml(path);
  return `<button type="button" class="cedar-file-code-map-btn diagram-tool-btn" data-file-code-map="${p}" title="Code map" aria-label="Open code map for ${p}">
    ${codeMapExpandIconSvg("cedar-file-code-map-icon")}
  </button>`;
}

/**
 * @param {ParentNode} root
 */
export function injectFileCodeMapHeaderButtons(root) {
  root.querySelectorAll(".cedar-gh-file[data-file-review]").forEach((article) => {
    if (!(article instanceof HTMLElement)) return;
    const path = article.getAttribute("data-file-path");
    if (!path) return;
    article.querySelectorAll(".d2h-file-header").forEach((header) => {
      if (!(header instanceof HTMLElement)) return;
      if (header.querySelector("[data-file-code-map]")) return;
      const wrap = document.createElement("div");
      wrap.className = "cedar-d2h-file-code-map";
      wrap.innerHTML = renderFileCodeMapButton(path);
      const stats = header.querySelector(".d2h-file-stats");
      if (stats instanceof HTMLElement) {
        stats.before(wrap);
      } else {
        header.appendChild(wrap);
      }
    });
  });
}

const DIFF_BASE = {
  drawFileList: false,
  matching: "lines",
  renderNothingWhenEmpty: false,
};

/** @typedef {"side-by-side" | "line-by-line"} DiffOutputFormat */

/**
 * @returns {DiffOutputFormat}
 */
export function defaultDiffFormat() {
  return "side-by-side";
}

/**
 * @param {DiffOutputFormat} format
 */
function diffOptions(format) {
  const day = getResolvedTheme() === "day";
  return {
    ...DIFF_BASE,
    outputFormat: format,
    colorScheme: day ? "light" : "dark",
  };
}

function diffSchemeClass() {
  return getResolvedTheme() === "day" ? "d2h-light-color-scheme" : "d2h-dark-color-scheme";
}

/**
 * @param {ParentNode} [root]
 */
export function refreshDiffThemeClasses(root = document) {
  const scheme = diffSchemeClass();
  const drop = scheme === "d2h-light-color-scheme" ? "d2h-dark-color-scheme" : "d2h-light-color-scheme";
  root
    .querySelectorAll(
      ".cedar-diff2html, .d2h-wrapper, .d2h-file-wrapper, .d2h-file-diff, .d2h-diff-table"
    )
    .forEach((el) => {
      el.classList.remove(drop);
      el.classList.add(scheme);
    });
}

/**
 * Re-render file diffs so diff2html picks up the active color scheme (not only wrapper classes).
 * @param {ParentNode} root
 */
export function refreshDiffRendersForTheme(root = document) {
  root.querySelectorAll(".cedar-gh-file[data-file-review]").forEach((article) => {
    if (!(article instanceof HTMLElement)) return;
    const path = article.getAttribute("data-file-path");
    const b64 = article.getAttribute("data-patch-b64");
    const body = article.querySelector("[data-file-body]");
    const activeMode = article.querySelector(".cedar-gh-diff-mode.is-active");
    const activeModeAttr = activeMode?.getAttribute("data-diff-mode");
    const format =
      activeModeAttr === "side-by-side" || activeModeAttr === "line-by-line"
        ? /** @type {DiffOutputFormat} */ (activeModeAttr)
        : defaultDiffFormat();
    if (!path || !b64 || !(body instanceof HTMLElement)) return;
    try {
      const patch = patchFromB64(b64);
      body.innerHTML = renderGithubFileDiff(path, patch, format);
      body.querySelectorAll(".d2h-file-header").forEach((header) => {
        header.classList.add("d2h-sticky-header");
      });
      styleDiffFileStatusTags(body);
      applyDiffLineStatsToArticle(article);
      injectFileCodeMapHeaderButtons(article);
      wireDiffComments(body);
    } catch {
      refreshDiffThemeClasses(body);
    }
  });
  refreshDiffThemeClasses(root);
}

/**
 * @param {string} patch
 */
function patchToB64(patch) {
  return btoa(unescape(encodeURIComponent(patch)));
}

/**
 * @param {string} b64
 */
export function patchFromB64(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * @param {string} path
 * @param {string} patch
 */
export function normalizePatch(path, patch) {
  if (!patch?.trim()) return "";
  const p = patch.trim();
  if (p.startsWith("diff --git")) return p;
  const hasOldNewHeaders = /^---\s/m.test(p) && /^\+\+\+\s/m.test(p);
  if (hasOldNewHeaders) {
    return [`diff --git a/${path} b/${path}`, p].join("\n");
  }
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, p].join("\n");
}

/**
 * @param {{ path?: string, filename?: string, status?: string, additions?: number, deletions?: number, patch?: string | null } & Record<string, unknown>} file
 */
export function normalizeReviewFile(file) {
  const path = String(file.path ?? file.filename ?? "").trim();
  let additions = Number(file.additions);
  let deletions = Number(file.deletions);
  if (!Number.isFinite(additions)) additions = 0;
  if (!Number.isFinite(deletions)) deletions = 0;
  const patch = typeof file.patch === "string" ? file.patch : "";
  if (patch.trim() && additions === 0 && deletions === 0) {
    const stats = countPatchAddDel(patch);
    if (stats.added > 0 || stats.removed > 0) {
      additions = stats.added;
      deletions = stats.removed;
    }
  }
  return {
    path,
    filename: path,
    status: file.status,
    additions,
    deletions,
    patch: patch || file.patch || null,
  };
}

/**
 * @param {{ additions?: number, deletions?: number, files?: Array<{ additions?: number, deletions?: number, patch?: string | null, path?: string, filename?: string }> } | null | undefined} micro
 */
export function microDiffTotals(micro) {
  const files = (micro?.files ?? []).map((f) => normalizeReviewFile(f));
  let additions = micro?.additions;
  let deletions = micro?.deletions;
  if (!Number(additions)) additions = 0;
  if (!Number(deletions)) deletions = 0;
  if (additions === 0 && deletions === 0 && files.length) {
    additions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
    deletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
  }
  return { additions, deletions };
}

/**
 * @param {HTMLElement} article
 */
function applyDiffLineStatsToArticle(article) {
  const additions = Number(article.dataset.fileAdditions);
  const deletions = Number(article.dataset.fileDeletions);
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) return;
  if (additions === 0 && deletions === 0) return;
  article.querySelectorAll(".d2h-file-wrapper").forEach((wrap) => {
    const addEl = wrap.querySelector(".d2h-lines-added");
    const delEl = wrap.querySelector(".d2h-lines-deleted");
    if (addEl instanceof HTMLElement && additions > 0) {
      addEl.textContent = `+${additions}`;
    }
    if (delEl instanceof HTMLElement && deletions > 0) {
      delEl.textContent = `−${deletions}`;
    }
  });
}

/**
 * @param {string} path
 * @param {string | null | undefined} patch
 * @param {DiffOutputFormat} [format]
 */
export function renderGithubFileDiff(path, patch, format = defaultDiffFormat()) {
  const full = normalizePatch(path, patch ?? "");
  if (!full) {
    return `<p class="cedar-gh-diff-empty">Diff not available from GitHub (file may be too large or binary).</p>`;
  }
  try {
    const body = diff2html(full, diffOptions(format));
    return `<div class="cedar-diff2html ${diffSchemeClass()}" data-diff-format="${format}">${body}</div>`;
  } catch {
    return `<pre class="cedar-gh-diff-fallback">${escapeHtml(patch ?? "")}</pre>`;
  }
}

/**
 * @param {string} status
 */
function statusLabel(status) {
  const s = String(status ?? "modified").toLowerCase();
  const labels = {
    added: "Added",
    removed: "Deleted",
    deleted: "Deleted",
    renamed: "Renamed",
    copied: "Copied",
    changed: "Changed",
    modified: "Modified",
  };
  return labels[s] ?? "Modified";
}

/** @type {Record<string, string>} */
const FILE_CHANGE_BADGE_KIND = {
  added: "added",
  removed: "deleted",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  changed: "changed",
  modified: "modified",
};

/**
 * @param {string} status
 */
function renderFileChangeBadge(status) {
  const raw = String(status ?? "modified").toLowerCase();
  const kind = FILE_CHANGE_BADGE_KIND[raw] ?? "modified";
  const label = statusLabel(raw);
  return `<span class="cedar-badge cedar-file-change-badge cedar-file-change-badge--${kind}" title="File status on GitHub">${escapeHtml(label)}</span>`;
}

/**
 * @param {string} path
 */
export function encodeGitHubFileAnchor(path) {
  return path.replace(/\//g, "-").replace(/\./g, "-");
}

/**
 * @param {{ path: string, status?: string, additions: number, deletions: number, patch?: string | null }[]} files
 * @param {string} panelId
 */
export function renderGhFilesSidebar(files, panelId) {
  const normalized = (files ?? []).map((f) => normalizeReviewFile(f)).filter((f) => f.path);
  if (!normalized.length) return "";
  const safeId = String(panelId).replace(/[^\w-]/g, "_");
  const rows = normalized
    .map((f) => {
      const anchor = encodeGitHubFileAnchor(f.path);
      const name = f.path.includes("/") ? f.path.slice(f.path.lastIndexOf("/") + 1) : f.path;
      return `<a href="#file-${escapeHtml(anchor)}" class="cedar-gh-files-tree-item" data-gh-file-jump="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}">
        <span class="cedar-gh-files-tree-name">${escapeHtml(name)}</span>
        <span class="cedar-gh-files-tree-stats" aria-label="+${f.additions} −${f.deletions}">
          <span class="cedar-gh-files-tree-add">+${f.additions ?? 0}</span>
          <span class="cedar-gh-files-tree-del">−${f.deletions ?? 0}</span>
        </span>
      </a>`;
    })
    .join("");
  return `<aside class="cedar-gh-files-sidebar" data-gh-files-sidebar aria-label="Changed files in this slice">
    <label class="sr-only" for="cedar-gh-files-filter-${escapeHtml(safeId)}">Filter changed files</label>
    <input type="search" class="cedar-gh-files-filter" id="cedar-gh-files-filter-${escapeHtml(safeId)}" placeholder="Filter changed files" autocomplete="off" spellcheck="false" />
    <nav class="cedar-gh-files-tree">${rows}</nav>
  </aside>`;
}

/**
 * @param {{ path: string, status?: string, additions: number, deletions: number, patch?: string | null }[]} files
 * @param {string} pullUrl
 * @param {string} panelId
 * @param {{ showFilesHeading?: boolean }} [opts]
 */
export function renderGhDiffWorkspace(files, pullUrl, panelId, opts = {}) {
  return `<div class="cedar-gh-diff-layout" data-gh-diff-layout>
    ${renderGhFilesSidebar(files, panelId)}
    <div
      class="cedar-col-splitter cedar-gh-files-splitter"
      data-gh-files-splitter
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize changed files list"
      tabindex="0"
      title="Drag to resize file list · double-click to reset"
    ></div>
    <div class="cedar-gh-diff-main min-w-0 flex-1">
      ${renderSliceFileReviews(files, pullUrl, opts)}
    </div>
  </div>`;
}

const GH_FILES_SIDEBAR_WIDTH_KEY = "cedar.ghFilesSidebarWidthPx";
const GH_FILES_SIDEBAR_USER_KEY = "cedar.ghFilesSidebarUserResized";
const GH_FILES_SIDEBAR_DEFAULT = 280;
const GH_FILES_SIDEBAR_MIN = 200;
const GH_FILES_SIDEBAR_MAX = 520;

function readStoredGhFilesSidebarWidth() {
  if (localStorage.getItem(GH_FILES_SIDEBAR_USER_KEY) !== "1") return GH_FILES_SIDEBAR_DEFAULT;
  const raw = localStorage.getItem(GH_FILES_SIDEBAR_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) {
    return Math.min(GH_FILES_SIDEBAR_MAX, Math.max(GH_FILES_SIDEBAR_MIN, n));
  }
  return GH_FILES_SIDEBAR_DEFAULT;
}

/**
 * @param {HTMLElement | null | undefined} shell
 * @param {number} widthPx
 */
function applyGhFilesSidebarWidth(host, widthPx) {
  if (!(host instanceof HTMLElement)) return;
  host.style.setProperty("--cedar-gh-files-sidebar-width", `${widthPx}px`);
}

/**
 * @param {HTMLElement | null | undefined} host
 */
function syncGhFilesSidebarWidthFromPrefs(host) {
  if (!(host instanceof HTMLElement)) return;
  if (localStorage.getItem(GH_FILES_SIDEBAR_USER_KEY) === "1") {
    applyGhFilesSidebarWidth(host, readStoredGhFilesSidebarWidth());
    return;
  }
  host.style.removeProperty("--cedar-gh-files-sidebar-width");
}

/**
 * @param {ParentNode} root
 */
/**
 * @param {ParentNode} root
 */
export function wireGhFilesSidebarResize(root) {
  const splitters = root.querySelectorAll("[data-gh-files-splitter]");
  if (!splitters.length) return;

  const hosts = new Set();
  splitters.forEach((splitter) => {
    const layout = splitter.closest("[data-gh-diff-layout]");
    if (layout instanceof HTMLElement) hosts.add(layout);
  });
  hosts.forEach((host) => syncGhFilesSidebarWidthFromPrefs(host));

  splitters.forEach((splitter) => {
    if (!(splitter instanceof HTMLElement) || splitter.dataset.wiredGhFilesSplit) return;
    splitter.dataset.wiredGhFilesSplit = "1";

    const layout = splitter.closest("[data-gh-diff-layout]");
    const widthHost = layout instanceof HTMLElement ? layout : null;
    const sidebar = layout?.querySelector(
      ":scope > .cedar-gh-files-sidebar:not(.cedar-gh-files-sidebar--drawer)"
    );

    splitter.addEventListener("dblclick", () => {
      localStorage.removeItem(GH_FILES_SIDEBAR_WIDTH_KEY);
      localStorage.removeItem(GH_FILES_SIDEBAR_USER_KEY);
      hosts.forEach((host) => syncGhFilesSidebarWidthFromPrefs(host));
    });

    splitter.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      splitter.setPointerCapture(ev.pointerId);
      document.body.classList.add("cedar-is-resizing-gh-files");
      const startX = ev.clientX;
      const startW =
        sidebar instanceof HTMLElement
          ? sidebar.getBoundingClientRect().width
          : readStoredGhFilesSidebarWidth();

      const onMove = (moveEv) => {
        const next = Math.min(
          GH_FILES_SIDEBAR_MAX,
          Math.max(GH_FILES_SIDEBAR_MIN, startW + (moveEv.clientX - startX))
        );
        if (widthHost) applyGhFilesSidebarWidth(widthHost, next);
      };

      const onUp = (upEv) => {
        splitter.releasePointerCapture(upEv.pointerId);
        document.body.classList.remove("cedar-is-resizing-gh-files");
        splitter.removeEventListener("pointermove", onMove);
        splitter.removeEventListener("pointerup", onUp);
        splitter.removeEventListener("pointercancel", onUp);
        if (sidebar instanceof HTMLElement) {
          localStorage.setItem(GH_FILES_SIDEBAR_USER_KEY, "1");
          localStorage.setItem(GH_FILES_SIDEBAR_WIDTH_KEY, String(Math.round(sidebar.getBoundingClientRect().width)));
        }
      };

      splitter.addEventListener("pointermove", onMove);
      splitter.addEventListener("pointerup", onUp);
      splitter.addEventListener("pointercancel", onUp);
    });

    splitter.addEventListener("keydown", (ev) => {
      let delta = 0;
      if (ev.key === "ArrowRight") delta = 16;
      else if (ev.key === "ArrowLeft") delta = -16;
      else return;
      ev.preventDefault();
      const current =
        sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : readStoredGhFilesSidebarWidth();
      const next = Math.min(GH_FILES_SIDEBAR_MAX, Math.max(GH_FILES_SIDEBAR_MIN, current + delta));
      if (widthHost) applyGhFilesSidebarWidth(widthHost, next);
      localStorage.setItem(GH_FILES_SIDEBAR_USER_KEY, "1");
      localStorage.setItem(GH_FILES_SIDEBAR_WIDTH_KEY, String(Math.round(next)));
    });
  });
}

export function wireGhFilesSidebar(root) {
  wireGhFilesSidebarResize(root);
  root.querySelectorAll("[data-gh-files-sidebar]").forEach((sidebar) => {
    if (!(sidebar instanceof HTMLElement) || sidebar.dataset.wiredGhSidebar) return;
    sidebar.dataset.wiredGhSidebar = "1";
    const diffLayout = sidebar.closest("[data-gh-diff-layout]");
    const panel =
      diffLayout?.closest("[data-slice-panel]") ??
      sidebar.closest("[data-slice-panel]") ??
      root.querySelector(".cedar-slice-panel.is-active-slice") ??
      root.querySelector("#cedar-review-panel-slices");
    const filter = sidebar.querySelector(".cedar-gh-files-filter");
    const items = [...sidebar.querySelectorAll("[data-gh-file-jump]")];

    filter?.addEventListener("input", () => {
      const q = filter instanceof HTMLInputElement ? filter.value.trim().toLowerCase() : "";
      items.forEach((item) => {
        if (!(item instanceof HTMLElement)) return;
        const path = item.getAttribute("data-gh-file-jump") ?? "";
        const hidden = Boolean(q) && !path.toLowerCase().includes(q);
        item.hidden = hidden;
        item.classList.toggle("is-filtered-out", hidden);
      });
    });

    items.forEach((item) => {
      if (!(item instanceof HTMLElement)) return;
      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        const path = item.getAttribute("data-gh-file-jump");
        if (!path) return;
        const slug = encodeGitHubFileAnchor(path);
        const fileEl =
          panel?.querySelector(`#file-${CSS.escape(slug)}`) ??
          panel?.querySelector(`.cedar-gh-file[data-file-path="${CSS.escape(path)}"]`);
        items.forEach((el) => el.classList.toggle("is-active", el === item));
        if (fileEl instanceof HTMLElement) {
          fileEl.classList.add("is-file-flow-active");
          fileEl.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      });
    });
  });
}

/**
 * @param {{ path: string, status?: string, additions: number, deletions: number, patch?: string | null }[]} files
 * @param {string} pullUrl
 * @param {{ showFilesHeading?: boolean }} [opts]
 */
export function renderSliceFileReviews(files, pullUrl = "", opts = {}) {
  const showFilesHeading = opts.showFilesHeading !== false;
  const normalized = (files ?? []).map((f) => normalizeReviewFile(f)).filter((f) => f.path);
  if (!normalized.length) {
    return `<p class="text-sm text-zinc-600">No files in this virtual PR.</p>`;
  }

  const ghFiles = pullUrl ? `${pullUrl.replace(/\/$/, "")}/files` : "";
  const format = defaultDiffFormat();

  const cards = normalized
    .map((f, i) => {
      const status = f.status ?? "modified";
      const diffHtml = f.patch ? renderGithubFileDiff(f.path, f.patch, format) : "";
      const patchB64 = f.patch ? patchToB64(f.patch) : "";
      const ghFile = ghFiles ? `${ghFiles}#diff-${encodeGitHubFileAnchor(f.path)}` : "";

      const fileAnchor = encodeGitHubFileAnchor(f.path);

      return `
      <article class="cedar-gh-file" id="file-${escapeHtml(fileAnchor)}" data-file-review data-file-path="${escapeHtml(f.path)}" data-file-additions="${f.additions}" data-file-deletions="${f.deletions}"${
        patchB64 ? ` data-patch-b64="${patchB64}"` : ""
      }>
        <div class="cedar-gh-file-actions">
          <div class="cedar-gh-diff-view-toggle" role="group" aria-label="Diff view">
            <button type="button" class="cedar-gh-diff-mode${format === "side-by-side" ? " is-active" : ""}" data-diff-mode="side-by-side" title="Split">Split</button>
            <button type="button" class="cedar-gh-diff-mode${format === "line-by-line" ? " is-active" : ""}" data-diff-mode="line-by-line" title="Unified">Unified</button>
          </div>
          <div class="cedar-gh-file-actions-end">
            ${renderFileCodeMapButton(f.path)}
            ${renderFileChangeBadge(status)}
            ${
              ghFile
                ? `<a href="${escapeHtml(ghFile)}" target="_blank" rel="noreferrer" class="cedar-gh-open-github">Open on GitHub</a>`
                : ""
            }
          </div>
        </div>
        <div class="cedar-gh-file-body" data-file-body id="file-review-${i}">
          ${diffHtml || `<p class="cedar-gh-diff-empty">No patch returned for this file.</p>`}
        </div>
      </article>`;
    })
    .join("");

  const fontPreset = getActiveDiffFontPreset();
  const { size, line } = getDiffFontSettings();
  const commentsVisible = defaultInlineCommentsVisible();

  const toolbar = showFilesHeading
    ? `<div class="cedar-gh-files-toolbar mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="cedar-gh-files-toolbar-copy">
          <p class="cedar-gh-files-toolbar-count mb-0"><strong>${normalized.length}</strong> changed file${normalized.length === 1 ? "" : "s"}</p>
          <p class="cedar-gh-files-toolbar-hint mt-0.5 text-[9px] text-zinc-600">Files rail for quick jumps · gutter <span class="cedar-comment-marker-chip cedar-comment-marker-chip--legend" aria-hidden="true"></span> to comment</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="cedar-btn-secondary cedar-btn-compact cedar-diff-comments-visibility" data-comments-toggle aria-pressed="${commentsVisible ? "true" : "false"}">
            ${commentsVisible ? "Hide comments" : "Show comments"}
          </button>
          ${renderDiffFontControl(fontPreset)}
        </div>
      </div>`
    : "";

  return `
    <div class="cedar-gh-files-changed space-y-0" data-comments-hidden="${commentsVisible ? "false" : "true"}" style="--cedar-diff-font-size: ${size}px; --cedar-diff-line-height: ${line}px">
      ${toolbar}
      ${cards}
    </div>`;
}

const D2H_STATUS_BADGE = [
  { match: "d2h-added-tag", kind: "added", label: "Added" },
  { match: "d2h-changed-tag", kind: "changed", label: "Changed" },
  { match: "d2h-deleted-tag", kind: "deleted", label: "Deleted" },
  { match: "d2h-moved-tag", kind: "renamed", label: "Renamed" },
];

/**
 * @param {ParentNode} root
 */
function styleDiffFileStatusTags(root) {
  root.querySelectorAll(".cedar-diff2html .d2h-tag").forEach((tag) => {
    if (!(tag instanceof HTMLElement)) return;
    if (tag.dataset.cedarFileBadge) return;
    tag.dataset.cedarFileBadge = "1";
    tag.classList.add("cedar-badge", "cedar-file-change-badge", "cedar-diff2html-file-badge");
    for (const spec of D2H_STATUS_BADGE) {
      if (tag.classList.contains(spec.match)) {
        tag.classList.add(`cedar-file-change-badge--${spec.kind}`);
        tag.textContent = spec.label;
        break;
      }
    }
  });
}

/**
 * @param {ParentNode} root
 */
export function wireFileReviewToggles(root) {
  wireDiffFontControls(root);
  wireDiffComments(root);
  wireGhFilesSidebar(root);
  refreshDiffThemeClasses(root);

  root.querySelectorAll(".cedar-gh-file[data-file-review]").forEach((article) => {
    if (!(article instanceof HTMLElement)) return;

    article.querySelectorAll(".d2h-file-header").forEach((header) => {
      header.classList.add("d2h-sticky-header");
    });
    styleDiffFileStatusTags(article);
    applyDiffLineStatsToArticle(article);
    injectFileCodeMapHeaderButtons(article);

    article.querySelectorAll("[data-diff-mode]").forEach((btn) => {
      if (btn.dataset.wiredDiff) return;
      btn.dataset.wiredDiff = "1";
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-diff-mode");
        if (mode !== "side-by-side" && mode !== "line-by-line") return;
        const path = article.getAttribute("data-file-path");
        const b64 = article.getAttribute("data-patch-b64");
        const body = article.querySelector("[data-file-body]");
        if (!path || !b64 || !(body instanceof HTMLElement)) return;

        article.querySelectorAll("[data-diff-mode]").forEach((b) => {
          b.classList.toggle("is-active", b.getAttribute("data-diff-mode") === mode);
        });

        try {
          const patch = patchFromB64(b64);
          body.innerHTML = renderGithubFileDiff(path, patch, mode);
          body.querySelectorAll(".d2h-file-header").forEach((header) => {
            header.classList.add("d2h-sticky-header");
          });
          styleDiffFileStatusTags(body);
          applyDiffLineStatsToArticle(article);
          injectFileCodeMapHeaderButtons(article);
          wireDiffComments(body);
        } catch {
          /* keep previous render */
        }
      });
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}