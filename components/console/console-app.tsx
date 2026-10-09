// The test console page (/console): consent switches, browser and server events, simulated
// bot and campaign traffic, a recording playground with privacy checks, and an event viewer
// that follows each item from Queued to Sent (collector 200) to Stored (found in RawTree).
// Everything goes through the real SDK to /api/console/collect with the visitor's credentials.
"use client";

import type { Properties } from "@rawtree/analytics";
import {
  IconArrowRight,
  IconBrowser,
  IconCheck,
  IconCloudUpload,
  IconPlayerRecord,
  IconRobot,
  IconRefresh,
  IconRepeat,
  IconSend,
  IconServer,
  IconShieldCheck,
  IconTargetArrow,
  IconX,
} from "@tabler/icons-react";
import { type ComponentProps, Fragment, type ReactNode, useEffect, useState } from "react";
import { Button } from "../date/button.tsx";
import { Badge, DashboardCard, InfoTip, PageToolbar, cn } from "../ui.tsx";
import {
  COLLECT_ENDPOINT,
  type Delivery,
  type Entry,
  findInSentRecordings,
  flush,
  resetIdentity,
  sendBrowserEvent,
  sendAsVisitor,
  sendServerEvent,
  setConsent,
  setMaskText,
  startConsole,
  stopConsole,
  type Storage,
  useConsole,
} from "./console-store.ts";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

const pageViewId = crypto.randomUUID();
const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
const shortId = () => crypto.randomUUID().slice(0, 8);

/** Recipe-shaped example events (see examples/recipes/RECIPES.md). */
const BROWSER_EVENTS: { name: string; props: () => Properties }[] = [
  { name: "page_view", props: () => ({ page_view_id: pageViewId, path: location.pathname, navigation: "initial" }) },
  { name: "cta_click", props: () => ({ cta_id: "pricing_start_trial", placement: "pricing_table" }) },
  { name: "scroll_depth", props: () => ({ page_view_id: pageViewId, path: location.pathname, threshold: 50, scrollable: true }) },
  {
    name: "time_on_page",
    props: () => {
      const visible = rand(4000, 40000);
      return { page_view_id: pageViewId, path: location.pathname, visible_ms: visible, elapsed_ms: visible + rand(0, 8000) };
    },
  },
  {
    name: "web_vital",
    props: () => {
      const value = rand(900, 3200);
      return { metric_name: "LCP", metric_id: `v5-${Date.now()}-${rand(1e12, 9e12)}`, value, delta: value, rating: value <= 2500 ? "good" : "needs-improvement", navigation_type: "navigate" };
    },
  },
  { name: "project_created", props: () => ({ project_id: `prj_${shortId()}`, template: "blank" }) },
  { name: "feature_used", props: () => ({ feature: "search" }) },
];

