import { collectCursorDraftCommentsForDiff } from "./cursor-diff-comments.js";

export { collectCursorDraftCommentsForDiff };

import { renderReviewCommentHtml } from "./comment-html.js";
import { wireFindingActions } from "./finding-actions.js";

/** @typedef {{ id: number, path: string, line: number, side: string, body: string, html_url?: string, user?: string | null, created_at?: string, source?: "github" | "cursor" | "cursor-macro", findingKey?: string, findingNumber?: number }} ReviewComment */

/** @typedef {{ prUrl: string, token?: string, reviewComments?: ReviewComment[], data: { target?: { owner?: string, repo?: string, pr?: number }, pull?: { headSha?: string } } }} CedarSession */

const INLINE_COMMENTS_VISIBLE_KEY = "cedar-inline-comments-visible";

/** @returns {boolean} */
export function defaultInlineCommentsVisible() {
  try {
    return sessionStorage.getItem(INLINE_COMMENTS_VISIBLE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * @param {boolean} visible
 */
function persistInlineCommentsVisible(visible) {
  try {
    sessionStorage.setItem(INLINE_COMMENTS_VISIBLE_KEY, visible ? "true" : "false");
  } catch {
    /* ignore */
  }
}

/** @type {HTMLElement | null} */
let popover = null;

function ensurePopover() {
  if (popover) return popover;
  popover = document.createElement("div");
  popover.className = "cedar-diff-comment-popover";
  popover.hidden = true;
  popover.innerHTML = `
    <form class="cedar-diff-comment-form">
      <p class="cedar-diff-comment-form-title">Comment on GitHub</p>
      <p class="cedar-diff-comment-form-meta"></p>
      <textarea class="cedar-diff-comment-input" rows="3" placeholder="Leave a review comment…" required></textarea>
      <div class="cedar-diff-comment-actions">
        <button type="button" class="cedar-diff-comment-cancel cedar-btn-secondary cedar-btn-compact">Cancel</button>
        <button type="submit" class="cedar-diff-comment-submit cedar-btn-primary cedar-btn-compact">Post to GitHub</button>
      </div>
    </form>`;
  document.body.appendChild(popover);
  return popover;
}

/**
 * @param {Element | null | undefined} el
 */
function lineNumFromEl(el) {
  const raw = el?.textContent?.trim() ?? "";
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * diff2html row kind from gutter + code cells only (ignore inline `<del>` in change rows).
 * @param {HTMLElement} row
 * @returns {"del" | "ins" | "cntx" | "change" | "side" | "unknown"}
 */
function diffRowCodeKind(row) {
  const rowTd = row.querySelector(":scope > td.d2h-del, :scope > td.d2h-ins, :scope > td.d2h-cntx, :scope > td.d2h-change");
  if (rowTd instanceof HTMLElement) {
    if (rowTd.classList.contains("d2h-del")) return "del";
    if (rowTd.classList.contains("d2h-ins")) return "ins";
    if (rowTd.classList.contains("d2h-cntx")) return "cntx";
    if (rowTd.classList.contains("d2h-change")) return "change";
  }
  if (row.querySelector(":scope > td.d2h-code-side-linenumber")) return "side";
  return "unknown";
}

/**
 * @param {HTMLElement} row
 */
export function resolveLineFromRow(row) {
  const kind = diffRowCodeKind(row);
  const oldDiv = row.querySelector(".line-num1");
  const newDiv = row.querySelector(".line-num2");
  if (oldDiv || newDiv) {
    const oldNum = lineNumFromEl(oldDiv);
    const newNum = lineNumFromEl(newDiv);
    if (kind === "del" && oldNum != null) return { line: oldNum, side: "LEFT" };
    if (newNum != null) return { line: newNum, side: "RIGHT" };
    if (oldNum != null) return { line: oldNum, side: "LEFT" };
    return null;
  }

  const sideCell = row.querySelector(":scope > td.d2h-code-side-linenumber");
  if (sideCell) {
    const n = lineNumFromEl(sideCell);
    if (n == null) return null;
    const paneSide = diffRowSidePane(row);
    const rowDel = row.querySelector(":scope > td.d2h-del");
    const isDel = paneSide === "LEFT" || rowDel instanceof HTMLElement;
    return { line: n, side: isDel ? "LEFT" : "RIGHT" };
  }

  const nums = [...row.querySelectorAll(":scope > td.d2h-code-linenumber, :scope > td.d2h-code-side-linenumber")].flatMap(
    (td) => {
      const a = lineNumFromEl(td.querySelector(".line-num1"));
      const b = lineNumFromEl(td.querySelector(".line-num2"));
      if (a != null || b != null) return [a, b].filter((x) => x != null);
      const direct = lineNumFromEl(td);
      return direct != null ? [direct] : [];
    }
  );
  if (!nums.length) return null;
  if (kind === "del") return { line: nums[0], side: "LEFT" };
  return { line: nums[nums.length - 1], side: "RIGHT" };
}

/**
 * @param {HTMLElement} row
 * @param {number} line
 * @param {string} side
 */
export function rowMatchesCommentAnchor(row, line, side) {
  const want = side === "LEFT" ? "LEFT" : "RIGHT";
  const resolved = resolveLineFromRow(row);
  if (resolved?.line === line && resolved.side === want) return true;
  if (want === "RIGHT") {
    const newNum = lineNumFromEl(row.querySelector(".line-num2"));
    if (newNum === line) return true;
    if (diffRowSidePane(row) === "RIGHT") {
      const n = lineNumFromEl(row.querySelector(":scope > td.d2h-code-side-linenumber"));
      if (n === line) return true;
    }
  } else {
    const oldNum = lineNumFromEl(row.querySelector(".line-num1"));
    if (oldNum === line) return true;
    if (diffRowSidePane(row) === "LEFT") {
      const n = lineNumFromEl(row.querySelector(":scope > td.d2h-code-side-linenumber"));
      if (n === line) return true;
    }
  }
  return false;
}

/**
 * Gutter cell that displays the anchored line (matches diff2html line numbers).
 * @param {HTMLElement} row
 * @param {"LEFT" | "RIGHT"} [side]
 */
export function gutterForCommentAnchor(row, side = "RIGHT") {
  const resolved = resolveLineFromRow(row);
  const effectiveSide = resolved?.side === "LEFT" ? "LEFT" : side === "LEFT" ? "LEFT" : "RIGHT";

  const unified = row.querySelector(":scope > td.d2h-code-linenumber");
  if (unified instanceof HTMLElement) return unified;

  const sideGutter = row.querySelector(":scope > td.d2h-code-side-linenumber");
  if (sideGutter instanceof HTMLElement) return sideGutter;

  const gutters = row.querySelectorAll(":scope > td.d2h-code-linenumber, :scope > td.d2h-code-side-linenumber");
  if (effectiveSide === "RIGHT" && gutters.length > 1) {
    const last = gutters[gutters.length - 1];
    return last instanceof HTMLElement ? last : null;
  }
  const first = gutters[0];
  return first instanceof HTMLElement ? first : null;
}

/** @type {{ path: string, line: number, side: string, row: HTMLElement } | null} */
let activeTarget = null;

function closePopover() {
  const el = ensurePopover();
  el.hidden = true;
  activeTarget = null;
}

/**
 * @param {HTMLElement} row
 * @param {string} path
 */
function openCommentPopoverForRow(row, path) {
  const resolved = resolveLineFromRow(row);
  if (!resolved) {
    showCommentToast("No line number on this row — pick a line with a number in the gutter.", "error");
    return;
  }

  const el = ensurePopover();
  const meta = el.querySelector(".cedar-diff-comment-form-meta");
  const input = el.querySelector(".cedar-diff-comment-input");
  const submit = el.querySelector(".cedar-diff-comment-submit");
  if (!(meta instanceof HTMLElement) || !(input instanceof HTMLTextAreaElement)) return;
  if (submit instanceof HTMLButtonElement) {
    submit.disabled = false;
    submit.textContent = "Post to GitHub";
  }

  activeTarget = { path, line: resolved.line, side: resolved.side, row };
  meta.textContent = `${path}:${resolved.line} (${resolved.side === "LEFT" ? "deleted" : "added"})`;

  const anchor = row.querySelector(".d2h-code-linenumber, .d2h-code-side-linenumber, .d2h-code-line-ctn") ?? row;
  const rect = anchor.getBoundingClientRect();
  const top = Math.min(rect.bottom + 6, window.innerHeight - 220);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - 336);
  el.style.position = "fixed";
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.zIndex = "200";
  el.hidden = false;
  input.value = "";
  input.focus();
}

async function submitActiveComment() {
  const session = /** @type {CedarSession | undefined} */ (window.__cedarSession);
  if (!session || !activeTarget) return;

  const el = ensurePopover();
  const input = el.querySelector(".cedar-diff-comment-input");
  const submit = el.querySelector(".cedar-diff-comment-submit");
  if (!(input instanceof HTMLTextAreaElement) || !(submit instanceof HTMLButtonElement)) return;

  const body = input.value.trim();
  if (!body) return;

  const panel = activeTarget.row.closest("[data-slice-panel]");
  const componentId = panel?.getAttribute("data-slice-panel") ?? "";
  const componentName = panel?.querySelector("h3")?.textContent?.trim() ?? componentId;

  submit.disabled = true;
  submit.textContent = "Posting…";

  try {
    const res = await fetch("/api/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prUrl: session.prUrl,
        token: session.token,
        owner: session.data.target?.owner,
        repo: session.data.target?.repo,
        pr: session.data.target?.pr,
        headSha: session.data.pull?.headSha,
        path: activeTarget.path,
        line: activeTarget.line,
        side: activeTarget.side,
        body,
        componentId,
        componentName,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = [json.error, json.hint, json.githubMessage].filter(Boolean).join("\n\n");
      throw new Error(msg || "Comment failed");
    }

    if (json.comment) {
      upsertSessionComment(/** @type {ReviewComment} */ (json.comment));
    }
    const fileBody = activeTarget.row.closest("[data-file-body]");
    const root = fileBody?.closest("#results") ?? document;
    if (fileBody instanceof HTMLElement) {
      paintCommentsForBody(fileBody, getSessionComments(), activeTarget.path);
    } else {
      repaintAllDiffComments(root);
    }
    closePopover();
    showCommentToast(`Posted on GitHub · ${pathBasename(activeTarget.path)}:${activeTarget.line}`);
  } catch (err) {
    submit.disabled = false;
    submit.textContent = "Post to GitHub";
    showCommentToast(err instanceof Error ? err.message : String(err), "error");
  }
}

function pathBasename(path) {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} path
 * @param {number} line
 * @param {string} side
 */
function commentAnchorKey(path, line, side) {
  return `${path}\0${line}\0${side === "LEFT" ? "LEFT" : "RIGHT"}`;
}

/**
 * @returns {ReviewComment[]}
 */
function getSessionComments() {
  const session = /** @type {CedarSession | undefined} */ (window.__cedarSession);
  return session?.reviewComments ?? [];
}

/**
 * GitHub inline + Composer Cursor drafts for diff painting.
 * @returns {ReviewComment[]}
 */
export function getCommentsForDiffPaint() {
  const github = getSessionComments().map((c) => ({ ...c, source: /** @type {const} */ ("github") }));
  const cursor = collectCursorDraftCommentsForDiff();
  return [...github, ...cursor];
}

/**
 * @param {ReviewComment} comment
 */
function upsertSessionComment(comment) {
  const session = /** @type {CedarSession | undefined} */ (window.__cedarSession);
  if (!session) return;
  if (!session.reviewComments) session.reviewComments = [];
  const idx = session.reviewComments.findIndex((c) => c.id === comment.id);
  if (idx >= 0) session.reviewComments[idx] = comment;
  else session.reviewComments.push(comment);
}

/**
 * @param {ReviewComment[]} comments
 */
function commentsByAnchor(comments) {
  /** @type {Map<string, ReviewComment[]>} */
  const map = new Map();
  for (const c of comments) {
    if (!c.path || !Number.isFinite(c.line)) continue;
    const key = commentAnchorKey(c.path, c.line, c.side ?? "RIGHT");
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  return map;
}

/**
 * @param {ReviewComment[]} items
 */
function isCursorInlineThread(items) {
  return items.length > 0 && items.every((c) => c.source === "cursor" || c.source === "cursor-macro");
}

/**
 * @param {HTMLElement} body
 * @param {string} path
 */
function expandedInlineThreadKeys(body, path) {
  /** @type {Set<string>} */
  const keys = new Set();
  body.querySelectorAll("tr.cedar-diff-comment-thread-row").forEach((threadRow) => {
    if (!(threadRow instanceof HTMLElement)) return;
    if (threadRow.classList.contains("is-collapsed") || threadRow.hidden) return;
    const codeRow = threadRow.previousElementSibling;
    if (!(codeRow instanceof HTMLElement) || !codeRow.classList.contains("cedar-diff-comment-row")) return;
    const resolved = resolveLineFromRow(codeRow);
    if (!resolved) return;
    keys.add(commentAnchorKey(path, resolved.line, resolved.side));
  });
  return keys;
}

/**
 * @param {ReviewComment[]} items
 * @param {{ startCollapsed?: boolean }} [opts]
 */
function renderCommentThreadSlide(items, opts = {}) {
  const startCollapsed = opts.startCollapsed === true;
  const cards = items
    .map((c) => {
      const isMacro = c.source === "cursor-macro";
      const isCursorDraft = c.source === "cursor" || isMacro;
      const who = isMacro
        ? `<span class="cedar-diff-comment-card-user"><span class="cedar-badge cedar-badge-ok cedar-badge-compact">Macro review</span></span>`
        : isCursorDraft
          ? `<span class="cedar-diff-comment-card-user"><span class="cedar-badge cedar-badge-ok cedar-badge-compact">Cursor</span> Draft</span>`
          : c.user
            ? `<span class="cedar-diff-comment-card-user">@${escapeHtml(c.user)}</span>`
            : `<span class="cedar-diff-comment-card-user">Reviewer</span>`;
      const when = !isCursorDraft && c.created_at ? escapeHtml(new Date(c.created_at).toLocaleString()) : "";
      const link = c.html_url
        ? `<a class="cedar-diff-comment-thread-link" href="${escapeHtml(c.html_url)}" target="_blank" rel="noreferrer">Open on GitHub</a>`
        : "";
      const cardClass = isMacro
        ? "cedar-diff-comment-card cedar-diff-comment-card--cursor cedar-diff-comment-card--cursor-macro"
        : isCursorDraft
          ? "cedar-diff-comment-card cedar-diff-comment-card--cursor"
          : "cedar-diff-comment-card";
      const dismissBtn =
        isCursorDraft && c.findingKey
          ? `<button type="button" class="cedar-btn-secondary cedar-btn-compact cedar-diff-comment-dismiss" data-finding-ignore data-finding-key="${escapeHtml(c.findingKey)}" title="Dismiss draft">Dismiss</button>`
          : "";
      const findingNumAttr =
        c.findingNumber && c.findingNumber > 0 ? ` data-finding-number="${c.findingNumber}"` : "";
      return `<article class="${cardClass}"${c.findingKey ? ` data-finding-key="${escapeHtml(c.findingKey)}"` : ""}${findingNumAttr}>
        <header class="cedar-diff-comment-card-head">
          ${who}
          ${when ? `<span class="cedar-diff-comment-card-time">${when}</span>` : ""}
          ${link}
          ${dismissBtn}
        </header>
        <div class="cedar-diff-comment-card-body cedar-comment-html cedar-comment-theme">${renderReviewCommentHtml(c.body)}</div>
      </article>`;
    })
    .join("");
  const count = items.length;
  const noun = count === 1 ? "comment" : "comments";
  const verb = startCollapsed ? "Show" : "Hide";
  return `<div class="cedar-diff-comment-thread-wrap cedar-comment-theme">
    <button type="button" class="cedar-diff-comment-thread-toggle" aria-expanded="${startCollapsed ? "false" : "true"}" aria-label="${verb} ${count} review ${noun} on this line">
      <span class="cedar-comment-marker-chip" aria-hidden="true" title="Review comment"></span>
      <span class="cedar-diff-comment-thread-toggle-count">${count}</span>
      <span class="cedar-diff-comment-thread-toggle-label">${verb} ${noun}</span>
    </button>
    <div class="cedar-diff-comment-thread cedar-comment-theme" role="region" aria-label="Review comments on this line">${cards}</div>
  </div>`;
}

/**
 * @param {HTMLElement} threadRow
 * @param {boolean} [expand]
 */
/**
 * @param {HTMLElement} host
 */
function commentsHostVisible(host) {
  return host.dataset.commentsHidden !== "true";
}

/**
 * @param {HTMLElement} host
 * @param {boolean} visible
 */
function setCommentsHostVisible(host, visible) {
  host.dataset.commentsHidden = visible ? "false" : "true";
  persistInlineCommentsVisible(visible);
  host.classList.toggle("cedar-diff-comments-off", !visible);
  host.querySelectorAll(".cedar-diff-comment-thread-row").forEach((threadRow) => {
    if (!(threadRow instanceof HTMLElement)) return;
    threadRow.classList.toggle("cedar-diff-comments-off", !visible);
    if (visible) {
      setThreadRowExpanded(threadRow, true);
    } else {
      threadRow.classList.remove("cedar-diff-line-expanded");
      setThreadRowExpanded(threadRow, false);
    }
  });
  const btn = host.querySelector("[data-comments-toggle]");
  if (btn instanceof HTMLButtonElement) {
    btn.textContent = visible ? "Hide comments" : "Show comments";
    btn.setAttribute("aria-pressed", visible ? "true" : "false");
  }
  syncAllGutterBadges(host);
}

/**
 * @param {HTMLElement} host
 */
function applyCommentsHostVisibility(host) {
  setCommentsHostVisible(host, commentsHostVisible(host));
}

/**
 * @param {HTMLElement} codeRow
 * @param {number} count
 * @param {{ cursorThread?: boolean, findingNumber?: number }} [opts]
 */
function setGutterCommentCount(codeRow, count, opts = {}) {
  const resolved = resolveLineFromRow(codeRow);
  const gutter = gutterForCommentAnchor(codeRow, resolved?.side === "LEFT" ? "LEFT" : "RIGHT");
  if (!(gutter instanceof HTMLElement)) return;
  if (count <= 0) {
    gutter.querySelector(".cedar-diff-comment-gutter-count")?.remove();
    delete codeRow.dataset.cedarCommentCount;
    return;
  }
  codeRow.dataset.cedarCommentCount = String(count);
  let badge = gutter.querySelector(".cedar-diff-comment-gutter-count");
  if (!(badge instanceof HTMLElement)) {
    badge = document.createElement("span");
    badge.className = "cedar-diff-comment-gutter-count";
    gutter.appendChild(badge);
  }
  const findingNumber = opts.findingNumber;
  const showCursorGutter = opts.cursorThread === true;
  if (showCursorGutter) {
    const num = findingNumber && findingNumber > 0 ? findingNumber : count > 1 ? count : null;
    badge.classList.add("cedar-diff-comment-gutter-count--cursor");
    badge.innerHTML = `<span class="cedar-comment-marker-chip cedar-comment-marker-chip--gutter" aria-hidden="true" title="Review comment"></span>${
      num != null ? `<span class="cedar-diff-comment-gutter-num font-mono">${num}</span>` : ""
    }`;
  } else {
    badge.classList.remove("cedar-diff-comment-gutter-count--cursor");
    badge.textContent = String(count);
  }
  badge.setAttribute("role", "button");
  badge.tabIndex = 0;
  const labelNum = findingNumber && findingNumber > 0 ? `finding #${findingNumber}` : `${count} review comment${count === 1 ? "" : "s"}`;
  badge.setAttribute("aria-label", `${labelNum} — click to show`);
  if (!badge.dataset.wiredGutterCount) {
    badge.dataset.wiredGutterCount = "1";
    const openThread = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleThreadForCodeRow(codeRow);
    };
    badge.addEventListener("click", openThread);
    badge.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      openThread(ev);
    });
  }
}

/**
 * @param {HTMLElement} codeRow
 * @param {HTMLElement | null} [threadRow]
 * @param {HTMLElement | null} [host]
 */
function syncGutterBadgeForRow(codeRow, threadRow, host) {
  const tr =
    threadRow instanceof HTMLElement
      ? threadRow
      : codeRow.nextElementSibling instanceof HTMLElement &&
          codeRow.nextElementSibling.classList.contains("cedar-diff-comment-thread-row")
        ? codeRow.nextElementSibling
        : null;
  const count = Number(codeRow.dataset.cedarCommentCount) || (tr ? tr.querySelectorAll(".cedar-diff-comment-card").length : 0);
  if (count > 0) {
    const cursorThread = tr?.dataset.cursorThread === "1";
    const card = tr?.querySelector("[data-finding-key]");
    const findingNumberAttr = card?.getAttribute("data-finding-number");
    const findingNumber = findingNumberAttr ? Number.parseInt(findingNumberAttr, 10) : undefined;
    setGutterCommentCount(codeRow, count, {
      cursorThread,
      findingNumber: Number.isFinite(findingNumber) ? findingNumber : undefined,
    });
  }
  const threadVisible =
    tr instanceof HTMLElement &&
    !tr.classList.contains("is-collapsed") &&
    !tr.hidden &&
    !tr.classList.contains("cedar-diff-comments-off");
  codeRow.classList.toggle("cedar-diff-comments-collapsed", count > 0 && !threadVisible);
  codeRow.classList.toggle("cedar-diff-gutter-count-visible", count > 0 && !threadVisible);
}

/**
 * @param {HTMLElement} host
 */
function syncAllGutterBadges(host) {
  host.querySelectorAll(".cedar-diff-comment-row.cedar-diff-line-commented").forEach((codeRow) => {
    if (!(codeRow instanceof HTMLElement)) return;
    syncGutterBadgeForRow(codeRow, null, host);
  });
}

function setThreadRowExpanded(threadRow, expand) {
  const host = threadRow.closest(".cedar-gh-files-changed");
  const globalOn = !(host instanceof HTMLElement) || commentsHostVisible(host);

  const isShown =
    !threadRow.classList.contains("is-collapsed") &&
    !threadRow.hidden &&
    !threadRow.classList.contains("cedar-diff-comments-off");
  const on = expand === undefined ? !isShown : expand;
  threadRow.classList.toggle("is-collapsed", !on);
  threadRow.hidden = false;
  threadRow.classList.toggle("cedar-diff-line-expanded", on);
  if (!globalOn) {
    threadRow.classList.toggle("cedar-diff-comments-off", !on);
  } else {
    threadRow.classList.remove("cedar-diff-comments-off");
  }
  const codeRow = threadRow.previousElementSibling;
  if (codeRow instanceof HTMLElement && codeRow.classList.contains("cedar-diff-comment-row")) {
    syncGutterBadgeForRow(codeRow, threadRow, host instanceof HTMLElement ? host : null);
  }
  const btn = threadRow.querySelector(".cedar-diff-comment-thread-toggle");
  const label = threadRow.querySelector(".cedar-diff-comment-thread-toggle-label");
  const count = threadRow.querySelectorAll(".cedar-diff-comment-card").length;
  const noun = count === 1 ? "comment" : "comments";
  if (btn instanceof HTMLButtonElement) {
    btn.setAttribute("aria-expanded", on ? "true" : "false");
    btn.setAttribute("aria-label", `${on ? "Hide" : "Show"} ${count} review ${noun} on this line`);
  }
  if (label instanceof HTMLElement) {
    label.textContent = on ? `Hide ${noun}` : `Show ${noun}`;
  }
}

/**
 * @param {HTMLElement} codeRow
 */
function toggleThreadForCodeRow(codeRow) {
  const threadRow = codeRow.nextElementSibling;
  if (!(threadRow instanceof HTMLElement) || !threadRow.classList.contains("cedar-diff-comment-thread-row")) return;
  setThreadRowExpanded(threadRow);
}

/**
 * @param {HTMLElement} body
 */
function wireCommentThreads(body) {
  body.querySelectorAll(".cedar-diff-comment-thread-row").forEach((threadRow) => {
    if (!(threadRow instanceof HTMLElement)) return;
    if (threadRow.dataset.wiredThreadToggle) return;
    threadRow.dataset.wiredThreadToggle = "1";
    const btn = threadRow.querySelector(".cedar-diff-comment-thread-toggle");
    btn?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setThreadRowExpanded(threadRow);
    });
  });
}

