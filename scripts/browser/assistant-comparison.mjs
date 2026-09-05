import assert from "node:assert/strict";

/** Real form submission: both API facts and the rendered, keyboard-operated result. */
export async function inspectAssistantComparison(page, { partial = false } = {}) {
  const prompt = partial
    ? "Confronta i pagamenti dei Comuni in Calabria tra 2025 e 2026"
    : "Come sono cambiati i pagamenti dei Comuni tra il 2024 e il 2025?";
  if (partial) {
    await page.type("#assistant-prompt", prompt);
  } else {
    const example = await page.$('button::-p-text(Come sono cambiati i pagamenti)');
    assert.ok(example, "esempio di confronto assente");
    await example.focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.$eval("#assistant-prompt", (element) => element.value), prompt);
    assert.equal(await page.$("#assistant-comparison-title"), null, "l’esempio non deve inviare automaticamente");
  }
  const pending = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/assistant" && response.request().method() === "POST",
  );
  await page.focus('main form button[type="submit"]');
  await page.keyboard.press("Enter");
  const response = await pending;
  assert.equal(response.status(), 200);
  assert.match(response.headers()["cache-control"], /no-store/);
  const payload = await response.json();
  assert.equal(payload.kind, "comparison");
  const { answers, change, caveats } = payload.comparison;
  assert.equal(answers.length, 2);
  assert.deepEqual(answers.map((answer) => answer.period.year), partial ? [2025, 2026] : [2024, 2025]);
  assert.ok(answers.every((answer) => answer.observation.scope === (partial ? "Calabria" : "Italia")));
  if (partial) {
    assert.equal(change, null);
    assert.match(caveats[0], /Variazione non calcolata/);
  } else {
    assert.equal(change.euro, (Math.round(answers[1].observation.value * 100) - Math.round(answers[0].observation.value * 100)) / 100);
    assert.ok(Number.isFinite(change.percent));
  }
  await page.waitForSelector("#assistant-comparison-title");
  const result = await page.$eval('[aria-live="polite"]', (element) => ({ text: element.textContent, busy: element.getAttribute("aria-busy") }));
  assert.equal(result.busy, "false");
  assert.ok(!result.text.includes(prompt), "prompt copiato nella risposta");
  assert.match(result.text, /Importi nominali/);
  for (const answer of answers) {
    assert.ok(result.text.includes(answer.period.label));
    const formatted = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(answer.observation.value);
    assert.ok(result.text.includes(formatted), `valore ${answer.period.year} divergente`);
  }
  const links = await page.$$eval('[aria-live="polite"] article a', (elements) => elements.map((element) => element.href));
  assert.deepEqual(links, answers.map((answer) => answer.source.url));
  assert.equal(await page.$('[aria-label="Variazione tra gli anni"]') !== null, !partial);
  if (!partial) {
    const delta = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(change.euro);
    assert.ok(result.text.includes(delta));
  }
  return payload;
}
