// Styles from rawtree-platform/frontend/src/components/ui/switch.tsx, rebuilt on a native
// <button role="switch"> so no headless UI dependency is needed.
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

type SwitchProps = Omit<ComponentProps<"button">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function Switch({ className, checked, onCheckedChange, disabled, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      data-checked={checked ? "" : undefined}
      data-unchecked={checked ? undefined : ""}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group/switch relative inline-flex h-[18.4px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-checked:bg-primary data-unchecked:border-border data-unchecked:bg-muted-foreground/30 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform",
          checked ? "translate-x-[calc(100%-2px)]" : "translate-x-0",
        )}
      />
    </button>
  );
}

export { Switch };
