import { SourceFetchError } from "@/lib/data/source-fetch";

export class OpenBdapUnavailableError extends SourceFetchError {
  constructor(message: string) {
    super(message, "openbdap");
    this.name = "OpenBdapUnavailableError";
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
