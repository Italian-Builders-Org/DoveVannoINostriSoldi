/** Official OpenCUP amounts are integer EUR; BigInt preserves every digit. */
export function formatOpenCupEuro(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "non disponibile";
  if (!/^[0-9]+$/.test(value)) throw new Error("Importo OpenCUP fuori contratto.");
  return `${BigInt(value).toLocaleString("it-IT")},00 €`;
}
