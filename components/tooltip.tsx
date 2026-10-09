// Hover and focus tooltip. Fixed-positioned and clamped to the viewport, so card overflow
// never clips it and it never causes horizontal scroll.
"use client";

import { type ReactNode, useId, useRef, useState } from "react";

const WIDTH = 240;
const GUTTER = 8;

export function Tooltip({ content, children, className }: { content: string; children: ReactNode; className?: string }) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(GUTTER, rect.left + rect.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - GUTTER);
    setPosition({ top: rect.bottom + 6, left });
  };
  const hide = () => setPosition(null);

  return (
    <span
      aria-describedby={position ? id : undefined}
      className={className}
      onBlur={hide}
      onFocus={show}
      onMouseEnter={show}
      onMouseLeave={hide}
      ref={trigger}
      tabIndex={0}
    >
      {children}
      {position ? (
        <span
          className="pointer-events-none fixed z-50 flex justify-center text-left text-xs font-normal normal-case tracking-normal"
          id={id}
          role="tooltip"
          style={{ top: position.top, left: position.left, width: WIDTH }}
        >
          <span className="rounded-md bg-foreground px-2.5 py-1.5 leading-snug text-background shadow-popover">{content}</span>
        </span>
      ) : null}
    </span>
  );
}
