---
name: verify-dvns-integrated-sources
description: Verify the DoveVannoINostriSoldi web UI, public data APIs, RGS views, source ledger, and MCP catalog after integrated-source changes.
---

# Verify DVNS integrated sources

Use this skill after changing the source-corpus ledger, an integrated dataset,
the RGS snapshots, navigation, public selectors, or any `/dati`, `/fonti`,
`/spese`, `/trasparenza`, `/appalti`, `/incarichi` or `/partecipazioni`
surface.

## Surface

The primary user surface is the Next.js web UI. Public JSON routes and the
read-only MCP endpoint are secondary surfaces and must agree with the UI. Read
`features/README.md`, then the feature file matching the change.

## Launch

Use a unique port and retain the exact PID. Do not reuse a developer server.

```bash
export DVNS_VERIFY_PORT=43173
export DVNS_BASE_URL="http://127.0.0.1:${DVNS_VERIFY_PORT}"
export DVNS_VERIFY_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-${DVNS_VERIFY_PORT}"
export DVNS_VERIFY_EVIDENCE_DIR="$PWD/.verification-artifacts/dvns-integrated-sources/${DVNS_VERIFY_RUN_ID}"
mkdir -p "$DVNS_VERIFY_EVIDENCE_DIR"
npm run build
npm run start -- --hostname 127.0.0.1 --port "$DVNS_VERIFY_PORT" >"$DVNS_VERIFY_EVIDENCE_DIR/server.log" 2>&1 &
export DVNS_VERIFY_PID=$!
```

The instance is ready only when this succeeds:

```bash
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs doctor
```

The doctor records `doctor.json` and requires the expected release totals from
the real HTTP pages and API. If startup fails, retain `server.log` and report
the feature as NOT RUN.

## Doctor

Confirm the process and port belong to this run before driving it:

```bash
kill -0 "$DVNS_VERIFY_PID"
lsof -nP -a -p "$DVNS_VERIFY_PID" -iTCP:"$DVNS_VERIFY_PORT" -sTCP:LISTEN
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs doctor
```

All three commands must pass. Never drive a process whose PID was not captured
at launch.

## Drive

The helper uses Puppeteer with stable headings, links, table regions and route
paths already present in the repository:

```bash
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive integrated-data-catalog
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive source-ledger
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive rgs-public-pages
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive thematic-hubs
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive mcp-access
```

Repeat changed visual surfaces at the maintained mobile viewport. Mobile
evidence is stored below the same feature without overwriting desktop proof:

```bash
export DVNS_VERIFY_VIEWPORT=mobile
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive integrated-data-catalog
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive source-ledger
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive rgs-public-pages
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive thematic-hubs
node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive mcp-access
unset DVNS_VERIFY_VIEWPORT
```

Run the offline semantic gates before browser claims:

```bash
python3 scripts/etl/source_corpus_intake.py --check
python3 scripts/etl/integrated_curated_datasets.py check
python3 scripts/etl/integrated_source_release.py --check
npm test
npm run typecheck
```

For the MCP wire protocol, additionally run with the same base URL:

```bash
npm run test:mcp:http
```

## Evidence

The helper writes screenshots plus a JSON action/state transcript beneath
`$DVNS_VERIFY_EVIDENCE_DIR/<feature>/`. A valid proof contains the entry page,
the resulting detail state and assertions from the public HTTP response. It
must exercise a production route; internal setters and test-only endpoints do
not count. Browser console errors, request failures, unexpected HTTP errors,
global horizontal overflow or a secret-looking local path fail the drive.

Report PASS, FAIL or NOT RUN separately for every feature, viewport and HTTP
surface. A passing unit test does not replace an unrun browser path.

## Cleanup

Stop only the PID captured by this run, then prove the evidence survived:

```bash
kill "$DVNS_VERIFY_PID"
wait "$DVNS_VERIFY_PID" 2>/dev/null || true
test -f "$DVNS_VERIFY_EVIDENCE_DIR/doctor.json"
find "$DVNS_VERIFY_EVIDENCE_DIR" -type f -maxdepth 3 -print
```

Do not delete `.verification-artifacts` during cleanup. If launch or drive
fails, run the same PID-scoped cleanup before retrying.
