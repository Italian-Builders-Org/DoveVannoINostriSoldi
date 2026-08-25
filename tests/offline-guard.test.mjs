import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const guardPath = new URL("../scripts/ci/node-offline-guard.mjs", import.meta.url).pathname;

function runWithGuard(code) {
  const result = spawnSync(process.execPath, [
    "--import", guardPath,
    "-e", code,
  ], {
    env: { ...process.env, DVNS_OFFLINE_GUARD: "1" },
    encoding: "utf-8",
    timeout: 10000,
  });
  return result;
}

test("external fetch is blocked under the guard", () => {
  const result = runWithGuard(`
    try {
      await fetch("http://93.184.216.34/test");
      console.log("FAIL");
      process.exit(1);
    } catch (e) {
      if (e.message && e.message.includes("offline verification attempted outbound connection")) {
        console.log("BLOCKED");
        process.exit(0);
      }
      console.log("UNEXPECTED:" + (e.message || e));
      process.exit(1);
    }
  `);
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /BLOCKED/);
});

test("external https.request is blocked under the guard", () => {
  const result = runWithGuard(`
    const https = require("https");
    try {
      https.request("https://93.184.216.34/test");
      console.log("FAIL");
      process.exit(1);
    } catch (e) {
      if (e.message && e.message.includes("offline verification attempted outbound connection")) {
        console.log("BLOCKED");
        process.exit(0);
      }
      console.log("UNEXPECTED:" + (e.message || e));
      process.exit(1);
    }
  `);
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /BLOCKED/);
});

test("loopback is not rejected by the guard", () => {
  const result = runWithGuard(`
    const http = require("http");
    const server = http.createServer((req, res) => { res.end("ok"); });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      http.get("http://127.0.0.1:" + port + "/", (res) => {
        console.log("ALLOWED");
        server.close();
        process.exit(0);
      }).on("error", (e) => {
        console.log("FAIL:" + e.message);
        server.close();
        process.exit(1);
      });
    });
  `);
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /ALLOWED/);
});

test("isLoopback correctly identifies loopback addresses", async () => {
  const { isLoopback } = await import(new URL("../scripts/ci/node-offline-guard.mjs", import.meta.url));
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("127.0.0.2"), true);
  assert.equal(isLoopback("localhost"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("93.184.216.34"), false);
  assert.equal(isLoopback("example.com"), false);
});
