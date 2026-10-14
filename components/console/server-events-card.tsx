// Backend events sent through the server SDK, with a resend that keeps the event ID.
"use client";

import type { Properties } from "@rawtree/analytics";
import { IconRepeat, IconServer } from "@tabler/icons-react";
import { DashboardCard } from "../dashboard/card.tsx";
import { Button } from "../ui/button.tsx";
import { cardTitle } from "./card-parts.tsx";
import { sendServerEvent, useConsole } from "./console-store.ts";

const SERVER_EVENTS: { name: string; props: Properties }[] = [
  { name: "signup_completed", props: { plan: "pro", method: "password" } },
  { name: "login_succeeded", props: { method: "password" } },
  { name: "export_completed", props: { format: "markdown" } },
];

export function ServerEventsCard() {
  const { lastServerEvent } = useConsole();
  return (
    <DashboardCard
      title={cardTitle(<IconServer className="size-4" />, "Server events")}
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
