import type { CSSProperties } from "react";
import type { CSSProperties } from "react";

export type SourceFlowMapProps = {
  /** Pre-parsed elements from {@link parseSourceFlow} */
  elements?: FlowElement[];
  /** Or pass raw map + optional filename to parse client-side (heavier) */
  map?: { nodes: unknown[]; edges: unknown[] };
  filename?: string;
  source?: string;
  theme?: "light" | "dark" | "auto";
  className?: string;
  style?: CSSProperties;
  fitPadding?: number;
  /** Post-fit zoom scale (0–1). @default 0.88 */
  postScale?: number;
  maxFitZoom?: number;
  onReady?: (api: {
    fitView: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    resetView: () => void;
  }) => void;
};

export function SourceFlowMap(props: SourceFlowMapProps): import("react").JSX.Element;