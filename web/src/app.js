import { cedarMarkSvg } from "./cedar-logo.js";
import { mountArchitectureGraphs } from "./architecture-canvas.js";
import { buildDiagramGraph } from "../../src/diagram-graph.js";
import { renderSliceFileReviews, wireFileReviewToggles } from "./diff-view.js";
import { mountLayoutMermaid } from "./diagram-ux.js";
import { applyReviewStreamEvent, postReviewStream } from "./review-stream.js";

const statusDot = {
  passed: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]",
  failed: "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.45)]",
  skipped: "bg-zinc-600",
};

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
  const host = document.getElementById("toast-host");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `cedar-toast ${tone === "error" ? "border-rose-500/30 text-rose-100" : ""}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4800);
}

export function mountApp(root) {
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
            <span class="rounded-lg px-3 py-1.5 text-zinc-300">Micro slices</span>
            <span class="text-zinc-700">·</span>
            <span class="px-3 py-1.5">Architecture</span>
            <span class="text-zinc-700">·</span>
            <span class="px-3 py-1.5">Approve</span>
          </nav>
          <div id="health-pill" class="cedar-badge cedar-badge-muted">Checking…</div>
        </div>
      </header>

      <main id="main-stage" class="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
        <section id="hero" class="cedar-fade-in mx-auto max-w-xl">
          <div class="text-center">
            <div class="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white shadow-[0_0_40px_-12px_rgba(255,255,255,0.25)]">
              ${cedarMarkSvg("h-8 w-8")}
            </div>
            <p class="cedar-label">Professional PR review</p>
            <h1 class="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-[2.75rem] sm:leading-[1.1]">
              Review the architecture,<br class="hidden sm:block" /> not just the diff
            </h1>
            <p class="mx-auto mt-5 max-w-md text-base leading-relaxed text-zinc-400">
              Cedar splits each pull request into micro slices, reviews them independently, and delivers a whole-picture composite with an architecture diagram.
            </p>
          </div>

          <form id="review-form" class="cedar-glass mt-10 p-6 sm:p-8">
            <label class="cedar-label">GitHub pull request URL</label>
            <input name="prUrl" required inputmode="url" autocomplete="url"
              placeholder="https://github.com/owner/repo/pull/42"
              class="cedar-input mt-3 font-mono text-[13px]" />
            <details class="mt-5 group">
              <summary class="cursor-pointer list-none text-sm font-medium text-zinc-500 transition hover:text-zinc-300">
                <span class="group-open:hidden">Advanced options</span>
                <span class="hidden group-open:inline">Hide options</span>
              </summary>
              <div class="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
                <label class="block">
                  <span class="text-xs text-zinc-500">GitHub token (optional)</span>
                  <input name="token" type="password" autocomplete="off" placeholder="Uses server credentials if empty"
                    class="cedar-input mt-2 font-mono text-xs" />
                </label>
                <div class="flex flex-wrap gap-6 text-xs text-zinc-400">
                  <label class="flex cursor-pointer items-center gap-2"><input type="checkbox" name="postMicro" class="rounded border-white/20 bg-black" /> Post micro-reviews to GitHub</label>
                  <label class="flex cursor-pointer items-center gap-2"><input type="checkbox" name="post" class="rounded border-white/20 bg-black" /> Post composite review</label>
                </div>
              </div>
            </details>
            <div class="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <button type="submit" id="submit-btn" class="cedar-btn-primary w-full sm:w-auto">
                <span id="submit-label">Start review</span>
              </button>
              <p class="text-center text-xs text-zinc-600 sm:text-left">Typically 30–90s depending on PR size</p>
            </div>
          </form>
          <p id="form-error" class="mt-4 hidden text-center text-sm text-rose-400"></p>
        </section>

        <section id="results" class="hidden cedar-fade-in"></section>
      </main>
    </div>
  `;

  void refreshHealth();
  document.getElementById("review-form").addEventListener("submit", onSubmit);

  const params = new URLSearchParams(window.location.search);
  const prFromQuery = params.get("pr") ?? params.get("url");
  if (prFromQuery) {
    const input = document.querySelector('input[name="prUrl"]');
    if (input) input.value = prFromQuery;
  }
}

