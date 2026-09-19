import assert from "node:assert/strict";

/** Local alias requests stay in the isolated browser, never on the public deployment. */
export function atlasTargets(primary, alias, host) {
  const canonical = new URL(primary);
  const validate = (url) => {
    assert.ok(["http:", "https:"].includes(url.protocol) && !url.username && !url.password, "URL dell’atlante non valido");
  };
  validate(canonical);
  if (alias) {
    const secondary = new URL(alias);
    validate(secondary);
    assert.notEqual(canonical.href, secondary.href, "Le due URL dell’atlante devono essere distinte");
    return { urls: [canonical.href, secondary.href], extraArgs: [], localAlias: null };
  }
  assert.ok(["localhost", "127.0.0.1"].includes(canonical.hostname), "Imposta DVNS_POLITICI_ALIAS_URL per verificare anche il sottodominio della preview");
  assert.match(host, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i, "Host dell’atlante non valido");
  const secondary = new URL(canonical.origin);
  secondary.hostname = host;
  return {
    urls: [canonical.href, secondary.href],
    extraArgs: [`--host-resolver-rules=MAP ${host} 127.0.0.1`],
    localAlias: secondary.href,
  };
}

// Passed to evaluateHandle: keep this function self-contained in the browser realm.
export function findVisibleButton(text) {
  return [...document.querySelectorAll("button")].find((element) => {
    if (element.textContent.trim() !== text || element.disabled || !element.getClientRects().length) return false;
    if (element.checkVisibility && !element.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true })) return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.inert) return false;
      if (parent instanceof HTMLDialogElement && !parent.open) return false;
      if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(":scope > summary")?.contains(element)) return false;
      const style = getComputedStyle(parent);
      if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none" || Number(style.opacity) === 0) return false;
    }
    return true;
  });
}

export async function clickText(page, label) {
  const handle = await page.evaluateHandle(findVisibleButton, label);
  try {
    const element = handle.asElement();
    assert.ok(element, `Pulsante visibile non trovato: ${label}`);
    // Real input, not element.click() in evaluate(), which bypasses hit testing.
    await element.click();
  } finally { await handle.dispose(); }
}

export async function waitForAtlas(page) {
  await page.waitForSelector('[data-politici-atlas][data-atlas-ready="true"]', { visible: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

export async function hoverSeat(page, selector = '[data-seat-person][tabindex="0"]') {
  const point = await page.$eval(selector, async (element) => {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    // Let the scroll events settle before entering the seat: scrolling correctly
    // dismisses previews, including a pending hover reveal.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error("Seggio senza matrice SVG");
    const point = new DOMPoint(0, 0).matrixTransform(matrix);
    const hit = document.elementFromPoint(point.x, point.y);
    if (!hit || !element.contains(hit)) throw new Error("Seggio coperto o fuori dal viewport");
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(point.x, point.y);
}
