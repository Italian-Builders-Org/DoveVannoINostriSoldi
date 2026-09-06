import type { PublishedPaper } from "@/lib/papers-contract";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { childcareStudy } from "@/lib/studies";

/** Published metadata only; the study capsule remains the source of its values. */
export const PUBLISHED_PAPERS = [{
  status: "published",
  slug: childcareStudy.slug,
  title: childcareStudy.title,
  abstract: `${childcareStudy.subtitle}. ${childcareStudy.description}`,
  authors: ["DoveVannoINostriSoldi"],
  publishedOn: "2026-09-06",
  version: childcareStudy.version,
  webPath: childcareStudy.path,
  limitations: "Lo studio osserva finanziamento e avanzamento amministrativo al 13 giugno 2026. Non misura i posti nido effettivamente aperti o certificati e non identifica effetti causali.",
  pdfUrl: `${PUBLIC_SITE_URL}${childcareStudy.assetPath}/dai-fondi-ai-posti.pdf`,
  pdfSha256: childcareStudy.assets["dai-fondi-ai-posti.pdf"].sha256,
  reproducibilityUrl: childcareStudy.reproducibilityUrl,
}] as const satisfies readonly PublishedPaper[];
