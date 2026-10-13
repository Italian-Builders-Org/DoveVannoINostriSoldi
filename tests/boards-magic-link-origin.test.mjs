import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("boards magic link uses public origin helper and forces DVNS Boards from", async () => {
  const [otpRoute, magicMailer, feedback, publicOrigin, resendFrom] = await Promise.all([
    readFile(new URL("../src/app/api/boards/auth/request-otp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/boards/magic-link-email.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/boards/feedback-email.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/boards/public-origin.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/boards/resend-from.ts", import.meta.url), "utf8"),
  ]);

  assert.match(otpRoute, /boardsMagicLinkCallbackUrl/);
  assert.doesNotMatch(otpRoute, /new URL\(request\.url\)\.origin/);
  assert.match(publicOrigin, /PUBLIC_SITE_URL/);
  assert.match(publicOrigin, /VERCEL_ENV === "production"/);
  assert.match(publicOrigin, /\/accedi\/callback/);

  assert.match(magicMailer, /boardsResendFromAddress/);
  assert.match(magicMailer, /forceActionLinkRedirect/);
  assert.match(feedback, /boardsResendFromAddress/);
  assert.match(resendFrom, /DVNS Boards </);
  assert.doesNotMatch(magicMailer, /resend\.from\.includes\("<"\)/);
});
