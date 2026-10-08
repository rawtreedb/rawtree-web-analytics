import type { Properties } from "@rawtree/analytics";
import {
  IconArrowRight,
  IconBolt,
  IconBrowser,
  IconCheck,
  IconCloudUpload,
  IconPlayerRecord,
  IconRefresh,
  IconRepeat,
  IconSend,
  IconServer,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import { Fragment, type ReactNode, useState } from "react";
import { Badge, type BadgeVariant } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.tsx";
import { Switch } from "./components/ui/switch.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.tsx";
import { InfoTooltip } from "./components/ui/tooltip.tsx";
import {
  type Delivery,
  type Entry,
  findInSentRecordings,
  flush,
  resetIdentity,
  sendBrowserEvent,
  sendServerEvent,
  setConsent,
  type Storage,
  useConsole,
} from "./console-store.ts";

const pageViewId = crypto.randomUUID();
const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
const shortId = () => crypto.randomUUID().slice(0, 8);

/** Recipe-shaped example events (see recipes/RECIPES.md). */
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

const SERVER_EVENTS: { name: string; props: Properties }[] = [
  { name: "signup_completed", props: { plan: "pro", method: "password" } },
  { name: "login_succeeded", props: { method: "password" } },
  { name: "export_completed", props: { format: "markdown" } },
];

export function App() {
  const { config, configError, identity } = useConsole();
  return (
    // Desktop: header and consent bar stay fixed, the sidebar and the viewer scroll on their own.
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="sticky top-0 z-20 shrink-0 border-b bg-background">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-6 pt-4 pb-2">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <IconBolt className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">RawTree Web Analytics · Test console</h1>
              <p className="text-xs text-muted-foreground">
                {configError ? (
                  <span className="text-destructive">Could not load /api/config: {configError}</span>
                ) : (
                  <>
                    Collector <Mono data-testid="collector-url">{config?.collectorUrl ?? "…"}</Mono> · Database <Mono>{config?.database || "not set"}</Mono>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void flush()} disabled={!identity}>
              <IconSend /> Flush now
            </Button>
            <Button variant="outline" size="sm" onClick={resetIdentity} disabled={!identity}>
              <IconRefresh /> Reset identity
            </Button>
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 px-6 pb-3 text-xs">
          <IdField label="anonymous_id" value={identity?.anonymousId} testId="anonymous-id" variant="info" />
          <IdField label="session_id" value={identity?.sessionId} testId="session-id" variant="purple" />
          <IdField label="recording_id" value={identity?.recordingId} testId="recording-id" variant="warning" />
        </dl>
      </header>
      <ConsentBar />
      <main className="grid min-h-0 flex-1 gap-5 px-6 py-5 lg:grid-cols-[400px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-5 lg:-mr-2 lg:overflow-y-auto lg:pr-2 lg:pb-1 [&>*]:shrink-0">
          <BrowserEventsCard />
          <ServerEventsCard />
          <PlaygroundCard />
        </aside>
        <EventViewer />
      </main>
    </div>
  );
}

function Mono({ children, ...props }: { children: ReactNode; "data-testid"?: string }) {
  return (
    <span className="font-mono text-foreground" {...props}>
      {children}
    </span>
  );
}

function IdField({ label, value, testId, variant }: { label: string; value?: string; testId: string; variant: BadgeVariant }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <Badge variant={value ? variant : "secondary"} className="font-mono font-normal" data-testid={testId}>
          {value ?? "—"}
        </Badge>
      </dd>
    </div>
  );
}

function ConsentBar() {
  const { consent, recording } = useConsole();
  return (
    <section aria-label="Consent" className="shrink-0 border-b bg-background">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
        <div className="flex items-center gap-2 font-medium">
          <IconShieldCheck className="size-4 text-primary" /> Consent
          <span className="text-xs font-normal text-muted-foreground">Nothing is sent until analytics is allowed. Stored in localStorage.</span>
        </div>
        <label className="flex items-center gap-3">
          <Switch id="consent-analytics" checked={consent.analytics} onCheckedChange={(on) => setConsent({ analytics: on, recording: on && consent.recording })} />
          <span className="text-sm">Analytics</span>
        </label>
        <label className="flex items-center gap-3">
          <Switch
            id="consent-recording"
            checked={consent.recording}
            disabled={!consent.analytics}
            onCheckedChange={(on) => setConsent({ analytics: consent.analytics, recording: on })}
          />
          <span className="text-sm">
            Session recording <span className="text-muted-foreground">(requires analytics)</span>
          </span>
          {recording !== "off" && (
            <Badge variant={recording === "on" ? "error" : "warning"} data-testid="recording-badge">
              <IconPlayerRecord /> {recording === "on" ? "recording" : "loading recorder"}
            </Badge>
          )}
        </label>
      </div>
    </section>
  );
}

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconBrowser className="size-4 text-primary" /> Browser events
        </CardTitle>
        <CardDescription>{consent.analytics ? "Recipe-shaped events with example properties." : "Turn on analytics consent to send events."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {BROWSER_EVENTS.map((event) => (
            <Button key={event.name} variant="secondary" size="sm" disabled={!consent.analytics} data-action={event.name} onClick={() => sendBrowserEvent(event.name, event.props())}>
              {event.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t pt-4">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom event</span>
          <input
            id="custom-name"
            className="h-9 rounded-lg border bg-input px-3 font-mono text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Event name"
          />
          <textarea
            id="custom-properties"
            className="min-h-24 rounded-lg border bg-input px-3 py-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
      </CardContent>
    </Card>
  );
}

function ServerEventsCard() {
  const { config, lastServerEvent } = useConsole();
  const enabled = config?.serverEvents === true;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconServer className="size-4 text-primary" /> Server events
        </CardTitle>
        <CardDescription>
          {enabled ? (
            "Sent by the console server with createServerAnalytics and a stable event ID."
          ) : (
            <span data-testid="server-hint">Set ANALYTICS_SERVER_TOKEN for the console server to enable server events.</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {SERVER_EVENTS.map((event) => (
          <Button key={event.name} variant="secondary" size="sm" disabled={!enabled} data-action={event.name} onClick={() => void sendServerEvent(event.name, event.props)}>
            {event.name}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          id="server-resend"
          disabled={!enabled || !lastServerEvent}
          onClick={() => lastServerEvent && void sendServerEvent(lastServerEvent.name, lastServerEvent.properties, lastServerEvent.eventId)}
        >
          <IconRepeat /> Resend last with same ID
        </Button>
      </CardContent>
    </Card>
  );
}

const SECRETS = {
  blocked: "sk_test_SENTINEL_123",
  token: "SENTINEL_URL",
  email: "jane.doe@example.com",
  panel: "A panel that opens and closes.",
};

function PlaygroundCard() {
  const { recording, recordingBytesSent } = useConsole();
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
    { label: "Panel text", leaked: open || recordingBytesSent > 0 ? found[SECRETS.panel] : undefined },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconPlayerRecord className="size-4 text-primary" /> Recording playground
          <InfoTooltip>
            Session recording captures the page structure and every change to it (plus clicks, scrolls, and typing), not video. Replay
            rebuilds the page from that data.
          </InfoTooltip>
        </CardTitle>
        <CardDescription>
          {recording === "off" ? "Turn on session recording in the consent row first." : "Change the page and check what stays private."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
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
            <input
              id="masked-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="h-9 w-full rounded-lg border bg-input px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="Type something, e.g. your name"
            />
          </Example>
          <Example label="Blocked region" tip="Elements with the class rr-block are not recorded at all; the replay shows an empty box of the same size. Use it for areas like billing details.">
            <div className="rr-block rounded-xl border border-dashed p-3 font-mono text-xs">
              API key <span>{SECRETS.blocked}</span>
            </div>
          </Example>
          <Example label="Link with a token" tip="Link addresses lose their ?query and #hash before they are recorded, because these often carry tokens.">
            <a href={`/?token=${SECRETS.token}`} className="text-xs text-primary underline-offset-4 hover:underline" onClick={(event) => event.preventDefault()}>
              /?token={SECRETS.token}
            </a>
          </Example>
          <Example label="Email in an attribute" tip="rrweb does not mask attributes by itself, so the SDK masks any attribute value that contains an email address.">
            <span data-email={SECRETS.email} className="font-mono text-xs text-muted-foreground">
              {"<span data-email=\"jane.doe@example.com\">"}
            </span>
          </Example>
        </Step3>

        <Step3
          title="3. Privacy check"
          tip="Searches the recording data the collector accepted for each private value. Page text is masked by default too, so the panel text should never appear."
          extra={<Badge variant="outline">{(recordingBytesSent / 1024).toFixed(1)} KB checked</Badge>}
        >
          <ul className="flex flex-col gap-1.5" data-testid="privacy-checks">
            {checks.map((check) => (
              <li key={check.label} className="flex items-center justify-between gap-3 text-xs">
                <span>{check.label}</span>
                {recordingBytesSent === 0 || check.leaked === undefined ? (
                  <Badge variant="secondary">{recordingBytesSent === 0 ? "no recording data yet" : "type something first"}</Badge>
                ) : check.leaked ? (
                  <Badge variant="error">
                    <IconX /> found in recording
                  </Badge>
                ) : (
                  <Badge variant="success">
                    <IconCheck /> not in recording
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Step3>
      </CardContent>
    </Card>
  );
}

function Step3({ title, tip, extra, children }: { title: string; tip: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
        <InfoTooltip>{tip}</InfoTooltip>
        {extra && <span className="ml-auto normal-case tracking-normal">{extra}</span>}
      </h3>
      {children}
    </section>
  );
}

function Example({ label, tip, children }: { label: string; tip: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        {label}
        <InfoTooltip>{tip}</InfoTooltip>
      </span>
      {children}
    </div>
  );
}

// ---------- event viewer ----------

const time = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour12: false }) + `.${String(at % 1000).padStart(3, "0")}`;
const short = (id?: string) => (!id ? "…" : id.length > 22 ? `${id.slice(0, 20)}…` : id);

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
    case "unconfigured":
      return <Step variant="outline" col="stored" state="unconfigured">storage check not configured</Step>;
  }
}

const Arrow = () => <IconArrowRight className="size-3 text-extra-muted-foreground" />;

function EntryCells({ entry }: { entry: Entry }) {
  if (entry.kind === "error") {
    const { code, message, dropped, status } = entry.error;
    return (
      <>
        <TableCell className="font-medium text-destructive">SDK error</TableCell>
        <TableCell><Badge variant="error">onError</Badge></TableCell>
        <TableCell className="truncate font-mono text-xs" title={code}>{code}</TableCell>
        <TableCell className="text-xs whitespace-normal text-muted-foreground">
          {message} · dropped {dropped}
          {status ? ` · HTTP ${status}` : ""}
        </TableCell>
      </>
    );
  }
  if (entry.kind === "recording") {
    return (
      <>
        <TableCell className="font-medium">recording</TableCell>
        <TableCell><Badge variant="purple">browser</Badge></TableCell>
        <TableCell className="truncate font-mono text-xs" title={entry.id}>{short(entry.id)}</TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-1.5">
            <SentStep delivery={entry.delivery} label={`${entry.partsSent} parts sent`} />
            <Arrow />
            <StoredStep storage={entry.storage} stored={entry.partsStored !== undefined ? `${entry.partsStored} / ${entry.partsSent} parts` : undefined} />
          </div>
        </TableCell>
      </>
    );
  }
  const rows = entry.storedRows === undefined ? undefined : `${entry.storedRows} row${entry.storedRows === 1 ? "" : "s"}`;
  return (
    <>
      <TableCell className="truncate font-medium" title={entry.name}>
        {entry.name}
        {entry.sends > 1 && <span className="ml-1 text-xs text-muted-foreground">×{entry.sends}</span>}
      </TableCell>
      <TableCell>
        <Badge variant={entry.source === "server" ? "warning" : "info"}>{entry.source}</Badge>
      </TableCell>
      <TableCell className="truncate font-mono text-xs" title={entry.id}>{short(entry.id)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <Step variant="info" col="queued" state="queued">Queued</Step>
          <Arrow />
          <SentStep delivery={entry.delivery} showTries={entry.source === "browser"} />
          <Arrow />
          <StoredStep storage={entry.storage} stored={rows} />
        </div>
      </TableCell>
    </>
  );
}

function EventViewer() {
  const { entries } = useConsole();
  const [openKey, setOpenKey] = useState<string>();
  return (
    <Card className="min-h-[600px] pb-0 lg:h-full lg:min-h-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconCloudUpload className="size-4 text-primary" /> Event viewer
        </CardTitle>
        <CardDescription>Newest first. Queued → Sent (collector 200) → Stored (found in RawTree). Click a row for the JSON as sent.</CardDescription>
        <CardAction>
          <Badge variant="outline">{entries.length} rows</Badge>
        </CardAction>
      </CardHeader>
      {/* Fixed layout: column widths never depend on the rows. Status takes the remaining width,
          and below the minimum table width the viewer scrolls horizontally. */}
      <Table className="table-fixed min-w-[960px]">
        <colgroup>
          <col className="w-[120px]" />
          <col className="w-[190px]" />
          <col className="w-[90px]" />
          <col className="w-[200px]" />
          <col />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                No events yet. Allow analytics and press a button.
              </TableCell>
            </TableRow>
          )}
          {entries.map((entry) => {
            const open = openKey === entry.key;
            const json = entry.kind === "error" ? entry.error : entry.payload;
            return (
              <Fragment key={entry.key}>
                <TableRow
                  className="cursor-pointer"
                  data-kind={entry.kind}
                  data-id={entry.kind === "error" ? entry.error.code : entry.id}
                  data-name={entry.kind === "event" ? entry.name : undefined}
                  data-state={open ? "selected" : undefined}
                  onClick={() => setOpenKey(open ? undefined : entry.key)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">{time(entry.at)}</TableCell>
                  <EntryCells entry={entry} />
                </TableRow>
                {open && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/40 whitespace-normal">
                      <pre className="max-h-80 overflow-auto font-mono text-xs leading-relaxed">{JSON.stringify(json, null, 2)}</pre>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
