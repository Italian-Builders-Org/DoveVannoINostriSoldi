import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("assistant credentials and model output stay out of storage and HTML rendering", async () => {
  const paths = ["assistant-chat.tsx", "assistant-provider-settings.tsx", "assistant-ai-reply.tsx", "assistant-markdown.tsx"];
  const components = await Promise.all(paths.map(path => readFile(new URL(`../src/components/${path}`, import.meta.url), "utf8")));
  assert.doesNotMatch(components.join("\n"), /localStorage|sessionStorage|dangerouslySetInnerHTML|console\.(?:log|error)/);
  assert.match(components[0], /aria-live="polite"/);
  assert.match(components[1], /type="password"/);
  assert.match(components[1], /pagehide/);
  assert.match(components[0], /connectionRef\.current = null/);
});
