// Consent switches, the collector and database in use, and the current SDK identity.
"use client";

import { IconPlayerRecord, IconShieldCheck } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Badge, type BadgeVariant } from "../ui/badge.tsx";
import { cardClass, cn } from "../ui/styles.ts";
import { Switch } from "./card-parts.tsx";
import { COLLECT_ENDPOINT, setConsent, useConsole } from "./console-store.ts";

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

export function ConsentBar({ database }: { database: string }) {
  const { consent, recording, identity } = useConsole();
  return (
    <section aria-label="Consent" className={cn(cardClass, "flex shrink-0 flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3 text-sm")}>
      <div className="flex items-center gap-2 font-semibold">
        <IconShieldCheck className="size-4 -translate-y-px text-muted-foreground" /> Consent
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
        <span className="w-full">
          Collector <Mono>{COLLECT_ENDPOINT}</Mono> · Database <Mono>{database}</Mono>
        </span>
        <IdField label="anonymous_id" value={identity?.anonymousId} testId="anonymous-id" variant="info" />
        <IdField label="session_id" value={identity?.sessionId} testId="session-id" variant="purple" />
        <IdField label="recording_id" value={identity?.recordingId} testId="recording-id" variant="warning" />
      </div>
    </section>
  );
}
