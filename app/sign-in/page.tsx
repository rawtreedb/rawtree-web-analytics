// Sign-in mode only (no RAWTREE_QUERY_KEY / RAWTREE_INGEST_KEY). Connect with a RawTree
// account through Vercel Connect (when RAWTREE_CONNECTOR is set) or with an API key, then a
// preview and how it works. `?method=key`
// picks the API key tab without client JavaScript. Once connected, the page becomes step 2 of the
// Connect flow: only the workspace picker and Disconnect. Env mode redirects to the dashboard.

import { IconChartBar, IconCheck, IconChevronRight, IconCode, IconDatabase, IconSend, IconShieldCheck } from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connectorInSignInMode, envMode, getAccess, SESSION_COOKIE } from "../../lib/access.ts";
import { listWorkspaces, type Workspace } from "../../lib/rawtree-connect.ts";
import { RawTreeError, rawTreeApiUrl } from "../../lib/rawtree.ts";
import { buttonClass } from "../../components/button.tsx";
import { ExternalLink, Notice, cardClass, cn, codeClass, focusRing, inputClass } from "../../components/ui.tsx";
import rawtreeLogo from "../../components/rawtree-logo.svg";
import { BrandLines } from "../../components/sign-in/brand-lines.tsx";
import { WorkspacePicker } from "../../components/sign-in/workspace-picker.tsx";
import overview from "../../public/overview.jpg";
import { signInWithKey, signOut } from "./actions.ts";
import { SITE } from "../../lib/site.ts";

export const dynamic = "force-dynamic";

const LINKS = {
  rawtree: "https://rawtree.com",
  docs: SITE.links.docs,
  requestAccess: "https://rawtree.com/waitlist",
  github: SITE.links.github,
};

const panel = cn(cardClass, "p-6");
const input = cn(inputClass, "h-10 w-full");
const link = cn("inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline", focusRing);

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

