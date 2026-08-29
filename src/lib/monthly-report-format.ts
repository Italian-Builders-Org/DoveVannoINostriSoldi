import type { ReportValue } from "@/lib/monthly-reports-contract";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function formatReportValue(value: ReportValue): string {
  if (value.kind === "count") return `${integer.format(value.value)} ${value.unit}`;
  if (value.kind === "money") return money.format(value.cents / 100);
  if (value.kind === "percentage") return `${(value.basisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
  if (value.kind === "ratio") return `${Number(value.decimal).toLocaleString("it-IT")} ${value.unit}`;
  return value.text;
}
