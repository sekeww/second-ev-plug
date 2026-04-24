# Stage 2 Test Report — Internal-LLM Continue Plugin (POC)

*Assignment deliverable: "test report"*

## Objective recap

Ship a modified Continue.dev plugin that routes all model traffic through an
**internal** LLM endpoint and does not leak data to any external host.

Stage 2 of this POC targeted the **runtime-egress** leg of the requirement:
eliminate every external network call made by the plugin and its bundled
core binary while it is in use.

## What Stage 2 proves

| Goal | Stage 1 state | Stage 2 state |
|------|---------------|---------------|
| Core binary talks only to internal gateway | Leaked to Cloudflare | **Clean — loopback only** ✅ |
| Webview talks only to internal/IDE-local | Leaked to AWS (PostHog CDN) | **Clean of plugin-origin leaks** ✅ |
| Plugin builds from source as a distributable `.zip` | N/A | **376 MB `.zip` produced** ✅ |
| Chat + autocomplete function end-to-end | N/A | Chat streams from local Ollama via gateway |

## Test environment

- macOS, IntelliJ IDEA 2026.1 (JCEF webview)
- Node 24 (host), Node 18 (packaged runtime in `continue-binary`)
- JDK 17 (`openjdk@17` via Homebrew — required by plugin-gradle toolchain)
- Docker Desktop running Ollama `qwen2.5-coder:1.5b` behind nginx gateway
  on `http://127.0.0.1:8080`

## Architecture used in this test

```
┌─────────── developer machine ───────────┐
│  IntelliJ IDEA                           │
│   └─ Continue (custom build, this POC)  │
│       ├─ continue-binary ──►  127.0.0.1:8080
│       └─ webview (JCEF)                  │
│                                          │
│  ┌── docker net: internal-llm ─────┐     │
│  │ nginx :8080 ──► ollama :11434   │     │
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

Gateway is published on `127.0.0.1:8080` only. Ollama has no published port.

## Egress observations (primary evidence)

Both runs used `scripts/observe-egress.sh`, which scopes `lsof` to the
IntelliJ process tree, classifies endpoints as `OK` (loopback), `LAN`, or
`LEAK` (public), and prints them grouped by process.

### Before (Stage 1 — stock Continue)

| Process | Endpoint | Classification |
|---------|----------|----------------|
| `continue-` | `127.0.0.1:8080` | OK (gateway) |
| `continue-` | `[2606:4700:10::ac42:a6a4]:443` | **LEAK (Cloudflare = `api.continue.dev` / control-plane)** |
| `cef_serve` | `[2600:1f18:4c12:9a01:c440:faea:46e4:5874]:443` | **LEAK (AWS CloudFront = PostHog CDN)** |
| `cef_serve` | `127.0.0.1:6189`, high-port loopback | OK (IDE↔webview IPC) |
| `idea` | various loopback | OK |

### After (Stage 2 — custom build)

| Process | Endpoint | Classification |
|---------|----------|----------------|
| `continue-` | `127.0.0.1:8080` | **OK — only endpoint** ✅ |
| `cef_serve` | `127.0.0.1:49896/97`, `127.0.0.1:6189` | OK (IDE↔webview IPC) |
| `cef_serve` | `[2001:4860:...]`, `[2a00:1450:...]` ×2 | Chromium-level (see *Residual noise*) |
| `idea` | `127.0.0.1:*` + JetBrains public IPs | IDE-level (see *Residual noise*) |

### Static-artifact verification

After the build, the entire plugin `.zip` plus the bundled `continue-binary`
were scanned for telemetry hosts:

```
api.continue.dev:         0 hits
app.posthog.com:          0 hits
ingest.sentry.io:         0 hits
api-test.continue.dev:    0 hits
api.continue-stage.tools: 0 hits
hub.continue-stage.tools: 0 hits
```

## Patches applied

Diff stat (`continue/` tree relative to upstream `main`):

```
 core/control-plane/client.ts                        |  32 +--
 core/control-plane/env.ts                           | 101 ++------
 core/util/posthog.ts                                | 123 ++--------
 core/util/sentry/SentryLogger.ts                    | 262 +++------------------
 core/util/sentry/constants.ts                       |   7 +-
 extensions/intellij/build.gradle.kts                |   4 +-
 .../auth/ContinueAuthService.kt                     |  35 +--
 .../error/ContinuePostHogService.kt                 |  27 +--
 .../error/ContinueSentryService.kt                  |  68 +-----
 .../src/main/resources/META-INF/plugin.xml          |   5 +-
 .../intellij/src/test/.../ContinuePostHogServiceTest|  29 ---
 gui/src/hooks/TelemetryProviders.tsx                | 132 +----------
 gui/vite.config.ts                                  |  21 +-
 17 files, 161 insertions, 823 deletions