function wireCommentVisibilityOnce() {
  const doc = document.documentElement;
  if (doc.dataset.cedarCommentVisWired) return;
  doc.dataset.cedarCommentVisWired = "1";
  document.addEventListener("click", (ev) => {
    const btn =
      ev.target instanceof HTMLElement ? ev.target.closest("[data-comments-toggle]") : null;
    if (!(btn instanceof HTMLButtonElement)) return;
    const host = btn.closest(".cedar-gh-files-changed");
    if (!(host instanceof HTMLElement)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const showAfterClick = btn.getAttribute("aria-pressed") !== "true";
    setCommentsHostVisible(host, showAfterClick);
  });
}

/**
 * @param {HTMLElement} row
 */
/**
 * @param {HTMLElement} body
 */
function diffIsSideBySide(body) {
  const wrap = body.closest(".cedar-diff2html");
  return wrap?.getAttribute("data-diff-format") === "side-by-side";
}

/**
 * @param {HTMLElement} row
 */
function diffRowInSidePane(row) {
  return Boolean(row.closest(".d2h-file-side-diff"));
}

/**
 * diff2html side-by-side: first `.d2h-file-side-diff` under `.d2h-files-diff` is the old (LEFT) file.
 * @param {HTMLElement} row
 * @returns {"LEFT" | "RIGHT" | null}
 */
export function diffRowSidePane(row) {
  const pane = row.closest(".d2h-file-side-diff");
  if (!(pane instanceof HTMLElement)) return null;
  const filesDiff = pane.parentElement;
  if (!(filesDiff instanceof HTMLElement) || !filesDiff.classList.contains("d2h-files-diff")) {
    return null;
  }
  const panes = filesDiff.querySelectorAll(":scope > .d2h-file-side-diff");
  if (panes.length < 2) return null;
  if (panes[0] === pane) return "LEFT";
  if (panes[1] === pane) return "RIGHT";
  return null;
}

function diffTableColCount(row) {
  const table = row.closest("table");
  if (!(table instanceof HTMLTableElement)) {
    return Math.max(row.querySelectorAll("td").length, 4);
  }
  let max = 0;
  table.querySelectorAll("tr").forEach((tr) => {
    let span = 0;
    tr.querySelectorAll("td, th").forEach((cell) => {
      span += Number(cell.colSpan) || 1;
    });
    if (span > max) max = span;
  });
  return Math.max(max, row.querySelectorAll("td").length, 4);
}

/**
 * @param {HTMLElement} body
 * @param {ReviewComment[]} comments
 * @param {string} path
 */
function paintCommentsForBody(body, comments, path) {
  const expandedKeys = expandedInlineThreadKeys(body, path);
  body.querySelectorAll(".cedar-diff-comment-thread-row").forEach((el) => el.remove());

  const byAnchor = commentsByAnchor(comments.filter((c) => c.path === path));
  if (!byAnchor.size) return;

  /** @type {Set<string>} */
  const paintedAnchors = new Set();

  const sideBySide = diffIsSideBySide(body);
  const filesHost = body.closest(".cedar-gh-files-changed");
  const inlineCommentsOn =
    !(filesHost instanceof HTMLElement) || commentsHostVisible(filesHost);

  body.querySelectorAll(".d2h-diff-tbody tr.cedar-diff-comment-row").forEach((row) => {
    if (!(row instanceof HTMLElement)) return;
    /** @type {ReviewComment[] | undefined} */
    let items;
    let anchorLine = 0;
    let anchorSide = "RIGHT";
    for (const [key, list] of byAnchor.entries()) {
      const [, lineStr, side] = key.split("\0");
      const line = Number(lineStr);
      if (!Number.isFinite(line)) continue;
      if (rowMatchesCommentAnchor(row, line, side)) {
        items = list;
        anchorLine = line;
        anchorSide = side;
        break;
      }
    }
    if (!items?.length) return;

    if (sideBySide) {
      const paneSide = diffRowSidePane(row);
      if (anchorSide === "RIGHT" && paneSide === "LEFT") return;
      if (anchorSide === "LEFT" && paneSide === "RIGHT") return;
    }

    const anchorKey = commentAnchorKey(path, anchorLine, anchorSide);
    if (paintedAnchors.has(anchorKey)) return;
    paintedAnchors.add(anchorKey);

    row.classList.add("cedar-diff-line-commented");
    const colCount = diffTableColCount(row);
    const sidePane = diffRowInSidePane(row);
    const threadRow = document.createElement("tr");
    threadRow.className = "cedar-diff-comment-thread-row";
    threadRow.dataset.anchorSide = anchorSide;
    const td = document.createElement("td");
    if (sideBySide && sidePane && colCount <= 2) {
      const pad = document.createElement("td");
      pad.className = "cedar-diff-comment-thread-pad";
      pad.setAttribute("aria-hidden", "true");
      threadRow.appendChild(pad);
      td.colSpan = 1;
    } else {
      td.colSpan = sideBySide ? colCount : Math.max(colCount, 4);
    }
    td.className = "cedar-diff-comment-thread-cell";
    const cursorOnly = isCursorInlineThread(items);
    const startCollapsed = !expandedKeys.has(anchorKey) && !inlineCommentsOn;
    td.innerHTML = renderCommentThreadSlide(items, { startCollapsed });
    if (cursorOnly) threadRow.dataset.cursorThread = "1";
    threadRow.dataset.cedarCommentMarker = "1";
    threadRow.appendChild(td);
    threadRow.dataset.sourceRow = "1";
    row.insertAdjacentElement("afterend", threadRow);
    const findingNumber = items.find((c) => c.findingNumber)?.findingNumber;
    setGutterCommentCount(row, items.length, {
      cursorThread: cursorOnly,
      findingNumber: typeof findingNumber === "number" ? findingNumber : undefined,
    });
    if (startCollapsed) {
      setThreadRowExpanded(threadRow, false);
    } else {
      syncGutterBadgeForRow(row, threadRow, body.closest(".cedar-gh-files-changed"));
    }
  });

  wireCommentThreads(body);
  wireFindingActions(body, () => {
    const root = body.closest("#results") ?? document.getElementById("results");
    if (root instanceof HTMLElement) repaintAllDiffComments(root);
    window.__cedarPatchFindings?.();
  });
  if (filesHost instanceof HTMLElement) {
    applyCommentsHostVisibility(filesHost);
  }
}

/**
 * @param {ParentNode} root
 */
export function repaintAllDiffComments(root) {
  const comments = getCommentsForDiffPaint();
  root.querySelectorAll("[data-file-body]").forEach((body) => {
    if (!(body instanceof HTMLElement)) return;
    const path = body.closest("[data-file-review]")?.getAttribute("data-file-path");
    if (!path) return;
    paintCommentsForBody(body, comments, path);
  });
  root.querySelectorAll(".cedar-gh-files-changed").forEach((host) => {
    if (host instanceof HTMLElement) applyCommentsHostVisibility(host);
  });
}

/**
 * Scroll to a file/line in the diff and expand inline review threads when present.
 * @param {ParentNode} root
 * @param {{ path: string, line?: number, findingKey?: string }} target
 */
export function focusDiffFinding(root, target) {
  const path = String(target.path ?? "").trim();
  if (!path) return false;
  const line = Number(target.line);
  const findingKey = target.findingKey ? String(target.findingKey) : "";

  const article = root.querySelector(
    `[data-file-review][data-file-path="${CSS.escape(path)}"]`
  );
  if (!(article instanceof HTMLElement)) return false;

  article.scrollIntoView({ behavior: "smooth", block: "start" });
  const body = article.querySelector("[data-file-body]");
  if (!(body instanceof HTMLElement)) return false;

  /** @type {HTMLElement | null} */
  let codeRow = null;
  if (Number.isFinite(line) && line > 0) {
    const sideBySide = diffIsSideBySide(body);
    for (const row of body.querySelectorAll(".d2h-diff-tbody tr.cedar-diff-comment-row, .d2h-diff-tbody tr")) {
      if (!(row instanceof HTMLElement)) continue;
      if (!rowMatchesCommentAnchor(row, line, "RIGHT")) continue;
      if (sideBySide && diffRowSidePane(row) === "LEFT") continue;
      codeRow = row;
      break;
    }
  }

  /** @param {HTMLElement} threadRow */
  const expandThreadAt = (threadRow) => {
    setThreadRowExpanded(threadRow, true);
    if (findingKey) {
      const card = threadRow.querySelector(`[data-finding-key="${CSS.escape(findingKey)}"]`);
      if (card instanceof HTMLElement) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        card.classList.add("cedar-diff-finding-card-focus");
        window.setTimeout(() => card.classList.remove("cedar-diff-finding-card-focus"), 2400);
      }
    }
  };

  if (codeRow instanceof HTMLElement) {
    codeRow.scrollIntoView({ behavior: "smooth", block: "center" });
    codeRow.classList.add("cedar-diff-line-focus");
    window.setTimeout(() => codeRow?.classList.remove("cedar-diff-line-focus"), 2400);
    const threadRow = codeRow.nextElementSibling;
    if (threadRow instanceof HTMLElement && threadRow.classList.contains("cedar-diff-comment-thread-row")) {
      expandThreadAt(threadRow);
    }
    return true;
  }

  if (findingKey) {
    const card = body.querySelector(`[data-finding-key="${CSS.escape(findingKey)}"]`);
    const threadRow = card?.closest(".cedar-diff-comment-thread-row");
    if (threadRow instanceof HTMLElement) {
      const prev = threadRow.previousElementSibling;
      if (prev instanceof HTMLElement) {
        prev.scrollIntoView({ behavior: "smooth", block: "center" });
        prev.classList.add("cedar-diff-line-focus");
        window.setTimeout(() => prev.classList.remove("cedar-diff-line-focus"), 2400);
      }
      expandThreadAt(threadRow);
      return true;
    }
  }

  return true;
}

