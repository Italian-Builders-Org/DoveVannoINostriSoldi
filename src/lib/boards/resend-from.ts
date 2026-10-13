import "server-only";

/**
 * Mittente Resend per Boards: riusa la mailbox verificata (anche se in env
 * è ancora `Consulenza <consulenza@…>`), ma forza sempre il nome DVNS Boards.
 */
export function boardsResendFromAddress(rawFrom: string): string {
  const trimmed = rawFrom.trim();
  const angled = /<([^>]+)>/u.exec(trimmed);
  const email = (angled?.[1] ?? trimmed).trim().toLowerCase();
  if (!email.includes("@") || email.includes(" ") || email.includes("<")) {
    throw new Error("RESEND_FROM_EMAIL non valido.");
  }
  return `DVNS Boards <${email}>`;
}
