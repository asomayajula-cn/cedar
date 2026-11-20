import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";

cytoscape.use(dagre);

/** @type {Map<string, cytoscape.Core>} */
const instances = new Map();

const CEDAR_STYLE = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": "156px",
      "font-size": "10px",
      "font-family": "Inter, system-ui, sans-serif",
      color: "#e4e4e7",
      "text-valign": "center",
      "text-halign": "center",
      "background-color": "#27272a",
      "border-width": 1,
      "border-color": "#52525b",
      padding: "12px",
      shape: "roundrectangle",
    },
  },
  {
    selector: "node[type = \"pr\"]",
    style: {
      "background-color": "#fafafa",
      color: "#09090b",
      "border-color": "#71717a",
      "font-weight": "bold",
      "font-size": "11px",
    },
  },
  {
    selector: "node[type = \"slice\"]",
    style: {
      "background-color": "#1f1f23",
      "border-color": "#3f3f46",
    },
  },
  {
    selector: "node[type = \"file\"]",
    style: {
      "background-color": "#0c0c0e",
      "border-color": "#27272a",
      color: "#a1a1aa",
      "font-size": "9px",
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": "#52525b",
      "target-arrow-color": "#52525b",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
    },
  },
  {
    selector: "edge[kind = \"depends\"]",
    style: {
      "line-style": "dashed",
      "line-color": "#a1a1aa",
      "target-arrow-color": "#a1a1aa",
    },
  },
];

/**
 * @param {object} graph
 * @param {"overview"|"detail"} mode
 */
function toElements(graph, mode) {
  const part = mode === "overview" ? graph.overview : graph.detail;
  if (!part?.nodes?.length) return [];
  const nodes = part.nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.label,
      type: n.type,
    },
  }));
  const edges = (part.edges ?? []).map((e) => ({
    data: {
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
    },
  }));
  return [...nodes, ...edges];
}

/**
 * @param {HTMLElement} container
 * @param {object} graph
 * @param {"overview"|"detail"} mode
 */
function mountCy(container, graph, mode) {
  if (!container.id) container.id = `cedar-cy-${mode}`;
  const key = container.id;
  const prev = instances.get(key);
  if (prev) prev.destroy();

  const elements = toElements(graph, mode);
  if (!elements.length) {
    container.innerHTML =
      '<p class="p-4 text-center text-sm text-zinc-500">No architecture nodes to draw for this PR.</p>';
    return null;
  }

  try {
    const cy = cytoscape({
      container,
      elements,
      style: CEDAR_STYLE,
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      boxSelectionEnabled: false,
    });

    const layout = cy.layout({
      name: "dagre",
      rankDir: "TB",
      nodeSep: mode === "overview" ? 56 : 42,
      rankSep: mode === "overview" ? 80 : 64,
      animate: false,
      fit: true,
      padding: 32,
    });
    layout.run();
    layout.on("layoutstop", () => {
      cy.fit(cy.elements(), 32);
    });

    instances.set(key, cy);
    return cy;
  } catch (err) {
    console.error("[cedar] cytoscape mount failed", err);
    container.innerHTML = `<p class="p-4 text-center text-sm text-rose-300">Diagram failed: ${escapeMsg(err)}</p>`;
    return null;
  }
}

/**
 * @param {HTMLElement} root
 * @param {object} diagramGraph
 */
export function mountArchitectureGraphs(root, diagramGraph) {
  if (!diagramGraph?.overview) return false;

  const overviewEl = root.querySelector("#cedar-cy-overview");
  const detailEl = root.querySelector("#cedar-cy-detail");
  let ok = false;
  if (overviewEl) ok = mountCy(overviewEl, diagramGraph, "overview") !== null || ok;
  if (detailEl) ok = mountCy(detailEl, diagramGraph, "detail") !== null || ok;

  root.querySelectorAll("[data-cy-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-cy-target");
      const action = btn.getAttribute("data-cy-action");
      const cy = instances.get(targetId);
      if (!cy) return;
      if (action === "fit") cy.fit(cy.elements(), 32);
      else if (action === "in") cy.zoom(cy.zoom() * 1.12);
      else if (action === "out") cy.zoom(cy.zoom() / 1.12);
    });
  });
  return ok;
}

/**
 * @param {unknown} err
 */
function escapeMsg(err) {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/</g, "&lt;");
}

export function destroyArchitectureGraphs() {
  for (const cy of instances.values()) cy.destroy();
  instances.clear();
}