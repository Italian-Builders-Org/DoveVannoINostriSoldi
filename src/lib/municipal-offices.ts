import "server-only";

import snapshotJson from "@/data/generated/mantova-offices.json";
import {
  parseMunicipalOfficesSnapshot,
  type MunicipalOfficesSnapshot,
} from "@/lib/data/municipal-offices-contract";

export type MunicipalOfficesState =
  | Readonly<{ status: "available"; snapshot: MunicipalOfficesSnapshot }>
  | Readonly<{ status: "out_of_scope" }>;

// Validate at the publication boundary. A malformed release must fail visibly
// instead of presenting an incomplete roster as a verified public record.
const snapshot = parseMunicipalOfficesSnapshot(snapshotJson);

export function getMunicipalOfficesForEntity(ipaCode: string, taxCode: string): MunicipalOfficesState {
  if (ipaCode !== snapshot.municipality.ipaCode || taxCode !== snapshot.municipality.taxCode) {
    return { status: "out_of_scope" };
  }
  return { status: "available", snapshot };
}
