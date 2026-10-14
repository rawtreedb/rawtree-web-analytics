import type { ComponentProps } from "react";
import { cn } from "./styles.ts";

const noticeVariants = {
  error: "border-badge-error-fg/20 bg-badge-error-bg text-badge-error-fg",
  warning: "border-badge-warning-fg/20 bg-badge-warning-bg text-badge-warning-fg",
  neutral: "bg-muted",
} as const;

/** Tinted message box for errors, warnings, and neutral notes. */
export function Notice({ variant = "neutral", className, ...props }: ComponentProps<"p"> & { variant?: keyof typeof noticeVariants }) {
  return <p className={cn("m-0 rounded-xl border border-transparent px-4 py-3 text-sm", noticeVariants[variant], className)} {...props} />;
}
