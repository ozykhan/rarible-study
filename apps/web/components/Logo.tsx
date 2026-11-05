/**
 * The mark: a graded case with a lens on its label, because the app watches
 * slabs. The colors are --accent, --accent-2 and --accent-ink written out as
 * hex, so the SVG still works when copied out on its own.
 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e4ff3a" />
          <stop offset="1" stopColor="#7cf3c9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-g)" />
      <rect x="9" y="5.5" width="14" height="21" rx="2.5" fill="none" stroke="#0b0b0c" strokeWidth="2" />
      <path d="M9 11.5h14" stroke="#0b0b0c" strokeWidth="2" />
      <circle cx="16" cy="19" r="3" fill="#0b0b0c" />
    </svg>
  )
}
