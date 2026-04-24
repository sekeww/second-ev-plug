# Stage 1 Test Report — Internal-LLM Continue Plugin (POC)

*Infrastructure-only POC: no Continue source changes.*

## Objective

Before committing to source-level surgery on the Continue.dev plugin, validate
the **end-to-end architecture** with a stock install:

1. Can the plugin be pointed at an internal LLM endpoint (Ollama behind an
   OpenAI-compatible gateway) via config alone?
2. Does config-only routing actually prevent the plugin from reaching external
   networks?

Stage 1 was intentionally scoped to *observation*, not enforcement — the
question it answers is "do we need Stage 2 at all, and what exactly does
Stage 2 have to target?"

## Test environment

- macOS, IntelliJ IDEA 2026.1
- Docker Desktop running `ollama/ollama:latest` + `nginx:1.27-alpine`
- Continue plugin: **stock, installed from JetBrains marketplace** (v1.0.68)
- Model: `qwen2.5-coder:1.5b` served by Ollama, proxied through nginx at
  `http://127.0.0.1:8080/v1/*`

## Architecture under test

```
┌─────────── developer machine ───────────┐
│  IntelliJ IDEA                           │
│   └─ Continue plugin (stock)            │
│       └─► http://127.0.0.1:8080/v1 ─┐   │
│                                      │   │
│  ┌── docker net: internal-llm ──────┼─┐ │
│  │  nginx :8080  ──►  ollama :11434 │ │ │
│  └──────────────────────────────────┘ │ │
└──────────────────────────────────────────┘
```

- Gateway published on `127.0.0.1:8080` only (no external host can reach it).
- Ollama container has **no** published port.
- `config/config.yaml` configures Continue's OpenAI-compatible provider to
  use `http://localhost:8080/v1` — no other providers defined.

## What Stage 1 is designed to prove

| Claim | Expected if true | Expected if false |
|-------|------------------|-------------------|
| Stock plugin can be routed through the gateway | gateway access logs show plugin traffic | no requests reach nginx |
| Config-only is sufficient to prevent external egress | **no** public-IP connections from plugin processes | at least one public-IP connection from `continue-` / `cef_serve` |

The second question is the important one — the whole reason to build a
Stage 2 exists only if the answer is "not sufficient."

## Method

1. `docker compose up -d` — Ollama + nginx up, model pulled.
2. `scripts/smoke-test.sh` — verify gateway responds on `/v1/models` and
   `/v1/chat/completions` with a synthetic prompt.
3. Install stock Continue in IntelliJ, drop `config/config.yaml` at
   `~/.continue/config.yaml`, restart IDE.
4. In the Continue side panel, send several chat messages; let autocomplete
   fire on real code.
5. In parallel, `scripts/observe-egress.sh` collects established TCP
   connections from the IDE's process tree (via `lsof`), for 30 s. Re-walks
   the tree each tick to capture newly-spawned children (the `continue-`
   core binary, the `cef_serve` webview helper, etc.).
6. Observer classifies each endpoint as **OK** (loopback), **LAN**
   (RFC 1918), or **LEAK** (anything public), grouped by process name.

### Observer iterations (worth flagging)

The observation script went through four rewrites before producing usable
signal — each iteration is documented here because the methodology lessons
carry into Stage 3.

| Iteration | Problem | Fix |
|-----------|---------|-----|
| v1 | `lsof` scoped to whole machine — caught every app on the laptop | Scope to IDE PID tree |
| v2 | `pgrep -f "IntelliJ IDEA|idea|..."` matched unrelated processes whose argv contained `idea` | Anchor pattern to installed `.app` path |
| v3 | `grep -oE '->[^ ]+'` failed — BSD grep read `->` as a flag | `grep -oE -- '->…'` |
| v4 | Regex caught `lsof` kernel-socket hex pointers (`->0xabc…`) as "leaks" | Restrict to IPv4/IPv6 `host:port` forms in an `awk` pass |

Final iteration also attributes each endpoint to its owning command
(`idea`, `continue-`, `cef_serve`, etc.) so plugin-origin traffic can be
distinguished from IDE-origin traffic.

