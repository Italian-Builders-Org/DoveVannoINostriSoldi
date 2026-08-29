import assert from "node:assert/strict";
import {
  NAVIGATION_TIMEOUT_MS,
  closeBrowser,
  createPage,
  defaultBaseUrl,
  installDiagnostics,
  launchBrowser,
  navigate,
  saveFailureArtifacts,
  scenarioIdFromLabel,
  waitForServer,
} from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const TABLE_REGION = '[role="region"][aria-label="Redditi e variabili IRPEF per territorio"]';
const ACTIVE_LEVEL = 'nav[aria-label="Livello territoriale"] a[aria-current="page"]';
const INFO_TOOLTIP_IDS = ["cash-payments-tip"];

if (!/^https?:$/.test(baseUrl.protocol)) {
  throw new Error("DVNS_BASE_URL deve usare il protocollo HTTP oppure HTTPS.");
}

async function viewportState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const main = document.querySelector("main");
    const mainRect = main?.getBoundingClientRect();
    const mainStyle = main ? getComputedStyle(main) : null;

    return {
      bodyScrollWidth: body.scrollWidth,
      clientWidth: root.clientWidth,
      h1Count: document.querySelectorAll("h1").length,
      innerWidth,
      mainVisible: Boolean(
        main &&
        mainRect &&
        mainRect.width > 0 &&
        mainRect.height > 0 &&
        mainStyle?.display !== "none" &&
        mainStyle?.visibility !== "hidden",
      ),
      rootScrollWidth: root.scrollWidth,
    };
  });
}

async function assertResponsiveShell(page, label, width) {
  const state = await viewportState(page);
  assert.equal(state.clientWidth, width, `${label}: viewport inatteso`);
  assert.equal(state.h1Count, 1, `${label}: deve esserci un solo h1`);
  assert.equal(state.mainVisible, true, `${label}: il contenuto principale non è visibile`);
  assert.ok(
    state.rootScrollWidth <= state.clientWidth + 1,
    `${label}: overflow globale ${state.rootScrollWidth}px > ${state.clientWidth}px`,
  );
  assert.ok(
    state.bodyScrollWidth <= state.clientWidth + 1,
    `${label}: overflow del body ${state.bodyScrollWidth}px > ${state.clientWidth}px`,
  );
}

