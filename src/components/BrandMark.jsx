export function CrownMark({ size = 40, title = 'FLIPPEN crown' }) {
  return (
    <svg className="crown-mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <path d="M3 13 20 25l7 19H10L3 13Z" fill="currentColor" />
      <path d="M32 3 43 25 32 45 21 25 32 3Z" fill="currentColor" />
      <path d="m61 13-7 31H37l7-19 17-12Z" fill="currentColor" />
    </svg>
  )
}

const iconPaths = {
  arrowRight: <path d="M5 12h14m-5-5 5 5-5 5" />,
  arena: <><path d="m8 6 4-3 4 3v6l-4 3-4-3V6Z" /><path d="M5 10 3 12l4 7h10l4-7-2-2M9 19v2m6-2v2" /></>,
  chart: <><path d="M4 19V5" /><path d="m6 16 4-5 4 3 5-8" /><path d="M16 6h3v3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  external: <><path d="M14 5h5v5" /><path d="m10 14 9-9" /><path d="M19 13v6H5V5h6" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.7-4 3.3-6 8-6s7.3 2 8 6" /></>,
  protocol: <><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Z" /><path d="m9 12 2 2 4-5" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></>,
  wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6Z" /><path d="M16 11h6v4h-6a2 2 0 1 1 0-4Z" /></>,
  warning: <><path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5m0 3v.1" /></>,
}

export function Icon({ name, size = 20, className = '', label }) {
  return (
    <svg
      className={`ui-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {iconPaths[name]}
    </svg>
  )
}
