# Stage 2 — Patch Plan

Root-cause the two leaks Stage 1 exposed (`continue-` → Cloudflare,
`cef_serve` → AWS) and decide what to delete or stub. Each entry names
the **callsite**, its **purpose in stock Continue**, and the **patch
strategy** (per user decision: easiest-path = delete/short-circuit).

---

## Leak 1 — `continue-` (core binary) → `[2606:4700:10::ac42:a6a4]:443` (Cloudflare)

The binary is a bundled Node app (`core/` → esbuild → vercel/pkg).
The Cloudflare host is `api.continue.dev` and/or `app.posthog.com`.
Three independent code paths reach Cloudflare *on startup or first
interaction*:

### 1a. Control-plane / hub URLs
**File:** `core/control-plane/env.ts`
**What it does:** hardcodes `https://api.continue.dev/` as
`CONTROL_PLANE_URL` and `https://continue.dev/` as `APP_URL`. These are
used by `ConfigHandler`, `ContinueProxyContextProvider`,
`ContinueProxy`, `NextEditLoggingService`, and `doLoadConfig` for hub
config sync, auth, proxy routing, and feedback upload.
**Patch:** replace every URL literal with `http://disabled.invalid/`
(RFC 6761 reserved, guaranteed unresolvable) and force `enableHubContinueDev()`
and `useHub()` to return `false` unconditionally. No actual calls happen
because callers check these flags first, but even if they didn't, the
invalid URL fails fast.

### 1b. PostHog analytics
**File:** `core/util/posthog.ts`
**What it does:** initializes a PostHog client pointing at
`https://app.posthog.com` and captures events throughout the core on
every startup, chat turn, autocomplete, etc. Imported by `core.ts`
(mandatory — top-level import).
**Patch:** rewrite the file so `Telemetry` class methods are all no-ops
and `capture`/`shutdownPosthogClient` do nothing. Do **not** change
callsites — keep the same exported surface.

### 1c. Sentry error reporting
**File:** `core/util/sentry/SentryLogger.ts` (+ `anonymization.ts`,
`constants.ts`)
**What it does:** initializes Sentry SDK pointing at a DSN
(`https://...@...ingest.sentry.io/...`). Reports unhandled errors.
Imported by `doLoadConfig.ts`.
**Patch:** stub `SentryLogger` so all methods are no-ops. Delete
Sentry's DSN constant. Don't remove the import sites.

### 1d. (Note) `ContinueProxy` LLM + `ContinueProxyContextProvider`
These only fire if the user has a hub assistant or a `ContinueProxy`
model in their config. Our Stage 1 config uses only `openai` (Ollama
via gateway), so they shouldn't fire. **Leave untouched for Stage 2.**
(In Stage 3 both files get removed anyway as part of the provider
strip — see STAGE2-REPORT.md "Stage 3 plan" item 2.)

---

## Leak 2 — `cef_serve` (JCEF webview) → `[2600:1f18:4c12:...]:443` (AWS)

The sidebar UI is a React/Vite app (`gui/`) loaded into JetBrains' JCEF
browser. AWS = `app.posthog.com` (PostHog uses AWS CloudFront).

### 2a. `posthog-js` client (GUI)
**Files:**
- `gui/src/components/PosthogPageView.ts`
- `gui/src/components/dialogs/FeedbackDialog.tsx`
- `gui/src/components/dialogs/AddDocsDialog.tsx`
- `gui/src/components/mainInput/TipTapEditor/utils/renderSlashCommand.ts`
- `gui/src/components/mainInput/TipTapEditor/utils/editorConfig.ts`
- (initialization lives in the app root — find via `PostHogProvider`)

**What it does:** browser-side PostHog capturing page views and UX
events. Runs from the moment the webview loads.

**Patch (easiest path):** add a **module shim** for `posthog-js` and
`posthog-js/react` via Vite's `resolve.alias`. The shim exports no-op
classes/hooks with the same shape. Zero callsite changes; every import
gets redirected to our stub at bundle time.

### 2b. `@sentry/react` or equivalent in GUI
**File:** `gui/vite.config.ts` (imports `@sentry/vite-plugin`)
**What it does:** the Vite plugin uploads source maps to Sentry at
**build time**; if the token env var isn't set, it's a no-op. Runtime
Sentry in the GUI — check `gui/src` for `@sentry` imports; stub
similarly if present.
**Patch:** remove `sentryVitePlugin(...)` from `vite.config.ts`
(build-time leak, not runtime, but belongs in the URL-free artifact).
Alias any runtime `@sentry/*` imports to a no-op shim.

### 2c. External resource hints / fetches at load
**Files to grep:** `gui/index.html`, `gui/src/**/*.css`, Tailwind
config. Look for `<link rel="preconnect">`, font CDNs, images on CDNs.
**Patch:** remove any external preconnect/font URL found. (Cheap — HTML
edit.)

---

## Patch technique summary

| Leak | File(s) | Strategy |
|---|---|---|
| 1a | `core/control-plane/env.ts` | replace URLs with `http://disabled.invalid/`; force hub flags to false |
| 1b | `core/util/posthog.ts` | rewrite → no-op Telemetry |
| 1c | `core/util/sentry/SentryLogger.ts` | rewrite → no-op logger; delete DSN |
| 2a | `gui/vite.config.ts` + `gui/stubs/posthog-shim.ts` | alias `posthog-js` + `posthog-js/react` to stub |
| 2b | `gui/vite.config.ts` | remove sentryVitePlugin call; alias `@sentry/*` if imported at runtime |
| 2c | `gui/index.html`, CSS | remove external preconnect/fonts |

**Not touching in Stage 2** (see STAGE2-REPORT.md for where each lands):
- Non-Ollama provider files (~55 files under `core/llm/llms/`) — Stage 3 (provider strip)
- Hardcoded URLs *inside* unused provider files — Stage 3 (falls out of provider strip)
- `core/control-plane/client.ts` internal methods (only called if hub is enabled, which 1a disables) — future hardening
- `core/continueServer/` stubs — future hardening
- Docs, test fixtures, markdown — future hardening (URL sweep)

---

## Verification plan

After applying patches and rebuilding:

1. `docker compose up -d` (Ollama gateway)
2. Install the custom plugin zip in IntelliJ
3. Run `scripts/observe-egress.sh` during a real chat session
4. **Pass:** `continue-` and `cef_serve` rows show only `127.0.0.1:*`
5. **Functional check:** chat reply from Ollama, autocomplete fires on real code
