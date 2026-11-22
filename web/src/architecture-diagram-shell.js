/**
 * Single markup + selectors for every Architecture tab diagram (Overview · slices + Mermaid).
 */

export const ARCHITECTURE_DIAGRAM_STAGE_SELECTOR =
  "[data-architecture-diagram-stage], .diagram-overview-read.diagram-stage-canvas, .diagram-complete-layout";

export const ARCHITECTURE_DIAGRAM_CARD_CLASS = "cedar-architecture-diagram-card cedar-layout-view";
export const ARCHITECTURE_DIAGRAM_STAGE_CLASS =
  "cedar-cy-host diagram-overview-read diagram-stage-canvas";

/**
 * @param {ParentNode | null | undefined} wrap
 * @returns {HTMLElement | null}
 */
export function architectureDiagramStageEl(wrap) {
  if (!(wrap instanceof HTMLElement)) return null;
  const el = wrap.querySelector(ARCHITECTURE_DIAGRAM_STAGE_SELECTOR);
  return el instanceof HTMLElement ? el : null;
}

/**
 * @param {string} text
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} targetId
 * @param {string} [badge]
 */
export function renderArchitectureDiagramToolbar(targetId, badge = "") {
  const id = escapeHtml(targetId);
  return `<div class="diagram-toolbar flex flex-wrap items-center gap-1.5" data-diagram-toolbar>
    <span class="cedar-label mb-0">View</span>
    <button type="button" class="diagram-tool-btn" data-cy-action="in" data-cy-target="${id}" title="Zoom in">+</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="out" data-cy-target="${id}" title="Zoom out">−</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="fit" data-cy-target="${id}" title="Fit">Fit</button>
    <button type="button" class="diagram-tool-btn" data-diagram-action="maximize" title="Maximize panel" aria-pressed="false">⤢</button>
    ${badge}
  </div>`;
}

/**
 * @param {{
 *   cardId?: string,
 *   layoutView?: string,
 *   label: string,
 *   toolbarTargetId: string,
 *   badgeHtml?: string,
 *   stageAria: string,
 *   cytoscapeContainerId?: string,
 *   mermaidHostId?: string,
 * }} spec
 */
export function renderArchitectureDiagramCard(spec) {
  const idAttr = spec.cardId ? ` id="${escapeHtml(spec.cardId)}"` : "";
  const viewAttr = spec.layoutView ? ` data-layout-view="${escapeHtml(spec.layoutView)}"` : "";
  const badge = spec.badgeHtml ?? "";
  const stageIdAttr = spec.cytoscapeContainerId
    ? ` id="${escapeHtml(spec.cytoscapeContainerId)}"`
    : "";
  const embed =
    spec.mermaidHostId && !spec.cytoscapeContainerId
      ? `<div id="${escapeHtml(spec.mermaidHostId)}" class="cedar-architecture-diagram-embed cedar-mermaid-source m-0" role="presentation"></div>`
      : "";

  return `<div class="${ARCHITECTURE_DIAGRAM_CARD_CLASS} w-full min-w-0"${idAttr} data-diagram-wrap data-architecture-diagram-card${viewAttr}>
            <div class="architecture-read-mermaid-head">
              <p class="cedar-label cedar-architecture-section-label mb-0">${escapeHtml(spec.label)}</p>
              <div class="architecture-read-mermaid-head-tools">
              ${renderArchitectureDiagramToolbar(spec.toolbarTargetId, badge)}
              </div>
            </div>
            <div${stageIdAttr} class="${ARCHITECTURE_DIAGRAM_STAGE_CLASS}" data-architecture-diagram-stage role="img" aria-label="${escapeHtml(spec.stageAria)}">
            ${embed}
            </div>
          </div>`;
}

/**
 * @param {{ view: string, label: string, cyId: string, aria: string }} spec
 * @param {string} sliceBadgesHtml
 */
export function renderArchitectureCyCard(spec, sliceBadgesHtml) {
  return renderArchitectureDiagramCard({
    layoutView: spec.view,
    label: spec.label,
    toolbarTargetId: spec.cyId,
    badgeHtml: sliceBadgesHtml,
    stageAria: spec.aria,
    cytoscapeContainerId: spec.cyId,
  });
}

export function renderArchitectureDiagramStack(cardsHtml) {
  return `<div class="cedar-architecture-diagram-stack cedar-complete-layout-views w-full min-w-0 flex flex-col gap-6" id="architecture-read-mermaid">${cardsHtml}</div>`;
}