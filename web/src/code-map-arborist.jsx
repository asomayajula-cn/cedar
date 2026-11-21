import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Tree } from "react-arborist";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { buildCodeMapTreeData } from "./code-map-tree-data.js";
import { codeMapFitMetrics } from "./diagram-fit.js";
import { getDiffFontSettings } from "./diff-font.js";

/**
 * @param {{ node: import('react-arborist').NodeApi, style: React.CSSProperties }} props
 */
function CodeMapTreeRow({ node, style, dragHandle }) {
  const kind = node.data.kind;
  const isFolder = node.isInternal;
  return (
    <div
      style={style}
      ref={dragHandle}
      className={`cedar-code-map-tree-row${node.isSelected ? " is-selected" : ""}${isFolder ? " is-folder" : ""}${
        kind ? ` cedar-code-map-tree-row--${kind}` : ""
      }`}
      title={node.data.name}
    >
      <span className="cedar-code-map-tree-chevron" aria-hidden="true">
        {isFolder ? (node.isOpen ? "▾" : "▸") : "·"}
      </span>
      <span className="cedar-code-map-tree-label">{node.data.name}</span>
    </div>
  );
}

/**
 * @param {{
 *   elements: object[],
 *   filePath?: string,
 *   isDay?: boolean,
 *   onEngineReady?: (api: object) => void,
 * }} props
 */
function ArboristInner({ elements, filePath, isDay, onEngineReady }) {
  const wrapRef = useRef(null);
  const treeRef = useRef(null);
  const [size, setSize] = useState({ width: 320, height: 480 });

  const data = useMemo(() => buildCodeMapTreeData(elements, filePath), [elements, filePath]);

  const { rowHeight, indent, fontPx } = useMemo(() => {
    const { fontPx: px } = codeMapFitMetrics();
    const { size: diffPx } = getDiffFontSettings();
    const base = Math.max(px, diffPx);
    return {
      fontPx: base,
      rowHeight: Math.round(base * 2.35),
      indent: Math.round(8 + base * 0.85),
    };
  }, [elements]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const w = Math.max(120, el.clientWidth);
      const h = Math.max(160, el.clientHeight);
      setSize({ width: w, height: h });
      el.style.setProperty("--cedar-code-map-node-font-size", `${fontPx}px`);
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fontPx]);

  useEffect(() => {
    const api = {
      fitView: () => {
        treeRef.current?.openAll?.();
        treeRef.current?.scrollTo?.("code-map-root");
      },
      resetView: () => {
        treeRef.current?.openAll?.();
        treeRef.current?.scrollTo?.("code-map-root");
      },
      resize: () => {
        const el = wrapRef.current;
        if (el) {
          setSize({ width: Math.max(120, el.clientWidth), height: Math.max(160, el.clientHeight) });
        }
      },
      zoomIn: () => {},
      zoomOut: () => {},
      zoomBy: () => {},
    };
    onEngineReady?.(api);
    const t = requestAnimationFrame(() => api.fitView());
    return () => cancelAnimationFrame(t);
  }, [data, onEngineReady]);

  useEffect(() => {
    const onFont = () => {
      const el = wrapRef.current;
      if (el) {
        const { size: diffPx } = getDiffFontSettings();
        el.style.setProperty("--cedar-code-map-node-font-size", `${diffPx}px`);
      }
      treeRef.current?.resize?.();
    };
    window.addEventListener("cedar-diff-font-change", onFont);
    return () => window.removeEventListener("cedar-diff-font-change", onFont);
  }, []);

  return (
    <div
      ref={wrapRef}
      className={`cedar-code-map-arborist${isDay ? " cedar-code-map-arborist--day" : ""}`}
    >
      <Tree
        ref={treeRef}
        data={data}
        width={size.width}
        height={size.height}
        rowHeight={rowHeight}
        indent={indent}
        openByDefault
        disableDrag
        disableDrop
        disableEdit
        disableMultiSelection
        selectionFollowsFocus
        paddingBottom={12}
        paddingTop={8}
      >
        {CodeMapTreeRow}
      </Tree>
    </div>
  );
}

/**
 * @param {{
 *   elements: object[],
 *   filePath?: string,
 *   isDay?: boolean,
 *   onEngineReady?: (api: object) => void,
 * }} props
 */
export function CodeMapArborist(props) {
  return (
    <DndProvider backend={HTML5Backend}>
      <ArboristInner {...props} />
    </DndProvider>
  );
}