async function refreshHealth() {
  const pill = document.getElementById("health-pill");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data.hasToken && (data.hasCursor || data.hasOpenRouter)) {
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

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const payload = {
    prUrl: String(fd.get("prUrl")).trim(),
    token: String(fd.get("token") || "").trim() || undefined,
    post: fd.get("post") === "on",
    postMicro: fd.get("postMicro") === "on",
  };

  const errorEl = document.getElementById("form-error");
  const btn = document.getElementById("submit-btn");
  const label = document.getElementById("submit-label");
  const hero = document.getElementById("hero");
  const results = document.getElementById("results");

  errorEl.classList.add("hidden");
  btn.disabled = true;
  label.innerHTML = '<span class="cedar-spinner"></span><span class="ml-2">Connecting…</span>';
  hero.classList.add("hidden");
  results.classList.remove("hidden");
  results.innerHTML = loadingSkeleton();

  try {
    const statusEl = document.getElementById("review-progress-status");
    const logEl = document.getElementById("review-progress-log");
    const onStream = (event) => {
      applyReviewStreamEvent(event, statusEl, logEl);
      if (event?.type === "activity" && event.text) {
        label.innerHTML = `<span class="cedar-spinner"></span><span class="ml-2">${escapeHtml(String(event.text))}</span>`;
      } else if (event?.type === "phase" && event.status === "running") {
        label.innerHTML = `<span class="cedar-spinner"></span><span class="ml-2">${escapeHtml(String(event.label ?? "Working…"))}</span>`;
      }
    };
    const data = await postReviewStream(payload, onStream);

    const filePatches = new Map();
    for (const m of data.microPrs ?? []) {
      for (const f of m.files ?? []) {
        if (f.patch) filePatches.set(`${m.componentId}::${f.path}`, f.patch);
      }
    }

    window.__cedarSession = {
      prUrl: payload.prUrl,
      token: payload.token,
      data,
      sliceApprovals: new Set(),
      filePatches,
    };

    renderResults(results, data);
    bindApproveHandlers(results);
  } catch (err) {
    results.innerHTML = "";
    results.classList.add("hidden");
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.classList.remove("hidden");
    showToast(errorEl.textContent, "error");
  } finally {
    btn.disabled = false;
    label.textContent = "Start review";
  }
}

function loadingSkeleton() {
  return `
    <div id="review-progress-panel" class="cedar-glass p-6 sm:p-8">
      <p class="cedar-label">Review in progress</p>
      <p id="review-progress-status" class="mt-3 text-sm font-medium text-zinc-200">Connecting…</p>
      <ul id="review-progress-log" class="review-progress-log mt-4 max-h-56 space-y-1 overflow-y-auto text-xs text-zinc-500" aria-live="polite"></ul>
    </div>`;
}

let sliceApprovals = new Set();

function mergeConfidence(gate, microResults) {
  const blockers = microResults.reduce((n, r) => n + r.findings.filter((f) => f.severity === "blocker").length, 0);
  const warnings = microResults.reduce((n, r) => n + r.findings.filter((f) => f.severity === "warning").length, 0);
  if (blockers > 0) return { score: 1, label: "High risk", color: "text-rose-400" };
  if (!gate.ready) return { score: 2, label: "In progress", color: "text-amber-300" };
  if (warnings > 3) return { score: 3, label: "Review carefully", color: "text-amber-200" };
  if (warnings > 0) return { score: 4, label: "Likely safe", color: "text-emerald-300" };
  return { score: 5, label: "Safe to merge", color: "text-emerald-400" };
}

function severityClass(sev) {
  if (sev === "blocker") return "severity-blocker";
  if (sev === "warning") return "severity-warning";
  return "severity-info";
}

