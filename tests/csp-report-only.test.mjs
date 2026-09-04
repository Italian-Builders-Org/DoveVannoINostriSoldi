import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const REPORT_ONLY_HEADER = "content-security-policy-report-only";
const ENFORCED_HEADER = "content-security-policy";

test("the CSP is defined once and remains report-only", async () => {
  const [{ default: nextConfig }, vercelSource] = await Promise.all([
    import("../next.config.ts"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);

  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers();
  const cspRules = rules.filter((rule) =>
    rule.headers.some((header) => header.key.toLowerCase() === REPORT_ONLY_HEADER),
  );
  assert.equal(cspRules.length, 1);
  assert.equal(cspRules[0].source, "/:path*");

  const headers = rules.flatMap((rule) => rule.headers);
  const reportOnly = headers.filter(
    (header) => header.key.toLowerCase() === REPORT_ONLY_HEADER,
  );

  assert.equal(reportOnly.length, 1);
  assert.equal(
    headers.some((header) => header.key.toLowerCase() === ENFORCED_HEADER),
    false,
  );

  const vercel = JSON.parse(vercelSource);
  const vercelHeaders = vercel.headers.flatMap((rule) => rule.headers);
  assert.equal(
    vercelHeaders.some((header) =>
      [REPORT_ONLY_HEADER, ENFORCED_HEADER].includes(header.key.toLowerCase()),
    ),
    false,
  );
});

test("the report-only policy covers current Next and Analytics resources without broad escapes", async () => {
  const { default: nextConfig } = await import("../next.config.ts");
  const rules = await nextConfig.headers();
  const policy = rules
    .flatMap((rule) => rule.headers)
    .find((header) => header.key.toLowerCase() === REPORT_ONLY_HEADER)?.value;

  assert.ok(policy);
  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "worker-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
  ]) {
    assert.ok(policy.includes(directive), `Direttiva CSP mancante: ${directive}`);
  }

  assert.match(policy, /connect-src[^;]*https:\/\/\*\.google-analytics\.com/);
  assert.match(policy, /connect-src[^;]*https:\/\/\*\.analytics\.google\.com/);
  assert.match(policy, /img-src[^;]*https:\/\/\*\.google-analytics\.com/);
  assert.match(policy, /img-src[^;]*https:\/\/\*\.analytics\.google\.com/);
  assert.doesNotMatch(policy, /'unsafe-eval'/);
  assert.doesNotMatch(policy, /(?:^|\s)\*(?:\s|;|$)/);
  assert.doesNotMatch(policy, /https?:\/\/\*(?:\s|;|$)/);
  assert.doesNotMatch(policy, /(?:^|;\s*)(?:report-uri|report-to)\b/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});
