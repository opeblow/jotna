import { useId } from "react";

/**
 * Flat geometric motifs in the spirit of West African wax print: concentric "target" rings,
 * shells and zigzags. Pure SVG patterns, so they cost a few hundred bytes and scale to any size.
 */
type PatternProps = { className?: string; fg?: string; bg?: string; accent?: string };

export function RingsPattern({ className, fg = "#18265e", bg = "#22347c", accent = "#f2b632" }: PatternProps) {
  const id = useId();
  return (
    <svg className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} width="56" height="56" patternUnits="userSpaceOnUse">
          <rect width="56" height="56" fill={bg} />
          <circle cx="28" cy="28" r="20" fill="none" stroke={fg} strokeWidth="5" />
          <circle cx="28" cy="28" r="10" fill="none" stroke={fg} strokeWidth="5" />
          <circle cx="28" cy="28" r="3" fill={accent} />
          <circle cx="0" cy="0" r="4" fill={accent} />
          <circle cx="56" cy="0" r="4" fill={accent} />
          <circle cx="0" cy="56" r="4" fill={accent} />
          <circle cx="56" cy="56" r="4" fill={accent} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export function ZigzagPattern({ className, fg = "#a23c1b", bg = "#c44d27" }: PatternProps) {
  const id = useId();
  return (
    <svg className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} width="28" height="20" patternUnits="userSpaceOnUse">
          <rect width="28" height="20" fill={bg} />
          <path d="M0 15 L7 5 L14 15 L21 5 L28 15" fill="none" stroke={fg} strokeWidth="4" strokeLinejoin="miter" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export function ShellPattern({ className, fg = "#e2a41f", bg = "#f2b632" }: PatternProps) {
  const id = useId();
  return (
    <svg className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} width="40" height="20" patternUnits="userSpaceOnUse">
          <rect width="40" height="20" fill={bg} />
          <path d="M0 20a20 20 0 0 1 40 0M8 20a12 12 0 0 1 24 0M15 20a5 5 0 0 1 10 0" fill="none" stroke={fg} strokeWidth="3" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** A strip of cloth used as a section divider. */
export function ClothStrip({ className = "" }: { className?: string }) {
  return (
    <div className={`flex h-5 w-full overflow-hidden border-y-2 border-ink ${className}`} aria-hidden="true">
      <RingsPattern className="h-full w-1/3" />
      <ShellPattern className="h-full w-1/3" />
      <ZigzagPattern className="h-full w-1/3" />
    </div>
  );
}
