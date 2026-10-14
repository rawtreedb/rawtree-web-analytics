import { IconExternalLink } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { cn } from "./styles.ts";

/** Link that opens in a new tab, marked with an external-link icon. */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a className={cn("inline-flex items-center gap-1", className)} href={href} rel="noopener noreferrer" target="_blank">
      {children}
      <IconExternalLink aria-hidden className="size-3" />
    </a>
  );
}
