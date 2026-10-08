// Primary navigation, trimmed from Treewatcher's components/sidebar-nav.tsx: the
// dashboard with its section anchors (highlighted as they scroll past) and Recordings.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "./ui.tsx";

/** Anchors rendered by the dashboard on `/`; keep in sync with its section ids. */
const sections = [
  { id: "overview", label: "Overview" },
  { id: "traffic", label: "Traffic" },
  { id: "acquisition", label: "Acquisition" },
  { id: "content", label: "Content" },
  { id: "engagement", label: "Engagement" },
  { id: "bots", label: "Bots" },
] as const;

function Icon({ d }: { d: string }) {
  return (
    <svg className="size-4.5 flex-none" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

const itemClass =
  "flex min-h-9 items-center gap-2.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary max-md:justify-center";

export function SidebarNav() {
  const pathname = usePathname();
  const onDashboard = pathname === "/";
  const active = useActiveSection(onDashboard);

  return (
    <nav aria-label="Primary navigation" className="grid gap-0.5 max-md:grid-cols-2 max-md:gap-1">
      <p className="eyebrow mb-1 px-2.5 max-md:hidden">Web analytics</p>
      <Link aria-current={onDashboard ? "page" : undefined} className={itemClass} href="/">
        <Icon d="M3 16V9m7 7V4m7 12v-5M2 16.5h16" />
        <span>Dashboard</span>
      </Link>
      {onDashboard ? (
        <ul
          aria-label="Dashboard sections"
          className="mt-1 mb-1.5 ml-5 grid list-none gap-0.5 border-l border-sidebar-border pl-2 max-md:col-span-full max-md:row-start-2 max-md:m-0 max-md:flex max-md:gap-1 max-md:overflow-x-auto max-md:border-l-0 max-md:p-0 max-md:no-scrollbar"
        >
          {sections.map(({ id, label }) => (
            <li key={id}>
              <a
                aria-current={active === id ? "location" : undefined}
                className={cn(
                  "block rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground max-md:whitespace-nowrap",
                  // The active marker sits on the list's left border: pl-2 plus the 1px border.
                  active === id &&
                    "relative font-semibold text-foreground before:absolute before:inset-y-1.5 before:-left-2.25 before:w-0.5 before:rounded-xs before:bg-primary max-md:bg-muted max-md:before:hidden",
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
        <Icon d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM8.5 7.25v5.5l4.25-2.75z" />
        <span>Recordings</span>
      </Link>
    </nav>
  );
}
