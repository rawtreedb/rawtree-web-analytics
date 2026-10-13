// App shell ported from Treewatcher (components/app-shell.tsx): a floating card sidebar
// with the RawTree logo and navigation. Each page renders its own sticky toolbar,
// because only pages receive search params (the date range). /sign-in sits outside this group.
import Image from "next/image";
import rawtreeLogo from "../../components/rawtree-logo.svg";
import { IconExternalLink, IconLogout } from "@tabler/icons-react";
import { SidebarNav } from "../../components/sidebar-nav.tsx";
import { requireAccess } from "../../lib/access.ts";
import { signOut } from "../sign-in/actions.ts";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  return (
    <div className="flex min-h-screen max-md:block">
      <aside className="sticky top-3 m-3 flex h-[calc(100dvh-1.5rem)] w-60 shrink-0 flex-col gap-2 overflow-y-auto rounded-2xl bg-sidebar px-3 py-4 text-sidebar-foreground shadow-soft ring-1 ring-foreground/10 max-md:static max-md:m-0 max-md:h-auto max-md:w-auto max-md:rounded-none max-md:border-b max-md:border-sidebar-border max-md:pt-2.5 max-md:pb-1.5 max-md:shadow-none max-md:ring-0">
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
              <button className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground" type="submit">
                <IconLogout aria-hidden className="size-4" />
                Sign out
              </button>
            </form>
          )}
        </div>
      </aside>
      {/* pt-3 matches the sidebar's m-3, so the PageToolbar card lines up with the sidebar card. */}
      <main className="@container min-w-0 flex-1 px-4 pt-3 pb-4 lg:px-6 lg:pb-6">{children}</main>
    </div>
  );
}
