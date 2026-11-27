import "server-only";

import integratedCatalog from "@/data/generated/integrated/catalog.json";
import { AI_MAX_SITE_LINKS, isInternalSiteHref, type AiSiteLink } from "@/lib/assistant/byok-contracts";
import { STATE_CONSUNTIVO_YEAR } from "@/lib/data/state-overview-period";
import { EPEA_SECTORS, EPEA_YEARS } from "@/lib/istat-epea-view";
import type { DatasetId, DatasetQuery } from "@/lib/mcp/catalog";

type DatasetLinkResolver = readonly AiSiteLink[] | ((query: DatasetQuery) => readonly AiSiteLink[]);

const SIOPE_YEARS = new Set([2024, 2025, 2026]);
const EPEA_YEAR_SET = new Set<number>(EPEA_YEARS);
const EPEA_SECTOR_SET = new Set<string>(EPEA_SECTORS.map((item) => item.code));
const CUP_PATTERN = /^[A-Z0-9]{15}$/iu;
const OP_REF_PATTERN = /^op-[a-z0-9-]+$/iu;
// Detail pages take a code chosen by the model: only well-formed codes become a path
// segment, so free text never reaches a URL or a card title.
const IPA_CODE_PATTERN = /^[A-Za-z0-9_]{1,32}$/u;
const STP_CODE_PATTERN = /^[A-Za-z0-9-]{1,16}$/u;
const DEVICE_NUMBER_PATTERN = /^\d{1,12}$/u;
const PNRR_FILTER_PATTERNS = {
  cup: /^[A-Z0-9]{15}$/u,
  mission: /^M[1-7]$/u,
  component: /^M[1-7]C[1-9]$/u,
  measure: /^M[1-7]C[1-9][IR][0-9][A-Z0-9.]{0,14}$/u,
  submeasure: /^M[1-7]C[1-9][IR][0-9][A-Z0-9.]{0,14}$/u,
  code: /^(?:[0-9]{11}|FR[0-9]{11})$/u,
  region: /^[0-9]{3}$/u,
  province: /^[0-9]{3}$/u,
  territory: /^[0-9]{6}$/u,
} as const;

const INTEGRATED_DATASET_TITLES = new Map<string, string>(
  (integratedCatalog.datasets as readonly { id: string; title: string }[]).map((item) => [item.id, item.title]),
);

const IRPEF_LEVEL_PARAM = {
  region: "regione",
  province: "provincia",
  municipality: "comune",
} as const;

function withParams(pathname: string, entries: readonly (readonly [string, string | undefined])[]): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    const clean = value?.trim();
    if (clean) params.set(key, clean);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function validYear(value: number | undefined, allowed?: ReadonlySet<number>): string | undefined {
  if (value === undefined || !Number.isInteger(value)) return undefined;
  if (allowed && !allowed.has(value)) return undefined;
  if (value < 1990 || value > 2100) return undefined;
  return String(value);
}

function cofogPageFor(cofog: string | undefined): AiSiteLink | null {
  const code = cofog?.trim().toUpperCase();
  if (!code) return null;
  if (code.startsWith("GF01") || code.startsWith("G01")) return { href: "/spese/servizi-generali", title: "Servizi generali PA", description: "Spesa pubblica per organi istituzionali, affari generali e debito" };
  if (code.startsWith("GF02") || code.startsWith("G02")) return { href: "/spese/difesa", title: "Difesa", description: "Spesa pubblica per la difesa nella serie COFOG" };
  if (code.startsWith("GF03") || code.startsWith("G03")) return { href: "/spese/sicurezza", title: "Ordine pubblico e sicurezza", description: "Spesa pubblica per ordine pubblico e sicurezza (COFOG)" };
  if (code.startsWith("GF05") || code.startsWith("G05")) return { href: "/spese/ambiente", title: "Protezione dell’ambiente", description: "Conti ambientali e spesa per la protezione dell’ambiente" };
  if (code.startsWith("GF07") || code.startsWith("G07")) return { href: "/spese/sanita", title: "Spesa pubblica per la sanità", description: "Serie COFOG sanità e Conto Economico del SSN" };
  if (code.startsWith("GF08") || code.startsWith("G08")) return { href: "/spese/cultura", title: "Cultura e tempo libero", description: "Spesa pubblica per attività ricreative, cultura e culto" };
  if (code.startsWith("GF09") || code.startsWith("G09")) return { href: "/istruzione", title: "Atlante Istruzione", description: "Studenti, scuole e percorsi della scuola secondaria" };
  if (code.startsWith("GF1002")) return { href: "/spese/pensioni", title: "Pensioni e pensionati", description: "Prestazioni pensionistiche INPS e Casellario ISTAT" };
  return null;
}

