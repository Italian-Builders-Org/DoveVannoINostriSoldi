import Page from "@/app/appalti/operatori/[ref]/page";
import { generateMetadata as metadata } from "@/app/appalti/operatori/[ref]/page";
export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return metadata({ params, searchParams: Promise.resolve({}) });
}

// All inputs are committed snapshots. A new deployment owns a new render cache.
export const revalidate = false;
export function generateStaticParams() { return []; }

export default async function SnapshotPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return Page({ params: Promise.resolve({ ref }), searchParams: Promise.resolve({}) });
}
