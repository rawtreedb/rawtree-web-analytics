// Primary navigation: the dashboard with its section anchors (highlighted as they scroll
// past), Recordings, and the test Console.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChartBar, IconCirclePlay, IconTerminal } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { cn, focusRing } from "./ui/styles.ts";

/** Anchors rendered by the dashboard on `/`; keep in sync with its section ids. */
const sections = [
  { id: "overview", label: "Overview" },
  { id: "traffic", label: "Traffic" },
  { id: "acquisition", label: "Acquisition" },
  { id: "content", label: "Content" },
  { id: "engagement", label: "Engagement" },
  { id: "bots", label: "Bots" },
] as const;

/** The last section whose top has scrolled past the sticky toolbar; the final one at page bottom. */
function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState<string>(sections[0].id);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Anchor jumps place a section at its scroll margin, which clears the sticky toolbar.
      const first = document.getElementById(sections[0].id);
      const margin = first ? Number.parseFloat(getComputedStyle(first).scrollMarginTop) || 0 : 0;
      const toolbar = document.querySelector("main header")?.getBoundingClientRect().bottom ?? 0;
      const line = Math.max(margin, toolbar) + 16;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current: string = sections[0].id;
      for (const { id } of sections) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && (top <= line || atBottom)) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [enabled]);
  return active;
}

const itemClass = cn(
  "flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground max-md:justify-center",
  focusRing,
);
const iconClass = "size-4.5 flex-none";

export function SidebarNav() {
  const pathname = usePathname();
  const onDashboard = pathname === "/";
  const active = useActiveSection(onDashboard);

  return (
    <nav aria-label="Primary navigation" className="grid gap-0.5 max-md:grid-cols-3 max-md:gap-1">
      <p className="eyebrow mb-1 px-2.5 max-md:hidden">Web analytics</p>
      <Link aria-current={onDashboard ? "page" : undefined} className={itemClass} href="/">
        <IconChartBar aria-hidden className={iconClass} stroke={1.6} />
        <span>Dashboard</span>
      </Link>
      {onDashboard ? (
        <ul
          aria-label="Dashboard sections"
          className="mt-1 mb-1.5 ml-5 grid list-none gap-0.5 border-l pl-2 max-md:col-span-full max-md:row-start-2 max-md:m-0 max-md:flex max-md:gap-1 max-md:overflow-x-auto max-md:border-l-0 max-md:p-0 max-md:no-scrollbar"
        >
          {sections.map(({ id, label }) => (
            <li key={id}>
              <a
                aria-current={active === id ? "location" : undefined}
                className={cn(
                  "block rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground max-md:whitespace-nowrap",
                  focusRing,
                  // The active marker sits on the list's left border: pl-2 plus the 1px border.
                  active === id &&
                    "relative font-semibold text-foreground before:absolute before:inset-y-1.5 before:-left-2.25 before:w-0.5 before:rounded-xs before:bg-foreground max-md:bg-muted max-md:before:hidden",
                )}
                href={`#${id}`}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <Link aria-current={pathname.startsWith("/recordings") ? "page" : undefined} className={cn(itemClass, "max-md:row-start-1 max-md:col-start-2")} href="/recordings">
        <IconCirclePlay aria-hidden className={iconClass} stroke={1.6} />
        <span>Recordings</span>
      </Link>
      <Link aria-current={pathname.startsWith("/console") ? "page" : undefined} className={cn(itemClass, "max-md:row-start-1 max-md:col-start-3")} href="/console">
        <IconTerminal aria-hidden className={iconClass} stroke={1.6} />
        <span>Console</span>
      </Link>
    </nav>
  );
}