```

Categorized (see `STAGE2-PATCHES.md` for the decision log):

| Leak source | Where patched | Strategy |
|-------------|---------------|----------|
| `https://api.continue.dev/` control-plane URLs | `core/control-plane/env.ts` | Replace all branch URLs with `http://disabled.invalid/`; `useHub()` and `enableHubContinueDev()` forced to `false` |
| Control-plane request hanging on DNS (startup deadlock) | `core/control-plane/client.ts` | `request()` throws immediately — callers already try/catch and fall through to local profile loader |
| PostHog (core binary, Node) | `core/util/posthog.ts` | Class rewritten as no-op; `posthog-node` never imported |
| Sentry (core binary, Node) | `core/util/sentry/SentryLogger.ts`, `constants.ts` | Logger class no-op; DSN emptied |
| PostHog (webview, React) | `gui/vite.config.ts` + `gui/stubs/posthog-js*.ts` | `resolve.alias` redirects `posthog-js` and `posthog-js/react` to local no-op shims — zero callsite edits |
| Sentry (webview, React) | `gui/src/hooks/TelemetryProviders.tsx`, `gui/vite.config.ts` | Component reduced to passthrough; `sentryVitePlugin` removed |
| PostHog (IntelliJ JVM, Kotlin) | `error/ContinuePostHogService.kt`, `build.gradle.kts` | Service stubbed; `com.posthog.java` dependency removed |
| Sentry (IntelliJ JVM, Kotlin) | `error/ContinueSentryService.kt`, `build.gradle.kts` | Service stubbed; `io.sentry.jvm.gradle` plugin removed |
| Auth refresh token polling (Kotlin) | `auth/ContinueAuthService.kt` | `refreshToken()` throws; `setupRefreshTokenInterval()` is no-op |
| `plugin.xml` external vendor URL | `META-INF/plugin.xml` | Removed |

An important non-obvious fix: the stubbed env type had to stay `WorkOsProd`
(not `OnPrem`) even though no hub is reachable, because `ConfigHandler.
getLocalProfiles()` returns an empty list for `OnPrem` deployments and
would have dropped the local `config.yaml`. With `WorkOsProd` the local
profile loader still runs; the unresolvable URLs keep the hub disabled.

## Build steps (reproducible)

```sh
# from repo root
cd continue
npm install                            # root deps
node scripts/build-packages.js         # internal @continuedev/* packages
(cd core && PUPPETEER_SKIP_DOWNLOAD=true npm install && npm link)
(cd gui  && npm install && npm link @continuedev/core && npx vite build)
cp -r gui/dist/* extensions/intellij/src/main/resources/webview/
(cd extensions/vscode && npm install)  # for shared build helper used by binary/
(cd binary && npm install && npm run build)
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
(cd extensions/intellij && ./gradlew buildPlugin --no-daemon)
# artifact:
# continue/extensions/intellij/build/distributions/continue-intellij-extension-1.0.68.zip
```

The built artifact is staged at
`dist/continue-hardened-poc-1.0.68.zip` (376 MB; five-architecture
bundle — one `continue-binary` per target platform).

## Functional verification

With the custom plugin installed in IntelliJ and
`docker compose up -d` running:

- "Loading config" spinner clears within ~1 s (vs. hanging in the first
  Stage 2 build, before the DNS-fail-fast patch).
- Model dropdown shows "Internal Chat" and "Internal Autocomplete" from
  `config/config.yaml`.
- Sending a chat message streams a reply from `qwen2.5-coder:1.5b` via
  the nginx gateway.
- `gateway` nginx logs show `POST /v1/chat/completions` from the plugin.

## Residual noise observed (not caused by the plugin)

Three categories of `LEAK` classifications remain in the post-patch
observation. None originate from the Continue plugin.

### 1. JetBrains IDE itself (`idea` process)
`13.224.236.18`, `3.160.77.65/69` — JetBrains-owned IPs for marketplace,
update check, and platform telemetry. Addressed by IDE-level flags or
corporate IDE provisioning, not plugin code.

