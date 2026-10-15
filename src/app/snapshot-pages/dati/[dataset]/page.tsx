import Page from "@/app/dati/[dataset]/page";
export { generateMetadata } from "@/app/dati/[dataset]/page";

// Committed row chunks belong to this deployment; filters never enter this route.
export const revalidate = false;
export function generateStaticParams() { return []; }

export default async function SnapshotPage({ params }: { params: Promise<{ dataset: string }> }) {
  return Page({ params, searchParams: Promise.resolve({}) });
}