/** Global toast hook set from app.js */
export let showCommentToast = /** @type {(message: string, tone?: string) => void} */ (
  (message, tone) => {
    console.warn("[cedar]", tone ?? "info", message);
  }
);

/**
 * @param {(message: string, tone?: string) => void} fn
 */
export function setCommentToast(fn) {
  showCommentToast = fn;
}

function wirePopoverOnce() {
  const el = ensurePopover();
  if (el.dataset.wired) return;
  el.dataset.wired = "1";

  el.querySelector(".cedar-diff-comment-cancel")?.addEventListener("click", closePopover);
  el.querySelector(".cedar-diff-comment-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitActiveComment();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && popover && !popover.hidden) closePopover();
  });

  document.addEventListener(
    "click",
    (ev) => {
      if (!popover || popover.hidden) return;
      if (ev.target instanceof Node && popover.contains(ev.target)) return;
      if (ev.target instanceof HTMLElement && ev.target.closest(".cedar-diff-gutter, .cedar-diff-add-comment")) return;
      closePopover();
    },
    true
  );
}

/**
 * @param {HTMLElement} row
 */
function isCommentableDiffRow(row) {
  if (row.querySelector(".d2h-info, .d2h-emptyplaceholder, .d2h-code-side-emptyplaceholder")) return false;
  if (row.querySelector(".d2h-code-line-ctn, .d2h-code-side-line")) return true;
  return Boolean(row.querySelector("td.d2h-ins, td.d2h-del, td.d2h-cntx, td.d2h-change"));
}

