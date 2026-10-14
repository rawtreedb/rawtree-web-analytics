// Event viewer: follows each item from Queued to Sent (collector 200) to Stored (found in RawTree).
"use client";

import { IconArrowRight, IconCloudUpload } from "@tabler/icons-react";
import { Fragment, type ReactNode, useState } from "react";
import { DashboardCard } from "../dashboard/card.tsx";
import { Badge, type BadgeVariant } from "../ui/badge.tsx";
import { cn, focusRing } from "../ui/styles.ts";
import { cardTitle } from "./card-parts.tsx";
import { type Delivery, type Entry, type Storage, useConsole } from "./console-store.ts";

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

export function EventViewer() {
  const { entries } = useConsole();
  const [openKey, setOpenKey] = useState<string>();
  return (
    <DashboardCard
      className="@max-4xl:max-h-160"
      title={cardTitle(<IconCloudUpload className="size-4" />, "Event viewer")}
      description="Newest first. Queued → Sent (collector 200) → Stored (found in RawTree). Click a row for the JSON as sent."
      action={<Badge>{entries.length} rows</Badge>}
    >
      {/* Fixed layout: column widths never depend on the rows. Status takes the remaining width,
          and below the minimum table width the viewer scrolls horizontally. */}
      <div className="-mx-5 -mb-5 h-full overflow-auto overscroll-contain px-5 pb-5">
        <table className="w-full min-w-180 table-fixed text-xs">
          <colgroup>
            <col className="w-24" />
            <col className="w-38" />
            <col className="w-19" />
            <col className="w-38" />
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
                    <td className={cn(cell, "font-mono text-muted-foreground")}>
                      {/* The row's click handler toggles; this button makes it reachable by keyboard. */}
                      <button aria-expanded={open} aria-label={`${time(entry.at)}: show the JSON as sent`} className={cn("cursor-pointer rounded-sm", focusRing)} type="button">
                        {time(entry.at)}
                      </button>
                    </td>
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
