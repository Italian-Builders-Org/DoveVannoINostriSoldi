import Page from "@/app/personale-pa/conto-annuale/page";

export { metadata } from "@/app/personale-pa/conto-annuale/page";

// Committed index belongs to this deployment; search queries never enter this route.
export const revalidate = false;
export function generateStaticParams() {
  return [];
}

export default async function SnapshotPage() {
  return Page({ searchParams: Promise.resolve({}) });
}
