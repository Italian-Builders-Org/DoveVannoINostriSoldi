import { z } from "zod";

import chronologyRegistry from "../../scripts/etl/specs/government-scorecard-chronology.json";

const EXPECTED_GOVERNMENTS = [
  ["dini-i", "Dini I", "1995-01-17", "historical"],
  ["prodi-i", "Prodi I", "1996-05-18", "historical"],
  ["dalema-i", "D'Alema I", "1998-10-21", "historical"],
  ["dalema-ii", "D'Alema II", "1999-12-22", "historical"],
  ["amato-ii", "Amato II", "2000-04-26", "historical"],
  ["berlusconi-ii", "Berlusconi II", "2001-06-11", "historical"],
  ["berlusconi-iii", "Berlusconi III", "2005-04-23", "historical"],
  ["prodi-ii", "Prodi II", "2006-05-17", "historical"],
  ["berlusconi-iv", "Berlusconi IV", "2008-05-08", "historical"],
  ["monti-i", "Monti I", "2011-11-16", "historical"],
  ["letta-i", "Letta I", "2013-04-28", "historical"],
  ["renzi-i", "Renzi I", "2014-02-22", "historical"],
  ["gentiloni-i", "Gentiloni I", "2016-12-12", "appointments"],
  ["conte-i", "Conte I", "2018-06-01", "appointments"],
  ["conte-ii", "Conte II", "2019-09-05", "appointments"],
  ["draghi-i", "Draghi I", "2021-02-13", "appointments"],
  ["meloni-i", "Meloni I", "2022-10-22", "meloni"],
] as const;

const SOURCE_URLS = {
  historical: "https://archivio.quirinale.it/comunicati/Quaderno-comunicati-16-marzo.pdf",
  appointments: "https://www.quirinale.it/it/pagine/nomine-presidente-sergio-mattarella",
  meloni: "https://www.quirinale.it/it/notizie/cerimonia-giuramento-governo-meloni-3",
} as const;

const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data ISO attesa")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, "data ISO valida attesa");

const governmentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  startDate: isoDate,
  sourceOwner: z.literal("Presidenza della Repubblica"),
  sourceUrl: z.url(),
  sourceLocator: z.string().trim().min(30),
}).strict();

export const governmentScorecardV6ChronologyRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  registryVersion: z.literal("quirinale-government-oaths-v1"),
  verifiedAt: isoDate,
  asOfDate: isoDate,
  eventDefinition: z.literal("Giuramento del Presidente del Consiglio e dei ministri nelle mani del Presidente della Repubblica"),
  constitutionalSourceUrl: z.literal("https://www.senato.it/istituzione/la-costituzione/parte-ii/titolo-iii/sezione-i/articolo-93"),
  governments: z.array(governmentSchema).min(EXPECTED_GOVERNMENTS.length),
}).strict().superRefine((registry, context) => {
  if (registry.verifiedAt < registry.asOfDate || new Set(registry.governments.map((government) => government.id)).size !== registry.governments.length) {
    context.addIssue({ code: "custom", message: "date del registro o identita duplicate", path: ["governments"] });
  }
  registry.governments.forEach((government, index) => {
    const expected = EXPECTED_GOVERNMENTS[index];
    if (!expected) {
      const source = new URL(government.sourceUrl);
      if (source.protocol !== "https:" || source.host !== "www.quirinale.it" || source.username || source.password
        || !source.pathname.startsWith("/it/notizie/") || source.pathname.length <= "/it/notizie/".length
        || source.search || source.hash || government.startDate > registry.asOfDate) {
        context.addIssue({ code: "custom", message: "nuovo giuramento: fonte o data non verificabile", path: ["governments", index] });
      }
    }
    if (
      expected && (government.id !== expected[0]
      || government.name !== expected[1]
      || government.startDate !== expected[2]
      || government.sourceUrl !== SOURCE_URLS[expected[3]])
    ) {
      context.addIssue({
        code: "custom",
        message: "governo, data o fonte divergente dal registro Quirinale verificato",
        path: ["governments", index],
      });
    }
    if (index > 0 && government.startDate <= registry.governments[index - 1]!.startDate) {
      context.addIssue({
        code: "custom",
        message: "date di giuramento duplicate o non crescenti",
        path: ["governments", index, "startDate"],
      });
    }
    if (!government.sourceLocator.includes(government.startDate.slice(0, 4))) {
      context.addIssue({
        code: "custom",
        message: "locator privo dell'anno del giuramento",
        path: ["governments", index, "sourceLocator"],
      });
    }
  });
});

export type GovernmentScorecardV6ChronologyRegistry = z.infer<typeof governmentScorecardV6ChronologyRegistrySchema>;

export class GovernmentScorecardV6ChronologyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GovernmentScorecardV6ChronologyError";
  }
}

export function parseGovernmentScorecardV6ChronologyRegistry(
  input: unknown,
): GovernmentScorecardV6ChronologyRegistry {
  const result = governmentScorecardV6ChronologyRegistrySchema.safeParse(input);
  if (!result.success) {
    throw new GovernmentScorecardV6ChronologyError("registro cronologia v6 non valido", { cause: result.error });
  }
  return result.data;
}

export const GOVERNMENT_SCORECARD_V6_REGISTRY = parseGovernmentScorecardV6ChronologyRegistry(chronologyRegistry);

export const GOVERNMENT_SCORECARD_V6_CHRONOLOGY = GOVERNMENT_SCORECARD_V6_REGISTRY.governments.map(
  (government, index, governments) => ({
    id: government.id,
    name: government.name,
    start_date: government.startDate,
    end_exclusive: governments[index + 1]?.startDate ?? null,
    status: index === governments.length - 1 ? "current" as const : "ended" as const,
    source_owner: government.sourceOwner,
    source_url: government.sourceUrl,
    source_locator: government.sourceLocator,
  }),
);

export type GovernmentScorecardV6GovernmentId = typeof GOVERNMENT_SCORECARD_V6_CHRONOLOGY[number]["id"];
