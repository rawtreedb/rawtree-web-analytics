// App shell ported from Treewatcher (components/app-shell.tsx): a fixed left sidebar
// with the RawTree logo and navigation. Each page renders its own sticky toolbar,
// because only pages receive search params (the date range). Signed out (sign-in mode),
// there is no sidebar: the only page that renders is /sign-in, which brings its own header and footer.
import type { Metadata } from "next";
import Image from "next/image";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import rawtreeLogo from "../components/rawtree-logo.svg";
import { IconExternalLink } from "@tabler/icons-react";
import { SidebarNav } from "../components/sidebar-nav.tsx";
import { getAccess } from "../lib/access.ts";
import { signOut } from "./sign-in/actions.ts";

export const metadata: Metadata = {
  title: "RawTree Web Analytics",
  description: "Dashboard and replay for the events collected by @rawtree/analytics.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  if (!access) {
    return (
      <html lang="en">
        <body>
          {children}
        </body>
      </html>
    );
  }
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
            <div className="mt-auto grid gap-3 max-md:mt-2">
              <nav aria-label="Resources" className="grid gap-1.5 px-2 text-sm text-muted-foreground max-md:hidden">
                {[
                  { label: "RawTree Docs", href: "https://rawtree.com/docs" },
                  { label: "GitHub", href: "https://github.com/rawtreedb/rawtree-web-analytics" },
                ].map((link) => (
                  <a className="inline-flex w-fit items-center gap-1 hover:text-foreground" href={link.href} key={link.label} rel="noopener noreferrer" target="_blank">
                    {link.label}
                    <IconExternalLink aria-hidden className="size-3" />
                  </a>
                ))}
              </nav>
              {access.mode === "env" ? null : (
                <form action={signOut} className="grid gap-1 border-t border-sidebar-border px-2 pt-3 max-md:flex max-md:items-center max-md:justify-between">
                  <span className="truncate text-xs text-muted-foreground" title={access.label}>
                    {access.label}
                  </span>
                  <button className="w-fit text-sm font-medium text-muted-foreground hover:text-foreground" type="submit">
                    Sign out
                  </button>
                </form>
              )}
            </div>
          </aside>
          {/* PageToolbar mirrors this padding with negative margins to bleed to the edges; keep them in sync. */}
          <main className="@container min-w-0 flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
