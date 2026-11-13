import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const IconLock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15.5" r="1.2" fill="currentColor" /></svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconArrow = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const IconReturn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 14l-4-4 4-4" /><path d="M5 10h9a5 5 0 0 1 0 10h-3" /></svg>
);
export const IconMoto = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="5.5" cy="16.5" r="3" /><circle cx="18.5" cy="16.5" r="3" /><path d="M5.5 16.5h6l3-6h3l1 6M11 10.5H7.5M14.5 7.5h2.5" /></svg>
);
export const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></svg>
);
export const IconEyeOff = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 4l16 16M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7M6.3 7.6A16.500 16.500 0 0 0 2.500 12s3.500 6.500 9.500 6.500a9.300 9.300 0 0 0 3.800-.8" /><path d="M9.900 9.900a2.800 2.800 0 0 0 4 4" /></svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.500 8.500V6.500a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></svg>
);
export const IconWallet = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.500 7.500a2.500 2.500 0 0 1 2.500-2.500h11v3.500" /><rect x="3.500" y="8.500" width="17" height="11" rx="2.500" /><circle cx="16.500" cy="14" r="1.300" fill="currentColor" /></svg>
);
export const IconSpark = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3.500l1.800 5 5 1.800-5 1.800-1.800 5-1.800-5-5-1.800 5-1.800zM18.500 15.500l.8 2.200 2.200.8-2.200.8-.8 2.200-.8-2.200-2.200-.8 2.200-.8z" /></svg>
);
export const IconCamera = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4.500 8.500h3l1.500-2.500h6l1.500 2.500h3a1.500 1.500 0 0 1 1.500 1.500v8a1.500 1.500 0 0 1-1.500 1.500h-15a1.500 1.500 0 0 1-1.500-1.500v-8a1.500 1.500 0 0 1 1.500-1.500z" /><circle cx="12" cy="13.500" r="3.200" /></svg>
);
export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l7.500 3v5.500c0 4.500-3.200 7.800-7.500 9.500-4.300-1.700-7.500-5-7.500-9.500V6z" /><path d="M8.800 12.200l2.300 2.300 4.200-4.400" /></svg>
);
export const IconWhatsApp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20l1.300-4.200A8 8 0 1 1 8.300 18.800z" /><path d="M9.200 9c0 3 2.800 5.800 5.800 5.800l1-1.300-1.800-1-.9.800c-.9-.4-1.700-1.200-2.100-2.100l.8-.9-1-1.800z" /></svg>
);
export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14.500 4.500h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h9.500" /></svg>
);
