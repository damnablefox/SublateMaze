/** 16px 线性图标，统一 1.5 描边与圆角端点。 */

interface IconProps {
  size?: number
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
}

export function LibraryIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 2.75h6.5A1.75 1.75 0 0 1 11.25 4.5v9H4.25A1.75 1.75 0 0 1 2.5 11.75v-9" />
      <path d="M2.5 11.75a1.75 1.75 0 0 1 1.75-1.75h7" />
      <path d="M5.25 5.5h3.5M5.25 8h3.5" />
    </svg>
  )
}

export function TrashIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 4.25h11" />
      <path d="M6 4.25V3a.75.75 0 0 1 .75-.75h2.5A.75.75 0 0 1 10 3v1.25" />
      <path d="M4 4.25l.6 8.4a.9.9 0 0 0 .9.85h5a.9.9 0 0 0 .9-.85l.6-8.4" />
      <path d="M6.5 6.75v4M9.5 6.75v4" />
    </svg>
  )
}

export function KnowledgeIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 2.5a3.5 3.5 0 0 0-2.1 6.3c.4.3.6.7.6 1.2v.5h3v-.5c0-.5.2-.9.6-1.2A3.5 3.5 0 0 0 8 2.5Z" />
      <path d="M6.5 12.5h3M7 14h2" />
    </svg>
  )
}

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  )
}

export function SearchIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
  )
}

export function ArrowLeftIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M13 8H3.5M7 4.5L3.5 8 7 11.5" />
    </svg>
  )
}

export function SunIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" />
    </svg>
  )
}

export function MoonIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
    </svg>
  )
}

export function SystemIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2" y="3" width="12" height="8.5" rx="1.5" />
      <path d="M6 13.5h4M8 11.5v2" />
    </svg>
  )
}