/** One preset per crawler category in lib/crawlers.ts (dashboard Bots section). */
const BOTS: { label: string; userAgent: string }[] = [
  { label: "GPTBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot" },
  { label: "ClaudeBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { label: "PerplexityBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
  { label: "Googlebot", userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  { label: "Bingbot", userAgent: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
  { label: "facebookexternalhit", userAgent: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
  { label: "AhrefsBot", userAgent: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)" },
  { label: "curl", userAgent: "curl/8.7.1" },
  { label: "HeadlessChrome", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36" },
  { label: "ExampleBot", userAgent: "ExampleBot/1.0 (+https://example.com/bot)" },
];

/** Campaign visits; utm_* survive the SDK URL sanitizer (allowedQueryParams default). */
const VISITS: { label: string; referrer: string; query: string }[] = [
  { label: "Google ad", referrer: "https://www.google.com/", query: "utm_source=google&utm_medium=cpc&utm_campaign=launch" },
  { label: "Newsletter", referrer: "", query: "utm_source=newsletter&utm_medium=email&utm_campaign=october" },
  { label: "Hacker News", referrer: "https://news.ycombinator.com/", query: "" },
];

const visitorPageView = (path: string) => ({ page_view_id: crypto.randomUUID(), path, navigation: "initial" });

const SERVER_EVENTS: { name: string; props: Properties }[] = [
  { name: "signup_completed", props: { plan: "pro", method: "password" } },
  { name: "login_succeeded", props: { method: "password" } },
  { name: "export_completed", props: { format: "markdown" } },
];

export function ConsoleApp({ database }: { database: string }) {
  const { identity } = useConsole();
  useEffect(() => {
    startConsole();
    return stopConsole;
  }, []);
  // With two columns (@5xl) the console fills the viewport (main's padding is p-4 lg:p-6):
  // toolbar and consent stay put, the controls column and the event table scroll on their own.
  return (
    <div className="flex w-full flex-col @5xl:h-[calc(100dvh-3rem)]">
      <PageToolbar
        title="Console"
        badges={<Badge variant="warning">Test events</Badge>}
        meta={
          <>
            <span className="text-foreground">
              A test console: everything you send from this page is synthetic data, written to your database and counted on the dashboard.
            </span>
          </>
        }
        filters={
          <>
            <Button variant="outline" size="sm" onClick={() => void flush()} disabled={!identity}>
              <IconSend /> Flush now
            </Button>
            <Button variant="outline" size="sm" onClick={resetIdentity} disabled={!identity}>
              <IconRefresh /> Reset identity
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <ConsentBar database={database} />
        <div className="grid min-h-0 flex-1 gap-4 @5xl:grid-cols-[400px_minmax(0,1fr)]">
          <div className="grid min-h-0 auto-rows-max content-start gap-4 @5xl:-mr-2 @5xl:overflow-y-auto @5xl:overscroll-contain @5xl:pr-2">
            <BrowserEventsCard />
            <ServerEventsCard />
            <TrafficCard />
            <PlaygroundCard />
          </div>
          <EventViewer />
        </div>
      </div>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-foreground">{children}</span>;
}

function IdField({ label, value, testId, variant }: { label: string; value?: string; testId: string; variant: BadgeVariant }) {
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1.5">
      {label}
      <Badge variant={value ? variant : "secondary"} className="h-auto min-w-0 shrink font-mono font-normal break-all whitespace-normal" data-testid={testId}>
        {value ?? "—"}
      </Badge>
    </span>
  );
}

/** On/off switch (native button, styles from rawtree-platform's switch). */
function Switch({ checked, onCheckedChange, disabled, id }: { checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; id: string }) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-[18.4px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "border-border bg-muted-foreground/30",
      )}
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span className={cn("pointer-events-none block size-4 rounded-full bg-background transition-transform", checked && "translate-x-[calc(100%-2px)]")} />
    </button>
  );
}

const inputClass = "rounded-lg border bg-input px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const subhead = "eyebrow flex items-center gap-1.5";

function ConsentBar({ database }: { database: string }) {
  const { consent, recording, identity } = useConsole();
  return (
    <section aria-label="Consent" className="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl bg-card px-5 py-3 text-sm shadow-soft ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 font-semibold">
        <IconShieldCheck className="size-4 text-primary" /> Consent
        <span className="text-xs font-normal text-muted-foreground">Nothing is sent until analytics is allowed. Stored in localStorage.</span>
      </div>
      <label className="flex items-center gap-3">
        <Switch id="consent-analytics" checked={consent.analytics} onCheckedChange={(on) => setConsent({ analytics: on, recording: on && consent.recording })} />
        Analytics
      </label>
      <label className="flex items-center gap-3">
        <Switch id="consent-recording" checked={consent.recording} disabled={!consent.analytics} onCheckedChange={(on) => setConsent({ analytics: consent.analytics, recording: on })} />
        <span>
          Session recording <span className="text-muted-foreground">(requires analytics)</span>
        </span>
        {recording !== "off" && (
          <Badge variant={recording === "on" ? "error" : "warning"} data-testid="recording-badge">
            <IconPlayerRecord className="size-3" /> {recording === "on" ? "recording" : "loading recorder"}
          </Badge>
        )}
      </label>
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-2.5 text-xs text-muted-foreground">
        <span>
          Collector <Mono>{COLLECT_ENDPOINT}</Mono> · Database <Mono>{database}</Mono>
        </span>
        <IdField label="anonymous_id" value={identity?.anonymousId} testId="anonymous-id" variant="info" />
        <IdField label="session_id" value={identity?.sessionId} testId="session-id" variant="purple" />
        <IdField label="recording_id" value={identity?.recordingId} testId="recording-id" variant="warning" />
      </div>
    </section>
  );
}

const cardTitle = (icon: ReactNode, text: string) => (
  <span className="flex items-center gap-2">
    {icon}
    {text}
  </span>
);

function BrowserEventsCard() {
  const { consent } = useConsole();
  const [name, setName] = useState("checkout_started");
  const [json, setJson] = useState('{\n  "plan": "pro",\n  "seats": 3\n}');
  const [error, setError] = useState<string>();

  const sendCustom = () => {
    let properties: unknown;
    try {
      properties = JSON.parse(json);
    } catch (parseError) {
      return setError(`Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
    if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return setError("Properties must be a JSON object");
    if (!name.trim()) return setError("Event name is required");
    const id = sendBrowserEvent(name.trim(), properties as Properties);
    setError(id ? undefined : "The SDK rejected the event (see the viewer)");
  };

  return (
    <DashboardCard
      title={cardTitle(<IconBrowser className="size-4 text-primary" />, "Browser events")}
      description={consent.analytics ? "Recipe-shaped events with example properties." : "Turn on analytics consent to send events."}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {BROWSER_EVENTS.map((event) => (
            <Button key={event.name} variant="secondary" size="sm" disabled={!consent.analytics} data-action={event.name} onClick={() => sendBrowserEvent(event.name, event.props())}>
              {event.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t pt-4">
          <span className={subhead}>Custom event</span>
          <input id="custom-name" className={cn(inputClass, "h-9 font-mono text-sm")} value={name} onChange={(event) => setName(event.target.value)} aria-label="Event name" />
          <textarea
            id="custom-properties"
            className={cn(inputClass, "min-h-24 py-2 font-mono text-xs")}
            value={json}
            onChange={(event) => setJson(event.target.value)}
            aria-label="Properties (JSON)"
          />
          {error && (
            <p className="text-xs text-destructive" data-testid="custom-error">
              {error}
            </p>
          )}
          <Button id="custom-send" size="sm" className="self-start" disabled={!consent.analytics} onClick={sendCustom}>
            <IconSend /> Send custom event
          </Button>
        </div>
      </div>
    </DashboardCard>
  );
}

function ServerEventsCard() {
  const { lastServerEvent } = useConsole();
  return (
    <DashboardCard
      title={cardTitle(<IconServer className="size-4 text-primary" />, "Server events")}
      description="Sent by this app's server with createServerAnalytics and a stable event ID."
      info="Server events need no consent: they record outcomes your backend already knows. Resending with the same ID still counts once."
    >
      <div className="flex flex-wrap gap-2">
        {SERVER_EVENTS.map((event) => (
          <Button key={event.name} variant="secondary" size="sm" data-action={event.name} onClick={() => void sendServerEvent(event.name, event.props)}>
            {event.name}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          id="server-resend"
          disabled={!lastServerEvent}
          onClick={() => lastServerEvent && void sendServerEvent(lastServerEvent.name, lastServerEvent.properties, lastServerEvent.eventId)}
        >
          <IconRepeat /> Resend last with same ID
        </Button>
      </div>
    </DashboardCard>
  );
}

function TrafficCard() {
  const { consent } = useConsole();
  return (
    <DashboardCard
      title={cardTitle(<IconRobot className="size-4 text-primary" />, "Simulated traffic")}
      info="Each click is a new visitor (own anonymous_id and session_id) sending one page_view. Your own IDs are untouched."
      description={consent.analytics ? "Crawler visits and campaign visits for the dashboard." : "Turn on analytics consent to send events."}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className={subhead}>Bots (user agent override)</span>
          <div className="flex flex-wrap gap-2">
            {BOTS.map((bot) => (
              <Button
                key={bot.label}
                variant="secondary"
                size="sm"
                disabled={!consent.analytics}
                data-bot={bot.label}
                title={bot.userAgent}
                onClick={() => void sendAsVisitor("page_view", visitorPageView(location.pathname), { userAgent: bot.userAgent, referrer: "" })}
              >
                {bot.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t pt-4">
          <span className={subhead}>
            <IconTargetArrow className="size-3.5" /> Acquisition (referrer + UTM)
          </span>
          <div className="flex flex-wrap gap-2">
            {VISITS.map((visit) => (
              <Button
                key={visit.label}
                variant="secondary"
                size="sm"
                disabled={!consent.analytics}
                data-visit={visit.label}
                title={`referrer ${visit.referrer || "(none)"} · ?${visit.query}`}
                onClick={() => {
                  const url = `/pricing${visit.query ? `?${visit.query}` : ""}`;
                  void sendAsVisitor("page_view", visitorPageView("/pricing"), { url, referrer: visit.referrer });
                }}
              >
                {visit.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}

const SECRETS = {
  blocked: "sk_test_SENTINEL_123",
  token: "SENTINEL_URL",
  email: "jane.doe@example.com",
  panel: "A panel that opens and closes.",
};

function PlaygroundCard() {
  const { recording, recordingBytesSent, maskText } = useConsole();
  const [items, setItems] = useState<string[]>(["First item"]);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const typedNeedle = typed.trim().length >= 3 ? typed.trim() : undefined;
  const found = findInSentRecordings([...Object.values(SECRETS), encodeURIComponent(SECRETS.email), ...(typedNeedle ? [typedNeedle] : [])]);
  const checks: { label: string; leaked: boolean | undefined }[] = [
    { label: "Text typed in the input", leaked: typedNeedle ? found[typedNeedle] : undefined },
    { label: "API key inside the rr-block region", leaked: found[SECRETS.blocked] },
    { label: "Token in the link URL", leaked: found[SECRETS.token] },
    { label: "Email in the data-email attribute", leaked: found[SECRETS.email] || found[encodeURIComponent(SECRETS.email)] },
  ];
  // Page text is readable unless "Mask all text" is on, so the panel text is only a privacy check then.
  const panelSeen = open || recordingBytesSent > 0 ? found[SECRETS.panel] : undefined;
  return (
    <DashboardCard
      title={cardTitle(<IconPlayerRecord className="size-4 text-primary" />, "Recording playground")}
      info="Session recording captures the page structure and every change to it (plus clicks, scrolls, and typing), not video. Replay rebuilds the page from that data."
      description={recording === "off" ? "Turn on session recording in the consent row first." : "Change the page and check what stays private."}
      action={
        <label className="flex items-center gap-2 text-xs">
          <Switch id="mask-text" checked={maskText} onCheckedChange={setMaskText} />
          Mask all text
        </label>
      }
    >
      <div className="flex flex-col gap-5">
        <Step3 title="1. Make the page change" tip="Each click adds or removes elements, which the recorder captures. New recording parts then appear in the event viewer.">
          <div className="flex gap-2">
            <Button id="add-item" variant="secondary" size="sm" onClick={() => setItems((list) => [...list, `Item ${list.length + 1}`])}>
              Add list item
            </Button>
            <Button id="toggle-panel" variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>
              {open ? "Close panel" : "Open panel"}
            </Button>
          </div>
          <ul id="playground-list" className="list-inside list-disc text-muted-foreground">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {open && (
            <div id="playground-panel" className="rounded-xl border bg-muted p-3 text-muted-foreground">
              {SECRETS.panel}
            </div>
          )}
        </Step3>

        <Step3 title="2. Private content" tip="Each example below must never reach the stored recording. Step 3 checks it.">
          <Example label="Masked input" tip="Inputs are masked: whatever you type is recorded as ****.">
            <input id="masked-input" value={typed} onChange={(event) => setTyped(event.target.value)} className={cn(inputClass, "h-9 w-full text-sm")} placeholder="Type something, e.g. your name" />
          </Example>
          <Example label="Blocked region" tip="Elements with the class rr-block are not recorded at all; the replay shows an empty box of the same size. Use it for areas like billing details.">
            <div className="rr-block rounded-xl border border-dashed p-3 font-mono text-xs">
              API key <span>{SECRETS.blocked}</span>
            </div>
          </Example>
          <Example label="Link with a token" tip="Link addresses lose their ?query and #hash before they are recorded, because these often carry tokens. The link text has the rr-mask class, which masks it even when page text is readable.">
            <a href={`/?token=${SECRETS.token}`} className="rr-mask text-xs text-primary underline-offset-4 hover:underline" onClick={(event) => event.preventDefault()}>
              /?token={SECRETS.token}
            </a>
          </Example>
          <Example label="Email in an attribute" tip="rrweb does not mask attributes by itself, so the SDK masks any attribute value that contains an email address. The visible text uses rr-mask.">
            <span data-email={SECRETS.email} className="rr-mask font-mono text-xs text-muted-foreground">
              {'<span data-email="jane.doe@example.com">'}
            </span>
          </Example>
        </Step3>

        <Step3
          title="3. Privacy check"
          tip="Searches the recording data the collector accepted for each private value. Page text is readable by default; turn on Mask all text and the panel text disappears too."
          extra={<Badge>{(recordingBytesSent / 1024).toFixed(1)} KB checked</Badge>}
        >
          <ul className="flex flex-col gap-1.5" data-testid="privacy-checks">
            {checks.map((check) => (
              <li key={check.label} className="flex items-center justify-between gap-3 text-xs">
                <span>{check.label}</span>
                {recordingBytesSent === 0 || check.leaked === undefined ? (
                  <Badge>{recordingBytesSent === 0 ? "no recording data yet" : "type something first"}</Badge>
                ) : check.leaked ? (
                  <Badge variant="error">
                    <IconX className="size-3" /> found in recording
                  </Badge>
                ) : (
                  <Badge variant="success">
                    <IconCheck className="size-3" /> not in recording
                  </Badge>
                )}
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 text-xs">
              <span>Panel text {maskText ? "(masked)" : "(readable)"}</span>
              {recordingBytesSent === 0 || panelSeen === undefined ? (
                <Badge>{recordingBytesSent === 0 ? "no recording data yet" : "open the panel first"}</Badge>
              ) : panelSeen ? (
                <Badge variant={maskText ? "error" : "info"}>found in recording</Badge>
              ) : (
                <Badge variant={maskText ? "success" : "secondary"}>not in recording</Badge>
              )}
            </li>
          </ul>
        </Step3>
      </div>
    </DashboardCard>
  );
}

function Step3({ title, tip, extra, children }: { title: string; tip: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className={subhead}>
        {title}
        <InfoTip>{tip}</InfoTip>
        {extra && <span className="ml-auto normal-case tracking-normal">{extra}</span>}
      </h4>
      {children}
    </section>
  );
}

function Example({ label, tip, children }: { label: string; tip: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        {label}
        <InfoTip>{tip}</InfoTip>
      </span>
      {children}
    </div>
  );
}

// ---------- event viewer ----------

const time = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour12: false }) + `.${String(at % 1000).padStart(3, "0")}`;
const short = (id?: string) => (!id ? "…" : id.length > 18 ? `${id.slice(0, 16)}…` : id);
const cell = "px-2.5 py-2 align-middle whitespace-nowrap";

function Step({ variant, children, col, state }: { variant: BadgeVariant; children: ReactNode; col: string; state: string }) {
  return (
    <Badge variant={variant} data-col={col} data-state={state}>
      {children}
    </Badge>
  );
}

function SentStep({ delivery, label, showTries = false }: { delivery: Delivery; label?: string; showTries?: boolean }) {
  if (delivery.state === "queued") return <Step variant="secondary" col="sent" state="pending">sending…</Step>;
  const tries = showTries && delivery.attempts > 1 ? ` · try ${delivery.attempts}` : "";
  if (delivery.state === "sent") return <Step variant="success" col="sent" state="sent">{label ?? `Sent · ${delivery.status}`}{tries}</Step>;
  return (
    <Step variant="error" col="sent" state="failed">
      {delivery.status ?? "network"} · {delivery.error}
      {tries}
    </Step>
  );
}

function StoredStep({ storage, stored }: { storage: Storage; stored?: string }) {
  switch (storage.state) {
    case "waiting":
      return <Step variant="secondary" col="stored" state="waiting">—</Step>;
    case "checking":
      return <Step variant="info" col="stored" state="checking">checking…</Step>;
    case "stored":
      return <Step variant="success" col="stored" state="stored">Stored · {stored}</Step>;
    case "missing":
      return <Step variant="error" col="stored" state="missing">not found after 30 s{stored ? ` · ${stored}` : ""}</Step>;
  }
}

const Arrow = () => <IconArrowRight className="size-3 text-extra-muted-foreground" />;

function EntryCells({ entry }: { entry: Entry }) {
  if (entry.kind === "error") {
    const { code, message, dropped, status } = entry.error;
    return (
      <>
        <td className={cn(cell, "font-medium text-destructive")}>SDK error</td>
        <td className={cell}><Badge variant="error">onError</Badge></td>
        <td className={cn(cell, "truncate font-mono")} title={code}>{code}</td>
        <td className={cn(cell, "whitespace-normal text-muted-foreground")}>
          {message} · dropped {dropped}
          {status ? ` · HTTP ${status}` : ""}
        </td>
      </>
    );
  }
  if (entry.kind === "recording") {
    return (
      <>
        <td className={cn(cell, "font-medium")}>recording</td>
        <td className={cell}><Badge variant="purple">browser</Badge></td>
        <td className={cn(cell, "truncate font-mono")} title={entry.id}>{short(entry.id)}</td>
        <td className={cell}>
          <div className="flex flex-wrap items-center gap-1.5">
            <SentStep delivery={entry.delivery} label={`${entry.partsSent} parts sent`} />
            <Arrow />
            <StoredStep storage={entry.storage} stored={entry.partsStored !== undefined ? `${entry.partsStored} / ${entry.partsSent} parts` : undefined} />
          </div>
        </td>
      </>
    );
  }
  const rows = entry.storedRows === undefined ? undefined : `${entry.storedRows} row${entry.storedRows === 1 ? "" : "s"}`;
  return (
    <>
      <td className={cn(cell, "truncate font-medium")} title={entry.name}>
        {entry.name}
        {entry.sends > 1 && <span className="ml-1 text-muted-foreground">×{entry.sends}</span>}
      </td>
      <td className={cell}>
        <Badge variant={entry.source === "server" ? "warning" : "info"}>{entry.source}</Badge>
      </td>
      <td className={cn(cell, "truncate font-mono")} title={entry.id}>{short(entry.id)}</td>
      <td className={cell}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Step variant="info" col="queued" state="queued">Queued</Step>
          <Arrow />
          <SentStep delivery={entry.delivery} showTries={entry.source === "browser"} />
          <Arrow />
          <StoredStep storage={entry.storage} stored={rows} />
        </div>
      </td>
    </>
  );
}

function EventViewer() {
  const { entries } = useConsole();
  const [openKey, setOpenKey] = useState<string>();
  return (
    <DashboardCard
      className="max-@5xl:max-h-[80vh]"
      title={cardTitle(<IconCloudUpload className="size-4 text-primary" />, "Event viewer")}
      description="Newest first. Queued → Sent (collector 200) → Stored (found in RawTree). Click a row for the JSON as sent."
      action={<Badge>{entries.length} rows</Badge>}
    >
      {/* Fixed layout: column widths never depend on the rows. Status takes the remaining width,
          and below the minimum table width the viewer scrolls horizontally. */}
      <div className="-mx-5 -mb-5 h-full overflow-auto overscroll-contain px-5 pb-5">
        <table className="w-full min-w-[720px] table-fixed text-xs">
          <colgroup>
            <col className="w-[96px]" />
            <col className="w-[150px]" />
            <col className="w-[76px]" />
            <col className="w-[150px]" />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b">
              {["Time", "Event", "Source", "ID", "Status"].map((header) => (
                <th className="eyebrow sticky top-0 z-10 bg-card px-2.5 pb-1.5 text-left" key={header} scope="col">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-muted-foreground">
                  No events yet. Allow analytics and press a button.
                </td>
              </tr>
            )}
            {entries.map((entry) => {
              const open = openKey === entry.key;
              const json = entry.kind === "error" ? entry.error : entry.payload;
              return (
                <Fragment key={entry.key}>
                  <tr
                    className={cn("cursor-pointer border-b hover:bg-muted", open && "bg-muted")}
                    data-kind={entry.kind}
                    data-id={entry.kind === "error" ? entry.error.code : entry.id}
                    data-name={entry.kind === "event" ? entry.name : undefined}
                    data-state={open ? "selected" : undefined}
                    onClick={() => setOpenKey(open ? undefined : entry.key)}
                  >
                    <td className={cn(cell, "font-mono text-muted-foreground")}>{time(entry.at)}</td>
                    <EntryCells entry={entry} />
                  </tr>
                  {open && (
                    <tr className="border-b">
                      <td colSpan={5} className="bg-muted/40 p-2.5">
                        <pre className="max-h-80 overflow-auto font-mono text-xs leading-relaxed">{JSON.stringify(json, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}
