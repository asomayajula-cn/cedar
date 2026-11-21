import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  MarkerType,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { kindMeta } from "./node-meta.js";
import { layoutWithDagreScoped } from "./layout-enhanced.js";

const DEFAULT_FIT = {
  fitPadding: 72,
  postScale: 0.88,
  maxFitZoom: 1,
  flowNodeSpacing: 58,
  flowRankSpacing: 78,
};

/**
 * @param {{ prefix: string, label?: string, kind?: string }} props
 */
function FlowNode({ data, selected }) {
  const kind = data.kind ?? "symbol";
  const meta = kindMeta(kind);
  const p = data.prefix;
  return (
    <div
      className={`${p}-node ${p}-node--${kind}${selected ? " is-selected" : ""}`}
      title={`${meta.title}: ${data.label ?? ""}`}
    >
      <span className={`${p}-node-badge`} aria-hidden="true">
        {meta.short}
      </span>
      <span className={`${p}-node-label`}>{data.label}</span>
    </div>
  );
}

function classifyEdge(d, isDay) {
  const dashed = d.lineStyle === "dashed";
  const label = String(d.label ?? "").toLowerCase();
  const night = !isDay;
  if (label.includes("then") || label === "defines" || label === "method" || label === "member") {
    return { className: "struct", stroke: night ? "#2dd4bf" : "#0d9488", animated: false, dashed: false };
  }
  if (dashed || label.includes("call") || label.includes("imports") || label.includes("references")) {
    return { className: "flow", stroke: night ? "#60a5fa" : "#2563eb", animated: dashed || label.includes("call"), dashed: true };
  }
  return { className: "", stroke: night ? "#64748b" : "#94a3b8", animated: false, dashed: false };
}

function elementsToFlow(elements, isDay, prefix) {
  const nodes = [];
  const edges = [];
  for (const el of elements ?? []) {
    const d = el?.data;
    if (!d) continue;
    if (Object.hasOwn(d, "source")) {
      const edge = classifyEdge(d, isDay);
      edges.push({
        id: d.id,
        source: d.source,
        target: d.target,
        label: d.label || undefined,
        labelStyle: { fill: isDay ? "#334155" : "#cbd5e1", fontSize: 9, fontWeight: 500 },
        labelBgStyle: { fill: isDay ? "rgb(248 250 252 / 0.92)" : "rgb(15 23 42 / 0.88)", fillOpacity: 0.95 },
        labelBgPadding: [4, 6],
        labelBgBorderRadius: 4,
        animated: edge.animated,
        style: { stroke: edge.stroke, strokeWidth: 1.35, ...(edge.dashed ? { strokeDasharray: "5 4" } : {}) },
        markerEnd: { type: MarkerType.ArrowClosed, color: edge.stroke, width: 16, height: 16 },
        className: edge.className ? `${prefix}-edge ${prefix}-edge--${edge.className}` : `${prefix}-edge`,
      });
    } else {
      nodes.push({
        id: d.id,
        type: "sourceFlow",
        data: { label: d.label, kind: d.kind, prefix },
        position: { x: 0, y: 0 },
        width: d.width,
        height: d.height,
      });
    }
  }
  return { nodes, edges };
}

function FlowInner({
  elements,
  isDay,
  mapLang,
  rankdir,
  fitMetrics,
  onEngineReady,
  classPrefix,
}) {
  const { fitView, zoomIn, zoomOut, setViewport, getViewport } = useReactFlow();
  const nodeTypes = useMemo(() => ({ sourceFlow: FlowNode }), []);

  const { nodes, edges } = useMemo(() => {
    const metrics = { ...DEFAULT_FIT, ...fitMetrics, rankdir: rankdir ?? "TB" };
    const raw = elementsToFlow(elements, isDay, classPrefix);
    return layoutWithDagreScoped(raw.nodes, raw.edges, metrics);
  }, [elements, isDay, fitMetrics, rankdir, classPrefix]);

  const fitMapView = (overrides = {}) => {
    const metrics = { ...DEFAULT_FIT, ...fitMetrics, ...overrides };
    const { fitPadding, postScale, maxFitZoom = 1 } = metrics;
    fitView({ padding: fitPadding, duration: 0 });
    requestAnimationFrame(() => {
      const vp = getViewport();
      let zoom = vp.zoom * postScale;
      if (maxFitZoom > 0) zoom = Math.min(zoom, maxFitZoom);
      setViewport({ ...vp, zoom: Math.min(4, Math.max(0.08, zoom)) });
    });
  };

  useEffect(() => {
    const api = {
      fitView: (opts = {}) => fitMapView(opts),
      zoomIn: () => zoomIn({ duration: 0 }),
      zoomOut: () => zoomOut({ duration: 0 }),
      zoomBy: (factor) => {
        const vp = getViewport();
        setViewport({ ...vp, zoom: Math.min(4, Math.max(0.08, vp.zoom * factor)) });
      },
      resetView: () => fitMapView(),
      resize: () => fitMapView(),
    };
    onEngineReady?.(api);
    const t = requestAnimationFrame(() => api.fitView());
    return () => cancelAnimationFrame(t);
  }, [elements, fitMetrics, onEngineReady, fitView, zoomIn, zoomOut, setViewport, getViewport]);

  return (
    <div
      className={[
        `${classPrefix}-xyflow-shell`,
        isDay ? `${classPrefix}-xyflow-shell--day` : `${classPrefix}-xyflow-shell--night`,
        mapLang ? `${classPrefix}-xyflow-shell--${mapLang}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ReactFlow
        className={`${classPrefix}-xyflow-canvas`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.12}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnScroll={false}
        zoomOnScroll={false}
        colorMode={isDay ? "light" : "dark"}
      >
        <Background gap={20} size={1} color={isDay ? "rgb(148 163 184 / 0.35)" : "rgb(71 85 105 / 0.45)"} />
        {nodes.length > 4 ? (
          <MiniMap
            className={`${classPrefix}-minimap`}
            pannable
            zoomable
            nodeColor={(n) => {
              const k = n.data?.kind ?? "symbol";
              if (k === "entry") return isDay ? "#64748b" : "#94a3b8";
              if (k === "import") return isDay ? "#0284c7" : "#38bdf8";
              if (k === "external") return isDay ? "#e11d48" : "#fb7185";
              return isDay ? "#059669" : "#34d399";
            }}
          />
        ) : null}
      </ReactFlow>
    </div>
  );
}

/**
 * React source-structure map (SQL / Java / JS cytoscape elements).
 */
export function SourceFlowMap({
  elements,
  isDay = false,
  mapLang,
  rankdir,
  fitMetrics,
  onEngineReady,
  /** CSS prefix for node styles — Cedar uses `cedar-code-map` */
  classPrefix = "cedar-code-map",
}) {
  return (
    <ReactFlowProvider>
      <FlowInner
        elements={elements}
        isDay={isDay}
        mapLang={mapLang}
        rankdir={rankdir}
        fitMetrics={fitMetrics}
        onEngineReady={onEngineReady}
        classPrefix={classPrefix}
      />
    </ReactFlowProvider>
  );
}