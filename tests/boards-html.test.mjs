import assert from "node:assert/strict";
import test from "node:test";

// In Node non c'è DOMParser: si verifica il fallback sicuro (solo testo escapato).
const {
  ensureBoardHtml,
  plainTextFromHtml,
  sanitizeBoardHtml,
} = await import("../src/lib/boards/board-html.ts");

test("sanitizeBoardHtml without DOMParser falls back to escaped plain text", () => {
  const dirty =
    '<p style="color: #b42332" onclick="alert(1)">Ciao <script>x()</script><em>mondo</em></p>';
  const clean = sanitizeBoardHtml(dirty);
  assert.equal(clean, "<p>Ciao x() mondo</p>");
  assert.doesNotMatch(clean, /script|onclick|style=/i);
});

test("ensureBoardHtml wraps plain text and flattens HTML without DOMParser", () => {
  assert.equal(ensureBoardHtml("Solo testo"), "<p>Solo testo</p>");
  assert.equal(ensureBoardHtml('<p style="font-size: 1rem">Già HTML</p>'), "<p>Già HTML</p>");
  assert.equal(plainTextFromHtml("<p>Titolo <strong>forte</strong></p>"), "Titolo forte");
});
