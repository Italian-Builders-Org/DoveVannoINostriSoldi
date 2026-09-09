#!/usr/bin/env bash
# Production gate runner: starts next start, waits for HTTP readiness with a
# bounded timeout, fails if Next terminates prematurely, runs all production
# gates, and always cleans up the server process via trap.
set -euo pipefail
cd "$(dirname "$0")/../.."

NEXT_HOST="127.0.0.1"
NEXT_PORT="${NEXT_PORT:-3000}"
LOG_FILE="${NEXT_LOG_FILE:-artifacts/production/next.log}"
READY_TIMEOUT="${READY_TIMEOUT:-90}"
READY_PATH="/territori/irpef"
BASE_URL="http://${NEXT_HOST}:${NEXT_PORT}"

# The MCP route allows 30 POSTs per public-client window. Keep the declared
# production sequence auditable and fail before starting a server if it ever
# exceeds that budget.
MCP_WINDOW_POST_BUDGET=30
MCP_CONTRACT_POSTS=29
MCP_SUBSCRIPTION_POSTS=2
MCP_LOAD_REQUESTS=15
if (( MCP_CONTRACT_POSTS > MCP_WINDOW_POST_BUDGET )); then
  echo "ERROR: MCP contract smoke declares ${MCP_CONTRACT_POSTS} POSTs, above the ${MCP_WINDOW_POST_BUDGET}-POST window budget." >&2
  exit 1
fi
if (( MCP_SUBSCRIPTION_POSTS + MCP_LOAD_REQUESTS > MCP_WINDOW_POST_BUDGET )); then
  echo "ERROR: MCP subscription + load declares $((MCP_SUBSCRIPTION_POSTS + MCP_LOAD_REQUESTS)) POSTs, above the ${MCP_WINDOW_POST_BUDGET}-POST window budget." >&2
  exit 1
fi

# Next may represent an internal rewrite through `localhost` even when the
# production-gate server is bound to 127.0.0.1. Keep browser CORS fail-closed
# while explicitly allowing only this run-owned loopback origin.
export MCP_ALLOWED_ORIGINS="${MCP_ALLOWED_ORIGINS:-$BASE_URL}"

server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
mkdir -p "$(dirname "$LOG_FILE")"

# Fail before readiness probes can accidentally exercise another worktree.
node --input-type=module - "$NEXT_HOST" "$NEXT_PORT" <<'JS'
import { createServer } from "node:net";
const [host, rawPort] = process.argv.slice(2);
const port = Number(rawPort);
if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`NEXT_PORT must be an integer from 1 to 65535: ${rawPort}`);
}
const server = createServer();
server.once("error", (error) => {
  console.error(`Cannot use ${host}:${port}: ${error.code}. Choose another NEXT_PORT.`);
  process.exitCode = 1;
});
server.listen(port, host, () => server.close());
JS

echo "::group::Start next start"
echo "Starting next start on ${NEXT_HOST}:${NEXT_PORT} (log: ${LOG_FILE})"
node node_modules/next/dist/bin/next start --hostname "$NEXT_HOST" --port "$NEXT_PORT" > "$LOG_FILE" 2>&1 &
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
  if curl --connect-timeout 2 --max-time 3 -sf "${BASE_URL}${READY_PATH}" > /dev/null 2>&1; then
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
npm run test:mcp:http -- --mode contract
MCP_CONTRACT_WINDOW_COMPLETED_MS="$(node -e 'console.log(Date.now())')"
echo "::endgroup::"

echo "::group::Browser assistant chat suite"
npm run test:browser:assistant
echo "::endgroup::"

echo "::group::Browser assistant attachments suite"
npm run test:browser:attachments
echo "::endgroup::"

echo "::group::Browser assistant voice suite"
npm run test:browser:voice
echo "::endgroup::"

echo "::group::Browser navigation suite"
npm run test:browser:navigation
echo "::endgroup::"

echo "::group::Browser papers suite"
npm run test:browser:papers
echo "::endgroup::"

echo "::group::MCP rate-limit window transition"
# The 29 contract POSTs above share the local public-client window. Start the
# conservative residual interval only after that group completes: every POST is
# known to predate this timestamp. The two subscriptions and 15-sample load then
# occupy only 17 POSTs in the next window. Browser suites that already consumed
# the interval continue immediately.
node scripts/ci/mcp-rate-limit-window.mjs "$MCP_CONTRACT_WINDOW_COMPLETED_MS"
echo "::endgroup::"

echo "::group::MCP subscription smoke"
npm run test:mcp:http -- --mode subscription
echo "::endgroup::"

echo "::group::MCP local load test"
npm run test:mcp:load -- \
  --url "${BASE_URL}/api/mcp" \
  --requests "$MCP_LOAD_REQUESTS" \
  --concurrency 6 \
  --p95-ms 3000
echo "::endgroup::"

echo "::group::Browser core suite"
npm run test:browser:core
echo "::endgroup::"

echo "::group::Browser procurement peer comparisons"
npm run test:browser:procurement-peers
echo "::endgroup::"

echo "::group::Browser operator pages"
node scripts/browser/operatori.mjs
echo "::endgroup::"

echo "::group::Browser procurement award years"
node scripts/browser/procurement-award-year.mjs
echo "::endgroup::"

echo "::group::Browser chart interactions"
npm run test:browser:charts
echo "::endgroup::"

echo "::group::Browser editorial suite"
npm run test:browser:editorial
echo "::endgroup::"

echo "::group::Browser report suite"
npm run test:browser:report
echo "::endgroup::"

echo "::group::Browser monthly reports suite"
npm run test:browser:monthly-report
echo "::endgroup::"

echo "::group::Browser studies suite"
node scripts/browser/studies.mjs
echo "::endgroup::"

echo "::group::CSP Report-Only browser smoke"
npm run test:csp:report-only
echo "::endgroup::"

echo "::group::Lighthouse budget"
npm run test:lighthouse
echo "::endgroup::"

echo "All production gates passed."
