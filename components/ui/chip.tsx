import { cn } from "@/lib/utils";

/**
 * A filter chip: a pill button that is "on" (volt) or off. Use a row of them for status filters ("All / Running / Failed"),
 * and `count` to show how many each would match.
 */
function Chip({
  active,
  count,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "type"> & { active?: boolean; count?: number | string }) {
  return (
    <button
      type="button"
      aria-pressed={!!active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors max-md:h-10 max-md:px-4",
        active ? "border-volt-line bg-volt-soft text-primary" : "border-line-2 bg-card text-text-2 hover:border-line-3 hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
      {count !== undefined ? <span className={cn("text-xs tabular-nums", active ? "text-primary/80" : "text-text-3")}>{count}</span> : null}
    </button>
  );
}

export { Chip };
