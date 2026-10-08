// Trimmed from rawtree-platform/frontend/src/components/ui/badge.tsx (plain <span>).
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        info: "bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)] border-[var(--badge-info-border)]",
        purple: "bg-[var(--badge-purple-bg)] text-[var(--badge-purple-fg)] border-[var(--badge-purple-border)]",
        warning: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-fg)] border-[var(--badge-warning-border)]",
        success: "bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)] border-[var(--badge-success-border)]",
        error: "bg-[var(--badge-error-bg)] text-[var(--badge-error-fg)] border-[var(--badge-error-border)]",
        default: "bg-primary text-primary-foreground",
        secondary: "border-current bg-secondary text-muted-foreground/75",
        outline: "border-border bg-input/30 text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, type BadgeVariant };
