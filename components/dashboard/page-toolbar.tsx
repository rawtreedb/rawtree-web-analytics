import type { ReactNode } from "react";
import { cardClass, cn } from "../ui/styles.ts";

/**
 * Sticky page header card with the title, meta line, and filters. It sticks at the
 * sidebar card's top offset; the strip above it hides content scrolling through the gap.
 */
export function PageToolbar({
  title,
  badges,
  meta,
  filters,
}: {
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  filters?: ReactNode;
}) {
  return (
    <header
      className={cn(
        cardClass,
        "sticky top-3 z-20 mb-4 flex min-h-19 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3 before:absolute before:inset-x-0 before:-top-3 before:h-3 before:bg-background-extra",
      )}
    >
      <div className="grid min-w-0 grow basis-72 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="m-0 min-w-0 truncate text-xl font-semibold tracking-tight">{title}</h1>
          {badges}
        </div>
        {meta ? <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {filters ? <div className="flex flex-wrap items-center gap-2 max-md:w-full">{filters}</div> : null}
    </header>
  );
}
