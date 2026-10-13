import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureBoardHtml,
  plainTextFromHtml,
  sanitizeBoardHtml,
} from "../src/lib/boards/board-html.ts";

test("sanitizeBoardHtml strips scripts and keeps safe inline styles", () => {
  const dirty =
    '<p style="color: #b42332; font-size: 1.2rem" onclick="alert(1)">Ciao <script>x()</script><em>mondo</em></p>';
  const clean = sanitizeBoardHtml(dirty);
  assert.match(clean, /<p style="color: #b42332; font-size: 1.2rem">/);
  assert.match(clean, /<em>mondo<\/em>/);
  assert.doesNotMatch(clean, /script|onclick/i);
});

test("ensureBoardHtml wraps plain text and preserves HTML", () => {
  assert.equal(ensureBoardHtml("Solo testo"), "<p>Solo testo</p>");
  assert.equal(
    ensureBoardHtml('<p style="font-size: 1rem">Già HTML</p>'),
    '<p style="font-size: 1rem">Già HTML</p>',
  );
  assert.equal(plainTextFromHtml("<p>Titolo <strong>forte</strong></p>"), "Titolo forte");
});
