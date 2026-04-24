#!/usr/bin/env bash
# Smoke-test: verify the gateway serves an OpenAI-compatible response
# backed by local Ollama. Run after `docker compose up -d`.
set -euo pipefail

GATEWAY="${GATEWAY:-http://localhost:8080}"
MODEL="${MODEL:-qwen2.5-coder:1.5b}"

echo "==> gateway health"
curl -fsS "$GATEWAY/healthz"

echo "==> /v1/models (OpenAI-compatible)"
curl -fsS "$GATEWAY/v1/models" | head -c 400
echo

echo "==> /v1/chat/completions (non-streaming)"
curl -fsS "$GATEWAY/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "$(cat <<JSON
{
  "model": "$MODEL",
  "messages": [{"role": "user", "content": "Reply with the single word: OK"}],
  "stream": false,
  "max_tokens": 8
}
JSON
)" | head -c 400
echo
echo "==> smoke test done"
