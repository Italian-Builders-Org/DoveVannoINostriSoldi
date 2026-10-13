import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("boardsAuthMode never uses local_preview on Vercel", async () => {
  const authMode = await readFile(
    new URL("../src/lib/boards/auth-mode.ts", import.meta.url),
    "utf8",
  );
  assert.match(authMode, /process\.env\.VERCEL_ENV === "production" \|\| process\.env\.VERCEL/);
  const requestRoute = await readFile(
    new URL("../src/app/api/boards/auth/request-otp/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(requestRoute, /previewCode/);
  assert.match(authMode, /local_preview/);
});

test("requestBoardsOtp omits localMagicLink on Vercel and in production", async () => {
  const otpSource = await readFile(
    new URL("../src/lib/boards/otp.ts", import.meta.url),
    "utf8",
  );
  assert.match(otpSource, /devOnlyLocalLink/);
  assert.match(otpSource, /NODE_ENV !== "production" && !process\.env\.VERCEL/);
  const routeSource = await readFile(
    new URL("../src/app/api/boards/auth/request-otp/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(routeSource, /localMagicLink/);
});

test("cloud API routes revoke sessions when profile is missing", async () => {
  const apiSession = await readFile(
    new URL("../src/lib/boards/api-session.ts", import.meta.url),
    "utf8",
  );
  assert.match(apiSession, /cloudProfileExists/);
  assert.match(apiSession, /maxAge: 0/);
  assert.match(apiSession, /status: 401/);

  const libraryRoute = await readFile(
    new URL("../src/app/api/boards/library/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(libraryRoute, /requireBoardsApiSession/);
  assert.doesNotMatch(libraryRoute, /readBoardsSession\(/);
});
