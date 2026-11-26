import type { DatasetId } from "@/lib/mcp/catalog";

/**
 * Citizen-facing caveats for chat answers. Catalog caveats target MCP/API agents
 * (endpoints, payload fields, pagination tokens); the chat keeps the substantive
 * accounting limits while dropping protocol instructions. MCP output is untouched.
 */
const CURATED_PUBLIC_CAVEATS: Partial<Record<DatasetId, string>> = {
  siope_comuni:
    "Pagamenti di cassa SIOPE dei Comuni, distinti dal bilancio di competenza e dai servizi ricevuti. I totali nazionali includono tutti i Comuni riconosciuti in SIOPE; gli aggregati regionali coprono soltanto quelli abbinati tramite IPA, dichiarando separatamente gli enti non regionalizzati. Le misure per abitante o per km² sono descrittive e non misurano efficienza, qualità o fabbisogno.",
  siope_entrate_comuni:
    "Incassi di cassa SIOPE, distinti da accertamenti ed entrate di competenza. Il 2026 può essere parziale. Non rappresentano un saldo di bilancio, un residuo fiscale o una classifica di efficienza. Gli incassi dei Comuni senza abbinamento regionale IPA restano inclusi nel totale nazionale; trasferimenti e partite di giro non sono consolidati.",
  openbdap_ssn_storico_nazionale:
    "Serie storica a livello nazionale: il dettaglio regionale e per singolo ente del SSN è disponibile soltanto per il 2024. Sono voci di conto economico (competenza economica), non pagamenti di cassa; non identificano gettonisti, cooperative o organico e non consentono classifiche di efficienza tra anni o Regioni.",
  openbdap_legge_bilancio_storico:
    "Stanziamenti di competenza del primo anno pubblicati dalla Legge di Bilancio, non pagamenti effettivi né misure della manovra. Gli importi sono in euro correnti, non corretti per l’inflazione. Ricerca e innovazione comprende anche enti non universitari ed è distinta da Istruzione universitaria; il dataset completo include il rimborso lordo del debito pubblico.",
  pnrr_progetti:
    "Il finanziamento assegnato non è un pagamento osservato; il soggetto attuatore può avere sede diversa dal territorio in cui si realizza l’intervento. Il catalogo include anche progetti non ancora validati e uno stesso codice CUP può comparire in più registrazioni.",
  spesa_pa_dettaglio:
    "Importi mancanti e zeri osservati restano distinti. Segnali, confronti e documenti mancanti sono piste di verifica e non dimostrano automaticamente spreco o illecito.",
  consulenti_incarichi_territori:
    "I dati sono ripartiti per territorio delle amministrazioni conferenti, non rappresentano il solo bilancio delle Giunte regionali e non vanno sommati alle consulenze ministeriali RGS. L’anno più recente è parziale.",
  eurostat_conti_pa:
    "Competenza economica SEC 2010: non sono incassi né pagamenti di cassa, quindi non si confrontano con SIOPE e non si sommano a CPT, OpenBDAP o COFOG. I totali sono quelli pubblicati dalla fonte e riconciliano con le componenti entro il solo arrotondamento.",
  istat_pensioni_prestazioni:
    "Il denominatore è il numero di prestazioni pensionistiche, non il numero di persone. Gli importi sono lordi e nominali; i totali per categoria possono differire dal totale generale di poche migliaia di euro per arrotondamento della fonte. Non è sommabile con il numero di pensionati né con l’invalidità civile INPS.",
  istat_pensionati_persone:
    "Il denominatore è il numero di persone pensionate, non il numero di prestazioni. Gli importi sono lordi e nominali. Non è sommabile con le prestazioni pensionistiche né con l’invalidità civile INPS.",
  anac_operatori:
    "Indice storico cross-temporale: non dichiara la popolazione nazionale corrente. Gli importi rappresentano aggiudicazioni dichiarate, non pagamenti o incassi; il valore è attribuito solo agli affidamenti con operatore unico. Le classifiche sono descrittive e non provano irregolarità.",
};

const API_ONLY_SENTENCE =
  /(?:GET\s+\/api\/|\/api\/|\bMCP\b|\bpayload\b|\bcursor\b|\boffset\b|\blimit\b|Specificare almeno un filtro|pagine di massimo \d+ righe|Il campo [a-zA-Z_]+|campi Cents|UNIT_MEAS|OBS_VALUE|dataMode|matchedRows|Accesso al corpus|\b(?:code|family|band|measure|territory)\s*=|territory omesso|Solo SEX=T|Licenza\s+(?:del payload\s+|zip\s+)?(?:not-declared|non dichiarata)|^(?:Importi|Valori) in (?:centesimi|decimi)(?:\s+da milioni di euro)?\.?$|^(?:Il )?flag [a-z/]+ restano? null|Nessuna cella n\/g|I riferimenti op-)/iu;

export function humanizeAssistantCaveat(datasetId: DatasetId, rawCaveat?: string): string | undefined {
  const curated = CURATED_PUBLIC_CAVEATS[datasetId];
  if (curated) return curated;
  if (!rawCaveat?.trim()) return undefined;
  const kept = rawCaveat
    .trim()
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && !API_ONLY_SENTENCE.test(sentence));
  return kept.length ? kept.join(" ") : undefined;
}
