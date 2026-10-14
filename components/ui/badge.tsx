import type { ComponentProps } from "react";
import { cn } from "./styles.ts";

export type BadgeVariant = "success" | "error" | "warning" | "info" | "purple" | "secondary";

const badgeVariants: Record<BadgeVariant, string> = {
  info: "border-badge-info-fg/20 bg-badge-info-bg text-badge-info-fg",
  purple: "border-badge-purple-fg/20 bg-badge-purple-bg text-badge-purple-fg",
  warning: "border-badge-warning-fg/20 bg-badge-warning-bg text-badge-warning-fg",
  success: "border-badge-success-fg/20 bg-badge-success-bg text-badge-success-fg",
  error: "border-badge-error-fg/20 bg-badge-error-bg text-badge-error-fg",
  secondary: "border-border bg-secondary text-muted-foreground",
};

export function Badge({ variant = "secondary", className, ...props }: ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn("inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", badgeVariants[variant], className)}
      {...props}
    />
  );
}