function cyToolbar(targetId, badge = "") {
  return `<div class="diagram-toolbar flex flex-wrap items-center gap-1.5">
    <span class="cedar-label mb-0">View</span>
    <button type="button" class="diagram-tool-btn" data-cy-action="in" data-cy-target="${targetId}" title="Zoom in">+</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="out" data-cy-target="${targetId}" title="Zoom out">−</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="fit" data-cy-target="${targetId}" title="Fit">Fit</button>
    ${badge}
  </div>`;
}

function virtualPrLabel(target, pull, componentId, index, total) {
  const repo = target?.owner && target?.repo ? `${target.owner}/${target.repo}` : "repository";
  return {
    id: `vpr-${pull.number}-${componentId}`,
    title: `Virtual micro-PR ${index} of ${total}`,
    slug: `${repo}#${pull.number} · slice \`${componentId}\``,
  };
}

function renderResults(container, data) {
  const { pull, gate, microPrs, microResults, composite, breakouts, partition, process, target } = data;
  sliceApprovals = window.__cedarSession?.sliceApprovals ?? sliceApprovals;

  const confidence = mergeConfidence(gate, microResults);
  const touched = microResults.filter((r) => r.status !== "skipped");
  const approvedCount = touched.filter((r) => sliceApprovals.has(r.componentId)).length;
  const allSlicesApproved = touched.length > 0 && approvedCount === touched.length;
  const canApprovePr = gate.ready && allSlicesApproved;
  const approvePct = touched.length ? Math.round((approvedCount / touched.length) * 100) : 0;
  const sliceTotal = touched.length || microResults.length;

  const sidebarSlices = microResults
    .filter((r) => r.status !== "skipped")
    .map((r, i) => {
      const micro = microPrs.find((m) => m.componentId === r.componentId);
      const approved = sliceApprovals.has(r.componentId);
      const vpr = virtualPrLabel(target, pull, r.componentId, i + 1, sliceTotal);
      return `
        <button type="button" data-scroll-slice="${escapeHtml(r.componentId)}"
          class="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]">
          <span class="flex items-center gap-2">
            <span class="h-2 w-2 shrink-0 rounded-full ${statusDot[r.status] ?? statusDot.skipped}"></span>
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">${escapeHtml(r.componentName)}</span>
            ${approved ? '<span class="text-emerald-400">✓</span>' : ""}
          </span>
          <span class="pl-4 font-mono text-[10px] text-zinc-600">${escapeHtml(vpr.id)} · ${micro?.fileCount ?? r.filesReviewed} files</span>
        </button>`;
    })
    .join("");

  const processList = (process ?? [])
    .map((step, i) => {
      const done = step.status === "done";
      const blocked = step.status === "blocked";
      return `
        <li class="flex gap-3 text-xs">
          <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
            done ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : blocked ? "border-rose-500/40 text-rose-300" : "border-white/10 text-zinc-500"
          }">${i + 1}</span>
          <span>
            <span class="font-medium text-zinc-200">${escapeHtml(step.label)}</span>
            <span class="block text-zinc-600">${escapeHtml(step.detail ?? step.status)}</span>
          </span>
        </li>`;
    })
    .join("");

  const archSliceCount = microPrs.filter((m) => (m.files?.length ?? m.fileCount ?? 0) > 0).length;
  const diagramMermaid = breakouts?.diagramMermaid ?? "";
  const showArchitectureSection = archSliceCount > 0 || Boolean(diagramMermaid.trim());
  const architectureReadSummary = (
    breakouts?.architectureVisual?.summary ??
    breakouts?.diagramGraph?.meta?.visualSummary ??
    ""
  ).trim();
  const architectureReadNotes =
    breakouts?.architectureVisual?.conceptualNotes ?? breakouts?.diagramGraph?.meta?.conceptualNotes ?? [];

  const slicePanels = microResults
    .filter((r) => r.status !== "skipped")
    .map((r, i) => {
      const micro = microPrs.find((m) => m.componentId === r.componentId);
      const rationale = micro?.rationale ?? micro?.description;
      const blockers = r.findings.filter((f) => f.severity === "blocker").length;
      const warnings = r.findings.filter((f) => f.severity === "warning").length;
      const canApprove = r.status === "passed" || r.status === "skipped";
      const approved = sliceApprovals.has(r.componentId);
      const vpr = virtualPrLabel(target, pull, r.componentId, i + 1, sliceTotal);
      const fileList = micro?.files ?? [];

      const findings =
        r.findings.length === 0
          ? `<p class="text-sm italic text-zinc-600">Clean virtual PR — no findings.</p>`
          : `<ul class="space-y-2">${r.findings
              .slice(0, 12)
              .map(
                (f) => `<li class="cedar-glass-subtle px-4 py-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="${severityClass(f.severity)}">${f.severity}</span>
                  ${f.filename ? `<span class="font-mono text-[11px] text-zinc-500">${escapeHtml(f.filename)}</span>` : ""}
                </div>
                <p class="mt-2 text-sm leading-relaxed text-zinc-300">${escapeHtml(f.message)}</p>
              </li>`
              )
              .join("")}</ul>`;

      return `
        <article id="slice-${escapeHtml(r.componentId)}" class="cedar-glass scroll-mt-24 overflow-hidden" data-virtual-pr="${escapeHtml(vpr.id)}">
          <div class="border-b border-white/[0.06] bg-white/[0.02] px-6 py-4">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="cedar-label">Virtual micro-PR</p>
                <p class="mt-1 font-mono text-xs text-zinc-500">${escapeHtml(vpr.id)}</p>
                <h3 class="mt-2 text-lg font-semibold text-white">${escapeHtml(r.componentName)}</h3>
                <p class="mt-1 font-mono text-xs text-zinc-500">${escapeHtml(vpr.slug)}</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span class="cedar-badge cedar-badge-muted">${vpr.title}</span>
                  <span class="cedar-badge cedar-badge-muted">${statusLabel[r.status] ?? r.status}</span>
                  <span class="cedar-badge cedar-badge-muted">+${micro?.additions ?? 0} / −${micro?.deletions ?? 0}</span>
                  <span class="cedar-badge cedar-badge-muted">${fileList.length} files</span>
                  ${blockers ? `<span class="cedar-badge border-rose-500/30 bg-rose-500/10 text-rose-200">${blockers} blockers</span>` : ""}
                  ${warnings ? `<span class="cedar-badge cedar-badge-warn">${warnings} warnings</span>` : ""}
                  ${approved ? `<span class="cedar-badge cedar-badge-ok">Approved</span>` : ""}
                </div>
                ${rationale ? `<p class="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">${escapeHtml(rationale)}</p>` : ""}
              </div>
              <button type="button" data-approve-slice="${escapeHtml(r.componentId)}" data-component-name="${escapeHtml(r.componentName)}"
                ${!canApprove || approved ? "disabled" : ""}
                class="cedar-btn-primary shrink-0 ${approved ? "!bg-emerald-600 !text-white" : ""}">
                ${approved ? "Virtual PR approved" : canApprove ? "Approve virtual PR" : "Resolve blockers"}
              </button>
            </div>
          </div>
          <div class="space-y-6 p-6">
            ${renderSliceFileReviews(fileList, pull.url)}
            <div>
              <p class="cedar-label mb-3">Review findings</p>
              ${findings}
            </div>
          </div>
        </article>`;
    })
    .join("");

  container.innerHTML = `
    <div class="cedar-glass mb-8 flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div class="min-w-0 flex-1">
        <p class="cedar-label">Pull request</p>
        <a href="${escapeHtml(pull.url)}" target="_blank" rel="noreferrer"
          class="mt-2 block text-xl font-semibold tracking-tight text-white hover:text-zinc-200">${escapeHtml(pull.title)}</a>
        <p class="mt-1 font-mono text-xs text-zinc-500">#${pull.number} · ${gate.headSha.slice(0, 7)} · ${escapeHtml(breakouts?.strategy ?? partition?.mode ?? "review")}</p>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex items-center gap-4 rounded-xl border border-white/[0.08] bg-black/40 px-5 py-3">
          <div class="text-center">
            <p class="cedar-label">Confidence</p>
            <p class="mt-1 text-3xl font-semibold tabular-nums ${confidence.color}">${confidence.score}<span class="text-lg text-zinc-600">/5</span></p>
            <p class="text-xs text-zinc-500">${confidence.label}</p>
          </div>
          <div class="h-12 w-px bg-white/10 max-sm:hidden"></div>
          <div class="text-center max-sm:w-full">
            <p class="cedar-label">Slices signed off</p>
            <p class="mt-1 text-lg font-semibold text-white">${approvedCount}<span class="text-zinc-600">/${touched.length}</span></p>
            <div class="mt-2 h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-emerald-500 transition-all" style="width:${approvePct}%"></div>
            </div>
          </div>
        </div>
        <button type="button" id="approve-pr-btn" ${canApprovePr ? "" : "disabled"} class="cedar-btn-primary">
          Approve on GitHub
        </button>
      </div>
    </div>

    ${
      showArchitectureSection
        ? `<section class="cedar-glass mb-8 p-4 sm:p-6" id="architecture-diagrams">
        <div class="flex flex-wrap items-end justify-between gap-2 border-b border-white/[0.06] pb-4">
          <div>
            <p class="cedar-label">Architecture</p>
            <p class="mt-1 text-sm text-zinc-400">
              Architectural slices · black &amp; white ·
              ${breakouts?.diagramVisualSource === "cursor" ? "labels &amp; layout by Cursor" : "partition slices"}
            </p>
          </div>
          <span class="cedar-badge cedar-badge-muted">${archSliceCount} slices</span>
        </div>
        ${
          archSliceCount > 0
            ? `<div class="mt-5">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p class="cedar-label mb-0">Overview</p>
            ${cyToolbar(
              "cedar-cy-slices",
              `<span class="cedar-badge cedar-badge-muted">${
                breakouts?.diagramVisualSource === "cursor" ? "Cursor layout" : "Minimal"
              }</span>`
            )}
          </div>
          <div id="cedar-cy-slices" class="cedar-cy-host diagram-slices" role="img" aria-label="Architecture slices"></div>
        </div>`
            : ""
        }
        ${
          diagramMermaid.trim()
            ? `<details class="mt-5 group">
            <summary class="cursor-pointer list-none text-xs font-medium text-zinc-500 hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
              <span class="cedar-label">Export flow (Mermaid)</span>
            </summary>
            <div class="mt-3" data-diagram-wrap data-diagram-panzoom>
              <div class="mb-2 flex justify-end gap-1.5" data-diagram-toolbar>
                <button type="button" class="diagram-tool-btn" data-diagram-action="reset" title="Fit">Fit</button>
              </div>
              <div class="diagram-complete-layout cedar-mermaid-scroll diagram-mermaid-sleek">
                <pre id="cedar-mermaid-layout" class="cedar-mermaid-source m-0"></pre>
              </div>
            </div>
          </details>`
            : ""
        }
      </section>`
        : ""
    }

    <div class="grid gap-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <aside class="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div class="cedar-glass p-4">
          <p class="cedar-label">Pipeline</p>
          <ul class="mt-4 space-y-3">${processList}</ul>
        </div>
        <div class="cedar-glass p-4">
          <p class="cedar-label">Micro slices</p>
          <div class="mt-3 space-y-0.5">${sidebarSlices}</div>
        </div>
        <p class="rounded-lg border px-3 py-2 text-xs ${gate.ready ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300/90" : "border-amber-500/20 bg-amber-500/5 text-amber-200/90"}">
          ${gate.ready ? "Composite review is ready." : escapeHtml(gate.blockedReason ?? "Composite pending.")}
        </p>
        <button type="button" id="new-review-btn" class="cedar-btn-secondary w-full text-xs">New review</button>
      </aside>

      <div class="space-y-8">
        ${
          breakouts?.architectureSummary
            ? `<section class="cedar-glass-subtle px-5 py-4">
            <p class="cedar-label">Summary · ${escapeHtml(String(breakouts.strategy ?? partition?.mode ?? ""))}</p>
            <p class="mt-2 text-sm leading-relaxed text-zinc-400">${escapeHtml(breakouts.architectureSummary)}</p>
          </section>`
            : ""
        }
        ${
          architectureReadSummary || architectureReadNotes.length || composite
            ? `<section class="cedar-glass p-6" id="architecture-read">
            <h2 class="text-sm font-semibold text-white">Architecture read</h2>
            ${
              architectureReadSummary
                ? `<p class="mt-4 max-w-3xl text-base leading-relaxed text-zinc-200">${escapeHtml(architectureReadSummary)}</p>`
                : !composite
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
              composite
                ? `<details class="mt-6 group"${architectureReadSummary ? "" : " open"}>
                <summary class="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-300">Complete composite markdown</summary>
                <pre class="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.04] bg-black/40 p-5 font-mono text-xs leading-relaxed text-zinc-400">${escapeHtml(composite.body)}</pre>
              </details>`
                : ""
            }
          </section>`
            : ""
        }
        <section>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-white">Review by slice</h2>
            <span class="text-xs text-zinc-600">${microResults.length} virtual micro-PRs</span>
          </div>
          <div class="space-y-5">${slicePanels}</div>
        </section>
        <p id="approve-status" class="hidden text-sm font-medium text-emerald-400"></p>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-scroll-slice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(`slice-${btn.getAttribute("data-scroll-slice")}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.getElementById("new-review-btn")?.addEventListener("click", () => {
    document.getElementById("hero")?.classList.remove("hidden");
    container.classList.add("hidden");
    container.innerHTML = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const renderMermaid = () => {
    if (!diagramMermaid.trim()) return;
    void mountLayoutMermaid(container, diagramMermaid).then((drew) => {
      if (!drew) showToast("Mermaid layout could not render.", "error");
    });
  };
  requestAnimationFrame(renderMermaid);
  container.querySelector("details summary")?.addEventListener("click", () => {
    requestAnimationFrame(() => requestAnimationFrame(renderMermaid));
  });

  if (archSliceCount > 0) {
    const graph =
      breakouts?.diagramGraph ??
      buildDiagramGraph(
        microPrs.map((m) => ({
          componentId: m.componentId,
          componentName: m.componentName,
          additions: m.additions,
          deletions: m.deletions,
          description: m.description,
          dependsOn: m.dependsOn ?? [],
          files: (m.files ?? []).map((f) => ({
            filename: f.path,
            additions: f.additions,
            deletions: f.deletions,
          })),
        })),
        breakouts,
        { number: pull.number, title: pull.title },
        { owner: target?.owner, repo: target?.repo }
      );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const drew = mountArchitectureGraphs(container, graph);
        if (!drew) showToast("Architecture diagram could not render.", "error");
      });
    });
  }

  wireFileReviewToggles(container);
}

function bindApproveHandlers(root) {
  root.querySelectorAll("[data-approve-slice]").forEach((btn) => {
    btn.addEventListener("click", () => void approveSlice(btn));
  });
  root.querySelector("#approve-pr-btn")?.addEventListener("click", () => void approveFullPr());
}

async function approveSlice(btn) {
  const session = window.__cedarSession;
  if (!session) return;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "Saving…";

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
        scope: "slice",
        componentId: btn.dataset.approveSlice,
        componentName: btn.dataset.componentName,
        headSha: session.data.pull.headSha,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(githubApiErrorMessage(body, res.statusText));
    session.sliceApprovals.add(btn.dataset.approveSlice);
    showToast(
      body.hint ? `Slice noted on GitHub · ${body.hint}` : `Slice approved · ${btn.dataset.componentName}`
    );
    const results = document.getElementById("results");
    renderResults(results, session.data);
    bindApproveHandlers(results);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = prev;
    showToast(err instanceof Error ? err.message : String(err), "error");
  }
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
      btn.textContent = "Approve on GitHub";
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