## Results

### Gateway reachability

`scripts/smoke-test.sh` returns `/v1/models` listing the pulled Ollama
model and a `/v1/chat/completions` reply ("OK") in <1 s. Nginx access log
confirms the request. **Gateway is reachable.** ✅

### Plugin wiring

The Continue side panel loads, shows the model "Internal Chat" from
`config/config.yaml`, and streams responses from Ollama during a chat
session. **Plugin routes through the gateway.** ✅

### Egress observation (the key result)

`observe-egress.sh` output after a 30 s chat session, filtered to the
plugin's two relevant processes:

| Process | Endpoint | Classification |
|---------|----------|----------------|
| `continue-` | `127.0.0.1:8080` | OK — gateway (intended) |
| `continue-` | **`[2606:4700:10::ac42:a6a4]:443`** | **LEAK — Cloudflare** |
| `cef_serve` | `127.0.0.1:6189`, `127.0.0.1:63265-6` | OK — IDE↔webview IPC |
| `cef_serve` | **`[2600:1f18:4c12:9a01:c440:faea:46e4:5874]:443`** | **LEAK — AWS CloudFront** |
| `idea` | `127.0.0.1:6188`, loopback | OK |

(Other processes in the observation — Telegram, Teams, etc. — were
script-scoping artifacts from earlier observer iterations; they are not
part of the plugin's process tree in the final run.)

### Identifying the leak targets

- `[2606:4700:10::ac42:a6a4]` reverse-resolves to Cloudflare infrastructure.
  Cross-referenced against the plugin source tree, this is almost
  certainly `api.continue.dev` (Continue's hub / control-plane endpoint,
  fronted by Cloudflare).
- `[2600:1f18:4c12:9a01:…]` is AWS CloudFront. Cross-referenced against
  `gui/src/hooks/TelemetryProviders.tsx`, this matches PostHog's CDN
  (`app.posthog.com` → AWS CF).

## Conclusions

| Question | Answer |
|----------|--------|
| Can the plugin be pointed at an internal gateway via config? | **Yes** — `continue-` routes `/v1/*` requests to `127.0.0.1:8080`. |
| Is config-only sufficient to eliminate external traffic? | **No** — even with zero external-LLM providers configured, the plugin makes **two classes** of unconfigurable outbound calls: control-plane (Cloudflare) from the core binary, and telemetry (AWS/PostHog) from the webview. |

The second answer is the whole justification for Stage 2. Stage 2 is
therefore scoped to **source-level elimination** of both leaks, verified
by re-running this same observer and confirming `continue-` and
`cef_serve` show only loopback endpoints.

## What Stage 1 does **not** claim

- That the plugin cannot be reconfigured by a developer to reach external
  hosts (config-level lockdown is a separate requirement, deferred).
- That the source tree contains no external URL literals (string-scan
  evidence belongs to the hardened build, deferred).
- That the IntelliJ IDE itself is silent — JetBrains marketplace,
  telemetry, update-check traffic is out of scope and expected.

## Artifacts produced in Stage 1

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Ollama + nginx gateway stack |
| `gateway/nginx.conf` | Reverse-proxy config (OpenAI-compatible /v1, streaming) |
| `config/config.yaml` | Continue config (OpenAI provider → gateway) |
| `scripts/smoke-test.sh` | Gateway reachability check |
| `scripts/observe-egress.sh` | Process-scoped egress observer |
| `README.md` | POC overview + how-to-run |

## Handoff to Stage 2

Two targets, both confirmed by observation:

1. **`continue-` → Cloudflare** — comes from the bundled Node core binary.
   Root-cause target: `core/control-plane/*`, `core/util/posthog.ts`,
   `core/util/sentry/*`.
2. **`cef_serve` → AWS** — comes from the React webview. Root-cause
   target: `gui/src/hooks/TelemetryProviders.tsx`, `posthog-js` imports
   across `gui/src`, `@sentry/react`, `sentryVitePlugin` in the build.

Stage 2's pass criterion is straightforward: repeat this observation
against the custom build and confirm both lines disappear.
