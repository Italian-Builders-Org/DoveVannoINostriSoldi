import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Next dev resources allow only the local browser hosts", async () => {
  const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

  assert.match(config, /allowedDevOrigins:\s*\["localhost",\s*"127\.0\.0\.1"\]/);
  assert.doesNotMatch(config, /allowedDevOrigins:[^\n]*\*/);
});
