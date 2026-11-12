import { cn } from "@/lib/utils";

/**
 * A tiny trend line (no axes). Coloured by `tone`; a flat or empty series draws a quiet horizontal line so rows without
 * history still line up with the rest.
 */
export function Sparkline({ values, tone, width = 72, height = 24, className }: { values: number[] | undefined; tone: "positive" | "negative" | "flat"; width?: number; height?: number; className?: string }) {
  const stroke = tone === "positive" ? "var(--positive)" : tone === "negative" ? "var(--negative)" : "var(--line-3)";
  const series = values && values.length > 1 ? values : [0, 0];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const flat = max === min;
  const d = series
    .map((v, i) => {
      const x = (i * width) / (series.length - 1);
      const y = flat ? height / 2 : height - 2 - ((v - min) / range) * (height - 4);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className={cn("shrink-0", className)}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
