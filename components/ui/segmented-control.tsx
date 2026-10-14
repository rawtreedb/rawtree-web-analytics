import { cn, focusRing } from "./styles.ts";

const segmentGroup = "no-scrollbar inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-muted p-0.5";
const segmentItem = cn(
  "inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full border border-transparent px-3 text-xs font-semibold text-foreground/60 transition-colors hover:text-foreground data-active:border-border data-active:bg-background data-active:text-foreground data-active:shadow-soft",
  focusRing,
);

/** Pill-shaped single-choice control for switching a view, metric, or playback option. */
export function SegmentedControl<T extends string>({
  label,
  items,
  value,
  onValueChange,
  itemClassName,
}: {
  label: string;
  items: readonly { value: T; label: string; title?: string }[];
  value: T;
  onValueChange: (value: T) => void;
  itemClassName?: string;
}) {
  return (
    <div aria-label={label} className={segmentGroup} role="radiogroup">
      {items.map((item) => (
        <button
          aria-checked={item.value === value}
          className={cn(segmentItem, itemClassName)}
          data-active={item.value === value || undefined}
          key={item.value}
          onClick={() => onValueChange(item.value)}
          role="radio"
          title={item.title}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
