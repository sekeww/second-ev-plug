#!/usr/bin/env bash
# Observe network activity *of the IDE and its children* while the plugin
# is in use. Scoping to the IDE's process tree is what makes this signal
# meaningful — a machine-wide lsof picks up Telegram, Teams, browsers,
# etc., which tells us nothing about whether the plugin leaks.
#
# Run this in one terminal, then interact with the Continue plugin in the
# IDE (chat, autocomplete, edit) during the observation window.
#
# Expected after a clean run:
#   - 127.0.0.1:8080                  ← gateway (intended)
#   - 127.0.0.1:<high port>           ← plugin ↔ core-binary IPC (intended)
# Anything else — public IPv4/IPv6, LAN IPs, *.continue.dev, api.openai.com
# — is a leak from the plugin or its bundled binary.
set -euo pipefail

# macOS' BSD sort/grep/awk error on non-UTF8 bytes under a UTF-8 locale;
# lsof output can contain them. Force byte-mode for everything downstream.
export LC_ALL=C

DURATION="${DURATION:-30}"
OUT="${OUT:-/tmp/egress-observation.log}"
# Default: IntelliJ IDEA installed under /Applications. Override with
# IDE_PATTERN to target another IDE — use a path-like pattern, not bare
# product names, otherwise pgrep -f will match unrelated processes whose
# command lines happen to mention those words.
IDE_PATTERN="${IDE_PATTERN:-/Applications/IntelliJ IDEA( [^/]*)?\.app/Contents/MacOS/idea}"

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof not found (this script targets macOS; adapt for Linux)" >&2
  exit 1
fi

descendants_of() {
  local seed="$*"
  local all="$seed"
  local frontier="$seed"
  while [ -n "$frontier" ]; do
    local next=""
    for pid in $frontier; do
      local children
      children=$(pgrep -P "$pid" 2>/dev/null || true)
      if [ -n "$children" ]; then
        next="$next $children"
        all="$all $children"
      fi
    done
    frontier="$next"
  done
  printf '%s\n' $all | sort -u
}

echo "==> finding IDE root processes matching: $IDE_PATTERN"
ide_pids=$(pgrep -f "$IDE_PATTERN" 2>/dev/null || true)
if [ -z "$ide_pids" ]; then
  echo "no IDE processes found. Check IDE_PATTERN. Currently running candidates:" >&2
  pgrep -lf 'idea|PyCharm|GoLand|WebStorm|RubyMine|CLion|Rider|PhpStorm|AppCode|DataGrip|RustRover' >&2 || true
  exit 1
fi

echo "==> matched IDE roots:"
for pid in $ide_pids; do
  # -o pid,comm keeps output tidy; the .app path would be huge
  ps -p "$pid" -o pid=,comm= 2>/dev/null || true
done

watch_pids=$(descendants_of $ide_pids | paste -sd, -)
tree_count=$(echo "$watch_pids" | tr ',' '\n' | wc -l | tr -d ' ')
echo "==> watching $tree_count processes (IDE + descendants)"
echo

echo "observing for ${DURATION}s, writing raw lsof output to $OUT"
echo "(go interact with Continue in the IDE now — chat, autocomplete, edit)"
: > "$OUT"

end=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$end" ]; do
  current=$(descendants_of $ide_pids | paste -sd, -)
  if [ -n "$current" ]; then
    lsof -nP -p "$current" -iTCP -sTCP:ESTABLISHED 2>/dev/null >> "$OUT" || true
  fi
  sleep 1
done

# Extract (command, endpoint) pairs from the raw lsof log. lsof format:
#   COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
#   idea   19181 u  87u IPv4 0x..   0t0 TCP  1.2.3.4:12345->5.6.7.8:443 (ESTABLISHED)
# We want $1 (command) and the <remote> from the last column that contains "->".
# Drop kernel hex sockets (->0x...) by requiring proper IP:port form.
pairs_file=$(mktemp)
awk '
  /ESTABLISHED/ {
    cmd = $1;
    for (i = 1; i <= NF; i++) {
      if ($i ~ /->/) {
        split($i, parts, "->");
        ep = parts[2];
        gsub(/[(),]/, "", ep);
        if (ep ~ /^\[[0-9a-fA-F:]+\]:[0-9]+$/ || ep ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+$/) {
          print cmd "\t" ep;
        }
      }
    }
  }
' "$OUT" | sort -u > "$pairs_file"

echo
echo "==> (process → remote endpoint) pairs observed:"
if [ ! -s "$pairs_file" ]; then
  echo "  (none — no established IPv4/IPv6 connections during window)"
  rm -f "$pairs_file"
  exit 0
fi

classify() {
  local endpoint="$1"
  local host kind
  if [[ "$endpoint" == \[*\]:* ]]; then
    host="${endpoint%]:*}"; host="${host#[}"; kind="v6"
  else
    host="${endpoint%:*}"; kind="v4"
  fi
  case "$kind:$host" in
    v4:127.0.0.1|v6:::1)                                      echo "OK  ";;
    v4:10.*|v4:192.168.*|v4:172.1[6-9].*|v4:172.2[0-9].*|v4:172.3[0-1].*) echo "LAN ";;
    v6:fc*|v6:fd*|v6:fe80*)                                   echo "LAN ";;
    *)                                                        echo "LEAK";;
  esac
}

# Print per-pair classification
while IFS=$'\t' read -r cmd endpoint; do
  tag=$(classify "$endpoint")
  printf "  %s  %-45s  %s\n" "$tag" "$endpoint" "$cmd"
done < "$pairs_file"

echo
echo "==> leaks grouped by process:"
# Filter to LEAK rows only, group by command
any_leak=0
while IFS=$'\t' read -r cmd endpoint; do
  tag=$(classify "$endpoint")
  [ "$tag" = "LEAK" ] || continue
  echo "$cmd"
  any_leak=1
done < "$pairs_file" | sort -u | while read -r cmd; do
  echo "  [$cmd]"
  awk -F'\t' -v c="$cmd" '$1==c {print "    " $2}' "$pairs_file" | while read -r ep; do
    tag=$(classify "$ep")
    [ "$tag" = "LEAK" ] && echo "    $ep"
  done
done

echo
echo "==> interpretation:"
echo "  - Leaks from 'idea' or other JetBrains processes are IDE-level calls"
echo "    (telemetry, marketplace, license, updates) — out of scope for this"
echo "    plugin assignment, addressed by corporate IDE provisioning policy."
echo "  - Leaks from node/continue/ripgrep/esbuild/etc. are from the Continue"
echo "    plugin or its bundled core binary — these are the ones the hardened"
echo "    plugin must eliminate."
echo
echo "==> gateway (127.0.0.1:8080) should appear above against the Continue-core"
echo "    process — that confirms the plugin is routing through the gateway."
rm -f "$pairs_file"
