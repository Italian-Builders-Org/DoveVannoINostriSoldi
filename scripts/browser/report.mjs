import assert from "node:assert/strict";
import {
  closeBrowser,
  defaultBaseUrl,
  delay,
  launchBrowser,
  runScenario,
  waitForServer,
} from "./harness.mjs";

/**
 * "Segnala un problema": the global trigger, the dialog and its four states.
 *
 * GitHub is never contacted: successful and failed submissions are simulated by
 * intercepting POST /api/segnalazioni at the browser boundary. Only the last
 * scenario reaches the real endpoint, which on CI has no credentials and must
 * answer 503 with the prefilled GitHub composer as fallback.
 */

const baseUrl = defaultBaseUrl();
const ENDPOINT = "/api/segnalazioni";
const TRIGGER = 'button[data-report-problem-trigger="floating"]';
const INLINE_TRIGGER = 'button[data-report-problem-trigger="inline"]';
const DIALOG = "dialog[open]";
const ISSUE_URL = "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/4242";

if (!/^https?:$/.test(baseUrl.protocol)) {
  throw new Error("DVNS_BASE_URL deve usare il protocollo HTTP oppure HTTPS.");
}

async function triggerGeometry(page, selector) {
  return page.evaluate((sel) => {
    const button = document.querySelector(sel);
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      text: button.textContent?.trim() ?? "",
      name: button.getAttribute("aria-label") ?? "",
      visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  }, selector);
}

async function dialogState(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    if (!dialog) return null;
    const rect = dialog.getBoundingClientRect();
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const title = labelledBy ? document.getElementById(labelledBy)?.textContent?.trim() : null;
    return {
      title,
      containsFocus: dialog.contains(document.activeElement),
      activeTag: document.activeElement?.tagName ?? null,
      fitsViewport: rect.left >= 0 && rect.right <= window.innerWidth + 1 && rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
      scrollWidthOk: dialog.scrollWidth <= dialog.clientWidth + 1,
    };
  });
}

/**
 * Activates the trigger until the dialog appears. The first activation can
 * land before hydration on a cold server and be lost: that is a plain HTML
 * button with no handler yet, not a defect in the dialog.
 */
async function activateUntilOpen(page, activate, label) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await activate();
    try {
      await page.waitForSelector(DIALOG, { visible: true, timeout: 2_000 });
      return;
    } catch {
      // retry after hydration has had time to attach the handler
    }
  }
  assert.fail(`${label}: il dialog non si apre dopo ripetute attivazioni`);
}

async function openDialog(page, { label, selector = TRIGGER }) {
  await page.waitForSelector(selector, { visible: true });
  await activateUntilOpen(page, () => page.click(selector), label);
  const state = await dialogState(page);
  assert.ok(state, `${label}: dialog non aperto`);
  assert.equal(state.title, "Segnala un problema", `${label}: titolo dialog`);
  assert.equal(state.containsFocus, true, `${label}: il focus deve entrare nel dialog`);
  assert.equal(state.fitsViewport, true, `${label}: il dialog esce dal viewport`);
  assert.equal(state.scrollWidthOk, true, `${label}: overflow orizzontale nel dialog`);
  return state;
}

async function fillField(page, labelText, value) {
  const handle = await page.evaluateHandle((text) => {
    const label = Array.from(document.querySelectorAll("dialog[open] label"))
      .find((node) => node.textContent?.trim().startsWith(text));
    return label ? document.getElementById(label.getAttribute("for") ?? "") : null;
  }, labelText);
  const element = handle.asElement();
  assert.ok(element, `campo «${labelText}» non trovato`);
  await element.click({ clickCount: 3 });
  await element.type(value);
}

async function chooseCategory(page, value) {
  await page.click(`dialog[open] input[name="category"][value="${value}"]`);
}

function interceptEndpoint(page, respond) {
  return page.setRequestInterception(true).then(() => {
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === ENDPOINT) {
        const payload = JSON.parse(request.postData() ?? "{}");
        const { status, body } = respond(payload);
        request.respond({
          status,
          contentType: "application/json",
          headers: { "cache-control": "private, no-store" },
          body: JSON.stringify(body),
        });
        return;
      }
      request.continue();
    });
  });
}

/** A 503 from the report endpoint is the behaviour under test, not a page error. */
const allowReportUnavailable = (failure) => failure.includes("/api/segnalazioni") && /503/.test(failure);

async function submit(page) {
  await page.click('dialog[open] button[type="submit"]');
}

