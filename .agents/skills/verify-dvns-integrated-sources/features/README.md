# DVNS integrated-source verification map

This map is the maintained user-facing verification source for the integrated
public-spending release.

## Baseline preconditions

- Build the exact checkout with `npm run build`.
- Launch a new `next start` instance on a unique loopback port.
- Record its PID and use a new `.verification-artifacts` run directory.
- Run the skill doctor and require 91 datasets, 14.457.856 source rows, 1.475.510
  public rows, 34.071 source identities and a complete release.
- Never drive a pre-existing dev server or a port not owned by the captured PID.

## Driving conventions

- Start from the route named in the feature file.
- Prefer the visible H1, accessible table region and exact link href.
- Preserve query parameters in the captured URL.
- Record browser errors, failed requests and HTTP errors.
- Test mobile and desktop when layout or navigation changes.

## Proof and skip reporting

- Keep both the action page and resulting detail screenshot.
- Keep the JSON transcript and API response used for assertions.
- A unit/API PASS and a browser NOT RUN are separate outcomes.
- Cleanup may stop only the run-owned PID and must retain all evidence.

## Feature entry contract

Every feature file names sub-features, user entry points, exact drive commands,
observable results and known traps.

## Features

- [Integrated data catalog](./integrated-data-catalog.md)
- [Source ledger](./source-ledger.md)
- [RGS public pages](./rgs-public-pages.md)
- [Thematic hubs](./thematic-hubs.md)
- [MCP access](./mcp-access.md)
