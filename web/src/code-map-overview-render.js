/**
 * @param {string} text
 */
function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{
 *   what: string,
 *   structure: string,
 *   layoutLine: string,
 *   details: string[],
 * }} overview
 */
export function renderCodeMapOverviewHtml(overview) {
  const { what, structure, layoutLine, details } = overview;
  const hasRows = Boolean(structure || what || layoutLine);
  if (!hasRows && !details.length) return "";

  const row = (label, value, mono = false) => {
    if (!value) return "";
    const cls = mono ? " cedar-code-map-overview__value--mono" : "";
    return `<div class="cedar-code-map-overview__row"><dt>${esc(label)}</dt><dd class="cedar-code-map-overview__value${cls}">${esc(value)}</dd></div>`;
  };

  const layout = layoutLine.replace(/^Layout:\s*/i, "").trim();
  const rows = [
    row("Structure", structure, true),
    row("Behavior", what, false),
    row("Graph layout", layout, false),
  ].filter(Boolean);

  const detailsHtml = details.length
    ? `<ul class="cedar-code-map-overview__details" aria-label="Additional context">${details
        .map((b) => `<li>${esc(b)}</li>`)
        .join("")}</ul>`
    : "";

  return `<dl class="cedar-code-map-overview__grid">${rows.join("")}</dl>${detailsHtml}`;
}