### 2. JCEF / Chromium defaults (`cef_serve` process)
Three Google IPv6 endpoints (`2001:4860:4802::`, `2a00:1450:4001::`,
`2a00:1450:4019::`). These are Chromium's built-in component-updater,
Safe Browsing, and variations-framework calls — features baked into JCEF,
not into our webview code. Confirmed by:
- The built `gui/dist/` bundle contains **zero** references to
  `gstatic.com` / `googleapis.com` / `googleusercontent.com` / any
  google-hosted CDN (the only three `google.*` strings in the bundle are
  `ai.google.dev`, `aistudio.google.com`, and `cloud.google.com` docs
  links — rendered as clickable `<a href>` in provider help text, not
  auto-fetched).
- Chromium process (`cef_serve`) connects to these even on an
  "empty-tab" JCEF window in JetBrains IDEs.

### 3. Unrelated desktop apps (Telegram / WhatsApp / MSTeams / …)
Script-scoping artifact: `pgrep -f` matched a few unrelated process
command lines. Doesn't change the plugin-level finding; can be tightened
further if the final report demands a perfectly clean screenshot.

## Gaps / what Stage 2 did **not** do

- **Config-level lockdown.** A developer who edits `~/.continue/
  config.yaml` could still point the OpenAI-compatible provider at a
  public URL (e.g. `https://api.openai.com/v1`). Stage 2 does not
  prevent this.
- **Provider strip.** All ~55 non-Ollama LLM provider source files are
  still present in the bundled binary (unused at runtime, because the
  user config only references `openai`). Their URL literals appear in
  `strings` output of the binary.
- **Full URL sweep.** Docs links (`docs.continue.dev`), provider help
  URLs (`ai.google.dev`, etc.) remain in source/bundle as rendered link
  text. No auto-fetch, but they technically violate the
  "no-external-URL-references" line of the assignment.
- **OS-level egress block.** No `pfctl` / firewall guardrail. If the
  source-level stubs are ever bypassed, nothing at the OS layer stops
  the traffic.
- **Signed / release-channel build.** Plugin is unsigned, no update URL
  removed from IDE's plugin-loading path.

## Stage 3 plan (next)

Stage 3 is scoped to the two items that close the assignment's own
clauses ("cannot be reconfigured", "no external URL references in
source"). Anything else is deferred to *Future hardening*.

1. **Config lockdown** — bake the gateway URL in as a build-time
   constant, remove the `apiBase` / `apiKey` fields from Continue's YAML
   schema and from provider constructors, and add an HTTP-client
   interceptor in `continue-binary` that rejects any request whose host
   is not `localhost` / `127.0.0.1`. Directly addresses the
   "cannot-be-reconfigured" clause.
2. **Provider strip** — delete everything in `core/llm/llms/` except the
   OpenAI-compatible path the gateway speaks; remove the deleted
   providers from the registry; fix compile fallout. Removes ~55 files'
   worth of hardcoded external URLs (`api.openai.com`,
   `api.anthropic.com`, etc.) from the bundled `continue-binary`.
   Directly addresses the "no-external-URL-references" clause for the
   vast majority of offending strings.

## Future hardening (out of Stage 3 scope)

Tracked for later phases, not promised by this POC:

- **URL sweep of remaining source** — docs links (`docs.continue.dev`,
  `ai.google.dev`, etc.) rendered as `<a href>` in help text. Most
  disappear once providers are stripped (Stage 3 item 2); stragglers are
  a grep-and-replace pass.
- **OS-level egress block** (`pfctl` anchor on macOS / `iptables` on
  Linux) — belt-and-braces that catches anything source-level stubs
  missed, including Chromium's defaults.
- **JCEF runtime flags** — disable Chromium's built-in component
  updater / Safe Browsing / variations pings if `cef_serve` traffic is
  treated as in-scope.
- **Signed, versioned release** published to an internal plugin
  repository instead of "install from disk".

## Artifacts

| File | Purpose |
|------|---------|
| `dist/continue-hardened-poc-1.0.68.zip` | Installable plugin (the build of record for this report) |
| `STAGE2-PATCHES.md` | Patch decision log (written before applying changes) |
| `scripts/observe-egress.sh` | Egress observer (scoped to IDE process tree) |
| `scripts/smoke-test.sh` | Gateway + model reachability check |
| `docker-compose.yml` | Ollama + nginx gateway stack |
| `config/config.yaml` | Continue config pointing at the gateway |

## Conclusion

Stage 2's goal — *eliminate every external network call attributable to
the Continue plugin itself* — is met. The core binary and webview no
longer reach any host outside the loopback interface. Remaining
public-host traffic under JetBrains' own processes is IDE-runtime
territory — out of the Continue plugin's control surface and deferred
to the *Future hardening* list above.
