import "../../tests/helpers/register-ts-alias.mjs";
import companySnapshot from "../../src/data/generated/company-atlas-snapshot.json" with { type: "json" };
import debtSnapshot from "../../src/data/generated/public-debt.json" with { type: "json" };

const { validateCompanyAtlasSnapshot } = await import("../../src/lib/company-atlas-contract.ts");
const { parsePublicDebtSnapshot } = await import("../../src/lib/data/public-debt-contract.ts");
const { siopeMunicipalSnapshot } = await import("../../src/lib/siope-snapshot.ts");

validateCompanyAtlasSnapshot(companySnapshot);
parsePublicDebtSnapshot(debtSnapshot);
if (siopeMunicipalSnapshot.schemaVersion !== 3) throw new Error("Contratto SIOPE non valido");
process.stdout.write("Contratti sorgente dei report: validi\n");
