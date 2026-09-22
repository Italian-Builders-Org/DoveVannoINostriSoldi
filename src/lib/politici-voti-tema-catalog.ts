/**
 * Themes are a DVNS reading aid: they group final votes by matching official act
 * titles. They are not an official Camera/Senato taxonomy.
 */
export type VoteThemeDefinition = {
  id: string;
  label: string;
  description: string;
  needles: readonly string[];
};

export const VOTE_THEMES: readonly VoteThemeDefinition[] = [
  {
    id: "lavoro",
    label: "Lavoro e professioni",
    description: "Lavoro, professioni, start-up e compensi professionali.",
    needles: ["lavoro", "professioni", "professionale", "professionali", "compenso", "start-up", "startup", "imprenditoria", "occupazione"],
  },
  {
    id: "sicurezza",
    label: "Sicurezza",
    description: "Sicurezza, ordine pubblico e contrasto di illeciti.",
    needles: ["sicurezza", "ordine pubblico", "illecita", "illecito"],
  },
  {
    id: "sanita",
    label: "Sanità",
    description: "Assistenza sanitaria, prevenzione e salute.",
    needles: ["sanit", "salute", "obesit", "mototerapia", "diagnostico"],
  },
  {
    id: "istruzione",
    label: "Istruzione e scuola",
    description: "Scuola, università, educazione e dispersione scolastica.",
    needles: ["scuola", "scolastic", "istruzion", "universit", "educativ", "insegnamento"],
  },
  {
    id: "giustizia",
    label: "Giustizia",
    description: "Codice penale, procedura e giustizia contabile.",
    needles: ["giustiz", "codice penale", "procedura penale", "prescriz"],
  },
  {
    id: "parita",
    label: "Parità e violenza di genere",
    description: "Parità, violenza sessuale, femminicidio e discriminazioni.",
    needles: ["parit", "donne", "femminicidio", "violenza sessuale", "discriminaz"],
  },
  {
    id: "ambiente",
    label: "Ambiente e territorio",
    description: "Ambiente, paesaggio, riciclo e interporti.",
    needles: ["ambiente", "paesaggio", "riciclo", "interport", "clima"],
  },
  {
    id: "europa",
    label: "Europa e ratifiche",
    description: "Ratifiche, adesioni e rapporti internazionali.",
    needles: ["ratifica", "adesione", "convenzione", "accordo tra la repubblica", "europe"],
  },
] as const;
