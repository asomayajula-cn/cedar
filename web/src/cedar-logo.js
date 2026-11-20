/** Inline Cedar mark (uses currentColor). */
export function cedarMarkSvg(className = "h-5 w-5") {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path fill="currentColor" d="M20 5 33 18H7L20 5Z" opacity=".95"/>
    <path fill="currentColor" d="M20 12.5 30.5 23H9.5L20 12.5Z" opacity=".75"/>
    <path fill="currentColor" d="M20 20 27 27H13L20 20Z" opacity=".55"/>
    <rect fill="currentColor" x="17.75" y="27" width="4.5" height="8" rx="1"/>
    <path stroke="currentColor" stroke-opacity=".35" stroke-width=".75" d="M20 5v22"/>
  </svg>`;
}