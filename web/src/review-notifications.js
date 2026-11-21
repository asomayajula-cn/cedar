import { refreshReviewIconSvg } from "./cedar-icons.js";
import { cedarMarkSvg } from "./cedar-logo.js";

/**
 * @typedef {"info" | "success" | "warning" | "error" | "neutral"} NotificationTone
 * @typedef {{ label: string, primary?: boolean, onClick?: () => void, dismiss?: boolean }} NotificationAction
 * @typedef {{ title: string, message?: string, tone?: NotificationTone, actions?: NotificationAction[], durationMs?: number, icon?: "refresh" | "info" }} NotificationOpts
 */

const TONE = {
  info: { accent: "59 130 246", label: "Info" },
  success: { accent: "52 211 153", label: "Updated" },
  warning: { accent: "251 191 36", label: "Review" },
  error: { accent: "251 113 133", label: "Error" },
  neutral: { accent: "161 161 170", label: "Cedar" },
};

const MAX_STACK = 4;

/**
 * @param {HTMLElement} el
 */
function dismissNotification(el) {
  el.classList.add("is-leaving");
  window.setTimeout(() => el.remove(), 280);
}

function closeIconSvg() {
  return `<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
}

/**
 * @param {NotificationOpts} opts
 */
export function showOutlookNotification(opts) {
  const host = document.getElementById("toast-host");
  if (!host) return;

  const tone = opts.tone ?? "info";
  const palette = TONE[tone] ?? TONE.info;
  const el = document.createElement("article");
  el.className = `cedar-notif cedar-notif--${tone}`;
  el.setAttribute("role", "status");
  el.style.setProperty("--cedar-notif-accent", `rgb(${palette.accent})`);
  el.style.setProperty("--cedar-notif-accent-soft", `rgb(${palette.accent} / 0.14)`);

  const badgeIcon =
    opts.icon === "refresh"
      ? refreshReviewIconSvg("h-4 w-4")
      : tone === "success"
        ? checkIconSvg()
        : tone === "warning"
          ? refreshReviewIconSvg("h-4 w-4")
          : cedarMarkSvg("h-4 w-4");

  const actions = opts.actions ?? [];
  const actionsHtml = actions.length
    ? `<div class="cedar-notif-actions" role="group" aria-label="Actions">${actions
        .map((a, i) => {
          const cls = a.primary ? "cedar-notif-action cedar-notif-action--primary" : "cedar-notif-action";
          return `<button type="button" class="${cls}" data-notif-action="${i}">${escapeHtml(a.label)}</button>`;
        })
        .join("")}</div>`
    : "";

  const ms = opts.durationMs ?? (actions.length ? 14_000 : 7_000);

  el.innerHTML = `
    <header class="cedar-notif-head">
      <div class="cedar-notif-brand">
        <span class="cedar-notif-badge" aria-hidden="true">${badgeIcon}</span>
        <div class="cedar-notif-meta">
          <span class="cedar-notif-app">Cedar</span>
          <span class="cedar-notif-tag">${escapeHtml(palette.label)}</span>
        </div>
      </div>
      <button type="button" class="cedar-notif-close" aria-label="Dismiss">${closeIconSvg()}</button>
    </header>
    <div class="cedar-notif-body">
      <p class="cedar-notif-title">${escapeHtml(opts.title)}</p>
      ${opts.message ? `<p class="cedar-notif-message">${escapeHtml(opts.message)}</p>` : ""}
    </div>
    ${actionsHtml}
    <div class="cedar-notif-progress" aria-hidden="true"><span style="animation-duration:${ms}ms"></span></div>
  `;

  const progressBar = el.querySelector(".cedar-notif-progress span");
  el.addEventListener("mouseenter", () => {
    if (progressBar instanceof HTMLElement) progressBar.style.animationPlayState = "paused";
  });
  el.addEventListener("mouseleave", () => {
    if (progressBar instanceof HTMLElement) progressBar.style.animationPlayState = "running";
  });

  el.querySelector(".cedar-notif-close")?.addEventListener("click", () => dismissNotification(el));

  actions.forEach((a, i) => {
    const btn = el.querySelector(`[data-notif-action="${i}"]`);
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.addEventListener("click", () => {
      if (a.dismiss !== false) dismissNotification(el);
      a.onClick?.();
    });
  });

  while (host.children.length >= MAX_STACK) {
    host.lastElementChild?.remove();
  }

  host.prepend(el);

  if (ms > 0) {
    window.setTimeout(() => {
      if (el.isConnected) dismissNotification(el);
    }, ms);
  }
}

function checkIconSvg() {
  return `<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 12.5l3.5 3.5L18 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} message
 * @param {NotificationTone} [tone]
 */
export function showSimpleNotification(message, tone = "neutral") {
  const title =
    tone === "error" ? "Something went wrong" : tone === "success" ? "Done" : tone === "warning" ? "Attention" : "Cedar";
  showOutlookNotification({ title, message, tone, durationMs: 5500 });
}