export type SourceFlowKind =
  | "entry"
  | "symbol"
  | "definition"
  | "import"
  | "export"
  | "call"
  | "step"
  | "table"
  | "external";

export type SourceFlowNode = {
  id: string;
  label: string;
  kind: SourceFlowKind | string;
  scope?: string;
};

export type SourceFlowEdge = {
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dotted";
};

export type SourceFlowMap = {
  nodes: SourceFlowNode[];
  edges: SourceFlowEdge[];
  whatItDoes: string;
  header: string;
  lang: "sql" | "java" | "js" | "generic";
};

export type FlowElement = {
  data: Record<string, unknown>;
};

export type ParseSourceFlowOptions = {
  filename?: string;
  source?: string;
  /** @default "structure" */
  view?: "structure" | "full";
};

export type ParseSourceFlowResult = SourceFlowMap & {
  summary: { lead: string; bullets: string[] };
  elements: FlowElement[];
};

export function detectLang(filename: string): ParseSourceFlowResult["lang"];

export function parseSourceFlow(options: ParseSourceFlowOptions): ParseSourceFlowResult;

export function toStructure(map: SourceFlowMap): SourceFlowMap;

export function toFlowElements(map: SourceFlowMap): FlowElement[];

export function summarize(map: SourceFlowMap): { lead: string; bullets: string[] };