import { html as diff2html } from "diff2html";

const DIFF_OPTS = {
  drawFileList: false,
  matching: "lines",
  outputFormat: "line-by-line",
  colorScheme: "dark",
  renderNothingWhenEmpty: false,
};

/**
 * @param {string} path
 * @param {string} patch
 */
export function normalizePatch(path, patch) {
  if (!patch?.trim()) return "";
  const p = patch.trim();
  if (p.startsWith("diff --git")) return p;
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    p,
  ].join("\n");
}

/**
 * @param {string} path
 * @param {string | null | undefined} patch
 */
export function renderGithubFileDiff(path, patch) {
  const full = normalizePatch(path, patch ?? "");
  if (!full) {
    return `<p class="px-4 py-6 text-center text-xs text-zinc-500">Diff not available from GitHub (file may be too large or binary).</p>`;
  }
  try {
    const body = diff2html(full, DIFF_OPTS);
    return `<div class="cedar-diff2html d2h-dark-color-scheme">${body}</div>`;
  } catch {
    return `<pre class="overflow-x-auto p-4 font-mono text-[11px] text-zinc-400">${escapeHtml(patch ?? "")}</pre>`;
  }
}

/**
 * @param {{ path: string, status?: string, additions: number, deletions: number, patch?: string | null }[]} files
 * @param {string} pullUrl
 */
export function renderSliceFileReviews(files, pullUrl = "") {
  if (!files?.length) {
    return `<p class="text-sm text-zinc-600">No files in this virtual PR.</p>`;
  }

  const ghFiles = pullUrl ? `${pullUrl.replace(/\/$/, "")}/files` : "";

  const cards = files
    .map((f, i) => {
      const status = f.status ?? "modified";
      const diffHtml = f.patch ? renderGithubFileDiff(f.path, f.patch) : "";
      return `
      <article class="cedar-gh-file overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0a0c]" data-file-review>
        <header class="cedar-gh-file-header flex flex-wrap items-center gap-3 border-b border-white/[0.08] bg-white/[0.03] px-4 py-2.5">
          <button type="button" class="cedar-gh-file-toggle text-zinc-500 hover:text-white" data-file-toggle aria-expanded="true" title="Collapse diff">▾</button>
          <span class="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>
          <span class="text-[10px] uppercase tracking-wide text-zinc-600">${escapeHtml(status)}</span>
          <span class="font-mono text-xs text-emerald-400/90">+${f.additions ?? 0}</span>
          <span class="font-mono text-xs text-rose-400/90">−${f.deletions ?? 0}</span>
          ${
            ghFiles
              ? `<a href="${escapeHtml(ghFiles)}" target="_blank" rel="noreferrer" class="text-[11px] text-zinc-500 hover:text-zinc-300">GitHub</a>`
              : ""
          }
        </header>
        <div class="cedar-gh-file-body max-h-[min(32rem,70vh)] overflow-auto" data-file-body id="file-review-${i}">
          ${diffHtml || `<p class="px-4 py-6 text-center text-xs text-zinc-500">No patch returned for this file.</p>`}
        </div>
      </article>`;
    })
    .join("");

  return `
    <div class="space-y-3">
      <p class="cedar-label">Files changed · GitHub-style review</p>
      ${cards}
    </div>`;
}

/**
 * @param {ParentNode} root
 */
export function wireFileReviewToggles(root) {
  root.querySelectorAll("[data-file-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const article = btn.closest("[data-file-review]");
      const body = article?.querySelector("[data-file-body]");
      if (!body) return;
      const hidden = body.classList.toggle("hidden");
      btn.setAttribute("aria-expanded", hidden ? "false" : "true");
      btn.textContent = hidden ? "▸" : "▾";
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