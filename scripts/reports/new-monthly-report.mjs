#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const INPUTS = {
  companies: "src/data/generated/company-atlas-snapshot.json",
  debt: "src/data/generated/public-debt.json",
  municipal: "src/data/generated/siope-municipal.json",
};

function fail(message) {
  throw new Error(`report:new: ${message}`);
}

function isDate(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseReportArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) fail("usa --month AAAA-MM --cutoff AAAA-MM-GG");
    values.set(flag, value);
  }
  const month = values.get("--month");
  const cutoff = values.get("--cutoff");
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail("mese non valido");
  if (!cutoff || !isDate(cutoff)) fail("cutoff non valido");
  if (cutoff.slice(0, 7) < month) fail("il cutoff non può precedere il mese raccontato");
  if (values.size !== 2) fail("argomento sconosciuto");
  return { month, cutoff };
}

function checkedDate(timestamp) {
  const value = String(timestamp).slice(0, 10);
  if (!isDate(value)) fail(`timestamp di verifica non valido: ${timestamp}`);
  return value;
}

function totalByPeriod(snapshot, period) {
  return snapshot.observations
    .filter((row) => row.sourceId === "active-stock" && row.metric === "active_enterprises" && row.period === period)
    .reduce((sum, row) => sum + (row.value ?? 0), 0);
}

function regionTotals(snapshot, period) {
  const totals = new Map(snapshot.regions.map((region) => [region.code, 0]));
  for (const row of snapshot.observations) {
    if (row.sourceId !== "active-stock" || row.metric !== "active_enterprises" || row.period !== period) continue;
    totals.set(row.geographyCode, (totals.get(row.geographyCode) ?? 0) + (row.value ?? 0));
  }
  return totals;
}

const count = (value, unit = "sedi di impresa") => ({ kind: "count", value, unit });
const money = (cents) => ({ kind: "money", cents, display: "compact" });
const percentage = (basisPoints) => ({ kind: "percentage", basisPoints });
const periodRange = (from, to, completeness = "complete") => ({ kind: "range", from, to, completeness });

function evidenceFor(path, details, provenance) {
  const input = provenance[path];
  if (!input) fail(`provenienza mancante per ${path}`);
  return { ...details, dataRevision: input.revision, artifactSha256: input.sha256 };
}

