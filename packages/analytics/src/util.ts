/** Keep in sync with package.json (checked by a test). */
export const SDK_VERSION = "0.1.0";

/** Random UUID v4. Falls back to getRandomValues where randomUUID is unavailable (insecure contexts). */
export function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const DEFAULT_ALLOWED_QUERY_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

/**
 * Remove credentials, the hash, and every query parameter not in the allowlist.
 * Returns undefined for anything that is not an absolute http(s) URL.
 */
export function sanitizeUrl(value: string | undefined, allowedQueryParams: readonly string[]): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.username = "";
  url.password = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (!allowedQueryParams.includes(key)) url.searchParams.delete(key);
  return url.toString().slice(0, 2048);
}

/** UTF-8 byte length of JSON.stringify(value) for a string value, without building the escaped copy. */
export function jsonStringLength(value: string): number {
  let bytes = 2;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x22 || c === 0x5c || c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d) bytes += 2;
    else if (c < 0x20) bytes += 6;
    else if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length && (value.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else if (c >= 0xd800 && c <= 0xdfff) bytes += 6; // lone surrogate: JSON.stringify writes \udxxx
    else bytes += 3;
  }
  return bytes;
}
