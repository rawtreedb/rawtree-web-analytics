import type { ComponentProps } from "react";
import { cn } from "../ui/styles.ts";

/** Twelve-column grid that responds to the dashboard `@container`, not the viewport. */
export function DashboardGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-12 gap-4", className)} {...props} />;
}

type Span = 4 | 5 | 6 | 7 | 8 | 12;

// Full class names so Tailwind can detect them.
const mdSpans: Record<Span, string> = {
  4: "@2xl:col-span-4",
  5: "@2xl:col-span-5",
  6: "@2xl:col-span-6",
  7: "@2xl:col-span-7",
  8: "@2xl:col-span-8",
  12: "@2xl:col-span-12",
};
const lgSpans: Record<Span, string> = {
  4: "@5xl:col-span-4",
  5: "@5xl:col-span-5",
  6: "@5xl:col-span-6",
  7: "@5xl:col-span-7",
  8: "@5xl:col-span-8",
  12: "@5xl:col-span-12",
};

const xlSpans: Record<Span, string> = {
  4: "@8xl:col-span-4",
  5: "@8xl:col-span-5",
  6: "@8xl:col-span-6",
  7: "@8xl:col-span-7",
  8: "@8xl:col-span-8",
  12: "@8xl:col-span-12",
};

/** Column spans per container width: md ≥ 42rem (@2xl), lg ≥ 64rem (@5xl), xl ≥ 100rem (@8xl). Full width below. */
export function GridItem({ md, lg, xl, className, ...props }: ComponentProps<"div"> & { md?: Span; lg?: Span; xl?: Span }) {
  return <div className={cn("col-span-12 min-w-0", md && mdSpans[md], lg && lgSpans[lg], xl && xlSpans[xl], className)} {...props} />;
}

/** Auto-filling row of stat cards; two columns on small screens. */
export function StatGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-stats gap-4 max-md:grid-cols-2 max-md:gap-3", className)} {...props} />;
}
