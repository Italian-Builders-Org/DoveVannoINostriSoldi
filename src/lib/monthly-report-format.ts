import type { ReferencePeriod, ReportValue } from "@/lib/monthly-reports-contract";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatReportPeriod(period: ReferencePeriod): string {
  const date = (value: string) => new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  if (period.kind === "date" || period.kind === "as-of") return date(period.date);
  const partial = period.completeness === "partial" ? " (parziale)" : "";
  if (period.kind === "range") return `${date(period.from)} – ${date(period.to)}${partial}`;
  if (period.kind === "year") return `${period.year}${partial}`;
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period.month}-01T00:00:00Z`)) + partial;
}

export function formatReportValue(value: ReportValue): string {
  if (value.kind === "count") return `${integer.format(value.value)} ${value.unit}`;
  if (value.kind === "money") {
    const euros = value.cents / 100;
    if (value.display === "compact" && Math.abs(euros) >= 1_000_000) {
      const billions = Math.abs(euros) >= 1_000_000_000;
      return `${(euros / (billions ? 1_000_000_000 : 1_000_000)).toLocaleString("it-IT", { maximumFractionDigits: 2, useGrouping: "always" })} ${billions ? "miliardi" : "milioni"} €`;
    }
    return money.format(euros);
  }
  if (value.kind === "percentage") return `${(value.basisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
  if (value.kind === "ratio") return `${Number(value.decimal).toLocaleString("it-IT")} ${value.unit}`;
  return value.text;
}
