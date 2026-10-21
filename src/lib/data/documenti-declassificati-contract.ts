import { z } from "zod";

/**
 * Curated pilot of Italian declassified / desecretized government documents.
 * Fail-closed: official HTTPS hosts, explicit soldi (usually null), distinct dates.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const yearOrDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/u);
const docId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const ISSUING_BODIES = ["camera", "senato", "acs", "stato"] as const;
export const THEMES = ["moro", "terrorismo-stragi", "declassifica-procedure"] as const;
export const ACCESS_STATUSES = [
  "public-online",
  "spid-required",
  "on-site-only",
  "request-required",
] as const;
export const READINESS = ["metadata-only", "summary-curated"] as const;

const ALLOWED_HOSTS = new Set([
  "documenti.camera.it",
  "www.camera.it",
  "camera.it",
  "patrimonio.archivio.senato.it",
  "www.senato.it",
  "senato.it",
  "acs.cultura.gov.it",
  "archivi.cultura.gov.it",
  "www.normattiva.it",
  "normattiva.it",
  "www.governo.it",
  "governo.it",
]);

function hostAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (ALLOWED_HOSTS.has(host)) return true;
    if (host.startsWith("www.") && ALLOWED_HOSTS.has(host.slice(4))) return true;
    return false;
  } catch {
    return false;
  }
}

const moneySchema = z
  .object({
    kind: z.string().min(1),
    amountEuroCents: z.number().int().nonnegative().safe(),
    note: z.string().min(1).nullable(),
  })
  .strict();

const relatedDocumentLinkSchema = z
  .object({
    id: docId,
    relation: z.string().min(4).max(120),
  })
  .strict();

const documentSchema = z
  .object({
    id: docId,
    title: z.string().min(1),
    issuingBody: z.enum(ISSUING_BODIES),
    issuingBodyLabel: z.string().min(1),
    theme: z.enum(THEMES),
    classificationBefore: z.string().min(1),
    classificationAfter: z.string().min(1),
    accessStatus: z.enum(ACCESS_STATUSES),
    readiness: z.enum(READINESS),
    eventPeriodLabel: z.string().min(1),
    eventPeriodFrom: yearOrDate.nullable(),
    eventPeriodTo: yearOrDate.nullable(),
    declassifiedAt: yearOrDate.nullable(),
    releasedAt: yearOrDate.nullable(),
    verifiedAt: isoDate,
    summary: z.string().min(40),
    keyPoints: z.array(z.string().min(12)).min(3).max(7),
    soldi: moneySchema.nullable(),
    sourceUrls: z.array(z.string().url()).min(1),
    caveat: z.string().min(1),
    relatedDocuments: z.array(relatedDocumentLinkSchema).min(1).max(12).optional(),
    cameraActRefs: z.array(z.string().min(2).max(40)).min(1).max(24).optional(),
    declassificationNote: z.string().min(12).max(480).optional(),
  })
  .strict()
  .superRefine((doc, context) => {
    for (const [index, url] of doc.sourceUrls.entries()) {
      if (!url.startsWith("https://") || !hostAllowed(url)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "URL fonte non ufficiale o non HTTPS",
          path: ["sourceUrls", index],
        });
      }
    }
  });

const coverageSchema = z
  .object({
    documentsPublished: z.number().int().positive(),
    documentsCataloguedOnly: z.number().int().nonnegative(),
    checkedAt: isoDate,
    periodFrom: yearOrDate.nullable(),
    periodTo: yearOrDate.nullable(),
    themes: z.array(z.enum(THEMES)).min(1),
    issuingBodies: z.array(z.enum(ISSUING_BODIES)).min(1),
    byAccessStatus: z.record(z.string(), z.number().int().nonnegative()),
    byReadiness: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

export const documentiDeclassificatiSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    dataset: z.literal("documenti-declassificati"),
    coverage: coverageSchema,
    source: z
      .object({
        holder: z.string().min(1),
        authority: z.literal("secondary"),
        license: z.literal("not-declared"),
        licenseNote: z.string().min(1).nullable(),
        referencePeriod: z.string().min(1),
        publicationDate: z.null(),
        acquisitionDate: isoDate,
        checkedAt: isoDate,
        updateFrequency: z.string().min(1),
        canonicalUrls: z.array(z.string().url()).min(1),
        evidenceRule: z.string().min(1),
        issueUrl: z.string().url(),
      })
      .strict(),
    semantics: z
      .object({
        soldi: z.string().min(1),
        periodo: z.string().min(1),
        provenance: z.string().min(1),
      })
      .strict(),
    caveats: z.array(z.string().min(1)).min(1),
    documents: z.array(documentSchema).min(8).max(64),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.coverage.documentsPublished !== snapshot.documents.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "coverage.documentsPublished non coincide",
        path: ["coverage", "documentsPublished"],
      });
    }
    const ids = new Set<string>();
    for (const doc of snapshot.documents) {
      if (ids.has(doc.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `id duplicato ${doc.id}`,
          path: ["documents"],
        });
      }
      ids.add(doc.id);
    }
  });

export type DocumentiDeclassificatiSnapshot = z.infer<typeof documentiDeclassificatiSnapshotSchema>;
export type DocumentoDeclassificato = DocumentiDeclassificatiSnapshot["documents"][number];

export function parseDocumentiDeclassificatiSnapshot(value: unknown): DocumentiDeclassificatiSnapshot {
  return documentiDeclassificatiSnapshotSchema.parse(value);
}
