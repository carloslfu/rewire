// A vector or matrix drawn as color on canvas, with the exact value on hover or tap (section 5.3).
import { useEffect, useRef, useState } from "react";
import { divergingRGB, fmt, onThemeChange } from "./color.ts";

export function Strip({ values, rows = 1, label, scale, names, height }: {
  values: Float32Array;
  rows?: number;
  label: string;
  /** Fixed scale; defaults to the largest magnitude. */
  scale?: number;
  /** Optional names for rows (e.g. heads) shown in the readout. */
  names?: (r: number, c: number) => string;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string>("");
  const [theme, setTheme] = useState(0);
  const cols = Math.ceil(values.length / rows);
  const s = scale ?? values.reduce((m, x) => Math.max(m, Math.abs(x)), 0) ?? 1;
  useEffect(() => onThemeChange(() => setTheme((t) => t + 1)), []);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    cv.width = cols;
    cv.height = rows;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < values.length; i++) {
      const [r, g, b] = divergingRGB(s ? values[i] / s : 0);
      img.data[4 * i] = r; img.data[4 * i + 1] = g; img.data[4 * i + 2] = b; img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [values, rows, cols, s, theme]);
  const at = (e: React.PointerEvent) => {
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * cols), ro = Math.floor(((e.clientY - r.top) / r.height) * rows);
    const i = ro * cols + c;
    if (i < 0 || i >= values.length) return;
    setHover(`${names ? names(ro, c) : rows > 1 ? `row ${ro + 1}, ${c + 1}` : `${c + 1}`}: ${fmt(values[i], 3)}`);
  };
  let min = Infinity, max = -Infinity;
  for (const x of values) { if (x < min) min = x; if (x > max) max = x; }
  return (
    <div>
      <canvas ref={ref} className="strip" style={{ height: height ?? (rows > 1 ? Math.min(160, rows * 6) : 22) }}
        role="img" aria-label={`${label}: ${values.length} numbers from ${fmt(min)} to ${fmt(max)}`}
        onPointerMove={at} onPointerDown={at} onPointerLeave={() => setHover("")} />
      <div className="hover-val">{hover || `${values.length.toLocaleString()} numbers, ${fmt(min)} to ${fmt(max)}`}</div>
    </div>
  );
}
