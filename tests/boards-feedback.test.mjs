import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("boards feedback route and Resend helper are wired", async () => {
  const route = await readFile(
    new URL("../src/app/api/boards/feedback/route.ts", import.meta.url),
    "utf8",
  );
  const helper = await readFile(
    new URL("../src/lib/boards/feedback-email.ts", import.meta.url),
    "utf8",
  );
  const studio = await readFile(
    new URL("../src/app/dashboard/board-studio.tsx", import.meta.url),
    "utf8",
  );
  assert.match(route, /sendBoardsFeedbackEmail/);
  assert.match(route, /requireBoardsApiSession/);
  assert.match(helper, /Authorization:\s*`Bearer \$\{/);
  assert.match(helper, /\[DVNS Boards\]/);
  assert.match(helper, /gagliardidomenico46@gmail\.com/);
  assert.match(studio, /\/api\/boards\/feedback/);
  assert.match(studio, /feedbackDialog/);
});
