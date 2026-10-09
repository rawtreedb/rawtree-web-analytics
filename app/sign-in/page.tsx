// Sign-in mode only (no RAWTREE_QUERY_KEY / RAWTREE_INGEST_KEY). Layout follows
// jev-pr-quality's sign-in page: connect with a RawTree account through Vercel Connect (when
// RAWTREE_CONNECTOR is set) or with an API key, then a preview and how it works. `?method=key`
// picks the API key tab without client JavaScript. Env mode redirects to the dashboard.

import { IconChartBar, IconChevronRight, IconCode, IconDatabase, IconExternalLink, IconSend, IconShieldCheck } from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { connectorInSignInMode, envMode, getAccess, SESSION_COOKIE } from "../../lib/access.ts";
import { listWorkspaces, type Workspace } from "../../lib/rawtree-connect.ts";
import { RawTreeError, rawTreeApiUrl } from "../../lib/rawtree.ts";
import { cn } from "../../components/ui.tsx";
import rawtreeLogo from "../../components/rawtree-logo.svg";
import { BrandLines } from "../../components/sign-in/brand-lines.tsx";
import { WorkspacePicker } from "../../components/sign-in/workspace-picker.tsx";
import overview from "../../public/overview.jpg";
import { signInWithKey, signOut } from "./actions.ts";

export const dynamic = "force-dynamic";

const LINKS = {
  rawtree: "https://rawtree.com",
  docs: "https://rawtree.com/docs",
  requestAccess: "https://rawtree.com/waitlist",
  github: "https://github.com/rawtreedb/rawtree-web-analytics",
};

const panel = "rounded-2xl border bg-card p-6 shadow-soft";
const input = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary";
const button =
  "inline-flex h-9 items-center justify-center gap-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/85 disabled:opacity-50";
const link = "inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline";

const HOW_IT_WORKS = [
  { icon: IconCode, title: "Add the SDK", body: "Install @rawtree/analytics and send your own events and session recordings from the browser or backend." },
  { icon: IconSend, title: "Collect", body: "The collector validates every batch and writes it to RawTree with an insert-only key." },
  { icon: IconDatabase, title: "RawTree stores it", body: "Events land as rows in your own database. Every query counts each event once." },
  { icon: IconChartBar, title: "See it", body: "Traffic, acquisition, engagement, bots, and session replays, plus a console to send test events." },
];

type SearchParams = { expired?: string; error?: string; method?: string };

/** The visitor's organizations, clusters, and databases after connecting, or why there are none. */
async function loadPicker(connector: string | null, session: string | undefined): Promise<{ workspaces?: Workspace[]; error?: string }> {
  if (!connector || !session) return {};
  try {
    return { workspaces: await listWorkspaces(connector, session, rawTreeApiUrl()) };
  } catch (error) {
    if (error instanceof RawTreeError && error.status === 401) return {}; // not connected (yet, or anymore)
    console.error("Could not list RawTree workspaces", error);
    return { error: "RawTree sign-in is unavailable right now. You can still connect with an API key." };
  }
}

function External({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a className={className} href={href} rel="noopener noreferrer" target="_blank">
      {children}
      <IconExternalLink aria-hidden className="size-3" />
    </a>
  );
}

function RequestAccess() {
  return (
    <p className="m-0 text-sm text-muted-foreground">
      No RawTree account?{" "}
      <External className={link} href={LINKS.requestAccess}>
        Request access
      </External>
    </p>
  );
}