export function buildMonthlyReportDraft({ month, cutoff, snapshots, provenance }) {
  const company = snapshots.companies;
  const companySource = company?.sources?.["active-stock"];
  if (!companySource || companySource.updatedAt > cutoff || checkedDate(companySource.observedAt) > cutoff) {
    fail("lo stock imprese non supera il contratto temporale");
  }
  const eligiblePeriods = company.periods.activeStock.map((entry) => entry.id)
    .filter((period) => period.slice(0, 7) < month)
    .sort();
  const latest = eligiblePeriods.at(-1);
  if (!latest) fail("nessun periodo imprese completo precedente al mese");
  const previousYear = `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}`;
  if (!eligiblePeriods.includes(previousYear)) fail(`confronto annuo imprese assente per ${previousYear}`);

  const history = eligiblePeriods.map((period) => ({
    key: period.slice(0, 7),
    label: period.slice(0, 7),
    values: { active: count(totalByPeriod(company, period)) },
  }));
  const latestByRegion = regionTotals(company, latest);
  const priorByRegion = regionTotals(company, previousYear);
  const regionRows = company.regions.map((region) => {
    const prior = priorByRegion.get(region.code) ?? 0;
    const current = latestByRegion.get(region.code) ?? 0;
    const delta = current - prior;
    return {
      key: region.code,
      label: region.name,
      values: {
        previous: count(prior),
        current: count(current),
        delta: count(delta),
        change: percentage(prior === 0 ? 0 : Math.round((delta * 10_000) / prior)),
      },
    };
  }).sort((left, right) => left.values.delta.value - right.values.delta.value);
  const nationalCurrent = totalByPeriod(company, latest);
  const nationalPrior = totalByPeriod(company, previousYear);
  const nationalDelta = nationalCurrent - nationalPrior;
  const strongestSignal = regionRows[0];
  const evidence = [evidenceFor(INPUTS.companies, {
    id: "company-active-stock",
    datasetId: "company_active_enterprises",
    publisher: companySource.publisher,
    title: companySource.label,
    publicUrl: companySource.url,
    checkedOn: checkedDate(companySource.observedAt),
    referencePeriod: periodRange(history[0].key + "-01", latest),
    perimeter: companySource.coverage,
    caveat: companySource.caveat,
  }, provenance)];
  const facts = [
    {
      id: "active-stock-latest",
      label: "Sedi di impresa attive",
      value: count(nationalCurrent),
      plainLanguage: `Al ${latest} risultano ${nationalCurrent.toLocaleString("it-IT")} sedi di impresa attive in Italia.`,
      referencePeriod: { kind: "date", date: latest },
      perimeter: "Stock nazionale delle sedi di impresa attive, tutte le regioni e sezioni ATECO 2025.",
      denominator: null,
      caveat: companySource.caveat,
      evidenceIds: ["company-active-stock"],
    },
    {
      id: "active-stock-year-change",
      label: "Variazione nazionale in un anno",
      value: count(nationalDelta),
      plainLanguage: `Tra ${previousYear} e ${latest} lo stock nazionale cambia di ${nationalDelta.toLocaleString("it-IT")} sedi.`,
      referencePeriod: periodRange(previousYear, latest),
      perimeter: "Differenza tra due stock nazionali a fine mese.",
      denominator: null,
      caveat: "È una variazione dello stock: non equivale al saldo fra sole aperture e chiusure nel periodo.",
      evidenceIds: ["company-active-stock"],
    },
    {
      id: "largest-territorial-signal",
      label: "Segnale territoriale più ampio",
      value: strongestSignal.values.delta,
      plainLanguage: `${strongestSignal.label} mostra la maggiore variazione assoluta fra ${previousYear} e ${latest}.`,
      referencePeriod: periodRange(previousYear, latest),
      perimeter: `Stock delle sedi attive nella regione ${strongestSignal.label}.`,
      denominator: null,
      caveat: "Il confronto descrive un segnale e non ne identifica automaticamente la causa.",
      evidenceIds: ["company-active-stock"],
    },
  ];
  const inBrief = ["active-stock-latest", "active-stock-year-change", "largest-territorial-signal"];
  const draftNotes = ["Bozza generata: la pubblicazione richiede revisione umana e passaggio da draft a published."];

  const debt = snapshots.debt;
  if (debt && checkedDate(debt.sources.bancaditalia.retrievedAt) <= cutoff && debt.stock.referenceDate.slice(0, 7) < month) {
    evidence.push(evidenceFor(INPUTS.debt, {
      id: "public-debt-stock", datasetId: "public_debt", publisher: debt.sources.bancaditalia.owner,
      title: debt.sources.bancaditalia.title, publicUrl: debt.sources.bancaditalia.landingUrl,
      checkedOn: checkedDate(debt.sources.bancaditalia.retrievedAt), referencePeriod: { kind: "date", date: debt.stock.referenceDate },
      perimeter: "Debito lordo delle Amministrazioni pubbliche italiane a fine mese.", caveat: debt.caveats[0],
    }, provenance));
    facts.push({
      id: "public-debt-latest", label: "Debito pubblico", value: money(debt.stock.totalCents),
      plainLanguage: `A fine ${debt.stock.referenceDate.slice(0, 7)} il debito pubblico è ${debt.stock.totalCents} centesimi.`,
      referencePeriod: { kind: "date", date: debt.stock.referenceDate },
      perimeter: "Debito lordo delle Amministrazioni pubbliche italiane.", denominator: null,
      caveat: debt.caveats.join(" "), evidenceIds: ["public-debt-stock"],
    });
    inBrief[1] = "public-debt-latest";
    draftNotes.push("Aggiornamento qualificato: debito pubblico, con periodo proprio e senza confronti con lo stock imprese.");
  }

  const municipal = snapshots.municipal;
  const municipalMonth = municipal && `${municipal.year}-${String(municipal.latestMonth).padStart(2, "0")}`;
  if (municipal && checkedDate(municipal.source.observedAt) <= cutoff && municipalMonth <= month) {
    evidence.push(evidenceFor(INPUTS.municipal, {
      id: "municipal-payments", datasetId: "siope_municipal_payments", publisher: municipal.source.siopeOwner,
      title: "Pagamenti di cassa SIOPE dei Comuni", publicUrl: municipal.source.siopeMovementsUrl,
      checkedOn: checkedDate(municipal.source.observedAt),
      referencePeriod: { kind: "month", month: municipalMonth, completeness: "partial" },
      perimeter: municipal.methodology.measure, caveat: municipal.methodology.warning,
    }, provenance));
    facts.push({
      id: "municipal-payments-ytd", label: "Pagamenti comunali registrati", value: money(Math.round(municipal.totalPaid * 100)),
      plainLanguage: `Da gennaio al mese ${municipal.latestMonth} del ${municipal.year}, i pagamenti comunali registrati ammontano a ${municipal.totalPaid} euro.`,
      referencePeriod: periodRange(`${municipal.year}-01-01`, `${municipalMonth}-31`, "partial"),
      perimeter: municipal.methodology.measure, denominator: null, caveat: municipal.methodology.warning,
      evidenceIds: ["municipal-payments"],
    });
    inBrief[2] = "municipal-payments-ytd";
    draftNotes.push("Aggiornamento qualificato: pagamenti comunali SIOPE, periodo parziale esplicitato e perimetro non sommabile agli altri fatti.");
  }

  const placeholder = (title) => ({ title, paragraphs: [{ text: "[DA SCRIVERE DOPO LA REVISIONE DEI FATTI CANDIDATI]", evidenceIds: [] }] });
  const [year, rawMonth] = month.split("-").map(Number);
  const targetDate = new Date(Date.UTC(year, rawMonth, 10));
  const targetPublishedOn = targetDate.toISOString().slice(0, 10);
  return {
    status: "draft", issueMonth: month, title: "Imprese e territori",
    dek: "Una lettura mensile dei dati pubblici verificati, con periodi e limiti in chiaro.",
    teaser: "Che cosa racconta lo stock delle sedi di impresa e quali segnali meritano attenzione.",
    keywords: ["imprese", "territori", "dati pubblici"], publication: { targetPublishedOn, dataCutoff: cutoff },
    inBrief, lead: placeholder("La storia del mese"), facts,
    rubrics: {
      numbers: placeholder("Numeri da ricordare"), territories: placeholder("Territori"),
      signal: placeholder("Un segnale da capire"), sources: placeholder("Fonti e limiti"), nextMonth: placeholder("Il mese prossimo"),
    },
    figures: [
      {
        id: "national-active-stock", kind: "time-series", title: "Sedi di impresa attive, mese per mese",
        takeaway: `Lo stock nazionale arriva a ${nationalCurrent.toLocaleString("it-IT")} sedi al ${latest}.`,
        accessibleSummary: "Serie mensile nazionale ordinata cronologicamente; i valori esatti sono nella tabella associata.",
        referencePeriod: periodRange(history[0].key + "-01", latest), perimeter: "Stock nazionale delle sedi di impresa attive.",
        denominator: null, caveat: companySource.caveat, evidenceIds: ["company-active-stock"], visualSeriesId: "active",
        series: [{ id: "active", label: "Sedi attive", format: "count" }], rows: history,
      },
      {
        id: "regional-year-change", kind: "ranked-bars", title: "Differenza regionale in un anno",
        takeaway: `${strongestSignal.label} registra la variazione assoluta più ampia; è un segnale, non una spiegazione.`,
        accessibleSummary: "Le venti regioni sono ordinate dalla variazione assoluta più negativa alla più positiva; la tabella riporta entrambi gli stock, differenza e percentuale.",
        referencePeriod: periodRange(previousYear, latest), perimeter: "Stock delle sedi di impresa attive nelle venti regioni italiane.",
        denominator: "stock regionale delle sedi attive al mese iniziale",
        caveat: "Le percentuali usano come denominatore lo stock della stessa regione nel mese iniziale.",
        evidenceIds: ["company-active-stock"], visualSeriesId: "delta",
        series: [
          { id: "previous", label: previousYear, format: "count", tableOnly: true },
          { id: "current", label: latest, format: "count", tableOnly: true },
          { id: "delta", label: "Differenza", format: "count" },
          { id: "change", label: "Variazione", format: "percentage", tableOnly: true },
        ], rows: regionRows,
      },
    ],
    evidence, reviewers: [], draftNotes,
  };
}

