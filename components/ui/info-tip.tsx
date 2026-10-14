import { IconInfoCircle } from "@tabler/icons-react";
import { cn, focusRing } from "./styles.ts";
import { Tooltip } from "./tooltip.tsx";

/** Small "i" marker whose explanation shows on hover or focus. */
export function InfoTip({ children }: { children: string }) {
  return (
    <Tooltip
      className={cn("inline-grid size-4.5 flex-none cursor-help place-items-center rounded-full text-extra-muted-foreground hover:text-primary focus-visible:text-primary", focusRing)}
      content={children}
    >
      <IconInfoCircle aria-label="More info" className="size-4" role="img" stroke={1.5} />
    </Tooltip>
  );
}