function KeyFields({ invalid }: { invalid: boolean }) {
  return (
    <form action={signInWithKey} className="grid gap-4">
      <label className="grid gap-1.5 text-sm font-medium">
        Read and write API key
        <input autoComplete="off" className={input} name="key" placeholder="rt_..." required type="password" />
        <span className="text-xs font-normal text-muted-foreground">
          Connecting to <span className="font-mono">{new URL(rawTreeApiUrl()).host}</span>
        </span>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Database
        <input className={input} defaultValue="web_analytics" name="database" pattern="[A-Za-z_][A-Za-z0-9_]*" required />
      </label>
      {invalid ? <p className="m-0 text-sm text-destructive">Enter a key and a valid database name.</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RequestAccess />
        <button className={button} type="submit">
          Load dashboard <IconChevronRight className="size-4" />
        </button>
      </div>
    </form>
  );
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (envMode()) redirect("/");
  const { expired, error, method } = await searchParams;
  if (!expired && (await getAccess())) redirect("/");

  const connector = connectorInSignInMode();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const picker = await loadPicker(connector, session);
  const useKey = !connector || method === "key";
  const connected = Boolean(picker.workspaces);

  return (
    <div className="flex min-h-dvh flex-col bg-background-extra">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link className="flex items-center gap-2.5 font-semibold tracking-tight" href="/sign-in">
            <Image alt="" className="h-7 w-auto" src={rawtreeLogo} />
            RawTree Web Analytics
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted-foreground max-sm:hidden">
            <External className="inline-flex items-center gap-1 hover:text-foreground" href={LINKS.docs}>
              RawTree Docs
            </External>
            <External className="inline-flex items-center gap-1 hover:text-foreground" href={LINKS.github}>
              GitHub
            </External>
          </nav>
        </div>
      </header>

      <main className="relative isolate flex flex-1 flex-col items-center overflow-hidden px-4 py-12">
        <BrandLines />
        <div className="relative z-10 flex w-full max-w-[500px] flex-col gap-4">
          <div className="grid gap-2 px-6 pb-2">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">Web analytics on RawTree</h1>
            <p className="m-0 text-sm text-muted-foreground">
              Send your own events and session recordings with one SDK, keep every row in your RawTree database, and see traffic, acquisition,
              engagement, and bots without counting retries twice.
            </p>
          </div>

          <section className={cn(panel, "grid gap-5")}>
            <div className="grid gap-3">
              <h2 className="m-0 text-lg font-semibold">Connect to RawTree</h2>
              {connector ? (
                <nav aria-label="Connection method" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
                  {[
                    { label: "RawTree account", href: "/sign-in", active: !useKey },
                    { label: "API key", href: "/sign-in?method=key", active: useKey },
                  ].map((tab) => (
                    <Link
                      aria-current={tab.active ? "page" : undefined}
                      className="flex h-9 items-center justify-center rounded-full text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-soft"
                      href={tab.href}
                      key={tab.label}
                      scroll={false}
                    >
                      {tab.label}
                    </Link>
                  ))}
                </nav>
              ) : null}
              <p className="m-0 text-sm">
                {useKey ? (
                  <>
                    Enter an API key that can <strong>read and write</strong> your analytics database: the dashboard reads it, and the console sends test
                    events to it.
                  </>
                ) : connected ? (
                  <>
                    Connected to RawTree. Choose where your events are stored.{" "}
                    <button className={link} form="disconnect" type="submit">
                      Disconnect
                    </button>
                  </>
                ) : (
                  "Sign in with your RawTree account to see your traffic, acquisition, engagement, bots, and session replays."
                )}
              </p>
              {expired ? <p className="m-0 rounded-lg bg-muted px-3 py-2 text-sm">RawTree rejected your credentials. Sign in again.</p> : null}
              {picker.error && !useKey ? <p className="m-0 text-sm text-muted-foreground">{picker.error}</p> : null}
            </div>

            {useKey ? (
              <KeyFields invalid={error === "key"} />
            ) : connected ? (
              <WorkspacePicker buttonClass={button} workspaces={picker.workspaces!} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <RequestAccess />
                <a className={button} href="/api/rawtree/connect">
                  Connect <IconChevronRight className="size-4" />
                </a>
              </div>
            )}
          </section>
          {/* Target of the Disconnect button, which sits inside a paragraph. */}
          <form action={signOut} className="hidden" id="disconnect" />

          <aside className={cn(panel, "grid gap-2 text-sm")}>
            {useKey ? (
              <>
                <p className="m-0 font-semibold">Your key stays on the server side of this app</p>
                <p className="m-0 text-muted-foreground">
                  It's kept in an HTTP-only cookie that page scripts can't read, used only to run the dashboard's own queries and the console's test
                  events, never logged, and cleared when you sign out or close the browser. Create one with{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">rtree key create --permission read_write --database web_analytics</code>.
                </p>
              </>
            ) : (
              <>
                <p className="m-0 font-semibold">No keys to copy or paste</p>
                <p className="m-0 text-muted-foreground">
                  <span className="text-foreground">Vercel Connect</span> holds your RawTree grant; this browser only keeps a session cookie. The dashboard
                  runs its own fixed queries and never accepts SQL from the browser. Disconnect revokes access.
                </p>
              </>
            )}
          </aside>
        </div>

        <figure className={cn(panel, "relative z-10 m-0 mt-12 w-full max-w-[1120px] p-3 sm:p-6")}>
          <figcaption className="mb-4 grid gap-1 px-2 pt-2 text-center sm:mb-6 sm:pt-0">
            <span className="text-lg font-semibold">What you'll see</span>
            <span className="text-sm text-muted-foreground">Traffic, acquisition, engagement, bots, and session replays. Preview uses sample data.</span>
          </figcaption>
          <Image
            alt="Dashboard preview with headline numbers, the traffic trend, and the dashboard sections"
            className="h-auto w-full rounded-xl border"
            placeholder="blur"
            sizes="(min-width: 1152px) 1072px, calc(100vw - 56px)"
            src={overview}
          />
        </figure>

        <section aria-labelledby="how-it-works" className={cn(panel, "relative z-10 mt-6 w-full max-w-[1120px]")}>
          <div className="mb-6 grid gap-1 text-center">
            <h2 className="m-0 text-lg font-semibold" id="how-it-works">
              How it works
            </h2>
            <p className="m-0 text-sm text-muted-foreground">From your app to your dashboard.</p>
          </div>
          <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-4">
            {HOW_IT_WORKS.map(({ icon: Icon, title, body }, index) => (
              <li className="grid content-start gap-3 rounded-xl border bg-muted/50 p-4" key={title}>
                <div className="flex items-center justify-between">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <span className="numeric text-xs text-muted-foreground">0{index + 1}</span>
                </div>
                <div className="grid gap-1">
                  <h3 className="m-0 text-sm font-semibold">{title}</h3>
                  <p className="m-0 text-sm text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 flex items-start gap-2">
              <IconShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              {useKey
                ? "Your site sends events with an insert-only key. Your dashboard key stays in an HTTP-only cookie."
                : "Your site sends events with an insert-only key. Viewers sign in with their own RawTree account."}
            </p>
            <External className={cn(link, "shrink-0")} href={`${LINKS.github}#-how-it-works`}>
              Technical details
            </External>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <p className="m-0 px-4 py-6 text-center text-sm text-muted-foreground">
          Web analytics powered by{" "}
          <a className="font-medium text-foreground underline-offset-4 hover:underline" href={LINKS.rawtree} rel="noopener noreferrer" target="_blank">
            RawTree
          </a>
        </p>
      </footer>
    </div>
  );
}
