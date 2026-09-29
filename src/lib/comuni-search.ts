import "server-only";

import { getMunicipalitySearchEntities } from "@/lib/siope-municipality-detail";

export type ComuniSearchHit = Readonly<{
  codiceIpa: string;
  name: string;
  province: string | null;
  region: string | null;
  taxCode: string;
}>;

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function displayMunicipalityName(name: string): string {
  const trimmed = name.trim().replace(/^comune di\s+/i, "");
  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (/^(di|de|del|della|dei|delle|dello|da|e|ed|in|sul|sulla)$/i.test(word)) {
        return word.toLocaleLowerCase("it-IT");
      }
      if (/^[A-Z]'/i.test(word) && word.length > 2) {
        return word.charAt(0).toLocaleUpperCase("it-IT")
          + word.charAt(1)
          + word.slice(2).toLocaleLowerCase("it-IT");
      }
      return word.charAt(0).toLocaleUpperCase("it-IT") + word.slice(1).toLocaleLowerCase("it-IT");
    })
    .join(" ");
}

/** Lightweight municipal name search for `/api/comuni/search` (no profile / corpus imports). */
export function searchComuni(query: string, limit = 12): readonly ComuniSearchHit[] {
  const needle = normalizeSearch(query);
  if (needle.length < 2) return [];
  const hits: ComuniSearchHit[] = [];
  for (const entity of getMunicipalitySearchEntities()) {
    const hay = normalizeSearch(entity.denominazione);
    if (!hay.includes(needle) && !normalizeSearch(entity.codiceIpa).includes(needle)) continue;
    hits.push({
      codiceIpa: entity.codiceIpa,
      name: entity.denominazione,
      province: null,
      region: null,
      taxCode: entity.codiceFiscale ?? "",
    });
  }
  return hits
    .sort((left, right) => {
      const leftExact = normalizeSearch(displayMunicipalityName(left.name)) === needle ? 0 : 1;
      const rightExact = normalizeSearch(displayMunicipalityName(right.name)) === needle ? 0 : 1;
      if (leftExact !== rightExact) return leftExact - rightExact;
      const leftStarts = normalizeSearch(displayMunicipalityName(left.name)).startsWith(needle) ? 0 : 1;
      const rightStarts = normalizeSearch(displayMunicipalityName(right.name)).startsWith(needle) ? 0 : 1;
      if (leftStarts !== rightStarts) return leftStarts - rightStarts;
      return left.name.localeCompare(right.name, "it");
    })
    .slice(0, limit);
}
