# MCP access

The read-only MCP catalog exposes the same integrated selector used by public
pages and APIs.

## Sub-features

- `mcp-catalog-page` lists the machine-readable datasets.
- `mcp-list` advertises `spesa_pa_dettaglio`.
- `mcp-query` delegates `code`, `query`, `limit` and `offset` to the public selector.
- `mcp-errors` rejects unknown IDs and unsupported filters.

## How to get to it (user POV)

- Choose `MCP` in the footer or open `/mcp`.
- Connect an MCP client to `/api/mcp`.
- Call `list_datasets`, then `query_dataset`.

## Driving it with verify-dvns-integrated-sources

Preconditions:

- The skill doctor passes.
- `tests/mcp-datasets.test.mjs` passes.

- **Open MCP page.** Run `node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive mcp-access`. The H1 is `Interroga il portale con MCP` and `spesa_pa_dettaglio` is present.
- **Exercise HTTP transport.** Run `npm run test:mcp:http` with `DVNS_BASE_URL` pointing to the run-owned server. Tool discovery, the existing protocol envelopes and a bounded `spesa_pa_dettaglio` query must pass.
- **Proof.** Retain `mcp.png`, `state.json` and the terminal transcript of `test:mcp:http`.

## Gotchas

- The MCP endpoint is read-only but still has strict Host and Origin checks.
- Run `list_datasets` before choosing the `code` value.
- A catalog-only dataset returns metadata and zero rows by design.