async function assertCohesionTracePanelContrast(page, label) {
  const state = await page.evaluate(() => {
    function luminance(red, green, blue) {
      const channels = [red, green, blue]
        .map((value) => value / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }
    function contrast(first, second) {
      const [lighter, darker] = [luminance(...first), luminance(...second)].sort((left, right) => right - left);
      return (lighter + 0.05) / (darker + 0.05);
    }
    function parseRgb(color) {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    const section = [...document.querySelectorAll("main section")].find(
      (candidate) => candidate.querySelector("h2")?.textContent?.includes("Il totale non basta"),
    );
    if (!section) return null;

    const background = parseRgb(getComputedStyle(section).backgroundColor);
    const heading = section.querySelector("h2");
    const body = section.querySelector("p");
    const kicker = section.querySelector("div > span");
    const metricValue = section.querySelector("strong");
    const metricLabel = metricValue?.nextElementSibling;

    return {
      background,
      samples: [
        ["heading", heading, 4.5],
        ["body", body, 4.5],
        ["kicker", kicker, 4.5],
        ["metric value", metricValue, 4.5],
        ["metric label", metricLabel, 4.5],
      ].map(([name, element, minimum]) => {
        const foreground = element ? parseRgb(getComputedStyle(element).color) : null;
        return {
          name,
          minimum,
          ratio: foreground && background ? contrast(foreground, background) : null,
        };
      }),
    };
  });

  assert.ok(state, `${label}: pannello traccia PNRR non trovato`);
  assert.ok(
    state.background?.every((channel) => channel < 80),
    `${label}: sfondo del pannello traccia non risulta scuro`,
  );
  for (const sample of state.samples) {
    assert.ok(sample.ratio !== null, `${label}: colore ${sample.name} non misurabile`);
    assert.ok(
      sample.ratio >= sample.minimum,
      `${label}: contrasto ${sample.name} ${sample.ratio.toFixed(2)} < ${sample.minimum}`,
    );
  }
}

async function assertCohesionStatusLayout(page, label) {
  const state = await page.$eval("main", (main) => {
    const section = [...main.querySelectorAll("section")].find(
      (candidate) => candidate.querySelector("h2")?.textContent?.trim() === "A che punto sono i progetti",
    );
    const list = section?.querySelector("ul");
    if (!section || !list) return null;

    const listRect = list.getBoundingClientRect();
    return {
      listClientWidth: list.clientWidth,
      listScrollWidth: list.scrollWidth,
      listRight: listRect.right,
      rows: [...list.querySelectorAll(":scope > li")].map((row) => {
        const value = row.lastElementChild;
        const rowRect = row.getBoundingClientRect();
        const valueRect = value?.getBoundingClientRect();
        return {
          rowClientWidth: row.clientWidth,
          rowScrollWidth: row.scrollWidth,
          rowRight: rowRect.right,
          valueClientWidth: value?.clientWidth ?? 0,
          valueScrollWidth: value?.scrollWidth ?? 0,
          valueRight: valueRect?.right ?? 0,
        };
      }),
    };
  });

  assert.ok(state, `${label}: elenco degli stati non trovato`);
  assert.equal(state.rows.length, 5, `${label}: numero di stati inatteso`);
  assert.ok(
    state.listScrollWidth <= state.listClientWidth + 1,
    `${label}: elenco stati oltre il proprio contenitore`,
  );
  for (const [index, row] of state.rows.entries()) {
    assert.ok(
      row.rowScrollWidth <= row.rowClientWidth + 1,
      `${label}: riga ${index + 1} oltre il proprio contenitore`,
    );
    assert.ok(
      row.valueScrollWidth <= row.valueClientWidth + 1,
      `${label}: valore della riga ${index + 1} tagliato o eccedente`,
    );
    assert.ok(
      row.valueRight <= row.rowRight + 1 && row.valueRight <= state.listRight + 1,
      `${label}: valore della riga ${index + 1} esce dal pannello`,
    );
  }
}

async function assertCohesionPathwayContrast(page, label) {
  const state = await page.$eval("main", (main) => {
    const heading = [...main.querySelectorAll("h2")].find((candidate) =>
      candidate.textContent?.includes("Segui un progetto fino alla gara"),
    );
    const panel = heading?.closest("section");
    const paragraph = panel?.querySelector("p");
    if (!panel || !heading || !paragraph) return null;

    function luminance(color) {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) return null;
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }

    function ratio(foreground, background) {
      const first = luminance(foreground);
      const second = luminance(background);
      if (first === null || second === null) return null;
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    }

    const background = getComputedStyle(panel).backgroundColor;
    const headingColor = getComputedStyle(heading).color;
    const paragraphColor = getComputedStyle(paragraph).color;
    return {
      headingContrast: ratio(headingColor, background),
      paragraphContrast: ratio(paragraphColor, background),
    };
  });

  assert.ok(state, `${label}: percorso PNRR non trovato`);
  assert.ok(state.headingContrast >= 4.5, `${label}: contrasto titolo ${state.headingContrast}`);
  assert.ok(state.paragraphContrast >= 4.5, `${label}: contrasto testo ${state.paragraphContrast}`);
}

async function assertInfoTooltips(page, label) {
  for (const tooltipId of INFO_TOOLTIP_IDS) {
    const selector = `button[aria-controls="${tooltipId}"]`;
    const button = await page.$(selector);
    assert.ok(button, `${label}: trigger ${tooltipId} assente`);

    await button.focus();
    await page.waitForFunction(
      (id) => {
        const tooltip = document.getElementById(id);
        if (
          tooltip?.getAttribute("data-open") !== "true" ||
          tooltip.getAttribute("data-positioned") !== "true" ||
          getComputedStyle(tooltip).display === "none"
        ) {
          return false;
        }
        const rect = tooltip.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      },
      { timeout: 2_000 },
      tooltipId,
    );

    const openState = await page.$eval(selector, (trigger, id) => {
      const tooltip = document.getElementById(id);
      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip?.getBoundingClientRect();
      return {
        describedBy: trigger.getAttribute("aria-describedby"),
        expanded: trigger.getAttribute("aria-expanded"),
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
        triggerRect: {
          left: triggerRect.left,
          right: triggerRect.right,
        },
        tooltipDisplay: tooltip ? getComputedStyle(tooltip).display : "missing",
        tooltipVisibility: tooltip ? getComputedStyle(tooltip).visibility : "missing",
        tooltipRect: tooltipRect
          ? {
              left: tooltipRect.left,
              right: tooltipRect.right,
              width: tooltipRect.width,
            }
          : null,
      };
    }, tooltipId);

    assert.equal(openState.expanded, "true", `${label}: ${tooltipId} non risulta aperto`);
    assert.equal(openState.describedBy, tooltipId, `${label}: descrizione ARIA assente`);
    assert.equal(openState.tooltipDisplay, "block", `${label}: tooltip non visibile`);
    assert.equal(openState.tooltipVisibility, "visible", `${label}: tooltip invisibile`);
    assert.ok(openState.tooltipRect, `${label}: rettangolo tooltip assente`);
    assert.ok(openState.tooltipRect.width > 0, `${label}: tooltip senza larghezza`);
    assert.ok(openState.tooltipRect.left >= -1, `${label}: tooltip ${tooltipId} esce a sinistra`);
    assert.ok(
      openState.tooltipRect.right <= openState.innerWidth + 1,
      `${label}: tooltip ${tooltipId} esce a destra`,
    );
    assert.ok(openState.triggerRect.left >= -1, `${label}: trigger ${tooltipId} esce a sinistra`);
    assert.ok(
      openState.triggerRect.right <= openState.innerWidth + 1,
      `${label}: trigger ${tooltipId} esce a destra`,
    );
    assert.ok(
      openState.bodyScrollWidth <= openState.clientWidth + 1,
      `${label}: overflow mentre ${tooltipId} è aperto`,
    );

    await page.keyboard.press("Escape");
    await page.waitForFunction(
      (id) => document.getElementById(id)?.getAttribute("data-open") === "false",
      { timeout: 2_000 },
      tooltipId,
    );
    const closedState = await page.$eval(selector, (trigger) => ({
      describedBy: trigger.getAttribute("aria-describedby"),
      expanded: trigger.getAttribute("aria-expanded"),
    }));
    assert.equal(closedState.expanded, "false", `${label}: Escape non chiude ${tooltipId}`);
    assert.equal(closedState.describedBy, null, `${label}: descrizione chiusa ancora esposta`);
    await button.dispose();
  }
}

async function assertRegionalMapSelection(page, label) {
  const mapSelector = '[data-region-map="true"]';
  const detailSelector = '[data-region-detail="true"] b';
  const regionLabels = await page.$$eval(
    'select[data-region-selector="true"] option',
    (options) => options.map((option) => option.textContent?.trim() ?? ""),
  );
  const sortedRegionLabels = [...regionLabels].sort(new Intl.Collator("it").compare);
  assert.deepEqual(regionLabels, sortedRegionLabels, `${label}: regioni non in ordine alfabetico`);

  await page.waitForSelector(mapSelector, { visible: true });
  const regionPaths = await page.$$(
    `${mapSelector} path[role="button"][aria-label]`,
  );
  assert.equal(regionPaths.length, 20, `${label}: la mappa deve esporre 20 regioni`);

  const lombardia = await page.$(`${mapSelector} path[aria-label^="Lombardia:"]`);
  const veneto = await page.$(`${mapSelector} path[aria-label^="Veneto:"]`);
  assert.ok(lombardia, `${label}: percorso Lombardia assente`);
  assert.ok(veneto, `${label}: percorso Veneto assente`);

  await lombardia.hover();
  await page.waitForFunction(
    (selector) => Boolean(document.querySelector(`${selector} path[data-hovered="true"]`)),
    { timeout: 2_000 },
    mapSelector,
  );
  const previewName = await page.$eval(detailSelector, (element) => element.textContent?.trim());
  assert.equal(previewName, "Lombardia", `${label}: hover non aggiorna l’anteprima`);

  const hoveredOutline = await page.$eval(mapSelector, (map) => {
    const outlines = [...map.querySelectorAll('path[aria-hidden="true"]')];
    return {
      outlineCount: outlines.length,
      overlayStroke: outlines.map((outline) => getComputedStyle(outline).stroke),
      overlayPointerEvents: outlines.map((outline) => getComputedStyle(outline).pointerEvents),
    };
  });
  assert.ok(
    hoveredOutline.outlineCount >= 1 && hoveredOutline.outlineCount <= 2,
    `${label}: numero inatteso di layer di contorno (${hoveredOutline.outlineCount})`,
  );
  assert.ok(
    hoveredOutline.overlayStroke.every((stroke) => stroke !== "none"),
    `${label}: contorno overlay non visibile`,
  );
  assert.ok(
    hoveredOutline.overlayPointerEvents.every((value) => value === "none"),
    `${label}: il contorno overlay intercetta il puntatore`,
  );

  await lombardia.click();
  await page.waitForFunction(
    () => document.querySelector('[data-region-detail="true"] b')?.textContent?.trim() === "Lombardia",
    { timeout: 2_000 },
  );
  const fixedName = await page.$eval(detailSelector, (element) => element.textContent?.trim());

  await veneto.hover();
  await page.waitForFunction(
    (selector) => Boolean(document.querySelector(`${selector} path[data-hovered="true"]`)),
    { timeout: 2_000 },
    mapSelector,
  );
  const afterHoverName = await page.$eval(detailSelector, (element) => element.textContent?.trim());
  assert.equal(
    afterHoverName,
    fixedName,
    `${label}: l’hover sovrascrive la regione fissata con un clic`,
  );

  await veneto.click();
  await page.waitForFunction(
    () => document.querySelector('[data-region-detail="true"] b')?.textContent?.trim() === "Veneto",
    { timeout: 2_000 },
  );
  const switchedName = await page.$eval(detailSelector, (element) => element.textContent?.trim());
  assert.equal(switchedName, "Veneto", `${label}: il clic non cambia la selezione fissata`);

  await lombardia.dispose();
  await veneto.dispose();
  for (const path of regionPaths) await path.dispose();
}

async function assertSpendingComposition(page, label, width) {
  const selector = '[data-composition-state="ready"]';
  await page.waitForSelector(selector);
  const state = await page.$eval(selector, (root, viewportWidth) => {
    const visual = root.querySelector('[aria-label^="Composizione di"]');
    const map = document.querySelector('[data-region-map="true"]');
    const municipalityHeading = [...document.querySelectorAll("h2")].find((heading) =>
      heading.textContent?.includes("Comuni con più pagamenti per abitante"),
    );
    return {
      legendButtons: root.querySelectorAll("ol button").length,
      visualDisplay: visual ? getComputedStyle(visual).display : null,
      visualHeight: visual?.getBoundingClientRect().height ?? 0,
      hasMetadata: /Denominatore:.*Fonte:/s.test(root.textContent ?? ""),
      compositionBeforeMap: Boolean(map && (root.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING)),
      mapBeforeMunicipalities: Boolean(
        map && municipalityHeading && (map.compareDocumentPosition(municipalityHeading) & Node.DOCUMENT_POSITION_FOLLOWING)
      ),
      shouldCollapse: viewportWidth <= 620,
    };
  }, width);
  assert.equal(state.legendButtons, 5, `${label}: macro-voci inattese`);
  assert.equal(state.hasMetadata, true, `${label}: periodo/perimetro/fonte non vicini`);
  assert.equal(state.compositionBeforeMap, true, `${label}: composizione dopo la mappa nel DOM`);
  assert.equal(state.mapBeforeMunicipalities, true, `${label}: classifica Comuni anticipa la mappa`);
  assert.equal(state.visualDisplay === "none", state.shouldCollapse, `${label}: fallback mobile incoerente`);
  if (!state.shouldCollapse) assert.ok(state.visualHeight >= 250, `${label}: geometria treemap non riservata`);

  const firstLegendButton = `${selector} ol button`;
  await page.focus(firstLegendButton);
  await page.waitForSelector(`${selector} [role="tooltip"]`, { visible: true });
  const describedBy = await page.$eval(firstLegendButton, (button) => button.getAttribute("aria-describedby"));
  assert.ok(describedBy, `${label}: tooltip non collegato al controllo`);
  await page.keyboard.press("Escape");
  await page.waitForFunction((rootSelector) => !document.querySelector(`${rootSelector} [role="tooltip"]`), {}, selector);

  await page.click(`${selector} details summary`);
  const rows = await page.$$eval(`${selector} details tbody tr`, (items) => items.length);
  assert.equal(rows, 6, `${label}: tabella equivalente incompleta`);
}

async function assertTableKeyboardScroll(page, label) {
  await page.waitForSelector(TABLE_REGION, { visible: true });
  const tableState = await page.$eval(TABLE_REGION, (region) => ({
    clientWidth: region.clientWidth,
    hasTable: Boolean(region.querySelector("table")),
    scrollWidth: region.scrollWidth,
    tabIndex: region.tabIndex,
  }));
  assert.equal(tableState.hasTable, true, `${label}: tabella assente`);
  assert.equal(tableState.tabIndex, 0, `${label}: regione tabella non raggiungibile da tastiera`);
  assert.ok(
    tableState.scrollWidth > tableState.clientWidth,
    `${label}: la tabella non espone lo scroll orizzontale atteso`,
  );

  await page.$eval(TABLE_REGION, (region) => region.scrollTo({ left: 0, behavior: "auto" }));
  await page.focus(TABLE_REGION);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.scrollLeft > 0,
    { timeout: 2_000 },
    TABLE_REGION,
  );

  await page.keyboard.press("End");
  await page.waitForFunction(
    (selector) => {
      const region = document.querySelector(selector);
      return region && region.scrollLeft >= region.scrollWidth - region.clientWidth - 1;
    },
    { timeout: 2_000 },
    TABLE_REGION,
  );

  await page.keyboard.press("Home");
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.scrollLeft === 0,
    { timeout: 2_000 },
    TABLE_REGION,
  );
}

