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

function buildSearchIndex() {
  return getMunicipalitySearchEntities().map((entity) => ({
    codiceIpa: entity.codiceIpa,
    name: entity.denominazione,
    taxCode: entity.codiceFiscale ?? "",
    normalizedName: normalizeSearch(entity.denominazione),
    normalizedDisplayName: normalizeSearch(displayMunicipalityName(entity.denominazione)),
    normalizedCode: normalizeSearch(entity.codiceIpa),
  }));
}

// Build only for an actual search; the committed snapshot stays fixed per instance.
let searchIndex: ReturnType<typeof buildSearchIndex> | undefined;

/** Lightweight municipal name search for `/api/comuni/search` (no profile / corpus imports). */
export function searchComuni(query: string, limit = 12): readonly ComuniSearchHit[] {
  const needle = normalizeSearch(query);
  if (needle.length < 2) return [];
  const hits = [];
  for (const entry of (searchIndex ??= buildSearchIndex())) {
    if (!entry.normalizedName.includes(needle) && !entry.normalizedCode.includes(needle)) continue;
    const name = entry.normalizedDisplayName;
    const rank = name === needle ? 0
      : name.startsWith(needle + " ") ? 1
      : name.startsWith(needle) ? 2 : 3;
    hits.push({ entry, rank });
  }
  return hits
    .sort((left, right) => left.rank - right.rank || left.entry.name.localeCompare(right.entry.name, "it"))
    .slice(0, limit)
    .map(({ entry }) => ({
      codiceIpa: entry.codiceIpa,
      name: entry.name,
      province: null,
      region: null,
      taxCode: entry.taxCode,
    }));
}
