// Recipe-shaped browser events and a custom event with your own JSON properties.
"use client";

import type { Properties } from "@rawtree/analytics";
import { IconBrowser, IconSend } from "@tabler/icons-react";
import { useState } from "react";
import { DashboardCard } from "../dashboard/card.tsx";
import { Button } from "../ui/button.tsx";
import { cn, inputClass } from "../ui/styles.ts";
import { cardTitle, subhead } from "./card-parts.tsx";
import { sendBrowserEvent, useConsole } from "./console-store.ts";

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

export function BrowserEventsCard() {
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
      title={cardTitle(<IconBrowser className="size-4" />, "Browser events")}
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
          <input id="custom-name" className={cn(inputClass, "h-9 font-mono")} value={name} onChange={(event) => setName(event.target.value)} aria-label="Event name" />
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
