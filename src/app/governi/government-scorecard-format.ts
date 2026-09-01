export function formatScore(value: number) {
  return value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function signed(value: number, digits = 1) {
  const absolute = Math.abs(value).toLocaleString("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${absolute}`;
}

export function rawChangeLabel(indicator: { id: string; rawChange: number }) {
  if (indicator.id === "real_compensation" || indicator.id === "real_gdp_per_capita") return `${signed(indicator.rawChange)}%`;
  return `${signed(indicator.rawChange)} punti`;
}

export function relativeChangeLabel(indicator: {
  relativeChange: number;
  transformation: "log-change" | "point-change";
}) {
  const suffix = indicator.transformation === "log-change" ? "%" : " punti";
  return `${signed(indicator.relativeChange)}${suffix}`;
}

export function sourceValue(value: number, indicatorId: string) {
  const suffix = indicatorId === "real_compensation" ? " indice" : indicatorId === "real_gdp_per_capita" ? " mila € 2020" : "%";
  return `${value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${suffix}`;
}

export function italySourceCodes(sourceCodes: Readonly<Record<"italy", readonly string[]>>) {
  return sourceCodes.italy.join(", ");
}
