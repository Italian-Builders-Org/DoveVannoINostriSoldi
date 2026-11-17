/**
 * Smoke-test the mobilita MCP App HTML with a minimal ext-apps host (postMessage).
 * Requires network for OpenFreeMap tiles.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import "../../tests/helpers/register-ts-alias.mjs";
import { closeBrowser, defaultArtifactsDir, launchBrowser } from "./harness.mjs";

const { mobilitaRomaBusLiveAppHtml } = await import("../../src/lib/mcp/mobilita-roma-mcp-app.ts");

const artifactsDir = path.join(defaultArtifactsDir(), "mcp-mobilita-app");
mkdirSync(artifactsDir, { recursive: true });

const appHtml = mobilitaRomaBusLiveAppHtml();

function hostPage(origin) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <title>DVNS MCP App host (smoke)</title>
  <style>
    html, body { margin: 0; height: 100%; background: #111; }
    #frame { width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  <iframe id="frame" title="MCP App" src="${origin}/app"></iframe>
  <script>
    const frame = document.getElementById("frame");

    window.addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow) return;
      const msg = event.data;
      if (!msg || msg.jsonrpc !== "2.0") return;

      if (msg.method === "ui/initialize" && msg.id !== undefined) {
        event.source.postMessage({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: msg.params?.protocolVersion ?? "2025-11-25",
            hostInfo: { name: "dvns-mcp-app-smoke", version: "1.0.0" },
            hostContext: {},
            hostCapabilities: {
              sandbox: {
                csp: {
                  connectDomains: ["https://tiles.openfreemap.org"],
                  resourceDomains: ["blob:", "https://tiles.openfreemap.org"],
                },
              },
            },
          },
        }, "*");
        return;
      }

      if (msg.method === "ui/notifications/initialized") {
        setTimeout(() => {
          event.source.postMessage({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-result",
            params: {
              content: [{ type: "text", text: "fixture" }],
              structuredContent: {
                ok: true,
                vehicles: [
                  { linea: "64", lat: 41.9012, lon: 12.5004 },
                  { linea: "492", lat: 41.905, lon: 12.51 },
                ],
              },
            },
          }, "*");
        }, 100);
      }
    });
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const origin = `http://127.0.0.1:${port}`;
  if (req.url === "/app") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(appHtml);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(hostPage(origin));
});

let port;
await new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
  port = server.address().port;
  resolve();
}));
const pageUrl = `http://127.0.0.1:${port}/`;

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768 });
  let sawOpenFreeMap = false;
  page.on("request", (req) => {
    if (req.url().includes("tiles.openfreemap.org")) sawOpenFreeMap = true;
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[page]", msg.text());
  });

  await page.goto(pageUrl, { waitUntil: "networkidle0", timeout: 120_000 });

  const frameHandle = await page.waitForSelector("#frame");
  const frame = await frameHandle.contentFrame();
  assert.ok(frame, "iframe content frame missing");
  frame.on("console", (msg) => {
    if (msg.type() === "error") console.error("[app]", msg.text());
  });

  await frame.waitForFunction(() => window.__dvnsMapReady === true, { timeout: 120_000 });
  await frame.waitForSelector(".maplibregl-canvas", { timeout: 30_000 });

  await frame.waitForFunction(() => {
    const canvas = document.querySelector(".maplibregl-canvas");
    return canvas instanceof HTMLCanvasElement && canvas.width > 0;
  }, { timeout: 30_000 });

  const screenshotPath = path.join(artifactsDir, "roma-bus-live-map.png");
  const mapCanvas = await frame.$(".maplibregl-canvas");
  assert.ok(mapCanvas, "map canvas missing for screenshot");
  await mapCanvas.screenshot({ path: screenshotPath });

  assert.equal(sawOpenFreeMap, true, "expected OpenFreeMap tile requests");
  console.log(`Saved ${screenshotPath}`);
} finally {
  await closeBrowser(browser);
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}