# Stage 3 — Patch Plan

Two items, scoped from STAGE2-REPORT.md's "Stage 3 plan":

1. **Config lockdown** — the "cannot be reconfigured" clause.
2. **Provider strip** — the "no external URL references" clause (bulk of).

## Item 1 — Config lockdown

### 1a. Single source of truth for the gateway URL
- New file: `core/util/internalEndpoint.ts`
  ```ts
  export const INTERNAL_LLM_URL = "http://127.0.0.1:8080/v1";
  export const INTERNAL_ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
  ```
- Constant is the build-time truth. In a real corp build this becomes the
  internal inference endpoint (e.g. `http://llm.internal.example/v1`) — the
  host just has to stay inside the allowlist.

### 1b. Force override in OpenAI provider
**File:** `core/llm/llms/OpenAI.ts`

- In the constructor (after `super(options)`), unconditionally set:
  ```ts
  this.apiBase = INTERNAL_LLM_URL;
  this.apiKey = "unused";
  ```
- Whatever the user writes in `config.yaml` under `apiBase:` / `apiKey:` is
  discarded. Schema doesn't need editing — the fields simply become inert.

### 1c. HTTP-client host allowlist (belt-and-braces)
**File:** `packages/fetch/src/fetch.ts` (in `fetchwithRequestOptions`)

- Right after the URL is parsed and normalized (`localhost` → `127.0.0.1`),
  check `url.hostname` against `INTERNAL_ALLOWED_HOSTS`. If not allowed,
  throw `Error("Egress blocked: <host>")`.
- This catches any code path that tries to fetch outside the allowlist,
  even if a future patch misses a callsite.

**Why here:** every LLM network call goes through `BaseLLM.fetch` which
calls `fetchwithRequestOptions`. Single chokepoint, one guard.

Note: the fetch package already has its own config-types dependency. We
will inline the hostname check rather than importing `core/util/…` (to
avoid a circular package reference).

## Item 2 — Provider strip

### 2a. What stays
- `core/llm/llms/OpenAI.ts` — our gateway speaks OpenAI-compatible.
- `core/llm/llms/Mock.ts` — needed by tests.
- `core/llm/llms/Test.ts` — same.

### 2b. What goes (~60 files under `core/llm/llms/`)
All other providers:

```
Anthropic Asksage Azure Bedrock BedrockImport Cerebras ClawRouter
Cloudflare Cohere CometAPI CustomLLM DeepInfra Deepseek Docker
Fireworks Flowise FunctionNetwork Gemini Groq HuggingFaceInferenceAPI
HuggingFaceTEI HuggingFaceTGI Inception Kindo LMStudio Lemonade
LlamaCpp LlamaStack Llamafile Mimo MiniMax Mistral Moonshot Msty
NCompass Nebius Nous Novita Nvidia OVHcloud Ollama OpenRouter Relace
Replicate SageMaker SambaNova Scaleway SiliconFlow TARS TextGenWebUI
Tensorix Together Venice VertexAI Vllm Voyage WatsonX xAI zAI
stubs/ContinueProxy
```

All their `.ts`, `.test.ts`, `.vitest.ts` variants.

### 2c. Registry + autodetect cleanup
- `core/llm/llms/index.ts`: reduce `LLMClasses` array to just `[OpenAI]`.
  Remove deleted imports. Remove the `if (desc.provider === "continue-proxy")`
  block.
- `core/llm/autodetect.ts`: inspect and trim any maps keyed on provider
  names — expected to need edits since it enumerates all providers.
- `core/llm/index.ts` (BaseLLM): remove the Ollama-specific error message
  branch (`"Unable to connect to local Ollama instance..."`).

### 2d. Expected compile fallout
- `core/config/profile/doLoadConfig.ts` — already patched in Stage 2,
  may still import `ContinueProxy` from stubs. Re-audit after the strip.
- `core/context/providers/ContinueProxyContextProvider.ts` — dead now,
  delete and remove its registration.
- `packages/openai-adapters/` — external package, our strip shouldn't
  touch it (used by other code paths, some provider-agnostic).

## Verification plan

| Check | Method | Pass |
|-------|--------|------|
| Non-OpenAI provider URLs absent from binary | `strings continue-binary \| grep -E "api\\.(openai\|anthropic\|mistral\|deepseek\|google)\|bedrock"` for each | **non-openai hosts → 0 hits** |
| Reconfigure attempt rejected | Edit `config.yaml`, set `apiBase: https://api.openai.com/v1`; observe gateway logs + egress | Gateway still used, or request rejected |
| Host guard fires | Add a throwaway callsite that fetches `https://example.com/`; run | Error thrown; no network traffic |
| Chat still works | docker compose up + chat | Streams response from Ollama |

## Out-of-scope reminders

From `STAGE2-REPORT.md` "Future hardening":

- URL sweep in docs / help-text strings
- OS-level egress block (pfctl / iptables)
- JCEF Chromium flags
- Signed release

Stage 3 does **not** close these.
