export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#cdf545" />
      <circle cx="9.5" cy="16" r="2.7" fill="#12150a" />
      <circle cx="22.5" cy="9.5" r="2.7" fill="#12150a" />
      <circle cx="22.5" cy="22.5" r="2.7" fill="#12150a" />
      <path d="M12 16h3.5c3 0 3-6.5 7-6.5M15.5 16c3 0 3 6.5 7 6.5" fill="none" stroke="#12150a" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

export default function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <Mark />
      <span className="display text-[1.4rem] leading-none">Relay</span>
    </span>
  )
}
