#!/usr/bin/env bash
# Production gate runner: starts next start, waits for HTTP readiness with a
# bounded timeout, fails if Next terminates prematurely, runs all production
# gates, and always cleans up the server process via trap.
#
# PR1.10: no fixed sleep — readiness is probed via a stable route.
set -euo pipefail

NEXT_HOST="127.0.0.1"
NEXT_PORT="${NEXT_PORT:-3000}"
LOG_FILE="${NEXT_LOG_FILE:-/tmp/dvns-next.log}"
READY_TIMEOUT="${READY_TIMEOUT:-90}"
READY_PATH="/territori/irpef"
BASE_URL="http://${NEXT_HOST}:${NEXT_PORT}"

server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "::group::Start next start"
echo "Starting next start on ${NEXT_HOST}:${NEXT_PORT} (log: ${LOG_FILE})"
npm run start -- --hostname "$NEXT_HOST" --port "$NEXT_PORT" > "$LOG_FILE" 2>&1 &
server_pid=$!
echo "Server PID: ${server_pid}"
echo "::endgroup::"

echo "::group::Wait for server readiness"
deadline=$((SECONDS + READY_TIMEOUT))
ready=0
while [ $SECONDS -lt $deadline ]; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "ERROR: Next server (PID ${server_pid}) exited prematurely." >&2
    echo "--- server log ---" >&2
    cat "$LOG_FILE" >&2 || true
    echo "--- end server log ---" >&2
    exit 1
  fi
  if curl -sf "${BASE_URL}${READY_PATH}" > /dev/null 2>&1; then
    echo "Server ready at ${BASE_URL}${READY_PATH}"
    ready=1
    break
  fi
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "ERROR: Server not ready within ${READY_TIMEOUT}s." >&2
  echo "--- server log ---" >&2
  cat "$LOG_FILE" >&2 || true
  echo "--- end server log ---" >&2
  exit 1
fi
echo "::endgroup::"

export DVNS_BASE_URL="$BASE_URL"

echo "::group::MCP HTTP smoke"
npm run test:mcp:http
echo "::endgroup::"

echo "::group::MCP local load test"
npm run test:mcp:load -- --requests 60 --concurrency 10 --p95-ms 3000
echo "::endgroup::"

echo "::group::Browser core suite"
npm run test:browser:core
echo "::endgroup::"

echo "::group::Browser editorial suite"
npm run test:browser:editorial
echo "::endgroup::"

echo "::group::Lighthouse budget"
npm run test:lighthouse
echo "::endgroup::"

echo "All production gates passed."
