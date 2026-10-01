import Page from "@/app/enti/[codice]/appalti/page";
export { generateMetadata } from "@/app/enti/[codice]/appalti/page";

// Populate only visited URLs; never prebuild the national corpus.
export const revalidate = 21_600;
export function generateStaticParams() { return []; }

export default async function SnapshotPage({ params }: { params: Promise<{ codice: string; view: string }> }) {
  const { codice, view } = await params;
  return Page({ snapshotCache: true, params: Promise.resolve({ codice }), searchParams: Promise.resolve({ view }) });
}
