/** Locale-preserving decimal euro formatting: no floating point or rounding. */
export function pnrrFunding(value: string | null): string {
  if (value === null || value === "") return "Non disponibile";
  if (!/^[0-9]+(?:,[0-9]{1,2})?$/.test(value)) throw new Error("Importo PNRR invalido.");
  const [euros, fraction = ""] = value.split(",");
  return `${euros.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0")} €`;
}

export type PnrrLocation = [string, string | null, string, string | null, string, string | null, string | null];
export function pnrrLocations(value: string | null): PnrrLocation[] {
  if (!value) throw new Error("Localizzazioni PNRR assenti dalla proiezione.");
  const locations: unknown = JSON.parse(value);
  if (!Array.isArray(locations) || locations.some((row: unknown) => !Array.isArray(row) || row.length !== 7 || row.some((cell: unknown) => cell !== null && typeof cell !== "string") || [0, 2, 4].some((index) => typeof row[index] !== "string" || !/^\d{3}$/.test(row[index])))) {
    throw new Error("Localizzazioni PNRR invalide.");
  }
  return locations as PnrrLocation[];
}
