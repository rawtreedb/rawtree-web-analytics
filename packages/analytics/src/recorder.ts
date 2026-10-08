// Optional rrweb integration. Import from "@rawtree/analytics/recorder" so event-only
// installs never bundle rrweb. Start it only after the application allows recording.
//
// Privacy defaults: mask all inputs and all text (maskAllText: false keeps text readable),
// block elements with class "rr-block", no canvas, fonts, or inlined images. rrweb masks text and inputs but not attributes or
// URLs, so every emitted event is also sanitized before it is queued:
// - the page URL in Meta events keeps only allowlisted query parameters;
// - URL attributes (href, src, action, ...) lose their query string and hash;
// - text-like attributes (title, alt, aria-label, placeholder) are masked;
// - any other attribute value that contains an email address is masked.
// Review your own DOM for other sensitive attributes and block or mask those regions.

import { record } from "rrweb";
import type { Analytics, RrwebEvent } from "./index.ts";
import { DEFAULT_ALLOWED_QUERY_PARAMS, sanitizeUrl } from "./util.ts";

type RecordOptions = NonNullable<Parameters<typeof record>[0]>;

export type StartRecordingOptions = Omit<RecordOptions, "emit"> & {
  /** Query parameters kept in recorded page URLs. Defaults to the utm_* parameters. */
  allowedQueryParams?: readonly string[];
  /** Attributes whose values are masked. Default: title, alt, aria-label, aria-description, placeholder. */
  maskAttributes?: readonly string[];
  /** Mask every text node (default true). Set false for readable replays; inputs stay masked by maskAllInputs. */
  maskAllText?: boolean;
};

export const RECORDING_DEFAULTS = {
  maskAllInputs: true,
  maskTextSelector: "*",
  blockClass: "rr-block",
  recordCanvas: false,
  collectFonts: false,
  inlineImages: false,
} satisfies RecordOptions;

const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "cite", "background", "ping", "xlink:href"]);
const DEFAULT_MASKED_ATTRIBUTES = ["title", "alt", "aria-label", "aria-description", "placeholder"];
const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/i;
const mask = (value: string) => value.replace(/\S/g, "*");

type SerializedNode = { attributes?: Record<string, unknown>; childNodes?: SerializedNode[] };

function sanitizeAttributes(attributes: Record<string, unknown>, masked: ReadonlySet<string>): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value !== "string" || name.startsWith("rr_") || name === "style") continue;
    const key = name.toLowerCase();
    if (URL_ATTRIBUTES.has(key)) attributes[name] = value.replace(/[?#].*$/s, "");
    else if (masked.has(key) || EMAIL.test(value)) attributes[name] = mask(value);
  }
}

function sanitizeNode(node: SerializedNode | undefined, masked: ReadonlySet<string>): void {
  const stack = node ? [node] : [];
  while (stack.length > 0) {
    const current = stack.pop() as SerializedNode;
    if (current.attributes) sanitizeAttributes(current.attributes, masked);
    if (current.childNodes) stack.push(...current.childNodes);
  }
}

/** Remove URL secrets and attribute PII from one rrweb event (mutates and returns it). */
export function sanitizeRecordingEvent(
  event: RrwebEvent,
  options: { allowedQueryParams?: readonly string[]; maskAttributes?: readonly string[] } = {},
): RrwebEvent {
  const masked = new Set((options.maskAttributes ?? DEFAULT_MASKED_ATTRIBUTES).map((a) => a.toLowerCase()));
  const data = event.data as Record<string, unknown> | undefined;
  if (!data) return event;
  if (event.type === 4 && typeof data.href === "string") {
    data.href = sanitizeUrl(data.href, options.allowedQueryParams ?? DEFAULT_ALLOWED_QUERY_PARAMS) ?? "";
  } else if (event.type === 2) {
    sanitizeNode(data.node as SerializedNode, masked);
  } else if (event.type === 3 && data.source === 0) {
    for (const add of (data.adds as { node?: SerializedNode }[] | undefined) ?? []) sanitizeNode(add.node, masked);
    for (const change of (data.attributes as { attributes?: Record<string, unknown> }[] | undefined) ?? []) {
      if (change.attributes) sanitizeAttributes(change.attributes, masked);
    }
  }
  return event;
}

/**
 * Start rrweb with privacy defaults and send its events through the analytics client.
 * Returns a function that stops recording. A new full snapshot is taken automatically
 * when the client starts a new recording (after reset()).
 */
export function startRecording(analytics: Analytics, options: StartRecordingOptions = {}): () => void {
  const { allowedQueryParams, maskAttributes, maskAllText = true, ...recordOptions } = options;
  const { maskTextSelector, ...defaults } = RECORDING_DEFAULTS;
  let recordingId = analytics.recordingId;
  let awaitingSnapshot = false;
  let stopped = false;
  const stop = record({
    ...defaults,
    ...(maskAllText ? { maskTextSelector } : {}),
    ...recordOptions,
    emit(event) {
      // rrweb can still emit throttled events after stop(); ignore them.
      if (stopped) return;
      // reset() or discardRecording() started a new recording: request a full snapshot and
      // skip events until its Meta event, so the new recording starts replayable. The
      // snapshot captures the DOM state those skipped events produced.
      if (analytics.recordingId !== recordingId) {
        recordingId = analytics.recordingId;
        awaitingSnapshot = true;
        queueMicrotask(() => {
          if (!stopped) record.takeFullSnapshot(true);
        });
      }
      if (awaitingSnapshot && event.type !== 4) return;
      awaitingSnapshot = false;
      analytics.sendRecording(sanitizeRecordingEvent(event as unknown as RrwebEvent, { allowedQueryParams, maskAttributes }));
    },
  });
  return () => {
    stopped = true;
    stop?.();
  };
}
