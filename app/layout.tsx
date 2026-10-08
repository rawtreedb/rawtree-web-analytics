// App shell ported from Treewatcher (components/app-shell.tsx): a fixed left sidebar
// with the RawTree logo and navigation. Each page renders its own sticky toolbar,
// because only pages receive search params (the date range).
import type { Metadata } from "next";
import Image from "next/image";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import rawtreeLogo from "../components/rawtree-logo.svg";
import { SidebarNav } from "../components/sidebar-nav.tsx";

export const metadata: Metadata = {
  title: "RawTree Web Analytics",
  description: "Dashboard and replay for the events collected by @rawtree/analytics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen max-md:block">
          <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-2 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground max-md:static max-md:h-auto max-md:w-auto max-md:border-r-0 max-md:border-b max-md:pt-2.5 max-md:pb-1.5">
            <div className="flex items-center gap-3 px-2 pt-1 pb-4 font-semibold tracking-tight max-md:hidden">
              <Image alt="" className="h-8 w-auto" src={rawtreeLogo} />
              <span className="grid leading-tight">
                RawTree
                <small className="text-2xs font-medium tracking-normal text-muted-foreground">Web analytics</small>
              </span>
            </div>
            <SidebarNav />
          </aside>
          {/* PageToolbar mirrors this padding with negative margins to bleed to the edges; keep them in sync. */}
          <main className="@container min-w-0 flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
