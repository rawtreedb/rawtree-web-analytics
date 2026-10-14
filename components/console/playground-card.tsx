// Recording playground: change the page while recording and check that private content
// never reaches the stored recording.
"use client";

import { IconCheck, IconPlayerRecord, IconX } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { DashboardCard } from "../dashboard/card.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { InfoTip } from "../ui/info-tip.tsx";
import { cn, inputClass } from "../ui/styles.ts";
import { Switch, cardTitle, subhead } from "./card-parts.tsx";
import { findInSentRecordings, setMaskText, useConsole } from "./console-store.ts";

const SECRETS = {
  blocked: "sk_test_SENTINEL_123",
  token: "SENTINEL_URL",
  email: "jane.doe@example.com",
  panel: "A panel that opens and closes.",
};

export function PlaygroundCard() {
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
      title={cardTitle(<IconPlayerRecord className="size-4" />, "Recording playground")}
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
            <input id="masked-input" value={typed} onChange={(event) => setTyped(event.target.value)} className={cn(inputClass, "h-9 w-full")} placeholder="Type something, e.g. your name" />
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
