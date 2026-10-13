import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  boardsMagicLinkCallbackUrl,
  boardsPublicOrigin,
  forceActionLinkRedirect,
} from "../src/lib/boards/public-origin.ts";
import { boardsResendFromAddress } from "../src/lib/boards/resend-from.ts";

test("production magic-link callback always uses the public site origin", () => {
  assert.equal(
    boardsMagicLinkCallbackUrl("http://localhost:3000/api/boards/auth/request-otp", {
      vercelEnv: "production",
    }),
    "https://www.dovevannoinostrisoldi.com/accedi/callback",
  );
  assert.equal(
    boardsPublicOrigin("https://preview.example/api/x", { vercelEnv: "production" }),
    "https://www.dovevannoinostrisoldi.com",
  );
});

test("non-production keeps request origin unless BOARDS_PUBLIC_ORIGIN is set", () => {
  assert.equal(
    boardsMagicLinkCallbackUrl("http://127.0.0.1:3055/api/boards/auth/request-otp", {
      vercelEnv: "preview",
    }),
    "http://127.0.0.1:3055/accedi/callback",
  );
  assert.equal(
    boardsMagicLinkCallbackUrl("http://localhost:3000/api/x", {
      vercelEnv: "development",
      boardsPublicOrigin: "https://staging.example/",
    }),
    "https://staging.example/accedi/callback",
  );
});

test("forceActionLinkRedirect overwrites Supabase redirect_to even when Site URL was localhost", () => {
  const raw =
    "https://ykhkorefmkkyqzbvjslg.supabase.co/auth/v1/verify?token=abc&type=magiclink&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Faccedi%2Fcallback";
  const fixed = forceActionLinkRedirect(
    raw,
    "https://www.dovevannoinostrisoldi.com/accedi/callback",
  );
  const url = new URL(fixed);
  assert.equal(
    url.searchParams.get("redirect_to"),
    "https://www.dovevannoinostrisoldi.com/accedi/callback",
  );
  assert.equal(url.searchParams.get("token"), "abc");
});

test("boards Resend from uses boards@ on the shared domain, never consulenza@", () => {
  assert.equal(
    boardsResendFromAddress("Consulenza <consulenza@dovevannoinostrisoldi.com>"),
    "DVNS Boards <boards@dovevannoinostrisoldi.com>",
  );
  assert.equal(
    boardsResendFromAddress("consulenza@dovevannoinostrisoldi.com"),
    "DVNS Boards <boards@dovevannoinostrisoldi.com>",
  );
  assert.equal(
    boardsResendFromAddress("Consulenza <consulenza@dovevannoinostrisoldi.com>", {
      boardsFrom: "Boards <boards@custom.example>",
    }),
    "DVNS Boards <boards@custom.example>",
  );
  assert.throws(() => boardsResendFromAddress("not-an-email"), /non valido/);
});

test("request-otp and mailers wire the helpers; public origin stays aligned with site.ts", async () => {
  const [otpRoute, magicMailer, feedback, site] = await Promise.all([
    readFile(new URL("../src/app/api/boards/auth/request-otp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/boards/magic-link-email.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/boards/feedback-email.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/site.ts", import.meta.url), "utf8"),
  ]);
  assert.match(otpRoute, /boardsMagicLinkCallbackUrl/);
  assert.doesNotMatch(otpRoute, /new URL\(request\.url\)\.origin/);
  assert.match(magicMailer, /forceActionLinkRedirect/);
  assert.match(magicMailer, /boardsResendFromAddress/);
  assert.match(feedback, /boardsResendFromAddress/);
  assert.match(site, /PUBLIC_SITE_URL = "https:\/\/www\.dovevannoinostrisoldi\.com"/);
});
