// The one button style. A native <button> with no client code, so server components can
// render it too; `buttonClass` gives the same look to links and to third-party parts.
import type { ComponentProps } from "react";
import { cn, focusRing } from "./styles.ts";

const variants = {
  default: "bg-primary font-semibold text-primary-foreground hover:bg-primary/85",
  outline: "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
  ghost: "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
} as const;

const sizes = {
  default: "h-9 gap-1.5 px-4",
  sm: "h-8 gap-1 px-3",
  icon: "size-9",
} as const;

type ButtonVariant = keyof typeof variants;
type ButtonSize = keyof typeof sizes;

export function buttonClass(variant: ButtonVariant = "default", size: ButtonSize = "default", className?: string): string {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all select-none focus-visible:border-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing,
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ variant, size, className, type = "button", ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} type={type} {...props} />;
}
