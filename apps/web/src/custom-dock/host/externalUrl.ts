import { parseUrl } from "@t3tools/shared/url";

export function parseExternalPanelUrl(value: string): URL | null {
  const url = parseUrl(value);
  if (!url || url.username || url.password || url.origin === globalThis.location?.origin)
    return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    return url;
  return null;
}
