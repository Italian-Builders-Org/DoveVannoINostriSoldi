import { linkDvnsEntities, type DvnsBatchOptions } from "@gov-core/client/dvns";
import type { GovCoreClient } from "@gov-core/client";

/** These two fields already exist on DVNS's validated IpaEntity server projection. */
export type DvnsIdentityRow = Readonly<{ codiceIpa: string | null; codiceFiscale: string | null }>;

/** Return an ordered overlay; never spread records into requests or change their accounting fields. */
export async function enrichDvnsIdentityLinks(
  client: Pick<GovCoreClient, "resolve">,
  records: readonly DvnsIdentityRow[],
  options?: DvnsBatchOptions,
) {
  const batch = await linkDvnsEntities(client, records.map(record => ({
    ipaCode: record.codiceIpa, taxCode: record.codiceFiscale,
  })), options);
  return {
    links: batch.rows.map((link, index) => ({
      sourceIpaCode: records[index]!.codiceIpa,
      govCoreEntityId: link.ok && link.result.status === "resolved" ? link.result.entity!.id : null,
      link,
    })),
    stats: batch.stats,
  };
}
