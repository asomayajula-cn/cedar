/** Stacked micro-slice layers (matches Cedar mark layering). */
export function slicesIconSvg(className = "h-4 w-4") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path fill="currentColor" d="M3 5.5h18v4.25H3V5.5Z" opacity=".45"/>
    <path fill="currentColor" d="M5 10.125h14v4.25H5v-4.25Z" opacity=".72"/>
    <path fill="currentColor" d="M7 14.75h10v4.25H7v-4.25Z"/>
    <path stroke="currentColor" stroke-width="1.25" stroke-linecap="round" opacity=".35" d="M12 5.5v13.5"/>
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