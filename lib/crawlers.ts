// Crawler identification from user-agent strings, ported from Treewatcher
// (lib/crawlers.ts). Categories follow Birdwatcher's bot taxonomy (training,
// retrieval, indexer, social), plus SEO tools and scripts/headless browsers.
// The first matching rule wins, so specific tokens come before broader ones.
// BOT_UA_PATTERN draws the human/bot line for the dashboard SQL (lib/queries.ts); the rules
// below name and categorize the agents on the bot side. Keep both in step (tests check it).

/**
 * Broad crawler/user-agent pattern (lowercase) that splits human and bot traffic in SQL.
 * Every human metric excludes user agents matching it; the Bots section counts them.
 */
export const BOT_UA_PATTERN =
  "bot|crawl|spider|slurp|headless|puppeteer|playwright|phantom|curl/|wget|python|go-http|node-fetch|axios|undici|httpx|scrapy|" +
  "facebookexternalhit|slack|whatsapp|chatgpt-user|perplexity|claude-|mistralai|cohere-ai|anthropic-ai|exa.ai|google-extended|" +
  "googleother|google-inspectiontool|externalagent|meta-webindexer|bingpreview|yandex|sogou|ahrefs|semrush|barkrowler|screaming frog|aiohttp";

const botUa = new RegExp(BOT_UA_PATTERN);

/** The SQL human/bot line in JavaScript. */
export function isBotUa(userAgent: string): boolean {
  return botUa.test(userAgent.toLowerCase());
}

const CRAWLER_CATEGORIES = ["AI retrieval", "AI training", "Search indexer", "Social preview", "SEO tool", "Script or headless", "Other"] as const;
export type CrawlerCategory = (typeof CRAWLER_CATEGORIES)[number];

const rules: readonly [RegExp, string, CrawlerCategory][] = [
  // Fetch pages at question time for AI answers and AI search.
  [/oai-searchbot/, "OpenAI SearchBot", "AI retrieval"],
  [/chatgpt-user/, "ChatGPT-User", "AI retrieval"],
  [/perplexity(bot|-user)/, "Perplexity", "AI retrieval"],
  [/claude-(user|searchbot|web)/, "Claude (user)", "AI retrieval"],
  [/exasearchbot|exa\.ai/, "Exa", "AI retrieval"],
  [/linkupbot/, "Linkup", "AI retrieval"],
  [/duckassistbot/, "DuckAssist", "AI retrieval"],
  [/mistralai-user/, "Mistral", "AI retrieval"],
  [/cohere-ai/, "Cohere", "AI retrieval"],
  [/youbot/, "You.com", "AI retrieval"],
  // Collect corpora for model training.
  [/gptbot/, "GPTBot", "AI training"],
  [/claudebot|anthropic-ai/, "ClaudeBot", "AI training"],
  [/amazonbot/, "Amazonbot", "AI training"],
  [/meta-externalagent/, "Meta ExternalAgent", "AI training"],
  [/bytespider/, "Bytespider", "AI training"],
  [/ccbot/, "Common Crawl", "AI training"],
  [/google-extended|google-cloudvertexbot/, "Google AI", "AI training"],
  [/applebot-extended/, "Applebot-Extended", "AI training"],
  [/ai2bot/, "AI2Bot", "AI training"],
  [/diffbot/, "Diffbot", "AI training"],
  // Feed search engines.
  [/googlebot|googleother|google-inspectiontool/, "Googlebot", "Search indexer"],
  [/bingbot|bingpreview|msnbot/, "Bingbot", "Search indexer"],
  [/petalbot/, "PetalBot", "Search indexer"],
  [/applebot/, "Applebot", "Search indexer"],
  [/meta-webindexer/, "Meta WebIndexer", "Search indexer"],
  [/yandex/, "YandexBot", "Search indexer"],
  [/baiduspider/, "Baiduspider", "Search indexer"],
  [/duckduckbot/, "DuckDuckBot", "Search indexer"],
  [/sogou/, "Sogou", "Search indexer"],
  // Unfurl shared links.
  [/slackbot|slack-imgproxy/, "Slack", "Social preview"],
  // Facebook's crawler also advertises Twitterbot, so it is matched first.
  [/facebookexternalhit|facebot/, "Facebook", "Social preview"],
  [/twitterbot/, "Twitterbot", "Social preview"],
  [/linkedinbot/, "LinkedIn", "Social preview"],
  [/discordbot/, "Discord", "Social preview"],
  [/telegrambot/, "Telegram", "Social preview"],
  [/whatsapp/, "WhatsApp", "Social preview"],
  // SEO and backlink crawlers.
  [/ahrefs/, "Ahrefs", "SEO tool"],
  [/semrush/, "Semrush", "SEO tool"],
  [/dotbot/, "Moz DotBot", "SEO tool"],
  [/mj12bot/, "Majestic", "SEO tool"],
  [/barkrowler/, "Babbar", "SEO tool"],
  [/screaming frog/, "Screaming Frog", "SEO tool"],
  // Scripts, HTTP libraries, and automated browsers.
  [/headlesschrome|puppeteer|playwright|phantomjs/, "Headless browser", "Script or headless"],
  [/^curl\//, "curl", "Script or headless"],
  [/^wget/, "Wget", "Script or headless"],
  [/python-requests|python-urllib|aiohttp|httpx/, "Python HTTP client", "Script or headless"],
  [/go-http-client/, "Go HTTP client", "Script or headless"],
  [/node-fetch|axios|undici|^node\b/, "Node HTTP client", "Script or headless"],
  [/scrapy/, "Scrapy", "Script or headless"],
];

/** Name and category for a user agent; unknown bots keep their own `*bot`/`*crawler`/`*spider` token. */
function classifyCrawler(userAgent: string): { name: string; category: CrawlerCategory } {
  const ua = userAgent.toLowerCase();
  for (const [pattern, name, category] of rules) {
    if (pattern.test(ua)) return { name, category };
  }
  const token = /([a-z0-9][a-z0-9._-]*(?:bot|crawler|spider))\b/.exec(ua)?.[1];
  return { name: token ?? (ua.trim() ? "Unidentified" : "(no user agent)"), category: "Other" };
}

/** True when the user agent belongs to a known crawler or automation token. */
export function isCrawler(userAgent: string): boolean {
  const { category, name } = classifyCrawler(userAgent);
  return category !== "Other" || (name !== "Unidentified" && name !== "(no user agent)");
}

/** Aggregate user-agent counts into crawler and category totals, largest first. */
export function summarizeCrawlers(agents: readonly { userAgent: string; hits: number }[]) {
  const crawlers = new Map<string, { name: string; category: CrawlerCategory; hits: number }>();
  const categories = new Map<CrawlerCategory, number>();
  for (const { userAgent, hits } of agents) {
    const { name, category } = classifyCrawler(userAgent);
    const key = `${category}\u0000${name}`;
    const entry = crawlers.get(key) ?? { name, category, hits: 0 };
    entry.hits += hits;
    crawlers.set(key, entry);
    categories.set(category, (categories.get(category) ?? 0) + hits);
  }
  const byHits = <T extends { hits: number; label?: string; name?: string }>(a: T, b: T) =>
    b.hits - a.hits || String(a.name ?? a.label).localeCompare(String(b.name ?? b.label));
  return {
    crawlers: [...crawlers.values()].sort(byHits),
    categories: [...categories.entries()].map(([label, hits]) => ({ label, hits })).sort(byHits),
  };
}
