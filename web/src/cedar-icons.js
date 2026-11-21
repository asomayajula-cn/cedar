/** Stacked micro-slice layers (matches Cedar mark layering). */
export function slicesIconSvg(className = "h-4 w-4") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path fill="currentColor" d="M3 5.5h18v4.25H3V5.5Z" opacity=".45"/>
    <path fill="currentColor" d="M5 10.125h14v4.25H5v-4.25Z" opacity=".72"/>
    <path fill="currentColor" d="M7 14.75h10v4.25H7v-4.25Z"/>
    <path stroke="currentColor" stroke-width="1.25" stroke-linecap="round" opacity=".35" d="M12 5.5v13.5"/>
  </svg>`;
}

/** Collapse the left navigation rail (panel + chevron toward edge). */
export function panelCollapseLeftIconSvg(className = "h-4 w-4") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3.5" y="5" width="7" height="14" rx="1.25" stroke="currentColor" stroke-width="1.5"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M16 9l-4 3 4 3"/>
  </svg>`;
}

/** Collapse the right code map rail. */
export function panelCollapseRightIconSvg(className = "h-4 w-4") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="13.5" y="5" width="7" height="14" rx="1.25" stroke="currentColor" stroke-width="1.5"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M8 9l4 3-4 3"/>
  </svg>`;
}

/** Restore left navigation rail. */
export function panelExpandLeftIconSvg(className = "h-3.5 w-3.5") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3.5" y="5" width="7" height="14" rx="1.25" stroke="currentColor" stroke-width="1.5"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M13 9l4 3-4 3"/>
  </svg>`;
}

/** Restore right code map rail. */
export function panelExpandRightIconSvg(className = "h-3.5 w-3.5") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="13.5" y="5" width="7" height="14" rx="1.25" stroke="currentColor" stroke-width="1.5"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M11 9l-4 3 4 3"/>
  </svg>`;
}

/** Expand code map to a large overlay. */
export function codeMapExpandIconSvg(className = "h-4 w-4") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>
  </svg>`;
}

/** Close expanded code map. */
export function codeMapCloseExpandIconSvg(className = "cedar-rail-edge-icon") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>
  </svg>`;
}

/** Re-sync review with latest PR head (diffs, maps, architecture). */
export function refreshReviewIconSvg(className = "h-3.5 w-3.5 shrink-0") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M20 12a8 8 0 1 1-2.34-5.66"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M20 4v5h-5"/>
  </svg>`;
}

/** Code findings / review comments for the active slice. */
export function findingsIconSvg(className = "h-4 w-4") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="6.25" cy="6" r="2" fill="currentColor" opacity=".9"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M10.5 6h8M10.5 10h8M10.5 14h8M10.5 18h5"/>
  </svg>`;
}

/** Changed files / diff list. */
export function filesIconSvg(className = "h-4 w-4") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M7 4.5h7.2L18 8.3V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V6a1.5 1.5 0 0 1 1-1.5Z"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M14 4.5V8.5h4"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M9 12.5h6M9 15.5h4"/>
  </svg>`;
}

/** PR chat / ask composer. */
export function chatIconSvg(className = "h-4 w-4") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M6 7.5h12v7.5a3 3 0 0 1-3 3H9.8L5 20v-4.2A3 3 0 0 1 6 7.5Z"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8.5 11.5h7"/>
  </svg>`;
}

/** Compact graph / blueprint for the Architecture tab. */
export function architectureIconSvg(className = "h-4 w-4") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="6" cy="18" r="2.25" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="18" cy="6" r="2.25" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="2.25" stroke="currentColor" stroke-width="1.5"/>
    <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M7.6 16.6 16.4 7.8M7.8 17.4 16.2 17.4"/>
  </svg>`;
}