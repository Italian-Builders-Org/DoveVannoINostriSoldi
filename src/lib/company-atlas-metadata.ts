import "server-only";
import metadata from "@/data/generated/company-atlas-metadata.json";
import { companyAtlasSourceSchema, type CompanyAtlasSource } from "@/lib/company-atlas-contract";

// Generated with the observations and checked for exact parity by the ETL.
// Importing this small sidecar keeps /fonti independent of the full atlas.
export const companyAtlasSources: Readonly<Record<string, CompanyAtlasSource>> = Object.freeze(Object.fromEntries(
  Object.entries(metadata.sources).map(([id, source]) => [id, companyAtlasSourceSchema.parse(source)]),
));
export const companyAtlasSourceList: readonly CompanyAtlasSource[] = Object.freeze(Object.values(companyAtlasSources));
