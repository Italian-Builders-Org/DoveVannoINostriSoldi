export type MunicipalOrgan = "giunta" | "consiglio";

export type MunicipalOfficesSource = Readonly<{
  id: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  lastModifiedAt: string | null;
  acquiredAt: string;
  verifiedAt: string;
  license: "CC-BY-4.0";
  licenseUrl: string;
  sha256: string;
}>;

export type MunicipalOfficeMember = Readonly<{
  organ: MunicipalOrgan;
  name: string;
  personUrl: string;
  role: string;
  membershipStartDate: string;
  membershipEndDate: string | null;
  evidenceSourceIds: readonly string[];
}>;

export type MunicipalOfficesSnapshot = Readonly<{
  schemaVersion: 1;
  municipality: Readonly<{ ipaCode: string; taxCode: string; name: string }>;
  coverage: Readonly<{
    organs: readonly MunicipalOrgan[];
    historical: false;
    verifiedAt: string;
  }>;
  sources: readonly MunicipalOfficesSource[];
  members: readonly MunicipalOfficeMember[];
}>;

const SOURCE_URLS: Readonly<Record<string, string>> = {
  giunta: "https://www.comune.mantova.it/it/unita_organizzative/giunta-comunale",
  nomina: "https://www.comune.mantova.it/it/news/la-nuova-giunta-del-comune-di-mantova",
  consiglio: "https://www.comune.mantova.it/it/unita_organizzative/consiglio-comunale",
  insediamento: "https://www.comune.mantova.it/it/news/142087/il-nuovo-consiglio-comunale-campisi-presidente",
  licenza: "https://www.comune.mantova.it/it/legal_notices",
};

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}: oggetto atteso`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field}: testo obbligatorio`);
  return value.trim();
}

function date(value: unknown, field: string): string {
  const result = text(value, field);
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error(`${field}: data non valida`);
  }
  return result;
}

