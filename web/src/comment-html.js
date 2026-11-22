import { marked } from "marked";

/** @type {Set<string>} */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "a",
  "span",
  "div",
  "hr",
]);

/** @type {Set<string>} */
const GLOBAL_STRIP_ATTRS = new Set(["style", "class", "id"]);

marked.setOptions({
  gfm: true,
  breaks: true,
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {string} raw
 */
function looksLikeMarkdown(raw) {
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s)|\*\*[^*]+\*\*|__[^_]+__|```|`[^`\n]+`/m.test(raw);
}

/**
 * @param {string} raw
 */
function looksLikeHtml(raw) {
  return /<(p|div|ul|ol|li|h[1-6]|strong|em|code|pre|blockquote|a|span|br)\b/i.test(raw);
}

/**
 * @param {Element} el
 */
function sanitizeElement(el) {
  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
    return;
  }

  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on") || GLOBAL_STRIP_ATTRS.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (tag === "a" && name === "href") {
      const href = attr.value.trim();
      if (!/^(https?:|mailto:|#)/i.test(href)) el.removeAttribute(attr.name);
      else el.setAttribute("rel", "noreferrer noopener");
      continue;
    }
    if (tag === "code" && name === "class") {
      const val = attr.value.trim();
      if (/^language-[a-z0-9_-]+$/i.test(val)) {
        el.setAttribute("class", val);
        continue;
      }
    }
    if (name !== "href" && name !== "title" && name !== "start") {
      el.removeAttribute(attr.name);
    }
  }

  for (const child of [...el.children]) sanitizeElement(child);
}

/**
 * @param {HTMLElement} root
 */
function sanitizeFragment(root) {
  docStripUnsafe(root);
  for (const child of [...root.children]) sanitizeElement(child);
  return root.innerHTML;
}

/**
 * @param {ParentNode} root
 */
function docStripUnsafe(root) {
  root.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((n) => n.remove());
}

/**
 * Render Composer / GitHub comment text: Markdown → HTML (default), or sanitized HTML.
 *
 * @param {string | undefined | null} raw
 */
const SUGGESTED_CHANGE_SPLIT =
  /^([\s\S]*?)\n\s*(?:\*\*)?Suggested change:(?:\*\*)?\s*\n?([\s\S]+)$/i;

/**
 * Review comment with optional "Suggested change" block (Cursor Draft, architecture themes).
 *
 * @param {string | undefined | null} raw
 */
export function renderReviewCommentHtml(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  const split = text.match(SUGGESTED_CHANGE_SPLIT);
  if (!split) return renderCommentBodyHtml(text);

  const lead = split[1].trim();
  const suggestion = split[2].trim();
  const leadHtml = lead
    ? `<div class="cedar-review-comment-lead cedar-comment-html cedar-comment-theme">${renderCommentBodyHtml(lead)}</div>`
    : "";
  const suggHtml = suggestion
    ? `<aside class="cedar-suggested-change" aria-label="Suggested change">
        <p class="cedar-suggested-change-label">Suggested change</p>
        <div class="cedar-suggested-change-body cedar-comment-html cedar-comment-theme">${renderCommentBodyHtml(suggestion)}</div>
      </aside>`
    : "";
  return `${leadHtml}${suggHtml}`;
}

export function renderCommentBodyHtml(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  if (typeof DOMParser === "undefined") {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  let asHtml;
  if (looksLikeMarkdown(text)) {
    asHtml = String(marked.parse(text, { async: false }));
  } else if (looksLikeHtml(text)) {
    asHtml = text;
  } else {
    asHtml = escapeHtml(text).replace(/\n/g, "<br>");
  }

  const doc = new DOMParser().parseFromString(`<div class="cedar-comment-html-root">${asHtml}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
  return sanitizeFragment(root);
}