/**
 * @param {HTMLElement} body
 */
function wireDiffBodyComments(body) {
  const article = body.closest("[data-file-review]");
  const path = article?.getAttribute("data-file-path");
  if (!path) return;

  body.querySelectorAll(".d2h-diff-tbody tr").forEach((row) => {
    if (!(row instanceof HTMLElement)) return;
    if (!isCommentableDiffRow(row)) return;
    if (row.dataset.cedarCommentRow) return;
    row.dataset.cedarCommentRow = "1";
    row.classList.add("cedar-diff-comment-row");

    row.querySelectorAll(".d2h-code-linenumber, .d2h-code-side-linenumber").forEach((gutter) => {
      if (gutter instanceof HTMLElement) gutter.classList.add("cedar-diff-gutter");
    });

  const resolvedLine = resolveLineFromRow(row);
  const leftGutter = gutterForCommentAnchor(row, resolvedLine?.side === "LEFT" ? "LEFT" : "RIGHT");
  if (leftGutter instanceof HTMLElement && !leftGutter.querySelector(".cedar-diff-add-comment")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cedar-diff-add-comment";
    btn.title = "Add review comment";
    btn.setAttribute("aria-label", "Add review comment");
    btn.textContent = "+";
    leftGutter.appendChild(btn);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCommentPopoverForRow(row, path);
    });
  }

    const openFromRow = (ev) => {
      if (ev.target instanceof HTMLElement && ev.target.closest(".cedar-diff-add-comment")) return;
      if (ev.target instanceof HTMLElement && ev.target.closest(".cedar-diff-comment-gutter-count")) {
        return;
      }
      const filesHost = row.closest(".cedar-gh-files-changed");
      const globalCommentsOn =
        filesHost instanceof HTMLElement && commentsHostVisible(filesHost);
      const gutterCountOnly =
        row.classList.contains("cedar-diff-gutter-count-visible") && !globalCommentsOn;
      if (
        filesHost instanceof HTMLElement &&
        (globalCommentsOn || gutterCountOnly) &&
        row.classList.contains("cedar-diff-line-commented") &&
        row.nextElementSibling?.classList.contains("cedar-diff-comment-thread-row") &&
        !(ev.target instanceof HTMLElement && ev.target.closest(".cedar-diff-add-comment"))
      ) {
        const onGutter = ev.target instanceof HTMLElement && ev.target.closest(".d2h-code-linenumber, .d2h-code-side-linenumber");
        const onCode = ev.target instanceof HTMLElement && ev.target.closest(".d2h-code-line-ctn");
        if (onGutter || onCode) {
          ev.preventDefault();
          ev.stopPropagation();
          toggleThreadForCodeRow(row);
          return;
        }
      }
      const onGutter = ev.target instanceof HTMLElement && ev.target.closest(".d2h-code-linenumber, .d2h-code-side-linenumber");
      const onCode = ev.target instanceof HTMLElement && ev.target.closest(".d2h-code-line-ctn");
      if (!onGutter && !onCode) return;
      ev.preventDefault();
      ev.stopPropagation();
      openCommentPopoverForRow(row, path);
    };

    row.addEventListener("click", openFromRow);
  });
}