function officialUrl(value: unknown, field: string): string {
  const url = text(value, field);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${field}: URL non valido`);
  }
  if (parsed.protocol !== "https:" || parsed.host !== "www.comune.mantova.it" || parsed.username || parsed.password) {
    throw new Error(`${field}: URL ufficiale non valido`);
  }
  return url;
}

export function parseMunicipalOfficesSnapshot(value: unknown): MunicipalOfficesSnapshot {
  const snapshot = record(value, "snapshot");
  if (snapshot.schemaVersion !== 1) throw new Error("schema municipal offices non riconosciuto");

  const municipality = record(snapshot.municipality, "municipality");
  if (municipality.ipaCode !== "c_e897" || municipality.taxCode !== "00189800204" || text(municipality.name, "nome Comune") !== "Comune di Mantova") {
    throw new Error("identità ufficiale del Comune pilota non valida");
  }

  const coverage = record(snapshot.coverage, "coverage");
  if (!Array.isArray(coverage.organs) || coverage.organs.length !== 2 ||
      coverage.organs[0] !== "giunta" || coverage.organs[1] !== "consiglio" || coverage.historical !== false) {
    throw new Error("copertura degli organi non riconosciuta");
  }
  const verifiedAt = date(coverage.verifiedAt, "coverage.verifiedAt");

  if (!Array.isArray(snapshot.sources) || snapshot.sources.length < 5) throw new Error("fonti obbligatorie mancanti");
  const sourceIds = new Set<string>();
  const sources = snapshot.sources.map((item, index) => {
    const source = record(item, `source[${index}]`);
    const id = text(source.id, "id fonte");
    if (sourceIds.has(id)) throw new Error("fonte duplicata");
    sourceIds.add(id);
    if (source.publisher !== "Comune di Mantova") throw new Error("titolare fonte non riconosciuto");
    const url = officialUrl(source.url, "URL fonte");
    if (url !== SOURCE_URLS[id]) throw new Error("URL fonte diverso dal registro ufficiale");
    const publishedAt = source.publishedAt === null ? null : date(source.publishedAt, "pubblicazione fonte");
    const lastModifiedAt = source.lastModifiedAt === null ? null : date(source.lastModifiedAt, "aggiornamento fonte");
    const acquiredAt = date(source.acquiredAt, "acquisizione fonte");
    const sourceVerifiedAt = date(source.verifiedAt, "verifica fonte");
    if (publishedAt && publishedAt > acquiredAt ||
        lastModifiedAt && lastModifiedAt > acquiredAt ||
        publishedAt && lastModifiedAt && lastModifiedAt < publishedAt ||
        acquiredAt > sourceVerifiedAt || sourceVerifiedAt > verifiedAt) {
      throw new Error("periodo della fonte incoerente");
    }
    if (source.license !== "CC-BY-4.0" || source.licenseUrl !== "https://www.comune.mantova.it/it/legal_notices") {
      throw new Error("licenza della fonte non verificata");
    }
    if (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) {
      throw new Error("hash della fonte non valido");
    }
    return { id, publisher: source.publisher, url, publishedAt, lastModifiedAt, acquiredAt, verifiedAt: sourceVerifiedAt, license: source.license, licenseUrl: source.licenseUrl, sha256: source.sha256 } as MunicipalOfficesSource;
  });
  if (!sourceIds.has("giunta") || !sourceIds.has("nomina") || !sourceIds.has("consiglio") || !sourceIds.has("insediamento") || !sourceIds.has("licenza")) {
    throw new Error("fonti di organi e mandato mancanti");
  }

  if (!Array.isArray(snapshot.members) || snapshot.members.length === 0) throw new Error("membri mancanti");
  const memberKeys = new Set<string>();
  const members = snapshot.members.map((item, index) => {
    const member = record(item, `member[${index}]`);
    const organ = member.organ;
    if (organ !== "giunta" && organ !== "consiglio") throw new Error("organo non riconosciuto");
    const name = text(member.name, "nome membro");
    const personUrl = officialUrl(member.personUrl, "profilo persona");
    const personAddress = new URL(personUrl);
    if (!/^\/it\/person(?:e)?\/[a-z0-9-]+\/?$/.test(personAddress.pathname) || personAddress.search || personAddress.hash) {
      throw new Error("profilo persona non ufficiale");
    }
    const key = `${organ}:${personUrl}`;
    if (memberKeys.has(key)) throw new Error("membro duplicato nello stesso organo");
    memberKeys.add(key);
    const role = text(member.role, "ruolo");
    const membershipStartDate = date(member.membershipStartDate, "inizio periodo");
    const membershipEndDate = member.membershipEndDate === null ? null : date(member.membershipEndDate, "fine periodo");
    if (membershipStartDate !== (organ === "giunta" ? "2026-06-08" : "2026-06-10") ||
        membershipStartDate > verifiedAt || membershipEndDate && membershipEndDate < membershipStartDate) {
      throw new Error("periodo del mandato incoerente");
    }
    const expectedRole = organ === "giunta"
      ? personUrl.endsWith("/murari-andrea") ? "Sindaco" : personUrl.endsWith("/sortino-chiara") ? "Vicesindaca" : "Assessore o assessora"
      : personUrl.endsWith("/campisi-matteo") ? "Presidente del Consiglio" :
        personUrl.endsWith("/grassi-maddalena") || personUrl.endsWith("/baschieri-pierluigi") ? "Vicepresidente del Consiglio" : "Componente del Consiglio";
    if (role !== expectedRole) throw new Error("ruolo non riconciliato con il comunicato ufficiale");
    if (!Array.isArray(member.evidenceSourceIds) || member.evidenceSourceIds.length === 0 ||
        member.evidenceSourceIds.some((id) => typeof id !== "string" || !sourceIds.has(id))) {
      throw new Error("fonte del membro mancante");
    }
    if (!member.evidenceSourceIds.includes(organ)) throw new Error("fonte dell'organo mancante");
    if (!member.evidenceSourceIds.includes(organ === "giunta" ? "nomina" : "insediamento")) {
      throw new Error("fonte di inizio mandato mancante");
    }
    return { organ, name, personUrl, role, membershipStartDate, membershipEndDate, evidenceSourceIds: member.evidenceSourceIds } as MunicipalOfficeMember;
  });

  if (members.filter((member) => member.organ === "giunta").length !== 10 ||
      members.filter((member) => member.organ === "consiglio").length !== 32) {
    throw new Error("copertura incompleta degli organi");
  }
  return {
    schemaVersion: 1,
    municipality: { ipaCode: "c_e897", taxCode: "00189800204", name: "Comune di Mantova" },
    coverage: { organs: ["giunta", "consiglio"], historical: false, verifiedAt },
    sources,
    members,
  };
}