async function assertHealthSpendingTables(page, label) {
  const selector = '[role="region"].table-scroll';
  const tableStates = await page.$$eval(selector, (regions) =>
    regions.map((region) => ({
      clientWidth: region.clientWidth,
      hasTable: Boolean(region.querySelector("table")),
      scrollWidth: region.scrollWidth,
      tabIndex: region.tabIndex,
    })),
  );

  assert.equal(tableStates.length, 3, `${label}: sono attese tre tabelle`);
  for (const [index, state] of tableStates.entries()) {
    assert.equal(state.hasTable, true, `${label}: tabella ${index + 1} assente`);
    assert.equal(state.tabIndex, 0, `${label}: tabella ${index + 1} non raggiungibile da tastiera`);
  }

  for (const index of tableStates.keys()) {
    if (tableStates[index].scrollWidth <= tableStates[index].clientWidth) continue;
    await page.$$eval(selector, (regions, selectedIndex) => {
      const region = regions[selectedIndex];
      region.scrollTo({ left: 0, behavior: "auto" });
      region.focus();
    }, index);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      (tableSelector, selectedIndex) =>
        document.querySelectorAll(tableSelector)[selectedIndex]?.scrollLeft > 0,
      { timeout: 2_000 },
      selector,
      index,
    );
  }
}

async function bodyText(page) {
  return page.$eval("body", (body) => body.innerText);
}

function assertTextMatches(text, pattern, label) {
  assert.ok(pattern.test(text), `${label}: testo atteso ${pattern} assente`);
}

async function findPrimaryNavSection(page, sectionLabel) {
  const item = await page.evaluateHandle((wanted) => {
    const link = [...document.querySelectorAll("nav.primary-nav .nav-item-has-menu > a")].find(
      (candidate) => (candidate.textContent ?? "").includes(wanted),
    );
    return link?.closest(".nav-item-has-menu") ?? null;
  }, sectionLabel);
  return item.asElement();
}

async function assertSubmenuVisible(itemElement, page, label, childLabel) {
  await page.waitForFunction(
    (element) => {
      const submenu = element.querySelector(".nav-submenu");
      if (!submenu) return false;
      const style = window.getComputedStyle(submenu);
      return style.display !== "none" && style.visibility !== "hidden";
    },
    { timeout: 3_000 },
    itemElement,
  );

  const childText = await itemElement.$eval(".nav-submenu", (element) => element.textContent ?? "");
  assert.match(childText, new RegExp(childLabel, "i"), `${label}: voce ${childLabel} assente in tendina`);
}

async function assertPrimaryDropdownOnly(page, label, { sectionLabel, childLabel }) {
  assert.equal(await page.$("nav.subnav"), null, `${label}: barra sottosezioni non attesa`);
  assert.equal(await page.$(".subnav-row"), null, `${label}: riga subnav non attesa`);

  const itemElement = await findPrimaryNavSection(page, sectionLabel);
  assert.ok(itemElement, `${label}: sezione ${sectionLabel} assente`);

  await itemElement.hover();
  await assertSubmenuVisible(itemElement, page, label, childLabel);
}

async function assertPrimaryDropdownExclusive(page, label, { fromLabel, toLabel }) {
  const fromItem = await findPrimaryNavSection(page, fromLabel);
  const toItem = await findPrimaryNavSection(page, toLabel);
  assert.ok(fromItem, `${label}: sezione ${fromLabel} assente`);
  assert.ok(toItem, `${label}: sezione ${toLabel} assente`);

  await fromItem.hover();
  await page.waitForFunction(
    (element) =>
      element.getAttribute("data-open") === "true" &&
      window.getComputedStyle(element.querySelector(".nav-submenu")).display !== "none",
    { timeout: 3_000 },
    fromItem,
  );

  await toItem.hover();
  await page.waitForFunction(
    (from, to) => {
      if (to.getAttribute("data-open") !== "true") return false;
      if (from.getAttribute("data-open") === "true") return false;
      const fromDisplay = window.getComputedStyle(from.querySelector(".nav-submenu")).display;
      const toDisplay = window.getComputedStyle(to.querySelector(".nav-submenu")).display;
      return fromDisplay === "none" && toDisplay !== "none";
    },
    { timeout: 3_000 },
    fromItem,
    toItem,
  );

  const visibleCount = await page.$$eval("nav.primary-nav .nav-submenu", (menus) =>
    menus.filter((menu) => window.getComputedStyle(menu).display !== "none").length,
  );
  assert.equal(visibleCount, 1, `${label}: atteso un solo sottomenu visibile, trovati ${visibleCount}`);
}

async function assertPrimaryDropdownTap(page, label, { sectionLabel, childLabel }) {
  const itemElement = await findPrimaryNavSection(page, sectionLabel);
  assert.ok(itemElement, `${label}: sezione ${sectionLabel} assente`);

  await page.evaluate((element) => {
    element.scrollIntoView({ block: "nearest", inline: "center" });
  }, itemElement);

  const toggle = await itemElement.$(".nav-item-toggle");
  assert.ok(toggle, `${label}: pulsante tendina assente`);

  const toggleBox = await toggle.boundingBox();
  assert.ok(toggleBox, `${label}: pulsante tendina non visibile`);
  await page.touchscreen.tap(
    toggleBox.x + toggleBox.width / 2,
    toggleBox.y + toggleBox.height / 2,
  );
  await assertSubmenuVisible(itemElement, page, label, childLabel);

  const navRowOpen = await page.$eval(".nav-row", (row) => row.getAttribute("data-menu-open"));
  assert.equal(navRowOpen, "true", `${label}: data-menu-open non attivo`);
  await assertResponsiveShell(page, `${label} aperto`, 390);

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    (element) => {
      const submenu = element.querySelector(".nav-submenu");
      if (!submenu) return false;
      return window.getComputedStyle(submenu).display === "none";
    },
    { timeout: 3_000 },
    itemElement,
  );
}

async function activeLevel(page) {
  return page.$eval(ACTIVE_LEVEL, (link) => link.textContent?.trim());
}

