/**
 * Mittente Resend per Boards.
 * Preferisce `BOARDS_RESEND_FROM_EMAIL` se impostato; altrimenti riusa il dominio
 * di `RESEND_FROM_EMAIL` ma forza la mailbox `boards@` (non consulenza@) e il
 * display name «DVNS Boards». Con dominio Resend verificato qualsiasi local-part
 * sullo stesso dominio è inviabile.
 */
function parseEmailAddress(raw: string): string {
  const trimmed = raw.trim();
  const angled = /<([^>]+)>/u.exec(trimmed);
  const email = (angled?.[1] ?? trimmed).trim().toLowerCase();
  if (!email.includes("@") || email.includes(" ") || email.includes("<")) {
    throw new Error("Mittente Resend Boards non valido.");
  }
  return email;
}

export function boardsResendFromAddress(
  rawFrom: string,
  options?: { boardsFrom?: string | null },
): string {
  const override = (options?.boardsFrom ?? "").trim();
  if (override) {
    return `DVNS Boards <${parseEmailAddress(override)}>`;
  }
  const email = parseEmailAddress(rawFrom);
  const at = email.lastIndexOf("@");
  const domain = email.slice(at + 1);
  if (!domain.includes(".")) {
    throw new Error("Mittente Resend Boards non valido.");
  }
  return `DVNS Boards <boards@${domain}>`;
}
