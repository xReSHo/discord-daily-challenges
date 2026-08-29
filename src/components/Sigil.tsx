/** Abstract rune-circle brand mark. Inherits colour via `currentColor`. */
export function Sigil({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="24"
        cy="24"
        r="21"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="3 7"
        opacity="0.55"
      />
      <circle cx="24" cy="24" r="15.5" stroke="currentColor" strokeWidth="1" opacity="0.8" />
      <path
        d="M24 10.5 34.5 24 24 37.5 13.5 24Z"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M24 2.5V8M24 40v5.5M2.5 24H8M40 24h5.5"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.7"
      />
      <circle cx="24" cy="24" r="2.4" fill="currentColor" />
    </svg>
  );
}
