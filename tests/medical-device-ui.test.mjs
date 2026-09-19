import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const index = await readFile(new URL("../src/app/spese/sanita/dispositivi/page.tsx", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/app/spese/sanita/dispositivi/[tipo]/[numero]/page.tsx", import.meta.url), "utf8");
const hub = await readFile(new URL("../src/app/spese/sanita/page.tsx", import.meta.url), "utf8");
const historyChart = await readFile(new URL("../src/components/charts/medical-device-spending-history-chart.tsx", import.meta.url), "utf8");

test("l’hub sanità collega la nuova superficie", () => {
  assert.match(hub, /href="\/spese\/sanita\/dispositivi"/);
  assert.match(hub, /non sono prezzi unitari/);
});

test("la pagina dispositivi espone ricerca, aggregati, righe e limiti", () => {
  assert.match(index, /searchMedicalDevices/);
  assert.match(index, /aggregateMedicalDeviceSpending/);
  assert.doesNotMatch(index, /Puoi usare numero di repertorio/);
  assert.doesNotMatch(index, /Non collegate alla BD\/RDM/);
  assert.match(index, /Righe JSON/);
  assert.match(index, /medicalDeviceRegionName\(row\.code\)/);
  assert.match(index, /aggregateRegion \? "Aziende sanitarie" : "Regioni"/);
  assert.match(index, /Totali nazionali per anno/);
  assert.match(index, /Non sono prezzi unitari né pagamenti al fabbricante/);
  assert.match(index, /className="btn btn-primary" type="submit">Cerca/);
  assert.doesNotMatch(index, /La ricerca parte solo dopo aver inserito un termine/);
});

test("la pagina dispositivi confronta i totali nazionali disponibili", () => {
  assert.match(index, /MedicalDeviceSpendingHistoryChart/);
  assert.match(index, /Promise\.all\(years\.map/);
  assert.match(index, /Spesa rilevata per anno/);
  assert.match(historyChart, /LineChart/);
  assert.match(historyChart, /ChartDataTable/);
  assert.match(historyChart, /Euro correnti/);
  assert.doesNotMatch(historyChart, /inflazione|efficienza/i);
});

test("la scheda distingue la chiave composta e mostra fonti e importi", () => {
  assert.match(detail, /Tipo \{device\.type\} · \{device\.number\}/);
  assert.match(detail, /getMedicalDeviceProfile/);
  assert.match(detail, /listMedicalDeviceFacts/);
  assert.match(detail, /Righe della fonte/);
  assert.match(detail, /Non prova quale ruolo avesse/i);
});
