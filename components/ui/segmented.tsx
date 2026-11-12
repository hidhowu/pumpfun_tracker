import { cn } from "@/lib/utils";

/**
 * A row of mutually exclusive buttons in a rounded track (the design's "seg"): Day / Week / Month, Value / P&L and the like.
 * `block` makes the buttons share the full width in equal columns (phones); `tall` makes them thumb-sized.
 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  block,
  tall,
  className,
}: {
  options: readonly { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  block?: boolean;
  tall?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("rounded-xl border border-border bg-card p-[3px]", block ? "grid w-full" : "flex w-fit items-center", className)}
      style={block ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center justify-center rounded-[9px] px-3.5 text-center text-[13px] font-medium transition-colors",
            // Equal-width buttons may wrap a long label onto two lines instead of spilling out of their column.
            block ? "py-1 leading-[1.2]" : "whitespace-nowrap",
            tall ? "min-h-10" : "h-[30px]",
            value === o.value ? "bg-surface-4 text-foreground" : "text-text-2 hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export { Segmented };
