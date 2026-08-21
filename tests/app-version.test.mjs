import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };
import "./helpers/register-ts-alias.mjs";

const { APP_USER_AGENT, APP_VERSION } = await import("../src/lib/app-version.ts");
const sourceFetch = await import("node:fs/promises").then(({ readFile }) =>
  readFile(new URL("../src/lib/data/source-fetch.ts", import.meta.url), "utf8"));
const mcpServer = await import("node:fs/promises").then(({ readFile }) =>
  readFile(new URL("../src/lib/mcp/server.ts", import.meta.url), "utf8"));

test("runtime metadata derives one version from package.json", () => {
  assert.equal(APP_VERSION, packageJson.version);
  assert.match(APP_USER_AGENT, new RegExp(`DoveVannoINostriSoldi/${packageJson.version.replaceAll(".", "\\.")}`));
  assert.match(sourceFetch, /APP_USER_AGENT/);
  assert.doesNotMatch(sourceFetch, /DoveVannoINostriSoldi\/0\.5/);
  assert.match(mcpServer, /version: APP_VERSION/);
  assert.doesNotMatch(mcpServer, /version: "1\.0\.0"/);
});
