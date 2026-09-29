import Page from "@/app/appalti/operatori/[ref]/page";
import { generateMetadata as metadata } from "@/app/appalti/operatori/[ref]/page";
export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return metadata({ params, searchParams: Promise.resolve({}) });
}

// Populate only visited URLs; never prebuild the national corpus.
export const revalidate = 21_600;
export function generateStaticParams() { return []; }

export default async function SnapshotPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return Page({ params: Promise.resolve({ ref }), searchParams: Promise.resolve({}) });
}
