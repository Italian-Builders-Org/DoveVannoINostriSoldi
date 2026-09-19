import type { GiudiziarioCase } from "@/lib/data/parlamento-giudiziario-contract";
import type { RepublicProfile } from "@/lib/politici-repubblica";
import { isSafeExternalUrl } from "@/app/politici/atlas-model";

export type Resource<T> = { status: "idle" | "loading"; } | { status: "error"; } | { status: "ready"; data: T; };
export type JudicialPayload = {
  byPerson: Record<string, GiudiziarioCase[]>;
  coverageNote: string;
};
export type NewsArticle = { title: string; url: string; source: string; publishedAt: string | null; };
export type NewsConnection = {
  person: { id: string; name: string; chamber: string | null; groupId: string | null; groupLabel: string | null; };
  articleCount: number;
  articleUrls: string[];
};
export type NewsData = {
  articles: NewsArticle[];
  connections: NewsConnection[];
  observedAt: string | null;
  provider: { id: string; name: string; url: string; note: string; } | null;
};

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const optionalText = (value: unknown): boolean => value === null || text(value);
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const count = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;
const invalid = (): never => { throw new Error("Risposta del servizio non valida"); };

/** Validate the fields rendered by the client; a broken response is never an empty success. */
export function parseProfiles(payload: unknown): Record<string, RepublicProfile> {
  if (!object(payload) || !object(payload.profiles)) return invalid();
  for (const profile of Object.values(payload.profiles)) {
    if (!object(profile) || !text(profile.firstName) || !text(profile.lastName) || !text(profile.biography)
      || !["photoCredit", "groupLabel", "componentLabel", "groupRoleLabel", "constituency", "college", "profession", "birthDate", "birthPlace"].every((key) => optionalText(profile[key]))
      || !texts(profile.departmentIds) || !texts(profile.organLabels)
      || !Array.isArray(profile.roles) || !profile.roles.every((role) => object(role) && text(role.label) && optionalText(role.organLabel) && optionalText(role.since))
      || !Array.isArray(profile.officialPages) || !profile.officialPages.every((page) => object(page) && text(page.label) && isSafeExternalUrl(page.url))
      || !(profile.socialLinks === null || (object(profile.socialLinks) && Object.values(profile.socialLinks).every(isSafeExternalUrl)))
      || !object(profile.education) || !text(profile.education.label) || !["stem", "health", "legal", "economic", "humanities_social", "other", "undeclared"].includes(String(profile.education.area))
      || !optionalText(profile.education.evidence)) return invalid();
    const attendance = profile.voteAttendance;
    if (attendance !== null && (!object(attendance)
      || !["votesCast", "missions", "presenceTotal", "absences", "justifiedAbsences", "rank", "rankedAmong"].every((key) => count(attendance[key]))
      || !["periodLabel", "observedDate", "sourceLabel", "votesCastPercent", "missionsPercent", "presencePercent", "absencesPercent", "justifiedAbsencesPercent"].every((key) => text(attendance[key]))
      || !isSafeExternalUrl(attendance.sourceUrl))) return invalid();
  }
  return payload.profiles as Record<string, RepublicProfile>;
}

export function parseNews(payload: unknown): NewsData {
  if (!object(payload) || payload.ok !== true || !Array.isArray(payload.articles) || !Array.isArray(payload.connections)
    || !optionalText(payload.observedAt)
    || !payload.articles.every((article) => object(article) && text(article.title) && text(article.source) && isSafeExternalUrl(article.url) && optionalText(article.publishedAt))
    || !payload.connections.every((connection) => object(connection) && object(connection.person)
      && text(connection.person.id) && text(connection.person.name)
      && ["chamber", "groupId", "groupLabel"].every((key) => optionalText((connection.person as Record<string, unknown>)[key]))
      && count(connection.articleCount) && Array.isArray(connection.articleUrls) && connection.articleUrls.every(isSafeExternalUrl))) return invalid();
  if (payload.provider !== null && (!object(payload.provider)
    || !text(payload.provider.id) || !text(payload.provider.name) || !text(payload.provider.note) || !isSafeExternalUrl(payload.provider.url))) return invalid();
  return { articles: payload.articles, connections: payload.connections, observedAt: payload.observedAt, provider: payload.provider } as NewsData;
}

export function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function requestDeadline(parent: AbortSignal, milliseconds: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Tempo di attesa superato", "TimeoutError")), milliseconds);
  return {
    signal: controller.signal, dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    }
  };
}

export async function loadProfiles(signal: AbortSignal): Promise<Record<string, RepublicProfile>> {
  const request = requestDeadline(signal, 15_000);
  try {
    request.signal.throwIfAborted();
    const response = await fetch("/api/politici/profili", { signal: request.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseProfiles(await response.json());
  } finally { request.dispose(); }
}

export async function loadNews(personId: string, signal: AbortSignal, retryDelay = 2400): Promise<NewsData> {
  const request = requestDeadline(signal, 35_000);
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      request.signal.throwIfAborted();
      const response = await fetch(`/api/politici/${encodeURIComponent(personId)}/news`, { signal: request.signal, headers: { Accept: "application/json" } });
      const payload: unknown = await response.json();
      if (response.ok && object(payload) && payload.ok === true) return parseNews(payload);
      if (object(payload) && payload.retry === true && attempt < 2) {
        await waitForRetry(retryDelay, request.signal);
        continue;
      }
      throw new Error(`Notizie non disponibili (HTTP ${response.status})`);
    }
    throw new Error("Notizie non disponibili");
  } finally { request.dispose(); }
}

export function parseJudicial(payload: unknown): JudicialPayload {
  if (!object(payload) || payload.ok !== true || !text(payload.coverageNote) || !object(payload.byPerson)) return invalid();
  for (const cases of Object.values(payload.byPerson)) {
    if (!Array.isArray(cases)) return invalid();
    for (const item of cases) {
      if (!object(item) || !text(item.caseId) || !text(item.title) || !text(item.statusLabel)
        || !text(item.statusAsOf) || !text(item.offence) || !text(item.outcomeBucket)
        || !Array.isArray(item.events) || !Array.isArray(item.sources)) return invalid();
      if (!item.sources.every((source) => object(source) && text(source.publisher) && isSafeExternalUrl(source.url))) return invalid();
    }
  }
  return {
    coverageNote: payload.coverageNote,
    byPerson: payload.byPerson as Record<string, GiudiziarioCase[]>,
  };
}

export async function loadJudicial(signal: AbortSignal): Promise<JudicialPayload> {
  const request = requestDeadline(signal, 15_000);
  try {
    request.signal.throwIfAborted();
    const response = await fetch("/api/politici/giudiziario", { signal: request.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseJudicial(await response.json());
  } finally { request.dispose(); }
}
