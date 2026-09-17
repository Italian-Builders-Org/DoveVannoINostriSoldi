type RawRecord = Record<string, unknown>;

export type IpaOrganizationUnit = {
  codice: string;
  codicePadre: string | null;
  codiceAoo: string | null;
  denominazione: string;
  istituitaIl: string | null;
  aggiornataIl: string | null;
  sede: {
    indirizzo: string | null;
    cap: string | null;
    codiceComuneIstat: string | null;
  };
  contatti: {
    telefono: string | null;
    email: string[];
    url: string | null;
  };
};

export type IpaHomogeneousArea = {
  codice: string;
  codiceEnte: string | null;
  denominazione: string;
  istituitaIl: string | null;
  aggiornataIl: string | null;
  protocolloInformatico: boolean | null;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredText(value: unknown, fallback: string): string {
  return text(value) ?? fallback;
}

function externalUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function flag(value: unknown): boolean | null {
  const normalized = text(value)?.toUpperCase();
  if (normalized === "S") return true;
  if (normalized === "N") return false;
  return null;
}

function emails(record: RawRecord): string[] {
  const values: string[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const value = text(record[`Mail${index}`]);
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

export function normalizeIpaOrganizationUnit(record: RawRecord): IpaOrganizationUnit {
  return {
    codice: requiredText(record.Codice_uni_uo, "codice-uo-non-disponibile"),
    codicePadre: text(record.Codice_uni_uo_padre),
    codiceAoo: text(record.Codice_uni_aoo),
    denominazione: requiredText(record.Descrizione_uo, "Unità senza denominazione"),
    istituitaIl: text(record.Data_istituzione),
    aggiornataIl: text(record.Data_aggiornamento),
    sede: {
      indirizzo: text(record.Indirizzo),
      cap: text(record.CAP),
      codiceComuneIstat: text(record.Codice_comune_ISTAT),
    },
    contatti: {
      telefono: text(record.Telefono),
      email: emails(record),
      url: externalUrl(record.Url),
    },
  };
}

export function normalizeIpaHomogeneousArea(record: RawRecord): IpaHomogeneousArea {
  return {
    codice: requiredText(record.Codice_uni_aoo, "codice-aoo-non-disponibile"),
    codiceEnte: text(record.Codice_IPA),
    denominazione: requiredText(record.Denominazione_aoo, "Area senza denominazione"),
    istituitaIl: text(record.Data_istituzione),
    aggiornataIl: text(record.Data_aggiornamento),
    protocolloInformatico: flag(record.Protocollo_informatico),
  };
}