const OPENCIVITAS_RESOLVER: DatasetLinkResolver = (query) => [{
  href: withParams("/territori/confronto", [
    ["regione", query.region?.trim().toLocaleUpperCase("it-IT")],
  ]),
  title: "Confronto Comuni e fabbisogni",
  description: "Spesa storica, spesa standard e livelli dei servizi comunali OpenCivitas",
}];

const POVERTA_LINKS: readonly AiSiteLink[] = [{
  href: "/poverta",
  title: "Povertà assoluta, relativa e AROPE",
  description: "Indicatori ufficiali ISTAT ed Eurostat per Italia, ripartizioni e Regioni",
}];

const PENSIONI_LINKS: readonly AiSiteLink[] = [{
  href: "/spese/pensioni",
  title: "Pensioni e pensionati",
  description: "Pensioni vigenti INPS e Casellario ISTAT per prestazioni e beneficiari",
}];

function companyAtlasResolver(metric: string, title: string, description: string): DatasetLinkResolver {
  return (query) => [{
    href: withParams("/imprese", [
      ["metric", metric],
      ["period", query.period],
      ["region", query.region],
      ["sector", query.sector],
      ["band", query.band],
    ]),
    title,
    description,
  }];
}

/**
 * Exhaustive mapping from every registered MCP dataset id to its best human-facing
 * DVNS page(s). Datasets without a dedicated citizen page map to an integrated
 * `/dati/...` table or an empty list — never to `/mcp`.
 */
