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
  openbdap_ssn_conto_economico:
    "Il dato nazionale e quelli regionali provengono da rilasci ufficiali distinti dal dettaglio per ente; le righe di consolidamento non sono mostrate per evitare doppi conteggi. Le voci sono categorie contabili: non equivalgono a gettonisti, cooperative, organico o pagamenti di cassa e non consentono classifiche di efficienza o giudizi sulla qualità sanitaria.",
  istat_poverta_assoluta:
    "Non è spesa pubblica: sono incidenze, intensità e conteggi, da non sommare né accostare a pagamenti, bilanci o redditi IRPEF. Incidenza, intensità e composizione hanno unità diverse; famiglie e individui sono denominatori distinti. Solo i conteggi si sommano fra territori, e Nord e Mezzogiorno contengono già le loro parti. La serie corrente parte dal 2014 e non va unita a quelle precedenti. ISTAT non pubblica la povertà per Comune; il dato non misura l’efficacia di una manovra né la responsabilità di un governo.",
  istat_poverta_relativa:
    "La povertà relativa misura la distanza dalla spesa media delle famiglie, quella assoluta il costo di un paniere di beni essenziali: sono definizioni diverse e non vanno sommate né confrontate. Non è spesa pubblica. Incidenza, intensità e composizione hanno unità diverse; famiglie e individui sono denominatori distinti. Solo i conteggi si sommano fra territori, e Nord e Mezzogiorno contengono già le loro parti. La serie corrente parte dal 2014; ISTAT non pubblica la povertà per Comune.",
  istat_poverta_soglia_assoluta:
    "È la spesa mensile sotto la quale una famiglia è considerata in povertà assoluta: non è spesa pubblica e non va sommata né confrontata con le incidenze di povertà. Cambia con il tipo di famiglia e l’ampiezza del Comune. Le celle vuote indicano un dato non disponibile, non uno zero; Nord e Mezzogiorno contengono già le loro parti.",
  istat_poverta_soglia_relativa:
    "È la spesa mensile sotto la quale una famiglia è considerata in povertà relativa: non è spesa pubblica e non va sommata né confrontata con le incidenze o con la soglia assoluta. È disponibile solo per l’Italia nel complesso; il 2021 non è incluso.",
  istat_poverta_regioni:
    "È un’incidenza percentuale di povertà relativa, non un importo: non si somma fra territori, e sommare le Regioni non ricostruisce l’Italia. L’incidenza della povertà assoluta non è pubblicata per Regione. Celle non diffuse o assenti nella fonte non valgono zero; per Bolzano manca il dato sulle famiglie.",
  eurostat_arope:
    "Indicatore europeo di rischio di povertà o esclusione sociale: non è spesa pubblica e non coincide con la povertà assoluta o relativa ISTAT, quindi non va sommato né confrontato con essa. Riguarda solo l’Italia; percentuali e migliaia di persone non si sommano fra loro.",
  istat_bes_salute:
    "Ogni indicatore mantiene definizione, unità e periodo propri: anni di vita attesi, valori per 1.000 nati vivi o tassi per 10.000 residenti. Totale, donne e uomini sono serie distinte; un dato non disponibile non vale zero. Dati provinciali, non comunali, con confini che cambiano nel tempo. Non misura spesa, livelli di assistenza o efficienza: nessuna somma, media ricostruita, classifica o indice composito.",
  istat_bes_istruzione:
    "Percentuali e tassi con denominatori propri: non è spesa pubblica né una misura di qualità o efficienza. Nessuna somma fra territori o fra donne e uomini, nessuna stima per Comune e nessuna classifica. Un dato non disponibile non vale zero. Le prove INVALSI mancano per il 2020; tassi di partecipazione sopra il 100% sono valori ufficiali. I confini provinciali cambiano nel tempo.",
  istat_bes_lavoro:
    "Occupazione, mancata partecipazione, giornate retribuite e infortuni hanno denominatori distinti: non sono spesa pubblica, non si sommano e non formano un indice. Donne, uomini e totale restano serie separate; un dato non disponibile non vale zero. Dati provinciali, non comunali, con confini variabili. Nessuna classifica, causalità politica o giudizio sulla sicurezza di una singola impresa.",
  istat_bes_relazioni:
    "Scuole accessibili e organizzazioni non profit per 10.000 abitanti hanno denominatori distinti: non sono spesa pubblica, non si sommano e non formano un indice. Un dato non disponibile non vale zero. Dati provinciali, non comunali, con confini variabili; nessuna classifica.",
  istat_bes_sicurezza:
    "Delitti per 100.000 abitanti e mortalità stradale hanno denominatori distinti: non sono spesa per ordine pubblico, non si sommano e non formano un indice. Un dato non disponibile non vale zero. Dati provinciali, non comunali, con confini variabili; nessuna classifica.",
  istat_bes_ambiente:
    "Concentrazioni, percentuali, metri quadrati e chilogrammi per abitante hanno unità distinte: non sono spesa pubblica, non si sommano e non formano un indice. Un dato non disponibile non vale zero. Dati provinciali.",
  mef_iva:
    "Importi dichiarati, non gettito riscosso né spesa pubblica. Importi, frequenze e numero di contribuenti non si sommano fra loro, e i totali ufficiali non si sommano alle righe di dettaglio. Le celle oscurate o mancanti non valgono zero. Le classificazioni delle attività cambiano fra i due anni: non è una serie omogenea.",
  eu_vat_gap_italy:
    "Stima del divario fra l’IVA teorica e quella incassata: non è evasione accertata né un dato delle dichiarazioni MEF o dei conti ISTAT. Il 2024 è una stima preliminare; le celle senza valore non sono osservate.",
  anac_operatori:
    "Indice storico cross-temporale: non dichiara la popolazione nazionale corrente. Gli importi rappresentano aggiudicazioni dichiarate, non pagamenti o incassi; il valore è attribuito solo agli affidamenti con operatore unico. Le classifiche sono descrittive e non provano irregolarità.",
};

const API_ONLY_SENTENCE =
  /(?:GET\s+\/api\/|\/api\/|\bMCP\b|\bpayload\b|\bcursor\b|\boffset\b|\blimit\b|Specificare almeno un filtro|pagine di massimo \d+ righe|Il campo [a-zA-Z_]+|campi Cents|UNIT_MEAS|OBS_VALUE|dataMode|matchedRows|Accesso al corpus|\b(?:code|family|band|measure|territory)\s*=|territory omesso|Solo SEX=T|Licenza\s+(?:del payload\s+|zip\s+)?(?:not-declared|non dichiarata)|^(?:Importi|Valori) in (?:centesimi|decimi)(?:\s+da milioni di euro)?\.?$|\bflag [a-z/]+ resta(?:no)? null|\bcodeSsn=|\b\d{2}_\d{3}\b|in (?:centesimi|decimi|milionesimi)\b|Nessuna cella n\/g|I riferimenti op-)/iu;

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
