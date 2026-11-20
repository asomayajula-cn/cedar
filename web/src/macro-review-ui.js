import { FINDING_TAG_CLASS, getFindingMeta } from "../../src/finding-meta.js";

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {{ tag?: string, priority?: string, ruleId?: string, severity?: string }} f
 */
function renderMacroFindingMeta(f) {
  const meta = getFindingMeta(f.ruleId, f.severity);
  const tag = f.tag ?? meta.tag;
  const tagLabel = meta.tagLabel;
  const priority = f.priority ?? meta.priority;
  const tagClass = FINDING_TAG_CLASS[tag] ?? "cedar-finding-tag-quality";
  return `<span class="cedar-finding-priority">${priority}</span>
    <span class="cedar-finding-tag ${tagClass}">${escapeHtml(tagLabel)}</span>`;
}

/**
 * @param {{ body?: string, event?: string, priority?: string, findings?: Array<{ message?: string, tag?: string, priority?: string, ruleId?: string, severity?: string }>, source?: string }} macroReview
 * @param {{ cursorReviewPending?: boolean, cursorReviewSummary?: { available?: boolean, enabled?: boolean, slicePassRan?: boolean }, serverHealth?: { hasCursor?: boolean, sliceReviewAvailable?: boolean } }} [ctx]
 */
export function renderMacroReviewPanelHtml(macroReview, ctx = {}) {
  if (!macroReview?.body?.trim() && !(macroReview?.findings?.length)) {
    const summary = ctx.cursorReviewSummary;
    const health = ctx.serverHealth ?? (typeof window !== "undefined" ? window.__cedarServerHealth : null);
    const pending = ctx.cursorReviewPending === true;
    const hasCursor = Boolean(
      summary?.available ||
        summary?.enabled ||
        health?.hasCursor ||
        health?.sliceReviewAvailable
    );

    let hint =
      'PR-wide themes and recommendation from Composer — macro runs <strong class="font-medium text-zinc-400">before</strong> per-slice Cursor review. Set <span class="font-mono text-zinc-600">CURSOR_API_KEY</span> (Configuration or <span class="font-mono text-zinc-600">.env</span>) and run <strong class="font-medium text-zinc-400">Start review</strong>.';

    if (pending) {
      hint =
        'Macro review runs <strong class="font-medium text-zinc-400">first</strong> in the background, then slice review — watch the progress bar above. Themes will appear here when Composer finishes.';
    } else if (hasCursor) {
      if (summary?.slicePassRan) {
        hint =
          'Cursor finished slice review but returned no PR-wide macro comment. Check the progress log for errors and run <strong class="font-medium text-zinc-400">Start review</strong> again, or confirm macro review was not blocked.';
      } else {
        hint =
          'Cursor key is loaded. Enable per-slice review and run <strong class="font-medium text-zinc-400">Start review</strong> — macro themes run automatically before slice review.';
      }
    }

    return `<section class="cedar-glass-subtle cedar-macro-review mb-6 px-5 py-4" aria-labelledby="cedar-macro-review-heading">
      <h2 id="cedar-macro-review-heading" class="text-sm font-semibold text-white">Cursor · macro review (entire PR)</h2>
      <p class="mt-2 text-xs leading-relaxed text-zinc-500">${hint}</p>
    </section>`;
  }

  const event = macroReview.event ?? "COMMENT";
  const eventLabel =
    event === "APPROVE" ? "Suggests approve" : event === "REQUEST_CHANGES" ? "Suggests changes" : "Review comment";

  const findingCards = (macroReview.findings ?? [])
    .map(
      (f) => `<li class="cedar-review-comment-card cedar-glass-subtle px-3 py-2.5">
        <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span class="cedar-badge cedar-badge-ok text-[9px]">Cursor</span>
          ${renderMacroFindingMeta(f)}
        </div>
        <p class="cedar-review-comment-body text-sm leading-relaxed text-zinc-200">${escapeHtml(f.message ?? "")}</p>
      </li>`
    )
    .join("");

  const findingsBlock = findingCards
    ? `<details class="mt-4 group" open>
        <summary class="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-300">Cursor macro findings (${macroReview.findings.length})</summary>
        <ul class="mt-3 space-y-2">${findingCards}</ul>
      </details>`
    : "";

  const bodyBlock = macroReview.body?.trim()
    ? `<details class="mt-3 group" open>
        <summary class="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-300">Full PR review comment (post to GitHub)</summary>
        <pre class="cedar-macro-review-body mt-3 max-h-[min(38vh,26rem)] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">${escapeHtml(macroReview.body)}</pre>
      </details>`
    : "";

  return `<section class="cedar-glass-subtle cedar-macro-review mb-6 px-5 py-4" aria-labelledby="cedar-macro-review-heading">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="cedar-macro-review-heading" class="text-sm font-semibold text-white">Cursor · macro review (entire PR)</h2>
        <p class="mt-1 text-[10px] text-zinc-500">PR-wide findings + one review comment · slice line comments are below</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="cedar-badge cedar-badge-ok text-[9px]">Cursor</span>
        <span class="cedar-badge cedar-badge-muted text-[9px]">${escapeHtml(eventLabel)}</span>
        ${macroReview.priority ? `<span class="cedar-finding-priority text-[10px]">${escapeHtml(macroReview.priority)}</span>` : ""}
        ${
          macroReview.body?.trim()
            ? `<button type="button" id="post-macro-review-btn" class="cedar-btn-secondary cedar-btn-compact" data-macro-event="${escapeHtml(event)}"
          title="Post the full macro comment as a GitHub PR review">Post PR comment</button>`
            : ""
        }
      </div>
    </div>
    ${findingsBlock}
    ${bodyBlock}
  </section>`;
}