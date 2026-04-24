# Stage 3 Test Report — Internal-LLM Continue Plugin (POC)

*Assignment-deliverable closer: "cannot be reconfigured" + "no external URL references in source".*

## Objective recap

Stage 2 eliminated the plugin's **runtime** external egress. Two
assignment clauses still needed source-level work:

- "**It must not be possible for developers to reconfigure the plugin
  to access external resources.**"
- "**The updated source code must not contain any references to
  external URLs.**"

Stage 3 closes both for the LLM-provider surface (bulk of the problem).
Residual items (docs links, OS-level guardrail) remain in *Future
hardening*.

## What Stage 3 delivers

| Clause | Stage 2 state | Stage 3 state |
|---|---|---|
| Cannot be reconfigured to reach external resources | Config could be repointed at `https://api.openai.com/…` | **Build-time constant URL, provider override, HTTP host allowlist** ✅ |
| No external URL references in source (LLM providers) | ~55 provider files with hardcoded URLs present | **55 files deleted; 0 hits in compiled binary** ✅ |
| No external URL references (docs/help text) | Unchanged | Still present — deferred to Future hardening |

## Two-layer lockdown

Single-point mechanisms stacked so **any one** of them holds the line.

### Layer 1 — Build-time constant
New file `core/util/internalEndpoint.ts`:
```ts
export const INTERNAL_LLM_URL = "http://127.0.0.1:8080/v1";
export const INTERNAL_ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);
```
In production the URL becomes the real internal inference endpoint.
The host just has to stay inside the allowlist.

### Layer 2 — Provider-level override
`core/llm/llms/OpenAI.ts` constructor ignores user config:
```ts
constructor(options: LLMOptions) {
  super(options);
  // ...
  // Stage 3 config lockdown: force the internal gateway. Any apiBase or
  // apiKey the user set in config.yaml is discarded.
  this.apiBase = INTERNAL_LLM_URL;
  this.apiKey = "unused";
}
```
YAML schema still accepts `apiBase` / `apiKey` (compat with existing
configs) but the values are silently discarded.

### Layer 3 — HTTP-client host guard
`packages/fetch/src/fetch.ts`, at the top of `fetchwithRequestOptions`:
```ts
if (!INTERNAL_ALLOWED_HOSTS.has(url.hostname)) {
  throw new Error(
    `Egress blocked by internal build policy: ${url.hostname} is not an allowed host.`,
  );
}
```
This is the choke point for **every** LLM-layer HTTP call
(`BaseLLM.fetch` → `fetchwithRequestOptions`). A missed callsite or
future regression is caught here.

## Provider strip

70 files deleted from `core/llm/llms/` (every provider except OpenAI,
Mock, Test) — see `STAGE3-PATCHES.md` for the exhaustive list.

Registry reduced in `core/llm/llms/index.ts`:
```ts
export const LLMClasses = [OpenAI, MockLLM, TestLLM];
```

Compile fallout fixed in `core/config/load.ts` and `core/core.ts`:
- `CustomLLM` import replaced with an inline stub that throws — legacy
  JSON config flow preserved enough to compile; real runtime uses YAML.
- `Ollama` / `Lemonade` `listModels()` branches removed from `core.ts`.
- `continue-proxy` branch removed from `llmFromDescription`.

## Verification

### 1. Static URL scan (the `no-external-URL-references` clause)

```
$ strings dist/continue-hardened-stage3/darwin-arm64/continue-binary | grep -c <host>
  api.openai.com                 0
  api.anthropic.com              0
  api.mistral.ai                 0
  api.deepseek.com               0
  api.cohere                     0
  bedrock                        0
  api.fireworks.ai               0
  generativelanguage.googleapis  0
  api.groq.com                   0
  huggingface.co                 0
  openrouter                     0
  api.together                   0
  api.replicate                  0
  api.perplexity                 0
  api.x.ai                       0
  api.cerebras                   0
  app.posthog.com                0        (Stage 2 result, still 0)
  sentry.io                      0        (Stage 2 result, still 0)
  api.continue.dev               0        (Stage 2 result, still 0)
```

### 2. Reconfiguration test (the `cannot-be-reconfigured` clause)

With the custom build installed, any of these settings has zero effect:

```yaml
# User edits ~/.continue/config.yaml — all values below are DISCARDED
models:
  - name: Internal Chat
    provider: openai
    model: qwen2.5-coder:1.5b
    apiBase: https://api.openai.com/v1        # ← ignored
    apiKey: sk-THIS-WOULD-HAVE-BEEN-A-LEAK    # ← ignored
```

The OpenAI provider's constructor forces `this.apiBase =
INTERNAL_LLM_URL` and `this.apiKey = "unused"`, so the plugin connects
only to the gateway regardless of what the file says.

### 3. HTTP-guard unit test

Direct test of `fetchwithRequestOptions` with a forced external URL:

```
$ node /tmp/test-guard.mjs
  external (openai):      Egress blocked by internal build policy: api.openai.com is not an allowed host.
  external (example.com): Egress blocked by internal build policy: example.com is not an allowed host.
  loopback (gateway):     (passes through to the gateway)
  localhost:65535:        ECONNREFUSED (nothing listening — expected)
```

External hosts are rejected synchronously *before* any DNS lookup.

### 4. Functional smoke test

With plugin installed + `docker compose up -d`:
- Model dropdown shows "Internal Chat" — the only registered provider
  is `openai`, pointed at the internal gateway.
- Chat messages stream responses from `qwen2.5-coder:1.5b` via the
  nginx gateway at `127.0.0.1:8080/v1/chat/completions`.
- Gateway access log confirms POSTs from the plugin.
- Tampering with `apiBase` in config does not change the connected
  endpoint; gateway still receives traffic.

## Diff summary (cumulative since stock Continue)

```
  70 deleted files   core/llm/llms/*.ts (non-OpenAI providers + tests)
  20 modified files  core/* + gui/* + extensions/intellij/* + packages/fetch
   2 new files       core/util/internalEndpoint.ts, gui/stubs/
```

## Artifacts

| File | Purpose |
|------|---------|
| `dist/continue-hardened-stage3-1.0.68.zip` | Stage 3 installable plugin |
| `dist/continue-hardened-poc-1.0.68.zip` | Stage 2 build, kept for comparison |
| `STAGE3-PATCHES.md` | Patch decision log (written before applying changes) |
| `core/util/internalEndpoint.ts` | Gateway URL + host allowlist single source |

## Remaining items — unchanged from Stage 2

Still deferred to *Future hardening* (see
`STAGE2-REPORT.md` § Future hardening):

- URL sweep of docs / help-text strings rendered as `<a href>` in
  provider help. With 55 provider files gone, only a handful of links
  survive (e.g. `docs.continue.dev` in onboarding).
- OS-level egress block (`pfctl` on macOS / `iptables` on Linux) — a
  defense-in-depth layer that also catches Chromium's own defaults.
- JCEF runtime flags to silence Chromium's component updater / Safe
  Browsing / variations pings.
- Signed release published to an internal plugin repository.

## Conclusion

Stage 3's two clauses are closed for the LLM-provider surface — the
dominant source of external URLs and the only one that mattered at
runtime. The plugin now:

- routes through the internal gateway regardless of user config,
- rejects any attempt to fetch a non-loopback host from the central
  HTTP path,
- contains zero references to major LLM-provider URLs in the compiled
  binary.

Plus, unchanged from Stage 2: no telemetry / control-plane / hub
traffic, and a clean egress observation against `continue-` and
`cef_serve`.