async function runScenario(browser, {
  expectedFailure = () => false,
  label,
  mediaFeatures,
  pathname,
  validate,
  width,
}) {
  const requestedUrl = new URL(pathname, baseUrl).toString();
  const page = await createPage(browser, { width });
  const { assertNoErrors, diagnostics } = installDiagnostics(page, { label, baseUrl });
  let thrown;

  try {
    if (mediaFeatures) await page.emulateMediaFeatures(mediaFeatures);
    await navigate(page, { url: requestedUrl, label });
    await assertResponsiveShell(page, label, width);
    await validate(page);
    await assertNoErrors(expectedFailure);
  } catch (error) {
    thrown = error;
    await saveFailureArtifacts(page, {
      suite: "core",
      scenarioId: scenarioIdFromLabel(label),
      label,
      requestedUrl,
      finalUrl: page.url(),
      viewport: { width },
      diagnostics: diagnostics(),
    });
  } finally {
    await page.close().catch(() => {});
  }

  if (thrown) throw thrown;
}

await waitForServer(baseUrl);

const debtApiResponse = await fetch(new URL("/api/debito", baseUrl));
assert.equal(debtApiResponse.status, 200, "Debito API: risposta iniziale non valida");
const debtApi = await debtApiResponse.json();
const debtSourceMillions = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 3,
  useGrouping: "always",
}).format(debtApi.stock.totalCents / 100_000_000);
const debtReferenceDate = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Rome",
}).format(new Date(debtApi.stock.referenceDate));

let browser;
const completed = [];

