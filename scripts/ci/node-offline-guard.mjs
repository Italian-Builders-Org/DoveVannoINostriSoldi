/**
 * Application-level network guard for Node.js offline verification.
 *
 * This module monkey-patches the Node.js HTTP/HTTPS client APIs and global
 * fetch to block accidental outbound network access during offline data-contract
 * verification. It is **not** kernel-level egress isolation.
 *
 * It catches the application-level paths exercised by the Node test suite:
 *   - globalThis.fetch
 *   - http.request / http.get
 *   - https.request / https.get
 *
 * Loopback addresses (127.0.0.0/8, ::1, localhost) are allowed.
 *
 * Activation:
 *   Set DVNS_OFFLINE_GUARD=1 in the environment, then use:
 *     --import ./scripts/ci/node-offline-guard.mjs
 *   or:
 *     NODE_OPTIONS="--import ./scripts/ci/node-offline-guard.mjs" DVNS_OFFLINE_GUARD=1 node ...
 *
 * Blocked connections throw an Error with a diagnostic message:
 *   offline verification attempted outbound connection to example.com:443
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const http = require("http");
const https = require("https");

const isLoopback = (host) => {
  if (host === "localhost") return true;
  if (host === "::1" || host === "[::1]") return true;
  if (host.startsWith("127.")) return true;
  if (host === "::ffff:127.0.0.1") return true;
  return false;
};

const blockMessage = (host, port) =>
  `offline verification attempted outbound connection to ${host}:${port}`;

const wrapUrl = (url) => {
  if (typeof url === "string") {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }
  return url;
};

const checkUrl = (parsed) => {
  if (!parsed || !parsed.hostname) return;
  if (!isLoopback(parsed.hostname)) {
    throw new Error(blockMessage(parsed.hostname, parsed.port || 443));
  }
};

const active = process.env.DVNS_OFFLINE_GUARD === "1";

if (active) {
  // --- Patch globalThis.fetch ---
  if (typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      let parsed;
      if (input instanceof URL) {
        parsed = input;
      } else if (typeof input === "string") {
        parsed = wrapUrl(input);
      } else if (input && typeof input.url === "string") {
        parsed = wrapUrl(input.url);
      }
      if (parsed) {
        checkUrl(parsed);
      }
      return originalFetch(input, init);
    };
  }

  // --- Patch http and https (CJS objects are mutable) ---
  const modules = [
    [http, 80],
    [https, 443],
  ];

  for (const [mod, defaultPort] of modules) {
    const originalRequest = mod.request;

    const patchedRequest = (urlOrOptions, optionsOrCallback, callback) => {
      let hostname;
      let port;

      if (typeof urlOrOptions === "string" || urlOrOptions instanceof URL) {
        const parsed = wrapUrl(urlOrOptions);
        if (parsed) {
          hostname = parsed.hostname;
          port = parsed.port;
        }
      } else if (urlOrOptions && typeof urlOrOptions === "object") {
        hostname = urlOrOptions.hostname || urlOrOptions.host;
        port = urlOrOptions.port;
        if (!hostname && typeof optionsOrCallback === "object") {
          hostname = optionsOrCallback.hostname || optionsOrCallback.host;
          port = optionsOrCallback.port;
        }
      }

      if (hostname && !isLoopback(hostname)) {
        throw new Error(blockMessage(hostname, port || defaultPort));
      }

      return originalRequest(urlOrOptions, optionsOrCallback, callback);
    };

    const patchedGet = (urlOrOptions, optionsOrCallback, callback) => {
      const req = patchedRequest(urlOrOptions, optionsOrCallback, callback);
      req.end();
      return req;
    };

    mod.request = patchedRequest;
    mod.get = patchedGet;
  }

  if (process.env.DVNS_OFFLINE_GUARD_DEBUG === "1") {
    process.stderr.write("[node-offline-guard] active — external connections will be blocked\n");
  }
}

export { isLoopback, blockMessage };
