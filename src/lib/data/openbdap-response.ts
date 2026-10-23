import { SourceFetchError } from "@/lib/data/source-fetch";

export class OpenBdapUnavailableError extends SourceFetchError {
  constructor(message: string) {
    super(message, "openbdap");
    this.name = "OpenBdapUnavailableError";
  }
}

export function isOpenBdapHtmlPayload(payload: string): boolean {
  const trimmed = payload.trimStart().slice(0, 32).toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

/**
 * OpenBDAP occasionally answers CKAN JSON endpoints with an HTML maintenance or
 * gateway page while still returning HTTP 200. Treat that as a temporary outage.
 */
export async function readOpenBdapJsonResponse<T>(
  response: Response,
  operation: string,
): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const raw = await response.text();
  if (contentType.includes("text/html") || isOpenBdapHtmlPayload(raw)) {
    throw new OpenBdapUnavailableError(
      `OpenBDAP ${operation} ha restituito HTML invece di JSON`,
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new OpenBdapUnavailableError(
        `OpenBDAP ${operation} ha restituito una risposta non JSON`,
      );
    }
    throw error;
  }
}

export function isOpenBdapCsvConversionError(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as {
      success?: unknown;
      error?: { message?: unknown };
    };
    const message = parsed.error?.message;
    return parsed.success === false
      && typeof message === "string"
      && /^Cannot convert data to csv(?:\. Attachment not found)?$/i.test(message.trim());
  } catch {
    return false;
  }
}