let browser;
try {
  await waitForServer(baseUrl);
  browser = await launchBrowser({ extraArgs: ["--disable-extensions"] });

  for (const width of [390, 768, 1280]) {
    await runScenario(browser, {
      suite: "report",
      label: `Segnala un problema: trigger e tastiera a ${width}px`,
      pathname: "/",
      width,
      validate: async (page) => {
        const label = `${width}px`;
        const trigger = await triggerGeometry(page, TRIGGER);
        assert.ok(trigger?.visible, `${label}: trigger globale assente`);
        assert.equal(trigger.name, "Segnala un problema", `${label}: nome accessibile del trigger`);
        assert.equal(trigger.text, "Segnala un problema", `${label}: etichetta visivamente nascosta`);
        assert.ok(trigger.height >= 44, `${label}: area di tocco ${trigger.height}px < 44px`);
        assert.ok(trigger.width <= 48, `${label}: il trigger globale deve restare un'icona (${trigger.width}px)`);
        assert.ok(trigger.left >= 0 && trigger.right <= trigger.innerWidth + 1, `${label}: trigger fuori viewport`);
        assert.ok(trigger.bottom <= trigger.innerHeight + 1, `${label}: trigger sotto il viewport`);

        const overlap = await page.evaluate((sel) => {
          const button = document.querySelector(sel);
          const rect = button.getBoundingClientRect();
          const probe = document.elementFromPoint(rect.left - 8, rect.top + rect.height / 2);
          return probe ? !button.contains(probe) : true;
        }, TRIGGER);
        assert.equal(overlap, true, `${label}: il trigger non deve estendersi oltre il proprio bordo`);

        // Keyboard: the trigger is focusable and opens with Enter; Esc closes and returns focus.
        await activateUntilOpen(page, async () => {
          await page.focus(TRIGGER);
          await page.keyboard.press("Enter");
        }, label);
        const opened = await dialogState(page);
        assert.equal(opened.containsFocus, true, `${label}: focus non nel dialog`);
        assert.equal(await page.$eval(TRIGGER, (node) => node.getAttribute("aria-expanded")), "true");

        await page.keyboard.press("Escape");
        await page.waitForSelector(DIALOG, { hidden: true });
        const focusBack = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), TRIGGER);
        assert.equal(focusBack, true, `${label}: dopo Esc il focus deve tornare al trigger`);
        assert.equal(await page.$eval(TRIGGER, (node) => node.getAttribute("aria-expanded")), "false");
      },
    });
  }

  await runScenario(browser, {
    suite: "report",
    label: "Segnala un problema: validazione e invio riuscito su route dinamica",
    pathname: "/enti/agid",
    width: 1280,
    afterNavigate: async (page) => {
      await interceptEndpoint(page, (payload) => {
        assert.equal(payload.page.path, "/enti/agid", "il path della pagina viene allegato");
        assert.equal(payload.category, "dato");
        assert.equal(payload.website, "", "honeypot vuoto");
        assert.ok(payload.context.viewport.width > 0);
        assert.ok(Date.parse(payload.context.openedAt) <= Date.parse(payload.context.reportedAt));
        return { status: 201, body: { ok: true, issue: { number: 4242, url: ISSUE_URL }, duplicate: false } };
      });
    },
    validate: async (page) => {
      await openDialog(page, { label: "route dinamica" });

      // Empty submit: errors linked to fields, announced, focus on the first one.
      await submit(page);
      await page.waitForSelector('dialog[open] [role="alert"]', { visible: true });
      const emptyState = await page.evaluate(() => {
        const invalid = Array.from(document.querySelectorAll('dialog[open] [aria-invalid="true"]'));
        return {
          invalidCount: invalid.length,
          firstFocused: invalid[0] === document.activeElement,
          describedOk: invalid.every((node) => {
            const ids = (node.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
            return ids.some((id) => document.getElementById(id)?.textContent?.includes("obbligatorio"));
          }),
        };
      });
      assert.equal(emptyState.invalidCount, 3, "tre campi obbligatori vuoti devono risultare invalidi");
      assert.equal(emptyState.firstFocused, true, "il focus va sul primo campo invalido");
      assert.equal(emptyState.describedOk, true, "ogni errore è collegato al campo");

      await fillField(page, "Cosa è successo", "La spesa 2024 mostrata è 1.000 €.");
      await fillField(page, "Cosa ti aspettavi", "La fonte riporta 2.000 €.");
      await fillField(page, "Passaggi per riprodurre", "Apri la scheda ente e leggi il totale.");
      await chooseCategory(page, "dato");
      const reminder = await page.$eval("dialog[open]", (node) => node.textContent);
      assert.match(reminder, /non dimostra da solo spreco, frode o responsabilità/);
      assert.match(reminder, /issue\s+pubblica/i);
      assert.match(reminder, /report privato GitHub/);

      // Contesting a datum without a source is refused client-side.
      await submit(page);
      await page.waitForSelector('dialog[open] input[type="url"][aria-invalid="true"]', { visible: true });
      await fillField(page, "Fonte ufficiale", "https://www.istat.it/fonte-ufficiale");

      await submit(page);
      await page.waitForSelector('dialog[open] [role="status"]', { visible: true });
      const success = await page.evaluate(() => {
        const status = document.querySelector('dialog[open] [role="status"]');
        const link = status?.querySelector("a[href]");
        return { text: status?.textContent ?? "", href: link?.getAttribute("href") ?? null };
      });
      assert.match(success.text, /Segnalazione inviata/);
      assert.match(success.text, /#4242/);
      assert.equal(success.href, ISSUE_URL);
      assert.equal(await page.$('dialog[open] button[type="submit"]'), null, "nessun doppio submit dopo il successo");
    },
  });

  await runScenario(browser, {
    suite: "report",
    label: "Segnala un problema: errore del provider conserva i dati e offre il fallback",
    pathname: "/supporto",
    width: 768,
    expectedFailure: allowReportUnavailable,
    afterNavigate: async (page) => {
      let attempts = 0;
      await interceptEndpoint(page, () => {
        attempts += 1;
        assert.equal(attempts, 1, "un solo invio per click");
        return {
          status: 503,
          body: {
            ok: false,
            code: "unavailable",
            message: "GitHub non ha risposto.",
            fallbackUrl: "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/new?title=x",
          },
        };
      });
    },
    validate: async (page) => {
      await openDialog(page, { label: "supporto", selector: INLINE_TRIGGER });
      await fillField(page, "Cosa è successo", "Testo che non deve andare perso");
      await fillField(page, "Cosa ti aspettavi", "Atteso");
      await fillField(page, "Passaggi per riprodurre", "Passi");
      await submit(page);
      await page.waitForSelector('dialog[open] [role="alert"] a[href^="https://github.com/"]', { visible: true });
      const kept = await page.evaluate(() => {
        const areas = Array.from(document.querySelectorAll("dialog[open] textarea")).map((node) => node.value);
        const alert = document.querySelector('dialog[open] [role="alert"]');
        return { areas, alert: alert?.textContent ?? "", submitEnabled: !document.querySelector('dialog[open] button[type="submit"]').disabled };
      });
      assert.equal(kept.areas[0], "Testo che non deve andare perso", "il contenuto resta nel form");
      assert.match(kept.alert, /Invio non riuscito/);
      assert.match(kept.alert, /modulo GitHub precompilato/);
      assert.equal(kept.submitEnabled, true, "si può riprovare");
    },
  });

  await runScenario(browser, {
    suite: "report",
    label: "Segnala un problema: endpoint reale senza credenziali degrada al composer GitHub",
    pathname: "/territori/irpef",
    width: 390,
    expectedFailure: allowReportUnavailable,
    validate: async (page) => {
      await openDialog(page, { label: "endpoint reale" });
      await fillField(page, "Cosa è successo", "Osservato dal browser");
      await fillField(page, "Cosa ti aspettavi", "Atteso dal browser");
      await fillField(page, "Passaggi per riprodurre", "1. Apri\n2. Guarda");
      // The server refuses submissions faster than a person could type.
      await delay(3_200);
      await submit(page);
      await page.waitForSelector('dialog[open] [role="alert"] a[href^="https://github.com/"]', { visible: true, timeout: 15_000 });
      const fallback = await page.$eval('dialog[open] [role="alert"] a[href^="https://github.com/"]', (node) => node.getAttribute("href"));
      const url = new URL(fallback);
      assert.equal(url.pathname, "/Italian-Builders-Org/DoveVannoINostriSoldi/issues/new");
      assert.match(url.searchParams.get("title"), /^\[Segnalazione\] Bug del sito: \/territori\/irpef/);
      assert.ok(url.searchParams.get("body").includes("Osservato dal browser"));
      assert.ok(!url.searchParams.get("body").includes("dvns-report-key"));
    },
  });

  console.log("Browser report suite: OK");
} finally {
  await closeBrowser(browser);
}
