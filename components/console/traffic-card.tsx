// Simulated traffic: crawler visits and campaign visits, each from a new visitor.
"use client";

import { IconRobot, IconTargetArrow } from "@tabler/icons-react";
import { DashboardCard } from "../dashboard/card.tsx";
import { Button } from "../ui/button.tsx";
import { cardTitle, subhead } from "./card-parts.tsx";
import { sendAsVisitor, useConsole } from "./console-store.ts";

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

export function TrafficCard() {
  const { consent } = useConsole();
  return (
    <DashboardCard
      title={cardTitle(<IconRobot className="size-4" />, "Simulated traffic")}
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
