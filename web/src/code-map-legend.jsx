import { codeMapLegendRows } from "./code-map-node-meta.js";
import { codeMapLangLabel } from "./code-map-lang.js";

/**
 * @param {{ mapLang?: string, isDay?: boolean, nodeCount?: number, edgeCount?: number }} props
 */
export function CodeMapLegend({ mapLang, isDay, nodeCount = 0, edgeCount = 0 }) {
  const rows = codeMapLegendRows(mapLang);
  const lang = String(mapLang ?? "generic");
  return (
    <div
      className={`cedar-code-map-legend cedar-code-map-legend--${lang}${isDay ? " cedar-code-map-legend--day" : ""}`}
      aria-label="Code map legend"
    >
      <div className="cedar-code-map-legend-title">
        <span className="cedar-code-map-legend-lang">{codeMapLangLabel(lang)}</span>
        map
        <span className="cedar-code-map-legend-stats">
          {nodeCount} nodes · {edgeCount} edges
        </span>
      </div>
      <ul className="cedar-code-map-legend-list">
        {rows.map(([kind, hint]) => (
          <li key={kind}>
            <span className={`cedar-code-map-legend-swatch cedar-code-map-node--${kind}`} aria-hidden="true" />
            <span className="cedar-code-map-legend-hint">{hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}