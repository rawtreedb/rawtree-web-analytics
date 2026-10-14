// The test console page (/console): consent switches, browser and server events, simulated
// bot and campaign traffic, a recording playground with privacy checks, and an event viewer
// that follows each item from Queued to Sent (collector 200) to Stored (found in RawTree).
// Everything goes through the real SDK to /api/console/collect with the visitor's credentials.
"use client";

import { IconRefresh, IconSend } from "@tabler/icons-react";
import { useEffect } from "react";
import { PageToolbar } from "../dashboard/page-toolbar.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { BrowserEventsCard } from "./browser-events-card.tsx";
import { ConsentBar } from "./consent-bar.tsx";
import { flush, resetIdentity, startConsole, stopConsole, useConsole } from "./console-store.ts";
import { EventViewer } from "./event-viewer.tsx";
import { PlaygroundCard } from "./playground-card.tsx";
import { ServerEventsCard } from "./server-events-card.tsx";
import { TrafficCard } from "./traffic-card.tsx";

export function ConsoleApp({ database }: { database: string }) {
  const { identity } = useConsole();
  useEffect(() => {
    startConsole();
    return stopConsole;
  }, []);
  // With two columns (@4xl) the console fills the viewport: toolbar and consent stay put,
  // the controls column and the event table scroll on their own.
  return (
    <div className="flex w-full flex-col @4xl:h-main">
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
        <div className="grid min-h-0 flex-1 gap-4 @4xl:grid-cols-aside">
          {/* The scroll container clips what's outside its box; the padding (offset by the negative margin) keeps the cards' ring and shadow visible. */}
          <div className="grid min-h-0 auto-rows-max content-start gap-4 @4xl:-m-2 @4xl:overflow-y-auto @4xl:overscroll-contain @4xl:p-2">
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
