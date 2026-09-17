export type OpenBdapPaymentComponents = {
  opErario: number;
  opTesoreria: number;
  opEsterno: number;
  oaTesoreria: number;
  oaSpesaFunzDeleg: number;
  rsfStipendi: number;
  rsfAltro: number;
  noteImputazione: number;
  totalPaid: number;
};

export function parseOpenBdapAmount(value: string | undefined, field: string): number {
  const raw = value?.trim();
  if (!raw) throw new Error(`OpenBDAP: importo mancante nel campo ${field}`);
  const normalized = raw.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`OpenBDAP: importo non valido nel campo ${field}`);
  }
  return parsed;
}

export function assertOpenBdapComponentTotal(
  components: OpenBdapPaymentComponents,
  toleranceEuro = 0.02,
): void {
  const componentTotal =
    components.opErario +
    components.opTesoreria +
    components.opEsterno +
    components.oaTesoreria +
    components.oaSpesaFunzDeleg +
    components.rsfStipendi +
    components.rsfAltro +
    components.noteImputazione;
  if (Math.abs(componentTotal - components.totalPaid) > toleranceEuro) {
    throw new Error("OpenBDAP: i metodi di pagamento non riconciliano con il totale della riga");
  }
}
