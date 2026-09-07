import "server-only";

import { aggregateHospitalBeds, HOSPITAL_BEDS_DATASET, HOSPITAL_BEDS_ROWS } from "@/lib/data/salute-hospital-beds-contract";
import { INTEGRATED_MAX_LIMIT, selectIntegratedDataset } from "@/lib/integrated-public-view";

export async function getHospitalBeds() {
  const first = await selectIntegratedDataset({ datasetId: HOSPITAL_BEDS_DATASET, limit: INTEGRATED_MAX_LIMIT });
  if (first.dataset.publicRows !== HOSPITAL_BEDS_ROWS) throw new Error("Posti letto: dataset incompleto.");
  const rows = [...first.rows];
  for (let offset = INTEGRATED_MAX_LIMIT; offset < HOSPITAL_BEDS_ROWS; offset += INTEGRATED_MAX_LIMIT) {
    const result = await selectIntegratedDataset({
      datasetId: HOSPITAL_BEDS_DATASET, offset, limit: INTEGRATED_MAX_LIMIT,
    });
    rows.push(...result.rows);
  }
  return { dataset: first.dataset, regions: aggregateHospitalBeds(first.dataset.headers, rows) };
}
