import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("accedi and dashboard routes exist and describe OTP login", async () => {
  const accedi = await readFile(new URL("../src/app/accedi/page.tsx", import.meta.url), "utf8");
  const form = await readFile(new URL("../src/app/accedi/accedi-form.tsx", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
  const studio = await readFile(new URL("../src/app/dashboard/board-studio.tsx", import.meta.url), "utf8");
  const settings = await readFile(
    new URL("../src/app/dashboard/settings/page.tsx", import.meta.url),
    "utf8",
  );
  const requestRoute = await readFile(
    new URL("../src/app/api/boards/auth/request-otp/route.ts", import.meta.url),
    "utf8",
  );
  const accountMenu = await readFile(
    new URL("../src/components/boards-account-menu.tsx", import.meta.url),
    "utf8",
  );
  assert.match(accedi, /data-immersive-page="boards"/);
  assert.match(accedi, /Torna al sito/);
  assert.match(accedi, /Utilizzabile solo da web/);
  assert.match(accedi, /non è supportato su smartphone o tablet/);
  assert.match(accedi, /featureList/);
  assert.match(accedi, /lavagna/);
  assert.match(form, /Invia link di accesso/);
  assert.match(form, /preview-otp-code/);
  assert.match(form, /link di accesso/);
  assert.match(dashboard, /redirect\("\/accedi"\)/);
  assert.match(dashboard, /BoardsHome/);
  assert.match(studio, /data-testid="boards-dashboard"/);
  assert.match(studio, /Torna al sito/);
  const boardPage = await readFile(
    new URL("../src/app/dashboard/b/[boardId]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(boardPage, /BoardStudio/);
  assert.match(settings, /data-testid="boards-settings"/);
  assert.match(settings, /DeleteAccountPanel/);
  const deletePanel = await readFile(
    new URL("../src/app/dashboard/settings/delete-account-panel.tsx", import.meta.url),
    "utf8",
  );
  const deleteRoute = await readFile(
    new URL("../src/app/api/boards/auth/delete-account/route.ts", import.meta.url),
    "utf8",
  );
  const privacy = await readFile(new URL("../src/app/privacy/page.tsx", import.meta.url), "utf8");
  assert.match(deletePanel, /settings-delete-account/);
  assert.match(deletePanel, /ELIMINA/);
  assert.match(deleteRoute, /supabaseAdminDeleteUser/);
  assert.match(deleteRoute, /deleteCloudAccountData/);
  assert.match(privacy, /DVNS Boards/);
  assert.match(privacy, /dashboard\/settings/);
  assert.match(requestRoute, /previewCode/);
  assert.match(accountMenu, /Apri dashboard/);
  assert.match(accountMenu, /Impostazioni/);
  const magicMailer = await readFile(
    new URL("../src/lib/boards/magic-link-email.ts", import.meta.url),
    "utf8",
  );
  assert.match(magicMailer, /generate_link/);
  assert.ok(magicMailer.includes("api.resend.com/emails"));
  assert.match(magicMailer, /Accedi a DVNS Boards/);
});
