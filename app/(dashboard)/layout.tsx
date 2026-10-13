// App shell: a floating card sidebar with the logo and navigation. Each page renders its own sticky toolbar,
// because only pages receive search params (the date range). /sign-in sits outside this group.
import Image from "next/image";
import rawtreeLogo from "../../components/rawtree-logo.svg";
import { IconLogout } from "@tabler/icons-react";
import { Button } from "../../components/button.tsx";
import { SidebarNav } from "../../components/sidebar-nav.tsx";
import { ExternalLink, cardClass, cn } from "../../components/ui.tsx";
import { requireAccess } from "../../lib/access.ts";
import { signOut } from "../sign-in/actions.ts";
import { SITE } from "../../lib/site.ts";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  return (
    <div className="flex min-h-screen max-md:block">
      <aside
        className={cn(
          cardClass,
          "sticky top-3 m-3 flex h-[calc(100dvh-1.5rem)] w-60 shrink-0 flex-col gap-2 overflow-y-auto px-3 py-4 max-md:static max-md:m-0 max-md:h-auto max-md:w-auto max-md:rounded-none max-md:border-b max-md:pt-2.5 max-md:pb-1.5 max-md:shadow-none max-md:ring-0",
        )}
      >
        <div className="flex items-center gap-3 px-2 pt-1 pb-4 font-semibold tracking-tight max-md:hidden">
          <Image alt="" className="h-8 w-auto" src={rawtreeLogo} />
          <span className="grid leading-tight">
            {SITE.shortName}
            <small className="text-2xs font-medium tracking-normal text-muted-foreground">{SITE.tagline}</small>
          </span>
        </div>
        <SidebarNav />
        <div className="mt-auto grid gap-3 max-md:mt-2">
          <nav aria-label="Resources" className="grid gap-1.5 px-2 text-sm text-muted-foreground max-md:hidden">
            {[
              { label: "RawTree Docs", href: SITE.links.docs },
              { label: "GitHub", href: SITE.links.github },
            ].map((link) => (
              <ExternalLink className="w-fit hover:text-foreground" href={link.href} key={link.label}>
                {link.label}
              </ExternalLink>
            ))}
          </nav>
          {access.mode === "env" ? null : (
            <form action={signOut} className="grid gap-1 border-t pt-3 max-md:flex max-md:items-center max-md:justify-between">
              <span className="truncate px-2 text-xs text-muted-foreground" title={access.label}>
                {access.label}
              </span>
              <Button className="w-fit px-2 text-muted-foreground" size="sm" type="submit" variant="ghost">
                <IconLogout aria-hidden />
                Sign out
              </Button>
            </form>
          )}
        </div>
      </aside>
      {/* pt-3 matches the sidebar's m-3, so the PageToolbar card lines up with the sidebar card. */}
      <main className="@container min-w-0 flex-1 px-4 pt-3 pb-4 lg:px-6 lg:pb-6">{children}</main>
    </div>
  );
}
