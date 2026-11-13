import QRCode from "qrcode";

/**
 * QR code rendered as a single SVG path: crisp at any size, no canvas, no image request.
 * Works in server and client components.
 */
export function Qr({ value, size = 240, level = "M", label }: { value: string; size?: number; level?: "L" | "M" | "Q" | "H"; label: string }) {
  const qr = QRCode.create(value, { errorCorrectionLevel: level });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const quiet = 2;
  let d = "";
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!data[y * n + x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < n && data[y * n + x + run]) run++;
      d += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`;
      x += run;
    }
  }
  const dim = n + quiet * 2;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges" className="h-auto max-w-full">
      <rect width={dim} height={dim} fill="#fffdf7" />
      <path d={d} fill="#211b14" />
    </svg>
  );
}
