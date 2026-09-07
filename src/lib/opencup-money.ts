const OPEN_CUP_MONEY = /^([0-9]+)(?:,([0-9]{1,2}))?$/;

/** Parse the OpenCUP decimal-comma EUR contract without floating point. */
export function parseOpenCupEuroCents(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  const match = OPEN_CUP_MONEY.exec(value);
  if (!match) throw new Error("Importo OpenCUP fuori contratto.");
  return BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}

export function formatOpenCupEuro(value: string | null | undefined): string {
  const cents = parseOpenCupEuroCents(value);
  if (cents === null) return "non disponibile";
  const whole = cents / BigInt(100);
  const fraction = String(cents % BigInt(100)).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped},${fraction} €`;
}
