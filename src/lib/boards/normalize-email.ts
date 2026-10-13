/** Validazione email senza regex backtracking (CodeQL-safe). */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  if (local.length === 0 || domain.length === 0 || dot <= 0 || dot >= domain.length - 1) {
    return null;
  }
  if (/[\s<>"']/.test(email)) return null;
  return email;
}