/**
 * @param {ParentNode} root
 */
export function wireDiffComments(root) {
  wirePopoverOnce();
  wireCommentVisibilityOnce();
  root.querySelectorAll("[data-file-body]").forEach((body) => {
    if (!(body instanceof HTMLElement)) return;
    wireDiffBodyComments(body);
    const path = body.closest("[data-file-review]")?.getAttribute("data-file-path");
    if (path) {
      const merged = getCommentsForDiffPaint();
      if (merged.length) paintCommentsForBody(body, merged, path);
    }
  });
}

/**
 * @param {ParentNode} root
 */
export async function loadDiffReviewComments(root) {
  const session = /** @type {CedarSession | undefined} */ (window.__cedarSession);
  if (!session) return;

  try {
    const res = await fetch("/api/comments/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prUrl: session.prUrl,
        token: session.token,
        owner: session.data.target?.owner,
        repo: session.data.target?.repo,
        pr: session.data.target?.pr,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = [json.error, json.hint, json.githubMessage].filter(Boolean).join("\n\n");
      throw new Error(msg || "Could not load comments");
    }
    session.reviewComments = json.comments ?? [];
    repaintAllDiffComments(root);
  } catch (err) {
    showCommentToast(err instanceof Error ? err.message : String(err), "error");
  }
}