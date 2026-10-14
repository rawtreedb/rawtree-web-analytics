// Shared class names for every component. `cn` also resolves conflicting Tailwind utilities
// so a `className` override wins.
import { twMerge } from "tailwind-merge";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return twMerge(classes);
}

/** The card frame used by every panel: dashboard cards, the toolbar, the sidebar, sign-in panels. */
export const cardClass = "rounded-2xl bg-card text-card-foreground shadow-soft ring-1 ring-foreground/10";

/** The one keyboard focus ring, shared by buttons, inputs, links, and segmented controls. */
export const focusRing = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Text inputs and select triggers; set the height and width where they are used. */
export const inputClass = cn("rounded-lg border bg-background px-3 text-sm focus-visible:border-ring", focusRing);

/** Inline code and IDs inside running text. */
export const codeClass = "rounded bg-muted px-1 py-0.5 font-mono text-xs";
