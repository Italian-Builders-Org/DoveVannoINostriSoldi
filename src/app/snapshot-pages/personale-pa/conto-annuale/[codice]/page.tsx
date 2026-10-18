import Page from "@/app/personale-pa/conto-annuale/[codice]/page";

export { generateMetadata } from "@/app/personale-pa/conto-annuale/[codice]/page";

export const revalidate = false;
export function generateStaticParams() {
  return [];
}

export default async function SnapshotPage({ params }: { params: Promise<{ codice: string }> }) {
  return Page({ params });
}
