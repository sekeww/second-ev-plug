// Stage 3: single source of truth for the internal LLM gateway.
// The URL is a BUILD-TIME constant. Changing it in config.yaml has no
// effect — provider constructors and the HTTP client both ignore user
// overrides and reject off-host traffic.
//
// In production this becomes the internal inference endpoint
// (vLLM / TGI / LiteLLM cluster). The host just has to stay inside
// INTERNAL_ALLOWED_HOSTS.
// Trailing slash matters. new URL("chat/completions", base) drops the last
// path segment of base unless it ends in "/" — without the slash the plugin
// would hit http://127.0.0.1:8080/chat/completions (404 HTML) instead of /v1/…
export const INTERNAL_LLM_URL = "http://127.0.0.1:8080/v1/";

export const INTERNAL_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "0.0.0.0",
]);

export function isInternalHost(hostname: string): boolean {
  return INTERNAL_ALLOWED_HOSTS.has(hostname);
}
