import * as z from "zod/v4";
import { ACTIVE_DATASET_IDS } from "@/lib/mcp/catalog";

export const datasetQuerySchema = z.object({
  dataset: z.enum(ACTIVE_DATASET_IDS).describe("Identificativo restituito da list_datasets."),
  year: z.number().int().min(2000).max(2100)
    .describe("Anno di riferimento a quattro cifre, solo se dichiarato tra i filtri del dataset.")
    .optional(),
  month: z.number().int().min(1).max(12)
    .describe("Mese di riferimento da 1 a 12; richiede anche year e un dataset che supporti month.")
    .optional(),
  query: z.string().max(200)
    .describe("Testo libero da cercare nel dataset, con significato e copertura indicati nel catalogo.")
    .optional(),
  region: z.string().max(200)
    .describe("Nome o codice della Regione accettato dal dataset selezionato, massimo 200 caratteri.")
    .optional(),
  province: z.string().max(200)
    .describe("Nome, sigla o codice provinciale accettato dal dataset selezionato, massimo 200 caratteri.")
    .optional(),
  level: z.enum(["region", "province", "municipality"])
    .describe("Livello territoriale della risposta: region, province oppure municipality.")
    .optional(),
  detail: z.enum(["summary", "income-sources", "income-bands", "all"])
    .describe("Dettaglio IRPEF: summary, income-sources, income-bands oppure all.")
    .optional(),
  code: z.string().max(100)
    .describe("Codice identificativo richiesto dal dataset, per esempio codice IPA o ISTAT; anac_operatori richiede op-######## dallo snapshot.")
    .optional(),
  cup: z.string().max(64)
    .describe("Codice Unico di Progetto: gli spazi esterni vengono rimossi prima della validazione esatta a 15 caratteri.")
    .optional(),
  area: z.string().max(100)
    .describe("Area tematica usata dai dataset che espongono classificazioni o segnali di controllo.")
    .optional(),
  chamber: z.enum(["camera", "senato"])
    .describe("Ramo del Parlamento: camera oppure senato.")
    .optional(),
  channel: z.enum(["convenzioni", "mepa"])
    .describe("Canale di acquisto Consip: convenzioni oppure mepa.")
    .optional(),
  country: z.string().max(12)
    .describe("Codice paese o aggregato Eurostat, per esempio IT, DE oppure EU27_2020.")
    .optional(),
  territory: z.string().max(8)
    .describe("Codice territoriale ISTAT, per esempio IT, ITF3 oppure ITCDE.")
    .optional(),
  table: z.string().max(40)
    .describe("Id della tabella pubblicata dal dataset selezionato, per esempio beneficiari_02.")
    .optional(),
  family: z.string().max(20)
    .describe("Famiglia di misure del dataset selezionato, per esempio tipo_reddito o bonus_irpef.")
    .optional(),
  breakdown: z.string().max(20)
    .describe("Taglio dimensionale del dataset selezionato, per esempio regione, classeEta o sesso.")
    .optional(),
  measure: z.string().max(20)
    .describe("Misura richiesta dal dataset selezionato, per esempio beneficiari oppure trattamenti; anac_operatori accetta awardCount o attributedValue.")
    .optional(),
  cofog: z.string().max(8)
    .describe("Funzione COFOG: per Eurostat TOTAL o GF01…GF10; per ISTAT il totale G oppure una divisione da G010 a G100.")
    .optional(),
  period: z.string().max(20)
    .describe("Periodo dichiarato dal dataset, per esempio 2026-07-31 o 2026-Q2.")
    .optional(),
  sex: z.enum(["F", "M", "T"])
    .describe("Modalità di sesso per i dataset che la espongono: F, M oppure T (totale, che NON è la somma di F e M).")
    .optional(),
  sector: z.string().max(20)
    .describe("Codice della sezione ATECO accettato dal dataset selezionato.")
    .optional(),
  band: z.string().max(30)
    .describe("Codice della fascia di valore della produzione, solo per il dataset che la dichiara.")
    .optional(),
  years: z.number().int().min(2).max(20)
    .describe("Numero di Leggi di Bilancio più recenti da restituire, da 2 a 20, solo per il dataset che lo dichiara.")
    .optional(),
  component: z.string().max(8).describe("Componente PNRR esatta, per esempio M1C1; solo pnrr_progetti.").optional(),
  submeasure: z.string().max(24).describe("Codice univoco submisura PNRR, per esempio M1C1I1.01.00; solo pnrr_progetti.").optional(),
  mission: z.string().min(1).max(200)
    .describe("Codice esatto in pnrr_progetti (es. M1); nome esatto della missione in openbdap_legge_bilancio_storico, per esempio Ricerca e innovazione oppure Istruzione universitaria e formazione post-universitaria.")
    .optional(),
  schoolType: z.string().max(30)
    .describe("Tipo di scuola del dataset istruzione: state, paritaria oppure all.")
    .optional(),
  pathway: z.string().max(80)
    .describe("Codice o etichetta del percorso di studio del dataset istruzione.")
    .optional(),
  limit: z.number().int().min(1).max(100)
    .describe("Numero massimo di record da restituire, da 1 a 100, solo per dataset che supportano limit.")
    .optional(),
  offset: z.number().int().min(0).max(100_000)
    .describe("Numero di record da saltare, da 0 a 100000, solo per dataset che supportano offset.")
    .optional(),
  cursor: z.string().max(512)
    .describe("Cursore opaco restituito dalla pagina precedente, solo per dataset che dichiarano cursor.")
    .optional(),
}).strict();
