import "server-only";
import type { IpaEntity } from "@/lib/ipa";
import { getMunicipalityFinancialProfile, type MunicipalityFinancialProfile } from "@/lib/municipality-financial-profile";
import { getMunicipalityRealEstate, type MunicipalityRealEstate } from "@/lib/municipality-real-estate";
import { getMunicipalitySchoolServices, type MunicipalitySchoolServices } from "@/lib/municipality-school-services";
export type { MunicipalityPeerBenchmark, ProfileSection, ProfileUnavailableReason } from "@/lib/municipality-financial-profile";

export type MunicipalityProfile = MunicipalityFinancialProfile & Readonly<{
  schoolServices: MunicipalitySchoolServices;
  realEstate: MunicipalityRealEstate;
}>;

export async function getMunicipalityProfile(
  entity: IpaEntity,
  options: Readonly<{ allowCommittedIstatIdentity?: boolean; signal?: AbortSignal }> = {},
): Promise<MunicipalityProfile | null> {
  options.signal?.throwIfAborted();
  const financial = await getMunicipalityFinancialProfile(entity, options);
  if (!financial) return null;
  options.signal?.throwIfAborted();
  const [schoolServices, realEstate] = await Promise.all([
    getMunicipalitySchoolServices(
      financial.irpef.status === "available" && financial.irpef.data.record.territory.level === "municipality"
        ? financial.irpef.data.record.territory : null,
      options.signal,
    ),
    getMunicipalityRealEstate(financial.identifiers.taxCode, options.signal),
  ]);
  return { ...financial, schoolServices, realEstate };
}