function RequestAccess() {
  return (
    <p className="m-0 text-sm text-muted-foreground">
      No RawTree account?{" "}
      <ExternalLink className={link} href={LINKS.requestAccess}>
        Request access
      </ExternalLink>
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
        <button className={buttonClass()} type="submit">
          Load dashboard <IconChevronRight />
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
  const connected = Boolean(picker.workspaces);
  // Once connected, the API key form is out of reach until the visitor disconnects.
  const useKey = !connected && (!connector || method === "key");

  return (
    <div className="flex min-h-dvh flex-col bg-background-extra">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link className="flex items-center gap-2.5 font-semibold tracking-tight" href="/sign-in">
            <Image alt="" className="h-7 w-auto" src={rawtreeLogo} />
            {SITE.name}
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted-foreground max-sm:hidden">
            <ExternalLink className="hover:text-foreground" href={LINKS.docs}>
              RawTree Docs
            </ExternalLink>
            <ExternalLink className="hover:text-foreground" href={LINKS.github}>
              GitHub
            </ExternalLink>
          </nav>
        </div>
      </header>

      <main className="relative isolate flex flex-1 flex-col items-center overflow-hidden px-4 py-12">
        <BrandLines />
        <div className="relative z-10 flex w-full max-w-lg flex-col gap-4">
          <div className="grid gap-2 px-6 pb-2">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">{connected ? "Choose your database" : "Web analytics on RawTree"}</h1>
            <p className="m-0 text-sm text-muted-foreground">
              {connected
                ? "Pick the RawTree organization, cluster, and database where your events are stored."
                : "Send your own events and session recordings with one SDK, keep every row in your RawTree database, and see traffic, acquisition, engagement, and bots without counting retries twice."}
            </p>
          </div>

          <section className={cn(panel, "grid gap-5")}>
            <div className="grid gap-3">
              {connected ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 flex items-center gap-2 text-sm font-semibold">
                    <span className="flex size-5 items-center justify-center rounded-full bg-success/15 text-success">
                      <IconCheck aria-hidden className="size-3.5" />
                    </span>
                    Connected to RawTree
                  </p>
                  <button className={cn(link, "text-sm")} form="disconnect" type="submit">
                    Disconnect
                  </button>
                </div>
              ) : (
                <h2 className="m-0 text-lg font-semibold tracking-tight">Connect to RawTree</h2>
              )}
              {connector && !connected ? (
                <nav aria-label="Connection method" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
                  {[
                    { label: "RawTree account", href: "/sign-in", active: !useKey },
                    { label: "API key", href: "/sign-in?method=key", active: useKey },
                  ].map((tab) => (
                    <Link
                      aria-current={tab.active ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-full text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-soft",
                        focusRing,
                      )}
                      href={tab.href}
                      key={tab.label}
                      scroll={false}
                    >
                      {tab.label}
                    </Link>
                  ))}
                </nav>
              ) : null}
              {connected ? null : (
                <p className="m-0 text-sm">
                  {useKey ? (
                    <>
                      Enter an API key that can <strong>read and write</strong> your analytics database: the dashboard reads it, and the console sends
                      test events to it.
                    </>
                  ) : (
                    "Sign in with your RawTree account to see your traffic, acquisition, engagement, bots, and session replays."
                  )}
                </p>
              )}
              {expired ? <Notice>RawTree rejected your credentials. Sign in again.</Notice> : null}
              {picker.error && !useKey ? <p className="m-0 text-sm text-muted-foreground">{picker.error}</p> : null}
            </div>

            {useKey ? (
              <KeyFields invalid={error === "key"} />
            ) : connected ? (
              <WorkspacePicker workspaces={picker.workspaces!} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <RequestAccess />
                <a className={buttonClass()} href="/api/rawtree/connect">
                  Connect <IconChevronRight />
                </a>
              </div>
            )}
          </section>
          {/* Target of the Disconnect button, which sits outside the picker's form. */}
          <form action={signOut} className="hidden" id="disconnect" />

          {connected ? null : (
            <aside className={cn(panel, "grid gap-2 text-sm")}>
              {useKey ? (
                <>
                  <p className="m-0 font-semibold">Your key stays on the server side of this app</p>
                  <p className="m-0 text-muted-foreground">
                    It's kept in an HTTP-only cookie that page scripts can't read, used only to run the dashboard's own queries and the console's test
                    events, never logged, and cleared when you sign out or close the browser. Create one with{" "}
                    <code className={codeClass}>rtree key create --permission read_write --database web_analytics</code>.
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
          )}
        </div>

        {connected ? null : (
          <>
            <figure className={cn(panel, "relative z-10 m-0 mt-12 w-full max-w-6xl p-3 sm:p-6")}>
              <figcaption className="mb-4 grid gap-1 px-2 pt-2 text-center sm:mb-6 sm:pt-0">
                <span className="text-lg font-semibold tracking-tight">What you'll see</span>
                <span className="text-sm text-muted-foreground">Traffic, acquisition, engagement, bots, and session replays. Preview uses sample data.</span>
              </figcaption>
              <Image
                alt="Dashboard preview with headline numbers, the traffic trend, and the dashboard sections"
                className="h-auto w-full rounded-xl border"
                placeholder="blur"
                sizes="(min-width: 1184px) 1104px, calc(100vw - 56px)"
                src={overview}
              />
            </figure>

            <section aria-labelledby="how-it-works" className={cn(panel, "relative z-10 mt-6 w-full max-w-6xl")}>
              <div className="mb-6 grid gap-1 text-center">
                <h2 className="m-0 text-lg font-semibold tracking-tight" id="how-it-works">
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
                <ExternalLink className={cn(link, "shrink-0")} href={`${LINKS.github}#-how-it-works`}>
                  Technical details
                </ExternalLink>
              </div>
            </section>
          </>
        )}
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
