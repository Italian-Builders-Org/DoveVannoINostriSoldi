import { createHash } from "node:crypto";
import "../ci/register-source-alias.mjs";

const { getMunicipalityProfile } = await import("../../src/lib/municipality-profile.ts");
const { municipalitySnapshotEntity } = await import("../../src/lib/municipality-snapshot-entity.ts");
const { getSiopeMunicipalityDetailByIpaCode, getMunicipalitySearchEntities } = await import("../../src/lib/siope-municipality-detail.ts");
const defaultCodes = ["c_e897", "c_f205", "c_h501", "c_a783", "c_f839", "c_d612"];

const entities = getMunicipalitySearchEntities();
const codes = process.argv.includes("--scan")
  ? Array.from({ length: 120 }, (_, index) => entities[Math.floor(index * entities.length / 120)].codiceIpa)
  : defaultCodes;

for (let pass = 0; pass < 3; pass++) {
  const start = performance.now();
  const cpu = process.cpuUsage();
  const rows = [];
  for (const code of codes) {
    const detail = getSiopeMunicipalityDetailByIpaCode(code);
    const entity = detail && municipalitySnapshotEntity(detail);
    if (!entity) throw new Error(`Identità comunale assente: ${code}`);
    rows.push(await getMunicipalityProfile(entity, { allowCommittedIstatIdentity: true }));
  }
  const used = process.cpuUsage(cpu);
  console.log(JSON.stringify({
    pass,
    node: process.version,
    codes,
    cpuMs: (used.user + used.system) / 1000,
    wallMs: performance.now() - start,
    rss: process.memoryUsage().rss,
    digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  }));
}
