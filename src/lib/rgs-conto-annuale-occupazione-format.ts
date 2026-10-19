import { decimal, integer } from "@/lib/format";

export function formatStaffCount(value: number): string {
  return Number.isInteger(value) ? integer(value) : decimal(value, 2);
}

export function formatStaffDelta(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatStaffCount(Math.abs(value))}`;
}
