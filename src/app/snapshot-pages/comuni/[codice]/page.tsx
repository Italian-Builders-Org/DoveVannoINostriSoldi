import Page from "@/app/comuni/page";
export { metadata } from "@/app/comuni/page";

// Populate only visited URLs; never prebuild the national corpus.
export const revalidate = 21_600;
export function generateStaticParams() { return []; }

export default async function SnapshotPage({ params }: { params: Promise<{ codice: string }> }) {
  const { codice } = await params;
  return Page({ searchParams: Promise.resolve({ ente: codice }) });
}
