/**
 * Deterministic education/profession area labels from official Camera/Senato/Governo notes.
 * Never invents a field when the source is silent: undeclared stays first-class (#549).
 */

export const EDUCATION_AREAS = [
  "stem",
  "health",
  "legal",
  "economic",
  "humanities_social",
  "other",
  "undeclared",
] as const;

export type EducationArea = (typeof EDUCATION_AREAS)[number];

export type EducationClassification = {
  area: EducationArea;
  label: string;
  evidence: string | null;
  matchedRule: string | null;
  sourceField: "profession" | "biography" | "none";
};

export type EducationAreaStat = {
  area: EducationArea;
  label: string;
  count: number;
  shareOfTotal: number;
  shareOfDeclared: number | null;
};

export type EducationDistribution = {
  total: number;
  declared: number;
  undeclared: number;
  stemCount: number;
  stemShareOfTotal: number;
  stemShareOfDeclared: number | null;
  caveat: string;
  areas: EducationAreaStat[];
};

const AREA_LABELS: Record<EducationArea, string> = {
  stem: "STEM",
  health: "Sanità e salute",
  legal: "Giuridica",
  economic: "Economica e aziendale",
  humanities_social: "Umanistica e sociale",
  other: "Altra / mista",
  undeclared: "Non dichiarata",
};

/** Ordered rules: first match wins. Patterns are case-insensitive substrings on normalized text. */
const RULES: Array<{ area: Exclude<EducationArea, "undeclared">; id: string; patterns: RegExp[] }> = [
  {
    area: "health",
    id: "health-degree",
    patterns: [
      /\b(medicina|medico|chirurg|odontoiatr|farmacia|farmacist|infermier|ostetric|veterinar|psicolog|psicoterapeut)/i,
    ],
  },
  {
    area: "stem",
    id: "stem-degree",
    patterns: [
      /\b(ingegner|matematic|fisic(?!a\s+e\s+politic)|chimic|biolog|biotecnolog|informati|computer\s*science|statisti|geolog|agronom|scienze?\s+(ambientali|naturali|della\s+terra)|architett)/i,
    ],
  },
  {
    area: "legal",
    id: "legal-degree",
    patterns: [/\b(giurisprudenz|avvocat|notar(?:io|ia|i)?|magistrat|giurist)/i],
  },
  {
    area: "economic",
    id: "economic-degree",
    patterns: [
      /\b(econom|commerci|aziendal|ragionier|commercialist|finanza|management|amministrazione)/i,
    ],
  },
  {
    area: "humanities_social",
    id: "humanities-degree",
    patterns: [
      /\b(filosof|letter|storia|scienze?\s+politic|relazioni\s+internazionali|diplomatic|sociolog|comunicaz|giornalis|pedagog|scienze?\s+della\s+formazione|antropolog|beni\s+culturali)/i,
    ],
  },
];

const DECLARED_HINT =
  /\b(laurea|diploma|dottorato|master|licenza|perito|istituto\s+tecnico|liceo|formazione|professione|avvocat|ingegner|medico|imprenditor|insegnante|docente)/i;

export function educationAreaLabel(area: EducationArea): string {
  return AREA_LABELS[area];
}

/** Prefer the explicit profession note; fall back to the «Formazione o note professionali» clause in biographies. */
export function extractEducationSourceText(
  profession: string | null | undefined,
  biography: string | null | undefined,
): { text: string; sourceField: EducationClassification["sourceField"] } {
  const note = (profession ?? "").trim();
  if (note.length > 0) return { text: note, sourceField: "profession" };

  const bio = (biography ?? "").trim();
  if (!bio) return { text: "", sourceField: "none" };

  const marker = /formazione\s+o\s+note\s+professionali\s*:\s*/i;
  const match = marker.exec(bio);
  if (match) {
    const slice = bio.slice(match.index + match[0].length).trim();
    if (slice.length > 0) return { text: slice, sourceField: "biography" };
  }

  return { text: "", sourceField: "none" };
}

export function classifyEducation(
  profession: string | null | undefined,
  biography: string | null | undefined,
): EducationClassification {
  const { text, sourceField } = extractEducationSourceText(profession, biography);
  if (!text) {
    return {
      area: "undeclared",
      label: AREA_LABELS.undeclared,
      evidence: null,
      matchedRule: null,
      sourceField: "none",
    };
  }

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return {
          area: rule.area,
          label: AREA_LABELS[rule.area],
          evidence: text,
          matchedRule: rule.id,
          sourceField,
        };
      }
    }
  }

  if (DECLARED_HINT.test(text)) {
    return {
      area: "other",
      label: AREA_LABELS.other,
      evidence: text,
      matchedRule: "declared-other",
      sourceField,
    };
  }

  return {
    area: "undeclared",
    label: AREA_LABELS.undeclared,
    evidence: text,
    matchedRule: null,
    sourceField,
  };
}

export function buildEducationDistribution(
  people: Array<{ profession: string | null; biography: string }>,
): EducationDistribution {
  const counts = Object.fromEntries(EDUCATION_AREAS.map((area) => [area, 0])) as Record<EducationArea, number>;
  for (const person of people) {
    counts[classifyEducation(person.profession, person.biography).area] += 1;
  }

  const total = people.length;
  const undeclared = counts.undeclared;
  const declared = total - undeclared;
  const stemCount = counts.stem;
  const areas: EducationAreaStat[] = EDUCATION_AREAS.map((area) => ({
    area,
    label: AREA_LABELS[area],
    count: counts[area],
    shareOfTotal: total === 0 ? 0 : counts[area] / total,
    shareOfDeclared: declared === 0 || area === "undeclared" ? null : counts[area] / declared,
  }));

  return {
    total,
    declared,
    undeclared,
    stemCount,
    stemShareOfTotal: total === 0 ? 0 : stemCount / total,
    stemShareOfDeclared: declared === 0 ? null : stemCount / declared,
    caveat:
      "Classificazione deterministica sulle note ufficiali di studi/professione (Camera, Senato, Governo). Non è un CV completo: «non dichiarata» resta uno stato distinto. STEM include ingegneria, matematica, fisica, chimica, biologia, informatica, statistica, geologia, agraria, architettura; medicina e farmacia sono in «Sanità e salute».",
    areas,
  };
}

export function formatPercent(share: number | null): string {
  if (share === null) return "n.d.";
  return `${(share * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
}
