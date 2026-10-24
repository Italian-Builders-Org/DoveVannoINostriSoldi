import { notFound } from "next/navigation";
import Page from "@/app/enti/[codice]/appalti/page";
import { entitySearchParamsFromSlug } from "@/lib/snapshot-routing";
export { generateMetadata } from "@/app/enti/[codice]/appalti/page";

// All inputs are committed snapshots. A new deployment owns a new render cache.
export const revalidate = false;
export function generateStaticParams() { return []; }

export default async function SnapshotPage({ params }: { params: Promise<{ codice: string; view: string }> }) {
  const { codice, view } = await params;
  const searchParams = entitySearchParamsFromSlug(view);
  if (!searchParams) notFound();
  return Page({ snapshotCache: true, params: Promise.resolve({ codice }), searchParams: Promise.resolve(searchParams) });
}
