import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { HOME_ASSISTANT_EXAMPLES, HOME_QUESTION_MAX, assistantHref, assistantPrefill } = await import("../src/lib/assistant-home.ts");

test("a question from the home page reaches the chat as a draft, not as a sent message", () => {
  assert.equal(assistantPrefill("?q=Quanto%20spende%20lo%20Stato%3F"), "Quanto spende lo Stato?");
  assert.equal(assistantPrefill(""), "");
  assert.equal(assistantPrefill("?altro=1"), "");
});

test("the prefill is trimmed, single-line and bounded", () => {
  assert.equal(assistantPrefill("?q=%20%20ciao%0A%0Amondo%09%20"), "ciao mondo");
  assert.equal(assistantPrefill(`?q=${"a".repeat(HOME_QUESTION_MAX + 50)}`).length, HOME_QUESTION_MAX);
  assert.equal(assistantPrefill("?q=%00%1Fnull"), "null");
});

test("example links round-trip through the prefill", () => {
  assert.equal(HOME_ASSISTANT_EXAMPLES.length, 3);
  for (const example of HOME_ASSISTANT_EXAMPLES) {
    const href = assistantHref(example);
    assert.match(href, /^\/assistente\?q=/u);
    assert.equal(assistantPrefill(href.slice(href.indexOf("?"))), example);
  }
});