try {
  browser = await launchBrowser();

  for (const width of [390, 768, 1280]) {
    const label = `Atlante Imprese ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/imprese",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Atlante Imprese Italia/i, label);
        assertTextMatches(text, /Solo dati aggregati/i, label);
        assertTextMatches(text, /Fonte del numero/i, label);
        assert.equal(
          (await page.$$('[data-region-map="true"] path[role="button"]')).length,
          20,
          `${label}: mappa regionale incompleta`,
        );

        const metricFilter = '[data-atlas-filter="metric"]';
        await page.focus(metricFilter);
        assert.equal(
          await page.$eval(metricFilter, (element) => document.activeElement === element),
          true,
          `${label}: il filtro metrica non riceve focus`,
        );
        await page.select(metricFilter, "employees");
        await page.waitForFunction(
          () => new URL(window.location.href).searchParams.get("metric") === "employees",
          { timeout: 3_000 },
        );
        assertTextMatches(await bodyText(page), /Addetti per regione/i, label);

        const firstRegion = '[data-region-map="true"] path[role="button"]';
        await page.$eval(firstRegion, (element) => element.focus());
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          () => new URL(window.location.href).searchParams.has("region"),
          { timeout: 3_000 },
        );
        await assertResponsiveShell(page, `${label} filtro regione`, width);
      },
    });
    completed.push(label);
  }

  await runScenario(browser, {
    label: "Atlante Imprese query navigation 390px",
    pathname: "/imprese?metric=employees",
    width: 390,
    validate: async (page) => {
      const currentLabels = await page.$$eval(
        'nav.primary-nav a[aria-current="page"]',
        (links) => links.map((link) => link.textContent?.trim()),
      );
      assert.deepEqual(currentLabels, ["Addetti"]);

      await assertPrimaryDropdownTap(page, "Atlante Imprese query navigation 390px", {
        sectionLabel: "Imprese",
        childLabel: "Localizzazioni attive",
      });

      const itemElement = await findPrimaryNavSection(page, "Imprese");
      assert.ok(itemElement, "Atlante Imprese query navigation 390px: sezione Imprese assente");
      const toggle = await itemElement.$(".nav-item-toggle");
      assert.ok(toggle, "Atlante Imprese query navigation 390px: pulsante tendina assente");
      await toggle.click();
      await assertSubmenuVisible(
        itemElement,
        page,
        "Atlante Imprese query navigation 390px",
        "Localizzazioni attive",
      );
      const localUnitsLink = await itemElement.$(
        'a[href="/imprese?metric=active_local_units"]',
      );
      assert.ok(localUnitsLink, "Atlante Imprese query navigation 390px: link metrica assente");
      await localUnitsLink.click();
      await page.waitForFunction(
        () => new URL(window.location.href).searchParams.get("metric") === "active_local_units",
        { timeout: 3_000 },
      );
      await page.waitForFunction(
        () => {
          const current = document.querySelector(
            'nav.primary-nav a[aria-current="page"]',
          );
          return current?.textContent?.trim() === "Localizzazioni attive";
        },
        { timeout: 3_000 },
      );
      assert.equal(
        await page.$eval(".nav-row", (row) => row.hasAttribute("data-menu-open")),
        false,
        "Atlante Imprese query navigation 390px: menu rimasto aperto dopo la query",
      );
    },
  });
  completed.push("Atlante Imprese query navigation 390px");

  for (const width of [390, 768, 1280]) {
    const label = `Scheda economica Benevento ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/enti/c_a783",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /SIOPE · pagamenti di cassa/i, label);
        assertTextMatches(text, /Quanto ha pagato il Comune/i, label);
        assertTextMatches(text, /Redditi e imposte dei residenti/i, label);
        assertTextMatches(text, /Spesa e servizi a confronto/i, label);
        assertTextMatches(text, /Progetti PNRR per asili e prima infanzia/i, label);
        assertTextMatches(text, /Da gennaio ad agosto 2026/i, label);
        assertTextMatches(text, /Dati parziali/i, label);
        assertTextMatches(text, /Per cosa ha pagato il Comune/i, label);
        assertTextMatches(text, /Pagamenti registrati per anno/i, label);
        assertTextMatches(text, /Vedi importi esatti e periodi coperti/i, label);
        assertTextMatches(text, /Altre categorie/i, label);
        assertTextMatches(text, /Informazioni sul Comune e fonti/i, label);
        assert.ok(
          text.indexOf("Quanto ha pagato il Comune") < text.indexOf("Per cosa ha pagato il Comune") &&
          text.indexOf("Per cosa ha pagato il Comune") < text.indexOf("Pagamenti registrati per anno") &&
          text.indexOf("Pagamenti registrati per anno") < text.indexOf("Vedi importi esatti e periodi coperti") &&
          text.indexOf("Vedi importi esatti e periodi coperti") < text.indexOf("Spesa e servizi a confronto") &&
          text.indexOf("Spesa e servizi a confronto") < text.indexOf("Progetti PNRR per asili e prima infanzia") &&
          text.indexOf("Progetti PNRR per asili e prima infanzia") < text.indexOf("Redditi e imposte dei residenti") &&
          text.indexOf("Redditi e imposte dei residenti") < text.indexOf("Informazioni sul Comune e fonti"),
          `${label}: ordine cittadino inatteso`,
        );
        assert.doesNotMatch(text, /API struttura|Dataset UO|Dataset AOO|limit|offset/i);

        const summaryPresentation = await page.$eval("#dati-economici dl", (element) => ({
          background: getComputedStyle(element).backgroundColor,
          label: element.textContent,
        }));
        assert.notEqual(summaryPresentation.background, "rgba(0, 0, 0, 0)");
        assert.match(summaryPresentation.label, /Per abitante\s*1\.402 €/i);

        const trendBars = await page.$$eval("[data-siope-history-chart] > li", (rows) => rows.map((row) => ({
          height: row.querySelector("[aria-hidden='true'] > span")?.style.getPropertyValue("--bar-height"),
          text: row.textContent,
        })));
        assert.equal(trendBars.length, 3);
        assert.match(trendBars[2].text, /2026.*parziale/is);
        assert.ok(trendBars.every((row) => /%$/.test(row.height ?? "")));

        const openCivitasBars = await page.$$eval("[data-opencivitas-chart] > li", (rows) => rows.map((row) => row.textContent));
        assert.equal(openCivitasBars.length, 2);
        assert.match(openCivitasBars.join(" "), /Spesa registrata.*Valore di riferimento/is);

        const historySummary = await page.$("details[data-payment-history] > summary");
        assert.ok(historySummary, `${label}: storico espandibile assente`);
        assert.equal(await historySummary.evaluate((element) => element.parentElement?.open), false);
        await historySummary.focus();
        await page.keyboard.press("Enter");
        assert.equal(await historySummary.evaluate((element) => element.parentElement?.open), true);
        const historyText = await page.$eval("details[data-payment-history]", (element) => element.innerText);
        assert.match(historyText, /Da gennaio ad agosto · dati parziali/i);
        assert.match(historyText, /Anno completo/i);

        const titleSummary = await page.$("details[data-siope-titles] summary");
        assert.ok(titleSummary, `${label}: spiegazione dei Titoli SIOPE assente`);
        await titleSummary.focus();
        await page.keyboard.press("Enter");
        assert.equal(
          await titleSummary.evaluate((element) => element.parentElement?.open),
          true,
        );

        const pnrrSummary = await page.$("details[data-pnrr-projects] summary");
        assert.ok(pnrrSummary, `${label}: progetti PNRR espandibili assenti`);
        await pnrrSummary.focus();
        await page.keyboard.press("Enter");
        assert.equal(await pnrrSummary.evaluate((element) => element.parentElement?.open), true);

        const irpefSummary = await page.$("details[data-irpef-details] > summary");
        assert.ok(irpefSummary, `${label}: sezione IRPEF secondaria assente`);
        assert.equal(await irpefSummary.evaluate((element) => element.parentElement?.open), false);
        await irpefSummary.focus();
        await page.keyboard.press("Enter");
        assert.equal(await irpefSummary.evaluate((element) => element.parentElement?.open), true);

        const informationSummary = await page.$("details[data-municipality-information] > summary");
        assert.ok(informationSummary, `${label}: informazioni comunali finali assenti`);
        assert.equal(await informationSummary.evaluate((element) => element.parentElement?.open), false);
        await informationSummary.focus();
        await page.keyboard.press("Enter");
        assert.equal(await informationSummary.evaluate((element) => element.parentElement?.open), true);

        const structureSummary = await page.$("details[data-structure-details] summary");
        assert.ok(structureSummary, `${label}: struttura IPA espandibile assente`);
        await structureSummary.focus();
        await page.keyboard.press("Enter");
        assert.equal(
          await structureSummary.evaluate((element) => element.parentElement?.open),
          true,
        );

        const apiResponse = await page.evaluate(async () => {
          const response = await fetch("/api/enti/c_a783");
          return { body: await response.json(), status: response.status };
        });
        assert.equal(apiResponse.status, 200);
        assert.equal(apiResponse.body.record.codiceIpa, "c_a783");
        assert.equal(apiResponse.body.municipalityProfile.identifiers.joinMethod, "exact_official_identifiers");
        assert.equal(apiResponse.body.municipalityProfile.siope.data.years.length, 3);
      },
    });
    completed.push(label);
  }

  await runScenario(browser, {
    label: "Ente non comunale invariato 390px",
    pathname: "/enti/agid",
    width: 390,
    validate: async (page) => {
      const text = await bodyText(page);
      assertTextMatches(text, /Identità amministrativa/i, "Ente non comunale");
      assertTextMatches(text, /Dati economici · collegamenti in corso/i, "Ente non comunale");
      assertTextMatches(text, /Formato JSON/i, "Ente non comunale");
      assert.doesNotMatch(text, /Quanto ha pagato il Comune/i);
    },
  });
  completed.push("Ente non comunale invariato 390px");

  const dropdownRoutes = [
    {
      pathname: "/controlli",
      label: "Controlli",
      sectionLabel: "Cosa controllare",
      childLabel: "Appalti",
    },
    {
      pathname: "/territori/irpef",
      label: "Territori IRPEF",
      sectionLabel: "Territori",
      childLabel: "Redditi IRPEF",
    },
    {
      pathname: "/appalti",
      label: "Appalti",
      sectionLabel: "Cosa controllare",
      childLabel: "Incarichi",
    },
    {
      pathname: "/parlamento",
      label: "Parlamento",
      sectionLabel: "Istituzioni",
      childLabel: "Parlamento",
    },
    {
      pathname: "/debito",
      label: "Debito pubblico",
      sectionLabel: "Soldi",
      childLabel: "Debito pubblico",
    },
  ];

  for (const route of dropdownRoutes) {
    for (const width of [390, 1280]) {
      const label = `Menu tendina ${route.label} ${width}px`;
      await runScenario(browser, {
        label,
        pathname: route.pathname,
        width,
        validate: async (page) => {
          assert.equal(await page.$("nav.subnav"), null, `${label}: subnav non attesa`);
          assert.equal(await page.$(".subnav-row"), null, `${label}: riga subnav non attesa`);
          assert.ok(await page.$("nav.primary-nav .nav-submenu"), `${label}: markup tendina assente`);
          if (width >= 1280) {
            await assertPrimaryDropdownOnly(page, label, {
              sectionLabel: route.sectionLabel,
              childLabel: route.childLabel,
            });
          } else {
            await assertPrimaryDropdownTap(page, label, {
              sectionLabel: route.sectionLabel,
              childLabel: route.childLabel,
            });
          }
        },
      });
      completed.push(label);
    }
  }

  for (const width of [320, 390, 768, 1024, 1280, 1600]) {
    const label = `Debito pubblico ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/debito",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Quanto debito c’è/i, label);
        assertTextMatches(text, /Come può incidere sulla tua vita/i, label);
        assertTextMatches(text, new RegExp(`${debtSourceMillions.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} milioni di euro nella fonte`), label);
        assertTextMatches(text, new RegExp(debtReferenceDate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), label);
        assertTextMatches(text, /Netto significa emissioni meno rimborsi/i, label);
        assert.equal(await page.$$eval("h1", (items) => items.length), 1);
        const headings = await page.$$eval("main section > h2", (items) => items.map((item) => item.textContent?.trim()));
        assert.deepEqual(headings, [
          "1. Quanto debito c’è?",
          "2. Perché è cambiato?",
          "3. A cosa serve e come viene rimborsato?",
          "4. Da cosa è composto?",
          "5. Chi lo detiene?",
          "6. Quando deve essere rifinanziato?",
          "7. Come può incidere sulla tua vita?",
        ]);
        const externalDataRequests = await page.evaluate(() => performance.getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => /a2a\.bancaditalia\.it|ec\.europa\.eu\/eurostat\/api/.test(url)));
        assert.deepEqual(externalDataRequests, [], `${label}: fetch runtime verso le fonti dati`);
        if (width === 390) {
          const externalLinks = await page.$$eval('a[target="_blank"]', (links) => links.map((link) => ({ href: link.href, rel: link.rel, target: link.target })));
          for (const expected of ["bancaditalia.it", "ec.europa.eu/eurostat/databrowser", "dt.mef.gov.it/it/debito_pubblico"]) {
            assert.ok(externalLinks.some((link) => link.href.includes(expected) && link.target === "_blank" && link.rel.includes("noreferrer")), `${label}: link ufficiale mancante ${expected}`);
          }
          const chartSummary = await page.$("details.chart-data > summary");
          assert.ok(chartSummary, `${label}: tabella del grafico assente`);
          await chartSummary.focus();
          await page.keyboard.press("Enter");
          assert.equal(await chartSummary.evaluate((element) => element.parentElement?.open), true);
          assert.match(await chartSummary.evaluate((element) => element.parentElement?.innerText ?? ""), /Debito convertito in euro/i);
          const session = await page.createCDPSession();
          try {
            await session.send("Accessibility.enable");
            const { nodes } = await session.send("Accessibility.getFullAXTree");
            const headingNames = nodes.filter((node) => node.role?.value === "heading").map((node) => node.name?.value);
            assert.ok(headingNames.includes("1. Quanto debito c’è?"), `${label}: primo titolo assente dall'albero accessibile`);
            assert.ok(headingNames.includes("7. Come può incidere sulla tua vita?"), `${label}: settimo titolo assente dall'albero accessibile`);
            assert.ok(nodes.filter((node) => node.role?.value === "table").length >= 5, `${label}: tabelle assenti dall'albero accessibile`);
          } finally {
            await session.detach();
          }
        }
      },
    });
    completed.push(label);
  }

  await runScenario(browser, {
    label: "Debito zoom 200% equivalente 640px",
    mediaFeatures: [{ name: "prefers-reduced-motion", value: "reduce" }],
    pathname: "/debito",
    width: 640,
    validate: async (page) => {
      const tableRegions = await page.$$eval('[role="region"][tabindex="0"]', (regions) => regions.map((region) => ({
        hasTable: Boolean(region.querySelector("table")),
        tabIndex: region.tabIndex,
      })));
      assert.ok(tableRegions.length >= 5, "Debito: tabelle accessibili non trovate");
      assert.ok(tableRegions.every((region) => region.hasTable && region.tabIndex === 0));
      const focusState = await page.$$eval('[role="region"][tabindex="0"]', (regions) => {
        const visible = regions.find((region) => region.getClientRects().length > 0 && !region.closest("details:not([open])"));
        visible?.focus();
        const style = visible ? getComputedStyle(visible) : null;
        return { role: document.activeElement?.getAttribute("role"), outlineStyle: style?.outlineStyle, outlineWidth: style?.outlineWidth };
      });
      assert.equal(focusState.role, "region");
      assert.notEqual(focusState.outlineStyle, "none");
      assert.notEqual(focusState.outlineWidth, "0px");
    },
  });
  completed.push("Debito zoom 200% equivalente 640px");

  {
    const label = "Debito JavaScript disabilitato 390px";
    const page = await browser.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setCacheEnabled(false);
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      const response = await page.goto(new URL("/debito", baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      assert.equal(response?.status(), 200);
      const text = await page.$eval("body", (body) => body.innerText);
      assertTextMatches(text, /Quanto debito c’è/i, label);
      assertTextMatches(text, /Come può incidere sulla tua vita/i, label);
      assertTextMatches(text, /Netto significa emissioni meno rimborsi/i, label);
      assertTextMatches(text, /D41PAY \/ TE × 100/i, label);
      const shell = await viewportState(page);
      assert.ok(shell.rootScrollWidth <= shell.clientWidth + 1, `${label}: overflow globale`);
    } finally {
      await page.close();
    }
    completed.push(label);
  }

  await runScenario(browser, {
    label: "Menu tendina esclusivo 1280px",
    pathname: "/istituzioni",
    width: 1280,
    validate: async (page) => {
      await assertPrimaryDropdownExclusive(page, "Menu tendina esclusivo 1280px", {
        fromLabel: "Istituzioni",
        toLabel: "Enti e società",
      });
    },
  });
  completed.push("Menu tendina esclusivo 1280px");

  await runScenario(browser, {
    label: "Controlli leggibilità 390px",
    pathname: "/controlli",
    width: 390,
    validate: async (page) => {
      const text = await bodyText(page);
      assertTextMatches(text, /Come leggere i numeri/i, "Controlli leggibilità");
      assertTextMatches(text, /Segnali da relazioni ufficiali/i, "Controlli leggibilità");
      assertTextMatches(text, /Screening derivato · OpenCivitas/i, "Controlli leggibilità");
    },
  });
  completed.push("Controlli leggibilità 390px");

  for (const width of [320, 390, 768, 1280]) {
    const label = `IRPEF ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/territori/irpef",
      width,
      validate: async (page) => {
        assert.equal(await activeLevel(page), "Regioni", `${label}: tab Regioni non attivo`);
        await assertTableKeyboardScroll(page, label);
      },
    });
    completed.push(label);
  }

  await runScenario(browser, {
    label: "Comuni senza filtro",
    pathname: "/territori/irpef?anno=2024&livello=comune",
    width: 390,
    validate: async (page) => {
      assert.equal(await activeLevel(page), "Comuni");
      assert.equal(await page.$(TABLE_REGION), null, "Non deve caricare una tabella comunale senza filtro");
      assert.ok(await page.$('select[name="regione"]'), "Filtro Regione assente");
      assert.ok(await page.$('input[name="provincia"]'), "Filtro Provincia assente");
      assert.ok(await page.$('input[name="q"]'), "Ricerca Comune assente");
      assert.equal(await page.$('[role="alert"]'), null, "Warning inatteso nello stato preparatorio");
      const text = await bodyText(page);
      assertTextMatches(text, /Indica almeno un filtro per caricare i Comuni\./, "Comuni senza filtro");
      assertTextMatches(
        text,
        /Scegli una Regione, una Provincia o inserisci il nome di un Comune\./,
        "Comuni senza filtro",
      );
    },
  });
  completed.push("Comuni senza filtro");

  await runScenario(browser, {
    label: "Ricerca Roma",
    pathname: "/territori/irpef?anno=2024&livello=comune&q=Roma",
    width: 390,
    validate: async (page) => {
      assert.equal(await activeLevel(page), "Comuni");
      await assertTableKeyboardScroll(page, "Ricerca Roma");
      const text = await bodyText(page);
      assertTextMatches(text, /Risultati da 1 a 42 su 42\./, "Ricerca Roma");
      assertTextMatches(text, /\bRoma\b/i, "Ricerca Roma");
      assert.equal(await page.$('[role="alert"]'), null, "Warning inatteso nella ricerca Roma");
    },
  });
  completed.push("Ricerca Roma");

  await runScenario(browser, {
    label: "Deep-link Veneto",
    pathname: "/territori/irpef?anno=2024&livello=comune&regione=Veneto",
    width: 768,
    validate: async (page) => {
      assert.equal(await activeLevel(page), "Comuni");
      const region = await page.$eval('select[name="regione"]', (select) => ({
        label: select.selectedOptions[0]?.textContent?.trim(),
        value: select.value,
      }));
      assert.deepEqual(region, { label: "Veneto", value: "05" });
      assertTextMatches(await bodyText(page), /Risultati da 1 a 50 su 560\./, "Deep-link Veneto");
      await assertTableKeyboardScroll(page, "Deep-link Veneto");
    },
  });
  completed.push("Deep-link Veneto");

  await runScenario(browser, {
    label: "Balme oscurato",
    pathname: "/territori/irpef?anno=2024&livello=comune&q=Balme",
    width: 390,
    validate: async (page) => {
      assert.equal(await activeLevel(page), "Comuni");
      const rows = await page.$$("tbody tr");
      assert.equal(rows.length, 1, "Balme deve produrre una sola riga");
      const text = await bodyText(page);
      assertTextMatches(text, /\bBalme\b/, "Balme oscurato");
      assertTextMatches(text, /≥/, "Balme oscurato");
      assertTextMatches(text, /1 riga oscurata/, "Balme oscurato");
      assert.ok(await page.$("tbody em"), "Indicatore di oscuramento assente");
      await assertTableKeyboardScroll(page, "Balme oscurato");
    },
  });
  completed.push("Balme oscurato");

  await runScenario(browser, {
    label: "Recovery offset",
    pathname: "/territori/irpef?anno=2024&livello=comune&q=Roma&offset=1000",
    width: 390,
    validate: async (page) => {
      const alertText = await page.$eval('[role="alert"]', (alert) => alert.textContent ?? "");
      assert.match(alertText, /Pagina non disponibile/);
      assert.match(alertText, /La pagina richiesta non esiste\./);
      assert.match(alertText, /Sono mostrati i primi risultati della stessa ricerca\./);
      assertTextMatches(await bodyText(page), /Risultati da 1 a 42 su 42\./, "Recovery offset");
      await assertTableKeyboardScroll(page, "Recovery offset");
    },
  });
  completed.push("Recovery offset");

  for (const width of [390, 1280]) {
    const label = `Geografia Comuni ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/territori?anno=2025",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Valori più alti · per abitante/i, label);
        const firstMunicipality = await page.$eval(
          '[data-municipality-ranking="per-abitante"] tbody tr:first-child',
          (row) => {
            const heading = row.querySelector("th");
            return {
              name: [...(heading?.childNodes ?? [])]
                .find((node) => node.nodeType === Node.TEXT_NODE)
                ?.textContent?.trim(),
              context: heading?.querySelector("small")?.textContent?.trim(),
              population: row.children[3]?.textContent?.trim(),
              surface: row.children[4]?.textContent?.trim(),
            };
          },
        );
        assert.match(firstMunicipality.name ?? "", /\S/);
        assert.match(firstMunicipality.context ?? "", /^\S.* · \S.*$/);
        assert.match(firstMunicipality.population ?? "", /^\d[\d.]*$/);
        assert.match(firstMunicipality.surface ?? "", /km²$/);
        await assertResponsiveShell(page, label, width);
      },
    });
    completed.push(label);
  }

  for (const [pathname, heading] of [
    ["/supporto", /Supporto/i],
    ["/supporter", /Chi ci sostiene/i],
    ["/termini", /Termini di utilizzo/i],
  ]) {
    for (const width of [320, 390, 1280]) {
      const label = `${pathname.slice(1)} ${width}px`;
      await runScenario(browser, {
        label,
        pathname,
        width,
        validate: async (page) => {
          assertTextMatches(await bodyText(page), heading, label);
        },
      });
      completed.push(label);
    }
  }

  for (const width of [320, 390]) {
    const label = `Footer sitemap ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/",
      width,
      validate: async (page) => {
        const sitemap = await page.$(".footer-sitemap");
        assert.ok(sitemap, `${label}: mappa del sito assente`);
        const rowCount = await page.$$eval(".footer-sitemap-grid", (rows) => rows.length);
        assert.equal(rowCount, 3, `${label}: attese 3 righe nella mappa`);
        const groupCount = await page.$$eval(".footer-sitemap-group", (groups) => groups.length);
        assert.equal(groupCount, 9, `${label}: attesi 9 gruppi nella mappa`);
        const headings = await page.$$eval(".footer-sitemap-group h3", (items) =>
          items.map((item) => item.textContent?.trim() ?? ""),
        );
        assert.ok(headings.includes("Imprese"), `${label}: sezione Imprese assente`);
        assert.ok(headings.includes("Istituzioni"), `${label}: sezione Istituzioni assente`);
        assert.ok(headings.includes("Fonti e metodo"), `${label}: sezione Fonti e metodo assente`);
        assert.ok(!headings.includes("Legale"), `${label}: sezione Legale non attesa in mappa`);
        const text = await bodyText(page);
        assertTextMatches(text, /Privacy/i, label);
        assertTextMatches(text, /Termini/i, label);
        assertTextMatches(text, /Chi ci sostiene/i, label);
        await assertResponsiveShell(page, label, width);
      },
    });
    completed.push(label);
  }

  for (const width of [320, 1280]) {
    const label = `Prompt MCP ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/mcp",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Prompt pronto per un agente AI/i, label);
        assertTextMatches(text, /Copia prompt per agenti/i, label);
        assertTextMatches(text, /list_datasets/i, label);
        await page.evaluate(() => {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (value) => {
                globalThis.__dvnsCopiedPrompt = value;
              },
            },
          });
          const button = [...document.querySelectorAll("button")].find(
            (candidate) => candidate.textContent?.trim() === "Copia prompt per agenti",
          );
          button?.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes("Prompt copiato"));
        const copiedPrompt = await page.evaluate(() => globalThis.__dvnsCopiedPrompt ?? "");
        assertTextMatches(copiedPrompt, /https:\/\/www\.dovevannoinostrisoldi\.com\/api\/mcp/, label);
        assertTextMatches(copiedPrompt, /list_datasets/, label);
      },
    });
    completed.push(label);
  }

  for (const width of [390, 1280]) {
    const label = `Macro-aree territori ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/territori?anno=2024&vista=tabella",
      width,
      validate: async (page) => {
        const groups = await page.$$eval(
          'main [aria-label^="Pagamenti di tutte le regioni"] tbody',
          (bodies) => bodies.map((body) => ({
            heading: body.querySelector("tr:first-child th")?.textContent?.trim(),
            rows: body.querySelectorAll("tr").length,
          })),
        );
        assert.deepEqual(groups, [
          { heading: "Nord", rows: 9 },
          { heading: "Centro", rows: 5 },
          { heading: "Sud e Isole", rows: 9 },
        ]);
        assert.equal(
          await page.$$eval('main a[href^="/territori/fisco#regione-"]', (links) => links.length),
          19,
          `${label}: numero inatteso di link CPT univoci`,
        );
        const trentinoHasLink = await page.$$eval("main table tbody th", (headings) => {
          const heading = headings.find((item) =>
            item.textContent?.includes("Trentino-Alto Adige"),
          );
          return Boolean(heading?.querySelector("a"));
        });
        assert.equal(trentinoHasLink, false, `${label}: il Trentino non deve avere un link CPT ambiguo`);
      },
    });
    completed.push(label);
  }

  for (const width of [390, 1280]) {
    const label = `Ricerca header ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/",
      width,
      validate: async (page) => {
        const input = await page.$("#global-entity-search");
        assert.ok(input, `${label}: campo di ricerca assente`);
        await input.type("Roma");
        await page.waitForSelector('[role="listbox"] [role="option"]', { visible: true });
        assert.equal(await input.evaluate((element) => element.getAttribute("aria-expanded")), "true");

        await page.keyboard.press("ArrowDown");
        assert.ok(
          await input.evaluate((element) => element.getAttribute("aria-activedescendant")),
          `${label}: opzione attiva non esposta`,
        );
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => /^\/enti\//.test(window.location.pathname));
        assert.match(new URL(page.url()).pathname, /^\/enti\//, `${label}: destinazione inattesa`);
      },
    });
    completed.push(label);
  }

  await runScenario(browser, {
    label: "Ricerca header Escape 390px",
    pathname: "/",
    width: 390,
    validate: async (page) => {
      const input = await page.$("#global-entity-search");
      assert.ok(input, "Ricerca header Escape: campo assente");
      await input.type("Roma");
      await page.waitForSelector('[role="listbox"] [role="option"]', { visible: true });
      await page.keyboard.press("Escape");
      assert.equal(await input.evaluate((element) => element.getAttribute("aria-expanded")), "false");
      assert.equal(await input.evaluate((element) => element.value), "Roma");
    },
  });
  completed.push("Ricerca header Escape 390px");

  await runScenario(browser, {
    label: "Ricerca header errore 390px",
    pathname: "/",
    width: 390,
    expectedFailure: (failure) => failure.includes("/api/enti?q=Roma&limit=7"),
    validate: async (page) => {
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/enti") {
          void request.respond({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ ok: false }),
          });
        } else {
          void request.continue();
        }
      });
      const input = await page.$("#global-entity-search");
      assert.ok(input, "Ricerca header errore: campo assente");
      await input.type("Roma");
      await page.waitForFunction(() =>
        document.body.innerText.includes("La ricerca rapida non è disponibile"),
      );
      await page.keyboard.press("Escape");
      assert.equal(await input.evaluate((element) => element.getAttribute("aria-expanded")), "false");
    },
  });
  completed.push("Ricerca header errore 390px");

  await runScenario(browser, {
    label: "Ricerca header testo lungo 320px",
    pathname: "/",
    width: 320,
    validate: async (page) => {
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/enti") {
          void request.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              ok: true,
              records: [{
                codiceIpa: "ente_test",
                denominazione: "Amministrazione straordinariamente lunga senza separatori utili alla visualizzazione",
                tipologia: "Pubblica amministrazione territoriale",
              }],
            }),
          });
        } else {
          void request.continue();
        }
      });
      const input = await page.$("#global-entity-search");
      assert.ok(input, "Ricerca header testo lungo: campo assente");
      await input.type("ente");
      await page.waitForSelector('[role="listbox"] [role="option"]', { visible: true });
      const widths = await page.$eval(".header-search-dropdown", (dropdown) => ({
        client: dropdown.clientWidth,
        scroll: dropdown.scrollWidth,
      }));
      assert.ok(widths.scroll <= widths.client + 1, "Ricerca header: testo lungo oltre il dropdown");
    },
  });
  completed.push("Ricerca header testo lungo 320px");

  for (const width of [390, 1280]) {
    const label = `Parlamento previdenza ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/parlamento",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Spese previdenziali/, label);
        assertTextMatches(text, /Deputati cessati dal mandato/, label);
        assertTextMatches(text, /Personale in quiescenza/, label);
        assertTextMatches(text, /non equivale ai soli vitalizi/i, label);
        await assertResponsiveShell(page, label, width);
      },
    });
    completed.push(label);
  }

  for (const width of [320, 390, 768, 1280, 1600]) {
    const label = `Coesione stati ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/coesione",
      width,
      validate: async (page) => {
        assertTextMatches(await bodyText(page), /A che punto sono i progetti/i, label);
        await assertCohesionTracePanelContrast(page, label);
        await assertCohesionStatusLayout(page, label);
        await assertCohesionPathwayContrast(page, label);
      },
    });
    completed.push(label);
  }

  for (const width of [390, 1280]) {
    const label = `Privacy ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/privacy",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Dati tecnici/i, label);
        assertTextMatches(text, /Misurazione delle visite/i, label);
        assertTextMatches(text, /Server MCP/i, label);
        assert.doesNotMatch(text, /form di consulenza/i);
      },
    });
    completed.push(label);
  }

  for (const width of [320, 390, 768, 901, 1024, 1280]) {
    const label = `Tooltip home ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/",
      width,
      validate: async (page) => {
        await assertInfoTooltips(page, label);
      },
    });
    completed.push(label);
  }

  for (const width of [390, 768, 1280]) {
    const label = `Composizione spesa home ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/",
      width,
      validate: async (page) => assertSpendingComposition(page, label, width),
    });
    completed.push(label);
  }

  for (const width of [390, 1280]) {
    const label = `Mappa regioni hover/selezione ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/",
      width,
      validate: async (page) => {
        await assertRegionalMapSelection(page, label);
      },
    });
    completed.push(label);
  }

  for (const pathname of ["/", "/enti", "/partecipazioni", "/controlli", "/metodologia"]) {
    const label = `Shell 320px ${pathname}`;
    await runScenario(browser, {
      label,
      pathname,
      width: 320,
      validate: async () => {},
    });
    completed.push(label);
  }

  for (const width of [320, 390, 768, 1280]) {
    const label = `Conto economico SSN ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/spese/sanita",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /costi di competenza economica/i, label);
        assertTextMatches(text, /non pubblica una voce chiamata “gettonisti” o “cooperative”/i, label);
        assertTextMatches(text, /alfabetico per codice geografico e Codice Ente SSN/i, label);
        assertTextMatches(text, /non sostituisce una contabilità dei pagamenti/i, label);
        await assertHealthSpendingTables(page, label);
      },
    });
    completed.push(label);
  }

  for (const width of [320, 390, 768, 1280]) {
    const label = `PNRR asili catalogo ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/coesione/asili?regione=LAZIO",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Da miliardi nazionali a un CUP verificabile/i, label);
        assertTextMatches(text, /progetti trovati/i, label);
        assert.ok(await page.$('input[name="q"]'), `${label}: ricerca assente`);
        assert.ok(await page.$('select[name="regione"]'), `${label}: filtro regione assente`);
        assert.ok(await page.$('article a[href^="/progetti/"]'), `${label}: schede progetto assenti`);
      },
    });
    completed.push(label);
  }

  for (const width of [320, 390, 768, 1280]) {
    const label = `PNRR traccia CUP ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/progetti/B11B21001610005",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Finanziamento PNRR registrato/i, label);
        assertTextMatches(text, /Pagamenti ReGiS/i, label);
        assertTextMatches(text, /Fonte e limiti/i, label);
        assert.ok(await page.$('[class*="evidence"]'), `${label}: etichette evidenza assenti`);
        assert.ok(await page.$('a[href*="/api/pnrr/asili?cup="]'), `${label}: JSON scheda assente`);
      },
    });
    completed.push(label);
  }

  for (const width of [320, 390, 768, 1280]) {
    const label = `Assistente deterministico ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/assistente",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Assistente sui dati pubblici/i, label);
        assertTextMatches(text, /deterministica e in sola lettura/i, label);
        assert.ok(await page.$("#assistant-prompt"), `${label}: campo domanda assente`);
        assert.ok(await page.$('main form button[type="submit"]'), `${label}: invio assente`);
      },
    });
    completed.push(label);
  }

  for (const width of [390, 1280]) {
    const label = `Assistente risposta verificata ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/assistente",
      width,
      validate: async (page) => {
        await page.type("#assistant-prompt", "Quanto hanno speso i Comuni nel 2025?");
        await page.click('main form button[type="submit"]');
        await page.waitForFunction(() =>
          document.body.innerText.includes("Pagamenti SIOPE dei Comuni") &&
          document.body.innerText.includes("anno completo 2025"),
        );
        const text = await bodyText(page);
        assertTextMatches(text, /Risposta verificata/i, label);
        assertTextMatches(text, /Fonte/i, label);
        assertTextMatches(text, /Da leggere con attenzione/i, label);
        const responseText = await page.$eval('[aria-live="polite"]', (element) => element.textContent ?? "");
        assert.doesNotMatch(responseText, /Quanto hanno speso i Comuni nel 2025\?/u, `${label}: prompt riversato nella risposta`);
        assert.equal(
          await page.$eval('[aria-live="polite"]', (element) => element.getAttribute("aria-busy")),
          "false",
          `${label}: stato busy non concluso`,
        );
      },
    });
    completed.push(label);
  }

  for (const width of [390, 768, 1280]) {
    const label = `Legge di Bilancio modifica→condivisione ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/spese/legge-di-bilancio",
      width,
      validate: async (page) => {
        const treemapSelector = '[role="group"][aria-label^="Scegli una missione"]';
        await page.waitForSelector(`${treemapSelector} g[role="button"]`, { timeout: 5_000 });
        const treemapState = await page.$eval(treemapSelector, (root) => {
          const bounds = root.getBoundingClientRect();
          const tiles = [...root.querySelectorAll('g[role="button"]')];
          const visibleTiles = tiles.filter((tile) => {
            const rect = tile.querySelector("rect")?.getBoundingClientRect();
            return Boolean(rect && rect.width > 1 && rect.height > 1);
          });
          return {
            height: bounds.height,
            tiles: tiles.length,
            visibleTiles: visibleTiles.length,
          };
        });
        assert.ok(treemapState.height >= 300, `${label}: il treemap non riserva spazio`);
        assert.ok(treemapState.tiles >= 5, `${label}: il treemap non contiene abbastanza missioni`);
        assert.equal(
          treemapState.visibleTiles,
          treemapState.tiles,
          `${label}: uno o più riquadri del treemap sono vuoti`,
        );

        const sliderSelector = 'input[type="range"]';
        await page.waitForSelector(sliderSelector, { timeout: 5_000 });
        assert.equal(
          await page.$eval(sliderSelector, (input) => Number(input.value)),
          0,
          `${label}: lo scenario dovrebbe partire da zero`,
        );

        // Tastiera: sposta lo slider di +5 punti (5 passi da 1), come premere «+5».
        await page.focus(sliderSelector);
        for (let step = 0; step < 5; step += 1) await page.keyboard.press("ArrowRight");
        await page.waitForFunction(
          (selector) => Number(document.querySelector(selector)?.value) === 5,
          {},
          sliderSelector,
        );

        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("button")].some((button) =>
              (button.textContent ?? "").includes("Condividi la tua finanziaria"),
            ),
          { timeout: 5_000 },
        );
        await page.evaluate(() => {
          const button = [...document.querySelectorAll("button")].find((candidate) =>
            (candidate.textContent ?? "").includes("Condividi la tua finanziaria"),
          );
          button?.click();
        });

        // Il link deve contenere già il piano appena toccato, non un istante dopo:
        // niente window.location coinvolta, il dialog legge lo stato React corrente.
        await page.waitForFunction(() => document.querySelector("dialog")?.open === true, {
          timeout: 3_000,
        });
        const telegramPlanValue = await page.$eval('a[href*="t.me/share"]', (link) => {
          const url = new URL(link.href);
          const shared = new URL(url.searchParams.get("url") ?? "");
          return shared.searchParams.get("piano");
        });
        assert.ok(
          telegramPlanValue && telegramPlanValue.startsWith("v1:"),
          `${label}: il link condiviso non contiene subito il piano toccato (${telegramPlanValue})`,
        );

        await assertResponsiveShell(page, `${label} dialog aperto`, width);
        const dialogOverflow = await page.evaluate(() => {
          const dialog = document.querySelector("dialog");
          const rect = dialog?.getBoundingClientRect();
          return rect ? rect.right <= window.innerWidth + 1 && rect.left >= -1 : false;
        });
        assert.ok(dialogOverflow, `${label}: il dialog di condivisione esce dal viewport`);

        assert.equal(
          await page.$eval("dialog", (element) => {
            const labelId = element.getAttribute("aria-labelledby");
            return Boolean(labelId && document.getElementById(labelId)?.textContent?.trim());
          }),
          true,
          `${label}: il dialog non ha un nome accessibile`,
        );

        // Escape chiude il dialog: verifica che la modifica → condivisione sia
        // navigabile da tastiera end-to-end, non solo col mouse.
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelector("dialog")?.open === false, {
          timeout: 3_000,
        });
      },
    });
    completed.push(label);
  }

  console.log(JSON.stringify({
    baseUrl: baseUrl.origin,
    checks: completed,
    ok: true,
  }));
} finally {
  if (browser) await closeBrowser(browser);
}