export const DATASET_SITE_LINKS: Readonly<Record<DatasetId, DatasetLinkResolver>> = {
  siope_comuni: (query) => {
    const anno = validYear(query.year, SIOPE_YEARS);
    const regione = query.region?.trim();
    const territoryLink: AiSiteLink = {
      href: withParams("/territori", [["anno", anno], ["regione", regione]]),
      title: "Pagamenti dei Comuni per territorio",
      description: "Spesa di cassa dei Comuni per Regione, pro capite e per km²",
    };
    const spendingLink: AiSiteLink = {
      href: withParams("/spese", [["anno", anno]]),
      title: "Pagamenti comunali",
      description: "Voci di spesa, titoli SIOPE e serie mensile dei Comuni italiani",
    };
    return regione ? [territoryLink, spendingLink] : [spendingLink, territoryLink];
  },
  siope_entrate_comuni: (query) => [{
    href: withParams("/entrate", [
      ["anno", validYear(query.year, SIOPE_YEARS)],
      ["regione", query.region],
      ["q", query.query],
      ["codice", query.code],
    ]),
    title: "Incassi comunali",
    description: "Entrate di cassa SIOPE dei Comuni per anno, Regione e singolo ente",
  }],
  siope_inventario_enti: [{
    href: "/dati/siope-inventario-enti",
    title: "Inventario enti SIOPE",
    description: "Censimento nazionale degli enti SIOPE per tipologia e copertura IPA",
  }],
  siope_asl: [
    { href: "/dati/siope-uscite-asl", title: "Pagamenti SIOPE delle ASL", description: "Movimenti mensili di cassa delle aziende sanitarie locali" },
    { href: "/spese/sanita", title: "Spesa pubblica per la sanità", description: "Conto Economico SSN e quadro della spesa sanitaria pubblica" },
  ],
  siope_province: [{
    href: "/dati/siope-uscite-province",
    title: "Pagamenti SIOPE delle Province",
    description: "Movimenti mensili di cassa delle amministrazioni provinciali",
  }],
  siope_regioni: [
    { href: "/dati/siope-uscite-regioni", title: "Pagamenti SIOPE delle Regioni", description: "Movimenti mensili di cassa di Regioni e Province autonome" },
    { href: "/regioni", title: "Spese delle Regioni", description: "Composizione degli impegni regionali per amministrazione" },
  ],
  siope_citta_metropolitane: [{
    href: "/dati/siope-uscite-citta-metropolitane",
    title: "Pagamenti SIOPE delle Città metropolitane",
    description: "Movimenti mensili di cassa delle Città metropolitane",
  }],
  openbdap_spesa_stato: (query) => [{
    href: query.year === STATE_CONSUNTIVO_YEAR ? `/stato?anno=${STATE_CONSUNTIVO_YEAR}` : "/stato",
    title: "Spese dello Stato",
    description: "Pagamenti del Bilancio dello Stato per missione, amministrazione e categoria",
  }],
  openbdap_amministrazione: (query) => {
    const code = query.code?.trim();
    const stateOverview: AiSiteLink = {
      href: "/stato",
      title: "Spese dello Stato",
      description: "Pagamenti del Bilancio dello Stato per missione e amministrazione",
    };
    if (!code || !STP_CODE_PATTERN.test(code)) return [stateOverview];
    const anno = validYear(query.year);
    const mese = anno && query.month !== undefined && Number.isInteger(query.month) && query.month >= 1 && query.month <= 12
      ? String(query.month)
      : undefined;
    return [
      {
        href: withParams(`/stato/amministrazioni/${encodeURIComponent(code)}`, [["anno", anno], ["mese", mese]]),
        title: "Dettaglio amministrazione statale",
        description: "Pagamenti OpenBDAP dell’amministrazione per missione e categoria economica",
      },
      stateOverview,
    ];
  },
  openbdap_opere_pubbliche: (query) => {
    const cup = query.cup?.trim().toUpperCase();
    return [{
      href: withParams("/opere", [["cup", cup && CUP_PATTERN.test(cup) ? cup : undefined]]),
      title: "Opere pubbliche",
      description: "Costo previsto ed effettivo e stato delle opere pubbliche OpenBDAP",
    }];
  },
  openbdap_ssn_conto_economico: [{
    href: "/spese/sanita",
    title: "Spesa pubblica per la sanità",
    description: "Conto Economico SSN 2024 per ente e Regione e serie storica COFOG",
  }],
  openbdap_ssn_storico_nazionale: [
    { href: "/spese/sanita/storico", title: "Sanità · serie storica", description: "Conto Economico nazionale del SSN dal 2012 al 2024" },
    { href: "/spese/sanita", title: "Spesa pubblica per la sanità", description: "Conto Economico SSN 2024 e quadro COFOG della spesa sanitaria" },
  ],
  salute_posti_letto: [
    { href: "/spese/sanita", title: "Spesa pubblica per la sanità", description: "Posti letto ospedalieri per Regione e disciplina e spesa SSN" },
    { href: "/dati/salute-posti-letto-2023", title: "Posti letto per Regione e disciplina", description: "Tabella completa dei posti letto e reparti del Ministero della Salute" },
  ],
  salute_dispositivi_medici: (query) => {
    const listLink: AiSiteLink = {
      href: withParams("/spese/sanita/dispositivi", [["q", query.query]]),
      title: "Dispositivi medici",
      description: "Spesa sanitaria per dispositivi BD/RDM, classificazione CND e territorio",
    };
    const deviceNumber = query.deviceNumber?.trim();
    if ((query.deviceType === "1" || query.deviceType === "2") && deviceNumber && DEVICE_NUMBER_PATTERN.test(deviceNumber)) {
      return [
        {
          href: `/spese/sanita/dispositivi/${encodeURIComponent(query.deviceType)}/${encodeURIComponent(deviceNumber)}`,
          title: "Scheda dispositivo medico",
          description: "Dettaglio del dispositivo BD/RDM e spesa rilevata nelle aziende sanitarie",
        },
        listLink,
      ];
    }
    return [listLink];
  },
  openbdap_spesa_legislature: [{
    href: "/stato/legislature",
    title: "Spesa dello Stato per legislatura",
    description: "Confronto descrittivo della spesa statale per missione tra legislature",
  }],
  openbdap_legge_bilancio_storico: [
    { href: "/spese/legge-di-bilancio", title: "Legge di Bilancio", description: "Stanziamenti per missione nelle Leggi di Bilancio e simulatore" },
    { href: "/manovra", title: "Manovra a confronto", description: "Confronto delle misure e delle missioni della Legge di Bilancio" },
  ],
  opencivitas_polizia_2021: OPENCIVITAS_RESOLVER,
  opencivitas_sociale_asili_2021: OPENCIVITAS_RESOLVER,
  opencivitas_viabilita_2021: OPENCIVITAS_RESOLVER,
  opencivitas_istruzione_2022: OPENCIVITAS_RESOLVER,
  opencivitas_fabbisogni: OPENCIVITAS_RESOLVER,
  opencivitas_fabbisogni_2021: OPENCIVITAS_RESOLVER,
  opencivitas_fabbisogni_2015: OPENCIVITAS_RESOLVER,
  opencivitas_fabbisogni_2016: OPENCIVITAS_RESOLVER,
  opencivitas_fabbisogni_2017: OPENCIVITAS_RESOLVER,
  opencivitas_fabbisogni_2018: OPENCIVITAS_RESOLVER,
  opencivitas_fabbisogni_2019: OPENCIVITAS_RESOLVER,
  opencivitas_istruzione_2019: OPENCIVITAS_RESOLVER,
  opencivitas_polizia_2019: OPENCIVITAS_RESOLVER,
  opencivitas_viabilita_2019: OPENCIVITAS_RESOLVER,
  opencivitas_rifiuti_2019: OPENCIVITAS_RESOLVER,
  opencivitas_sociale_asili_2019: OPENCIVITAS_RESOLVER,
  opencivitas_amministrazione_2019: OPENCIVITAS_RESOLVER,
  opencivitas_rifiuti_2022: OPENCIVITAS_RESOLVER,
  opencivitas_rifiuti_2021: OPENCIVITAS_RESOLVER,
  opencivitas_viabilita_2022: OPENCIVITAS_RESOLVER,
  opencivitas_amministrazione_2021: OPENCIVITAS_RESOLVER,
  opencivitas_amministrazione_2022: OPENCIVITAS_RESOLVER,
  opencivitas_istruzione_2021: OPENCIVITAS_RESOLVER,
  opencivitas_sociale_asili_2022: OPENCIVITAS_RESOLVER,
  opencivitas_polizia_2022: OPENCIVITAS_RESOLVER,
  opencoesione_progetti: [{
    href: "/coesione",
    title: "Coesione e PNRR",
    description: "Progetti, costi pubblici e pagamenti dei fondi di coesione",
  }],
  opencup_progetto: [{
    href: "/opere",
    title: "Opere pubbliche",
    description: "Monitoraggio e ricerca delle opere pubbliche per codice CUP",
  }],
  pnrr_asili: (query) => {
    const catalogLink: AiSiteLink = {
      href: withParams("/coesione/asili", [
        ["q", query.query],
        ["regione", query.region],
        ["provincia", query.province],
      ]),
      title: "Asili e prima infanzia (PNRR)",
      description: "Progetti PNRR per asili e scuole dell’infanzia, gare e aggiudicazioni",
    };
    const cup = query.cup?.trim().toUpperCase();
    if (cup && CUP_PATTERN.test(cup)) {
      return [
        { href: `/progetti/${encodeURIComponent(cup)}`, title: `Progetto CUP ${cup}`, description: "Scheda documentale del progetto PNRR" },
        catalogLink,
      ];
    }
    return [catalogLink];
  },
  pnrr_progetti: (query) => {
    const entries: [string, string | undefined][] = [];
    for (const [key, pattern] of Object.entries(PNRR_FILTER_PATTERNS) as [keyof typeof PNRR_FILTER_PATTERNS, RegExp][]) {
      const value = query[key]?.trim().toUpperCase();
      if (value && pattern.test(value)) entries.push([key, value]);
    }
    return [{
      href: withParams("/pnrr", entries),
      title: "Tutti i progetti PNRR",
      description: "Catalogo nazionale ReGiS per missione, misura, attuatore e territorio",
    }];
  },
  anac_cig_snapshot: [{
    href: "/appalti",
    title: "Appalti pubblici",
    description: "CIG 2025, procedure di affidamento e fasce di importo ANAC",
  }],
  anac_operatori: (query) => {
    const searchLink: AiSiteLink = {
      href: withParams("/appalti/operatori", [["q", query.query]]),
      title: "Imprese aggiudicatarie",
      description: "Indice storico nazionale degli operatori economici aggiudicatari ANAC",
    };
    const code = query.code?.trim();
    if (code && OP_REF_PATTERN.test(code)) {
      return [
        { href: `/appalti/operatori/${encodeURIComponent(code)}`, title: "Scheda impresa aggiudicataria", description: "Storico delle aggiudicazioni e dei CIG attribuiti all’operatore" },
        searchLink,
      ];
    }
    return [searchLink];
  },
  consip_ordini: (query) => query.channel === "mepa"
    ? [
        { href: "/appalti/mepa", title: "MePA e bandi Consip", description: "Metadati open data dei bandi e strumenti Consip" },
        { href: "/appalti", title: "Appalti pubblici", description: "Panoramica su contratti, gare e fornitori della PA" },
      ]
    : [
        { href: "/appalti/fornitori", title: "Fornitori e aggiudicatari", description: "Fornitori aggregati e aggiudicazioni Consip" },
        { href: "/appalti", title: "Appalti pubblici", description: "Panoramica su contratti, gare e fornitori della PA" },
      ],
  eurostat_cofog: (query) => {
    const specific = cofogPageFor(query.cofog);
    return [
      ...(specific ? [specific] : []),
      { href: "/spese/panoramica", title: "Spesa pubblica", description: "Composizione della spesa PA per funzione COFOG e confronti territoriali" },
      { href: "/esplora/serie", title: "Confronta serie ufficiali", description: "Serie storiche Eurostat COFOG e conti della pubblica amministrazione" },
    ];
  },
  eurostat_conti_pa: [
    { href: "/spese/panoramica", title: "Spesa pubblica", description: "Quadro della spesa della pubblica amministrazione e serie ufficiali" },
    { href: "/esplora/serie", title: "Confronta serie ufficiali", description: "Serie storiche Eurostat su entrate, uscite e saldo della PA" },
  ],
  inps_invalidita_civile: [{
    href: "/spese/invalidita",
    title: "Invalidità civile INPS",
    description: "Spesa nazionale, prestazioni vigenti e nuove pensioni per Regione",
  }],
  inps_pensioni_vigenti: PENSIONI_LINKS,
  istat_pensioni_prestazioni: PENSIONI_LINKS,
  istat_cofog: (query) => {
    const specific = cofogPageFor(query.cofog);
    return [
      ...(specific ? [specific] : []),
      { href: "/spese/panoramica", title: "Spesa pubblica", description: "Quadro della spesa della pubblica amministrazione per funzione" },
    ];
  },
  istat_epea: (query) => [{
    href: withParams("/spese/ambiente", [
      ["anno", validYear(query.year, EPEA_YEAR_SET)],
      ["settore", query.sector && EPEA_SECTOR_SET.has(query.sector.trim()) ? query.sector.trim() : undefined],
    ]),
    title: "Protezione dell’ambiente",
    description: "Conti ISTAT EPEA sulla spesa per la protezione dell’ambiente per settore e classe CEPA",
  }],
  istat_poverta_assoluta: POVERTA_LINKS,
  istat_poverta_relativa: POVERTA_LINKS,
  istat_poverta_soglia_assoluta: POVERTA_LINKS,
  istat_poverta_soglia_relativa: POVERTA_LINKS,
  istat_poverta_regioni: POVERTA_LINKS,
  eurostat_arope: POVERTA_LINKS,
  // Datasets currently published via API/MCP without a dedicated citizen page.
  istat_bes_economico: [],
  istat_bes_salute: [],
  istat_bes_istruzione: [],
  istat_bes_lavoro: [],
  istat_bes_relazioni: [],
  istat_bes_politica: [],
  istat_bes_sicurezza: [],
  istat_bes_paesaggio: [],
  istat_bes_servizi: [],
  istat_bes_ambiente: [],
  istat_bes_innovazione: [],
  inps_naspi: [],
  inps_assegno_unico: [],
  inps_integrazioni_salariali: [],
  inps_cig_fondi_solidarieta: [],
  inl_vigilanza: [],
  aifa_farmaci_spesa: [{
    href: "/spese/sanita",
    title: "Spesa pubblica per la sanità",
    description: "Conto Economico SSN, spesa sanitaria pubblica e serie storica",
  }],
  mef_irpef_dettaglio: [
    { href: "/territori/irpef", title: "Redditi IRPEF", description: "Dichiarazioni dei redditi e imposta netta MEF per territorio" },
    { href: "/disuguaglianza", title: "Disuguaglianza dei redditi", description: "Distribuzione dei redditi, indice di Gini e confronti territoriali" },
  ],
  mef_iva: [],
  eu_vat_gap_italy: [],
  istat_permessi_costruire: [{
    href: "/edilizia",
    title: "Permessi di costruire",
    description: "Serie nazionali ISTAT 2015–2025 su fabbricati, abitazioni e volumi",
  }],
  mef_tax_gap_nazionale: [],
  eurostat_taxag: [],
  eurostat_sha_health: [{
    href: "/spese/sanita",
    title: "Spesa pubblica per la sanità",
    description: "Spesa sanitaria SHA Eurostat, COFOG e Conto Economico SSN",
  }],
  istat_pensionati_persone: PENSIONI_LINKS,
  cpt_finanza_regionale: [{
    href: "/territori/fisco",
    title: "Entrate e spese pubbliche per territorio",
    description: "Conti Pubblici Territoriali (CPT): entrate, spese e saldo per Regione",
  }],
  mef_irpef_comunale: (query) => [{
    href: withParams("/territori/irpef", [
      ["livello", query.level ? IRPEF_LEVEL_PARAM[query.level] : undefined],
      ["regione", query.region],
      ["provincia", query.province],
      ["codice", query.code],
      ["q", query.query],
    ]),
    title: "Redditi e IRPEF per territorio",
    description: "Contribuenti, redditi, imposta netta dichiarata e addizionali MEF",
  }],
  ipa_enti: (query) => {
    const registryLink: AiSiteLink = {
      href: withParams("/enti", [["q", query.query]]),
      title: "Registro degli enti pubblici",
      description: "Cerca enti pubblici nell’Indice PA per nome, tipologia e dati collegati",
    };
    const code = query.code?.trim();
    if (code && IPA_CODE_PATTERN.test(code)) {
      return [
        { href: `/enti/${encodeURIComponent(code)}`, title: "Scheda dell’ente", description: "Dati anagrafici IPA e informazioni collegate all’ente pubblico" },
        registryLink,
      ];
    }
    return [registryLink];
  },
  ipa_struttura: (query) => {
    const registryLink: AiSiteLink = {
      href: "/enti",
      title: "Registro degli enti pubblici",
      description: "Cerca enti pubblici e strutture organizzative nell’Indice PA",
    };
    const code = query.code?.trim();
    return code && IPA_CODE_PATTERN.test(code)
      ? [{ href: `/enti/${encodeURIComponent(code)}`, title: "Scheda dell’ente", description: "Struttura organizzativa e uffici registrati nell’Indice PA" }, registryLink]
      : [registryLink];
  },
  mef_partecipazioni: [{
    href: "/partecipazioni",
    title: "Partecipazioni pubbliche",
    description: "Aggregati della rilevazione annuale MEF sulle società partecipate",
  }],
  consulenti_incarichi: [
    { href: "/incarichi", title: "Incarichi pubblici", description: "Quadro nazionale annuale di incarichi esterni e ai dipendenti pubblici" },
    { href: "/spese/consulenze", title: "Consulenze ministeriali", description: "Voci di bilancio RGS per consulenze e collaborazioni" },
  ],
  consulenti_incarichi_territori: (query) => [{
    href: withParams("/incarichi/territori", [["anno", validYear(query.year)]]),
    title: "Incarichi esterni per territorio",
    description: "Compensi erogati per incarichi esterni ripartiti per territorio delle PA",
  }],
  parlamento_bilanci: [
    { href: "/parlamento", title: "Parlamento", description: "Bilanci, atti e trasparenza di Camera dei deputati e Senato" },
    { href: "/parlamento/indennita", title: "Indennità e salari", description: "Indennità, diarie e rimborsi dei parlamentari" },
  ],
  controlli_segnali: [
    { href: "/controlli", title: "Segnali da controllare", description: "Indicatori, screening e piste di verifica sui dati pubblici" },
    { href: "/controlli/sintesi", title: "Sintesi dei controlli", description: "Quadro sintetico delle anomalie e delle verifiche aperte" },
  ],
  debito_pubblico_italiano: [{
    href: "/debito",
    title: "Debito pubblico",
    description: "Stock Maastricht, composizione, detentori, vita residua e interessi",
  }],
  registro_fonti: [
    { href: "/fonti", title: "Elenco fonti", description: "Fonti ufficiali collegate, proprietari, cadenza e ultimi aggiornamenti" },
    { href: "/fonti/stato", title: "Stato delle fonti", description: "Salute, freschezza e stato di aggiornamento delle fonti pubbliche" },
  ],
  spesa_pa_dettaglio: (query) => {
    const code = query.code?.trim();
    const title = code ? INTEGRATED_DATASET_TITLES.get(code) : undefined;
    if (code && title) {
      return [{
        href: withParams(`/dati/${encodeURIComponent(code)}`, [["q", query.query]]),
        title: title.slice(0, 120),
        description: "Esplora righe, filtri e fonti verificate nel catalogo dati DVNS",
      }];
    }
    return [{
      href: "/dati",
      title: "Catalogo dati",
      description: "Dataset integrati su affidamenti, incarichi, personale e trasparenza",
    }];
  },
  company_active_enterprises: companyAtlasResolver(
    "active_enterprises",
    "Atlante Imprese · imprese attive",
    "Sedi di impresa attive per Regione e settore ATECO",
  ),
  company_workforce: companyAtlasResolver(
    "employees",
    "Atlante Imprese · addetti",
    "Addetti e localizzazioni attive delle imprese per Regione e settore",
  ),
  company_production_value_bands: companyAtlasResolver(
    "production_value_band_count",
    "Atlante Imprese · valore della produzione",
    "Distribuzione delle imprese per fascia di valore della produzione",
  ),
  company_turnover_istat: companyAtlasResolver(
    "turnover",
    "Atlante Imprese · fatturato (ISTAT)",
    "Fatturato aggregato delle imprese per Regione e macro-settore",
  ),
  education_students_by_pathway: (query) => [{
    href: withParams("/istruzione", [
      ["period", query.period],
      ["region", query.region],
      ["schoolType", query.schoolType],
      ["pathway", query.pathway],
    ]),
    title: "Atlante Istruzione",
    description: "Studenti della scuola secondaria per Regione, tipo di scuola e indirizzo",
  }],
};

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Normalizes a candidate page; rejects anything outside the public, human-facing site. */
export function cleanSiteLink(link: AiSiteLink): AiSiteLink | null {
  if (!isInternalSiteHref(link.href)) return null;
  if (link.href.startsWith("/mcp") || link.href.startsWith("/api/") || link.href.startsWith("/assistente")) return null;
  const title = clip(link.title.trim(), 120);
  if (!title) return null;
  const description = link.description ? clip(link.description.trim(), 240) : "";
  return description ? { href: link.href, title, description } : { href: link.href, title };
}

export function linksForDatasetQuery(query: DatasetQuery): AiSiteLink[] {
  const resolver = DATASET_SITE_LINKS[query.dataset];
  const raw = typeof resolver === "function" ? resolver(query) : resolver;
  return raw.map(cleanSiteLink).filter((item): item is AiSiteLink => item !== null).slice(0, AI_MAX_SITE_LINKS);
}

export function sitePathname(href: string): string {
  return href.split(/[?#]/u, 1)[0] || "/";
}

/** Two links are the same page unless they open a different /imprese metric view. */
export function sitePageKey(href: string): string {
  const pathname = sitePathname(href);
  if (pathname !== "/imprese") return pathname;
  const metric = new URLSearchParams(href.split("?")[1] ?? "").get("metric");
  return metric ? `${pathname}?metric=${metric}` : pathname;
}
