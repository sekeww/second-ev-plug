# second-ev-plug — Continue.dev plugin, internal-LLM-only build

POC for securing the [Continue.dev](https://www.continue.dev/) JetBrains
plugin so it cannot reach any external network — built iteratively in
three stages, each with its own test report.

## TL;DR

A modified Continue plugin that:

- routes **only** to an internal LLM gateway (Ollama behind nginx in this
  POC; a real internal inference endpoint in production);
- cannot be reconfigured at runtime to reach external hosts
  (build-time-constant URL + provider override + HTTP host allowlist);
- contains zero references to external LLM-provider URLs or telemetry
  hosts in its compiled binary.

Architecture:

```
┌─────────── developer machine ───────────┐
│  IntelliJ IDEA                           │
│   └─ Continue (custom build)            │
│       └─► http://127.0.0.1:8080/v1 ─┐   │
│                                      │   │
│  ┌── docker net: internal-llm ──────┼─┐ │
│  │  nginx :8080  ──►  ollama :11434 │ │ │
│  └──────────────────────────────────┘ │ │
└──────────────────────────────────────────┘
```

The Ollama container is a **stand-in for the internal LLM
infrastructure**. In production, the docker stack is replaced by an
internal inference endpoint (vLLM / TGI / LiteLLM) reachable at the same
URL — no plugin change needed because everything speaks
OpenAI-compatible HTTP.

## Stages

| Stage | Scope | Status | Report |
|-------|-------|--------|--------|
| 1 | Infrastructure POC — Docker + gateway + stock plugin — identifies leaks | done | [STAGE1-REPORT.md](./STAGE1-REPORT.md) |
| 2 | Source-level leak elimination in `continue-binary` + webview; custom plugin `.zip` built | done | [STAGE2-REPORT.md](./STAGE2-REPORT.md) · [STAGE2-PATCHES.md](./STAGE2-PATCHES.md) |
| 3 | Config lockdown (build-time constant URL, host-allowlist HTTP guard) + non-OpenAI provider strip | done | [STAGE3-REPORT.md](./STAGE3-REPORT.md) · [STAGE3-PATCHES.md](./STAGE3-PATCHES.md) |

Each report contains receipts (egress observations, static URL scans,
reconfiguration tests) for that stage's claims.

## Repo layout

```
├── README.md                     ← this file
├── STAGE1-REPORT.md              ← POC + leak identification
├── STAGE2-REPORT.md              ← source-level leak elimination
├── STAGE2-PATCHES.md             ← patch decision log (pre-edit)
├── STAGE3-REPORT.md              ← config lockdown + provider strip
├── STAGE3-PATCHES.md             ← patch decision log (pre-edit)
│
├── docker-compose.yml            ← Ollama + nginx gateway
├── gateway/nginx.conf            ← reverse-proxy config
├── config/config.yaml            ← Continue plugin config
│
├── scripts/
│   ├── smoke-test.sh             ← gateway + model reachability check
│   └── observe-egress.sh         ← IDE-process-tree egress watcher
│
└── continue/                     ← our fork of Continue.dev with all patches applied
    ├── core/                       ← patched TypeScript core
    ├── gui/                        ← patched React webview
    ├── extensions/intellij/        ← patched JetBrains plugin
    └── packages/fetch/             ← patched shared fetch package (host allowlist)
```

## Quick start — build and install

Prereqs: Docker, macOS/Linux, **Node 24+**, **JDK 17**, **IntelliJ IDEA**.

```sh
# Start the internal-LLM stand-in
docker compose up -d
scripts/smoke-test.sh                        # sanity-check gateway + model

# Build the custom plugin (~15 min first run; most of it is npm installs)
cd continue
npm install
node scripts/build-packages.js
(cd core && PUPPETEER_SKIP_DOWNLOAD=true npm install && npm link)
(cd gui  && npm install && npm link @continuedev/core && npx vite build)
cp -r gui/dist/* extensions/intellij/src/main/resources/webview/
(cd extensions/vscode && npm install)        # shared helper for binary build
(cd binary && npm install && npm run build)
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
(cd extensions/intellij && ./gradlew buildPlugin --no-daemon)
# artifact:
#   continue/extensions/intellij/build/distributions/continue-intellij-extension-1.0.68.zip

# Install in IntelliJ:
#   Settings → Plugins → ⚙ → Install Plugin from Disk... → pick the .zip above
#   Restart IDE

# Wire the plugin's config to the gateway:
mkdir -p ~/.continue && cp config/config.yaml ~/.continue/config.yaml
#   (the built plugin also ignores any URL in config.yaml and forces the
#    internal gateway — this file is just used for the model name and role
#    wiring.)
```

## What the patches actually change

Summarised in each stage's report; headline:

- **Telemetry removed** — PostHog + Sentry SDKs stubbed across `core/` (Node), `gui/` (React), and the IntelliJ JVM layer (Kotlin).
- **Control-plane disabled** — `core/control-plane/env.ts` points at an unresolvable URL, `client.ts` fails fast on any request, Kotlin auth-refresh polling is a no-op, plugin.xml vendor URL removed.
- **Provider registry reduced** — 70 files deleted from `core/llm/llms/`; only `OpenAI` (+ `Mock`/`Test`) remain.
- **Gateway URL is a build-time constant** — `core/util/internalEndpoint.ts`.
- **Provider override** — `OpenAI.ts` constructor forces `this.apiBase`/`this.apiKey`, ignoring any user config.
- **HTTP host allowlist** — `packages/fetch/src/fetch.ts`'s `fetchwithRequestOptions` throws on any non-loopback hostname.

See `STAGE2-PATCHES.md` + `STAGE3-PATCHES.md` for the decision log,
and the stage reports for before/after verification.

## Testing the lockdown layer

See STAGE3-REPORT.md §Verification, plus the four end-to-end tests
documented in the commit history. Short version:

1. **Reconfiguration test** — edit `~/.continue/config.yaml` to set
   `apiBase: https://api.openai.com/v1`; restart IDE; observe gateway
   still receives all traffic (override discards the user value).
2. **Deleted-provider test** — set `provider: anthropic`; observe plugin
   reject with "Unknown LLM provider type 'anthropic'".
3. **Static URL scan** — `strings continue/binary/bin/darwin-arm64/continue-binary | grep <host>` returns 0 for all major providers.
4. **HTTP-guard unit test** — call `fetchwithRequestOptions("https://api.openai.com/v1/models")` directly; observe `Egress blocked by internal build policy: api.openai.com is not an allowed host.`

## Status

Functional end-to-end: chat + autocomplete stream from local Ollama via
gateway; external egress from `continue-binary` is zero under observation.

Known residual items (documented in `STAGE2-REPORT.md §Future
hardening`) — not in scope for this POC:

- URL sweep of remaining docs/help-text strings
- OS-level egress block (`pfctl` / `iptables`)
- JCEF runtime flags to silence Chromium's component updater / Safe Browsing
- Signed release published to an internal plugin repository

## Upstream

Built on top of [continuedev/continue](https://github.com/continuedev/continue)
(Apache 2.0). The `continue/` directory is a fork with the patches
described above applied.

## Tear down

```sh
docker compose down -v
```
