import type { CSSProperties } from "react";
import { cn } from "../ui/styles.ts";

/** Legend swatch: a filled square or a dashed comparison line. */
export function ChartSwatch({ color, variant = "solid" }: { color?: string; variant?: "solid" | "dashed" }) {
  const style: CSSProperties | undefined = variant === "dashed" ? { borderColor: color } : color ? { background: color } : undefined;
  return (
    <span
      className={cn("inline-block flex-none", variant === "dashed" ? "h-0 w-3.5 border-t-2 border-dashed" : "size-2.5 rounded-xs")}
      style={style}
    />
  );
}
