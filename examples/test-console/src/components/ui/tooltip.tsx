// Minimal hover/focus tooltip. Rendered in a portal with fixed positioning so cards with
// overflow-hidden and the scrolling sidebar never clip it.
import { IconInfoCircle } from "@tabler/icons-react";
import { type ReactNode, useId, useState } from "react";
import { createPortal } from "react-dom";

export function InfoTooltip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  const id = useId();
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setPosition({ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 296) });
  };
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-describedby={position ? id : undefined}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-extra-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={() => setPosition(undefined)}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setPosition(undefined)}
      >
        <IconInfoCircle className="size-3.5" />
      </button>
      {position &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{ top: position.top, left: position.left }}
            className="pointer-events-none fixed z-50 w-72 rounded-lg bg-foreground px-3 py-2 text-xs leading-relaxed font-normal normal-case tracking-normal text-background shadow-lg"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