function git(command, cwd = ROOT) {
  return execFileSync("git", command, { cwd, encoding: "utf8" }).trim();
}

function readInputs(root) {
  const snapshots = {};
  const provenance = {};
  for (const [name, path] of Object.entries(INPUTS)) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) {
      if (name === "companies") fail(`input obbligatorio assente: ${path}`);
      continue;
    }
    if (git(["status", "--porcelain", "--", path], root)) fail(`input non committato o sporco: ${path}`);
    const revision = git(["log", "-1", "--format=%H", "--", path], root);
    if (!/^[0-9a-f]{40}$/.test(revision)) fail(`revisione Git assente: ${path}`);
    const bytes = readFileSync(absolute);
    snapshots[name] = JSON.parse(bytes.toString("utf8"));
    provenance[path] = { revision, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return { snapshots, provenance };
}

function verifySourceContracts(root) {
  execFileSync(process.execPath, [
    "--experimental-strip-types",
    "scripts/reports/validate-report-inputs.mjs",
  ], { cwd: root, stdio: "inherit" });
}

export function writeDraft(root, draft) {
  const target = resolve(root, `src/content/monthly-reports/drafts/${draft.issueMonth}.ts`);
  const published = resolve(root, `src/content/monthly-reports/published/${draft.issueMonth}.ts`);
  if (existsSync(target) || existsSync(published)) fail(`l'edizione ${draft.issueMonth} esiste già`);
  mkdirSync(dirname(target), { recursive: true });
  const source = `import type { MonthlyReportDraft } from "@/lib/monthly-reports-contract";\n\nexport const monthlyReportDraft = ${JSON.stringify(draft, null, 2)} as const satisfies MonthlyReportDraft;\n`;
  writeFileSync(target, source, { encoding: "utf8", flag: "wx" });
  return target;
}

function main() {
  const args = parseReportArguments(process.argv.slice(2));
  verifySourceContracts(ROOT);
  const draft = buildMonthlyReportDraft({ ...args, ...readInputs(ROOT) });
  const target = writeDraft(ROOT, draft);
  process.stdout.write(`Bozza creata: ${target}\nFatti candidati: ${draft.facts.length}; figure congelate: ${draft.figures.length}.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
