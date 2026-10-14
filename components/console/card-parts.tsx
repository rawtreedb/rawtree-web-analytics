// Small pieces shared by the console cards: the card title with an icon, the subheading
// class, and the on/off switch.
import type { ReactNode } from "react";
import { cn, focusRing } from "../ui/styles.ts";

export const subhead = "eyebrow flex items-center gap-1.5";

export const cardTitle = (icon: ReactNode, text: string) => (
  <span className="flex items-center gap-2">
    {/* Centered on the line box, the icon reads low next to Geist's capitals; nudge it up. */}
    <span className="-translate-y-px text-muted-foreground">{icon}</span>
    {text}
  </span>
);

/** On/off switch as a native button. */
export function Switch({ checked, onCheckedChange, disabled, id }: { checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; id: string }) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-all disabled:cursor-not-allowed disabled:opacity-50",
        focusRing,
        checked ? "bg-primary" : "border-border bg-muted-foreground/30",
      )}
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span className={cn("pointer-events-none block size-4 rounded-full bg-background transition-transform", checked && "translate-x-3.5")} />
    </button>
  );
}
