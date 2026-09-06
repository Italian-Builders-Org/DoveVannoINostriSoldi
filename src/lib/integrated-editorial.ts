export type EditorialFact = Readonly<{
  value: string;
  label: string;
  note: string;
}>;

export type EditorialDatasetPreview = Readonly<{
  id: string;
  label: string;
  catalogBoundary?: string;
  columns?: readonly Readonly<{
    key: string;
    label: string;
  }>[];
}>;

export type EditorialSurfacePreview = Readonly<{
  surface: "/partecipazioni";
  title: string;
  description: string;
  datasets: readonly EditorialDatasetPreview[];
}>;

export type EditorialTopic = Readonly<{
  section: "appalti" | "incarichi" | "spese" | "controlli" | "trasparenza" | "confronti";
  slug: string;
  title: string;
  description: string;
  introduction: string;
  status: "Fatto documentato" | "Dato mancante" | "Richiede una spiegazione";
  primaryMetric: string;
  primaryLabel: string;
  hubSummary: string;
  facts: readonly EditorialFact[];
  readingNotes: readonly string[];
  datasets: readonly EditorialDatasetPreview[];
}>;

export const EDITORIAL_TOPICS: readonly EditorialTopic[] = [
  {
    section: "appalti",
    slug: "affidamenti-diretti",
    title: "Affidamenti diretti e CIG",
    description: "Singoli affidamenti, copertura di importi e contraenti, CIG ministeriali e autorità.",
    introduction: "Dal catalogo generale degli appalti al singolo atto: qui si vede che cosa è già collegato e dove importo, destinatario o documento puntuale mancano ancora.",
    status: "Fatto documentato",
    primaryMetric: "6.506",
    primaryLabel: "affidamenti diretti censiti",
    hubSummary: "Importi, contraenti e link agli atti, con una vista separata sui CIG di ministeri e autorità.",
    facts: [
      { value: "6.484", label: "CIG presenti e unici", note: "22 righe non hanno un CIG utilizzabile." },
      { value: "2.445", label: "importi conosciuti", note: "37,58% del catalogo; il totale parziale è 113.976.638,61 €." },
      { value: "1.696", label: "candidati completi", note: "CIG, importo, contraente e URL presenti insieme." },
      { value: "658", label: "URL riutilizzati", note: "Spesso indicano una pagina-indice, non necessariamente l’atto puntuale." },
      { value: "2.391", label: "righe CIG aggiuntive", note: "C3, C8, Consip/OpenCUP e seed restano un working set separato e non additivo." },
      {
        value: "17.265",
        label: "istanze procurement row-level",
        note: "Sei insiemi supplementari; l’indice MIMIT da 2.794 righe resta separato e nessuno di questi conteggi forma un totale di contratti.",
      },
    ],
    readingNotes: [
      "Le 1.437 date al primo gennaio possono rappresentare un anno noto, non il giorno esatto.",
      "Un URL presente è una pista documentale: va distinto fra atto puntuale e pagina generale.",
      "Un affidamento diretto è una procedura prevista dall’ordinamento; non è da solo prova di inefficienza.",
      "I cataloghi aggiuntivi possono sovrapporsi per CIG o atto: sono esplorabili, ma non producono un totale da sommare al catalogo principale.",
    ],
    datasets: [
      {
        id: "affidamenti-diretti",
        label: "Affidamenti diretti",
        columns: [
          { key: "ente", label: "Ente" },
          { key: "oggetto", label: "Oggetto" },
          { key: "importo", label: "Importo" },
          { key: "contraente", label: "Contraente" },
          { key: "cig", label: "CIG" },
        ],
      },
      {
        id: "cig-ministeri",
        label: "CIG ministeri e PCM",
        columns: [
          { key: "ente", label: "Ente" },
          { key: "cig", label: "CIG" },
          { key: "aggiudicatario", label: "Aggiudicatario" },
          { key: "importo_euro", label: "Importo" },
          { key: "data", label: "Data" },
        ],
      },
      {
        id: "cig-autorita",
        label: "CIG autorità",
        columns: [
          { key: "ente", label: "Ente" },
          { key: "cig", label: "CIG" },
          { key: "aggiudicatario", label: "Aggiudicatario" },
          { key: "importo_euro", label: "Importo" },
          { key: "data", label: "Data" },
        ],
      },
      { id: "cig-aggiudicatari-extra", label: "CIG aggiuntivi da riconciliare" },
      { id: "procurement-atti-mimit", label: "Atti di acquisto MIMIT" },
      {
        id: "procurement-indici-mimit",
        label: "Indici e provvedimenti MIMIT",
        catalogBoundary: "L’indice mescola pagine di elenco e atti: prima di esporre righe omogenee vanno separati i due livelli documentali.",
      },
      { id: "procurement-affidamenti-c1-extra", label: "Affidamenti centrali aggiuntivi" },
      { id: "procurement-difesa-direzioni", label: "Affidamenti delle direzioni della Difesa" },
      { id: "procurement-difesa-procedimenti", label: "Procedimenti della Difesa" },
      {
        id: "procurement-partecipate",
        label: "Affidamenti delle società partecipate",
        catalogBoundary: "I tre lotti descrivono affidamenti, non quote societarie; prima di un totale vanno deduplicati per CIG e atto rispetto agli altri cataloghi.",
      },
      {
        id: "procurement-mimit-dork",
        label: "Atti MIMIT emersi dalla ricerca documentale",
        catalogBoundary: "I riferimenti sono piste verso atti, non nuovi contratti già deduplicati: CIG e URL vanno riconciliati con gli altri insiemi MIMIT prima di esporre una seconda serie.",
      },
    ],
  },
  {
    section: "appalti",
    slug: "fornitori",
    title: "Fornitori e aggiudicatari",
    description: "Fornitori aggregati, gruppi societari e aggiudicazioni Consip, senza classifiche oltre la copertura disponibile.",
    introduction: "Questa vista segue i destinatari economici dei contratti e rende visibile quanta parte del catalogo dispone davvero di importo, denominazione e collegamento documentale.",
    status: "Fatto documentato",
    primaryMetric: "682",
    primaryLabel: "aggregati fornitore-settore",
    hubSummary: "Destinatari, concentrazione e aggiudicazioni Consip, con copertura esplicita degli importi.",
    facts: [
      { value: "489", label: "aggregati con importo zero", note: "Zero osservato e dato mancante non vanno confusi." },
      { value: "120", label: "collegamenti fornitore-CIG", note: "Il sottoinsieme più puntuale fra contratto e aggiudicatario." },
      { value: "3.867", label: "righe Consip", note: "Aggiudicazioni 2024, 2025 e 2026 conservate per anno." },
      {
        value: "1.028.559",
        label: "righe negli snapshot Consip",
        note: "Amministrazioni, gare, operatori e partecipazioni sono strati diversi e non formano un totale di contratti.",
      },
    ],
    readingNotes: [
      "Le classifiche descrivono soltanto il sottoinsieme con destinatario e importo disponibili.",
      "Gruppo societario e singola ragione sociale restano dimensioni distinte.",
      "Gli anni Consip non vengono sommati come se fossero un’unica gara.",
      "I join Consip sono strumenti di riconciliazione: una riga priva di fornitore rende visibile un limite di copertura, non un’aggiudicazione attribuibile.",
    ],
    datasets: [
      {
        id: "vincitori",
        label: "Fornitori per settore e importo",
        columns: [
          { key: "ragione_sociale", label: "Fornitore" },
          { key: "settore_cpv", label: "Settore" },
          { key: "enti_committenti", label: "Enti committenti" },
          { key: "importo_totale", label: "Importo totale" },
        ],
      },
      {
        id: "gruppi-vincitori",
        label: "Gruppi societari",
        catalogBoundary: "L’appartenenza a un gruppo richiede riconciliazione dell’identità legale: il name matching da solo non basta a esporre attribuzioni row-level.",
        columns: [
          { key: "gruppo", label: "Gruppo" },
          { key: "ragione_sociale", label: "Fornitore" },
          { key: "importo_euro", label: "Importo" },
          { key: "fonte_url", label: "Fonte" },
        ],
      },
      { id: "consip-ranking", label: "Classifica Consip (derivata)" },
      { id: "consip-winners-2024", label: "Aggiudicatari Consip 2024" },
      { id: "consip-winners-2025", label: "Aggiudicatari Consip 2025" },
      { id: "consip-winners-2026", label: "Aggiudicatari Consip 2026" },
      { id: "vincitori-cig", label: "Collegamenti fornitore-CIG" },
      { id: "consip-contratti-riconciliati", label: "Contratti Consip riconciliati" },
      {
        id: "consip-snapshot-strutturati",
        label: "Snapshot strutturati Consip",
        catalogBoundary: "I file hanno schemi, anni e granularità differenti; alcuni download sono parziali. Restano censiti senza convertirli in un’unica tabella di aggiudicazioni.",
      },
    ],
  },
  {
    section: "appalti",
    slug: "rinnovi-proroghe",
    title: "Rinnovi, proroghe e incarichi ripetuti",
    description: "Sequenze temporali documentate per fornitori e persone, senza inferire irregolarità dalla sola ripetizione.",
    introduction: "Le sequenze aiutano a capire durata effettiva e ripetizione degli affidamenti. Ogni cluster rimanda agli atti disponibili e conserva il tipo attribuito nella sorgente.",
    status: "Richiede una spiegazione",
    primaryMetric: "440",
    primaryLabel: "cluster temporali",
    hubSummary: "Timeline di rinnovi, proroghe e incarichi multipli, con atti e durata da verificare.",
    facts: [
      { value: "159", label: "rinnovi", note: "Classificazione presente nel working set." },
      { value: "38", label: "proroghe", note: "Da leggere con durata e motivazione dell’atto." },
      { value: "243", label: "incarichi multipli", note: "La ripetizione non dimostra da sola un’anomalia." },
      { value: "1.125", label: "atti dichiarati", note: "Numero di riferimenti indicati nei 440 cluster." },
    ],
    readingNotes: [
      "Gli importi annuali sono disponibili solo per 9 cluster e non consentono un totale generale.",
      "La timeline mostra una sequenza; la valutazione richiede oggetto, durata, procedura e motivazione.",
    ],
    datasets: [{
      id: "rinnovi-proroghe",
      label: "Rinnovi e proroghe",
      columns: [
        { key: "ente", label: "Ente" },
        { key: "nome", label: "Nominativo" },
        { key: "tipo", label: "Tipo" },
        { key: "n_atti", label: "Atti" },
        { key: "periodi", label: "Periodo" },
      ],
    }],
  },
  {
    section: "appalti",
    slug: "consip-da-confrontare",
    title: "Acquisti da rendere confrontabili",
    description: "Contratti raccolti per un confronto Consip che oggi non dispongono di SKU o modello omogeneo.",
    introduction: "Questa pagina non pubblica sovrapprezzi: mostra perché il confronto è bloccato e quale informazione servirebbe per renderlo difendibile.",
    status: "Dato mancante",
    primaryMetric: "207",
    primaryLabel: "contratti non confrontabili",
    hubSummary: "Una coda di verifica, non una classifica di sovrapprezzi: mancano modello o SKU omogenei.",
    facts: [
      { value: "0", label: "SKU confrontabili", note: "Nessun record supera oggi il gate di comparabilità." },
      { value: "191", label: "senza modello o SKU", note: "Il prodotto non è identificato con precisione sufficiente." },
      { value: "16", label: "modello senza SKU catalogo", note: "Esiste un modello, ma non il riferimento omogeneo nel catalogo." },
      { value: "20", label: "importi conosciuti", note: "Copertura del 9,66%; non viene calcolato alcun sovrapprezzo." },
    ],
    readingNotes: [
      "Un acquisto non confrontabile non è automaticamente fuori convenzione né inefficiente.",
      "Per un confronto servono stesso modello, specifiche, quantità, servizi inclusi, periodo e base IVA.",
    ],
    datasets: [{
      id: "fuori-consip",
      label: "Candidati a confronto Consip",
      columns: [
        { key: "ente", label: "Ente" },
        { key: "oggetto", label: "Oggetto" },
        { key: "cig", label: "CIG" },
        { key: "importo", label: "Importo" },
        { key: "motivo_non_confrontabile", label: "Perché non confrontabile" },
      ],
    }],
  },
  {
    section: "incarichi",
    slug: "consulenze-legali",
    title: "Consulenze legali",
    description: "Incarichi legali con ente, professionista o studio, oggetto, anno, importo e fonte quando disponibili.",
    introduction: "È uno dei nuclei più completi del materiale: la pagina separa gli incarichi documentati dai buchi informativi e rende leggibile la copertura economica.",
    status: "Fatto documentato",
    primaryMetric: "352",
    primaryLabel: "righe su 30 enti",
    hubSummary: "Incarichi legali con copertura dell’importo elevata e collegamenti agli atti disponibili.",
    facts: [
      { value: "323", label: "importi conosciuti", note: "Circa il 91,8% delle righe." },
      { value: "3.261.822,68 €", label: "totale parziale parseabile", note: "Somma del solo sottoinsieme con importo leggibile." },
      { value: "11", label: "buchi informativi", note: "Sono assenze documentali, non incarichi." },
    ],
    readingNotes: [
      "La somma non include le righe senza importo e non stima i valori mancanti.",
      "Un incarico legale documentato non costituisce da solo inefficienza o danno.",
    ],
    datasets: [{
      id: "consulenze-legali",
      label: "Consulenze legali",
      columns: [
        { key: "ente", label: "Ente" },
        { key: "nome_studio", label: "Studio o professionista" },
        { key: "oggetto", label: "Oggetto" },
        { key: "anno", label: "Anno" },
        { key: "importo", label: "Importo" },
      ],
    }],
  },
  {
    section: "incarichi",
    slug: "pnrr",
    title: "Consulenze e incarichi PNRR",
    description: "Strato nominativo e strato contabile CE3 conservati separatamente.",
    introduction: "Il materiale contiene due rappresentazioni incompatibili: incarichi nominativi da Amministrazione Trasparente e aggregati contabili. La pagina li affianca senza sommarli.",
    status: "Fatto documentato",
    primaryMetric: "213",
    primaryLabel: "record nei due strati",
    hubSummary: "Incarichi nominativi e capitoli CE3 affiancati, mai sommati come se misurassero la stessa cosa.",
    facts: [
      { value: "159", label: "record nominativi", note: "Incarichi osservati in Amministrazione Trasparente." },
      { value: "54", label: "aggregati CE3", note: "Capitoli contabili, non persone o contratti individuali." },
      { value: "195", label: "righe con importo", note: "157 nominative e 38 contabili, da tenere separate." },
    ],
    readingNotes: [
      "I due strati non hanno la stessa unità di osservazione e non producono un totale unico.",
      "La vista INDIRE già verificata sul sito resta un perimetro specifico distinto.",
    ],
    datasets: [{
      id: "consulenze-pnrr",
      label: "Consulenze PNRR",
      columns: [
        { key: "strato", label: "Strato" },
        { key: "ente", label: "Ente" },
        { key: "nome_o_ditta", label: "Nominativo o ditta" },
        { key: "oggetto", label: "Oggetto" },
        { key: "importo", label: "Importo" },
      ],
    }],
  },
  {
    section: "incarichi",
    slug: "nominativi",
    title: "Nominativi, incarichi e curriculum",
    description: "Incarichi nominativi, collaboratori aggiuntivi e confronti fra CV e incarico.",
    introduction: "Questa vista collega persone, ruoli, durata, compenso e documentazione disponibile, mantenendo separati i confronti curriculari dai fatti contrattuali.",
    status: "Fatto documentato",
    primaryMetric: "1.633",
    primaryLabel: "incarichi nominativi curati",
    hubSummary: "Persone, ruoli, compensi e CV: il fatto contrattuale resta distinto dalla valutazione dell’esperienza.",
    facts: [
      { value: "137", label: "collaboratori aggiuntivi", note: "Working set distinto dal catalogo nominativo principale." },
      { value: "139", label: "confronti CV-incarico", note: "Candidati alla verifica, non giudizi automatici di idoneità." },
      { value: "2.812", label: "righe preparate per card", note: "Materiale derivato conservato come tale." },
      {
        value: "626",
        label: "righe nei frammenti collaboratori",
        note: "Solo 7 coincidono con il finale da 137 righe; le 619 restanti sono un working set da riconciliare, non persone da aggiungere automaticamente.",
      },
      { value: "159.493", label: "relazioni fra atti e parti", note: "Autorizzanti, destinatari e fonti in quattro insiemi non additivi." },
      { value: "39.685", label: "righe negli shard nominativi", note: "Varianti e lotti di lavoro restano distinti dal master curato di 1.633 righe." },
      { value: "1.191", label: "righe o sezioni da completare", note: "Copertura mancante e record incompleti sono mostrati come tali." },
    ],
    readingNotes: [
      "La presenza o assenza di una voce nel CV non sostituisce la verifica dei requisiti dell’avviso.",
      "Durata, compenso e ruolo vanno confrontati nello stesso perimetro e anno.",
      "Master, shard e ledger delle parti possono descrivere lo stesso incarico con grani diversi: i conteggi non formano un totale di persone o di spesa.",
      "Gli incarichi extra-ruolo autorizzati possono essere pagati da soggetti terzi e non rappresentano automaticamente spesa dell’ente del dipendente.",
    ],
    datasets: [
      {
        id: "nominativi-incarichi",
        label: "Nominativi e incarichi",
        columns: [
          { key: "ente", label: "Ente" },
          { key: "nome", label: "Nominativo" },
          { key: "oggetto", label: "Incarico" },
          { key: "dal", label: "Dal" },
          { key: "importo_totale", label: "Compenso totale" },
        ],
      },
      { id: "collaboratori-extra", label: "Collaboratori aggiuntivi" },
      {
        id: "collaboratori-frammenti",
        label: "Frammenti collaboratori da riconciliare",
        catalogBoundary: "I tre frammenti si sovrappongono solo in parte al file finale: finché le chiavi non sono riconciliate, non diventano un secondo elenco di collaboratori.",
      },
      {
        id: "cv-incarichi",
        label: "CV e incarichi",
        catalogBoundary: "Il confronto fra curriculum e incarico richiede verifica contestuale dei requisiti e minimizzazione delle inferenze personali prima di esporre righe puntuali.",
        columns: [
          { key: "ente", label: "Ente" },
          { key: "nome", label: "Nominativo" },
          { key: "ruolo", label: "Incarico" },
          { key: "anni_esperienza_dichiarati", label: "Esperienza dichiarata" },
          { key: "importo_totale", label: "Compenso totale" },
        ],
      },
      { id: "segnalazioni-card", label: "Righe preparate per card" },
      { id: "parti-atti", label: "Autorizzanti e destinatari degli atti" },
      {
        id: "incarichi-nominativi-shard",
        label: "Shard nominativi catalogati",
        catalogBoundary: "Gli shard contengono varianti, lotti e granularità diverse dal master: il conteggio non equivale a nuovi incarichi o persone uniche.",
      },
      { id: "incarichi-nominativi-buchi-copertura", label: "Sezioni nominative non reperite" },
      { id: "incarichi-nominativi-buchi-riga", label: "Righe nominative da completare" },
    ],
  },
  {
    section: "incarichi",
    slug: "personale-organi",
    title: "Personale, staff e organi",
    description: "Organici, funzioni e indennità con perimetri omogenei e confronti dichiarati.",
    introduction: "La pagina riunisce consistenza del personale, staff per funzione e indennità degli organi senza trasformare massimali, dotazioni e pagamenti in un’unica misura.",
    status: "Fatto documentato",
    primaryMetric: "247",
    primaryLabel: "righe di personale su 143 enti",
    hubSummary: "Organici, funzioni e indennità letti nel rispettivo perimetro, con confronti UE separati.",
    facts: [
      { value: "69", label: "righe staff per funzione", note: "Funzioni dichiarate, non una graduatoria di produttività." },
      { value: "131", label: "indennità degli organi", note: "Importi e massimali restano distinti." },
      { value: "127", label: "comparazioni UE", note: "Richiedono anno, FTE, costo e perimetro omogenei." },
      { value: "5.556", label: "piani di gestione sul personale", note: "Dettaglio OpenBDAP 2024-2025, distinto dalle 247 righe aggregate per ente." },
      { value: "850", label: "buchi di organico", note: "Teste, FTE, costo e costo per addetto non reperiti, separati per ente e anno." },
    ],
    readingNotes: [
      "Una dotazione di personale più alta o più bassa non misura da sola efficienza o qualità.",
      "I confronti internazionali restano candidati finché unità e perimetri non sono normalizzati.",
      "Piani di gestione, organici e compensi degli organi hanno unità diverse e non vengono sommati.",
    ],
    datasets: [
      {
        id: "personale",
        label: "Personale",
        columns: [
          { key: "ente", label: "Ente" },
          { key: "anno", label: "Anno" },
          { key: "teste", label: "Personale" },
          { key: "fte", label: "FTE" },
          { key: "costo_lordo_eur", label: "Costo lordo" },
        ],
      },
      { id: "staff-funzioni", label: "Staff per funzione" },
      { id: "indennita-organi", label: "Indennità degli organi" },
      {
        id: "comparazione-ue",
        label: "Comparazioni UE",
        catalogBoundary: "Anno, FTE, costo e perimetro istituzionale non sono ancora omogenei per un confronto row-level difendibile.",
      },
      {
        id: "comparazione-ue-staff-funzioni",
        label: "Staff e funzioni UE",
        catalogBoundary: "Le funzioni amministrative non hanno una tassonomia comune sufficiente a trasformare le righe in una graduatoria confrontabile.",
      },
      { id: "openbdap-personale-piani-gestione", label: "Dettaglio OpenBDAP sul personale" },
      { id: "buchi-organico", label: "Dati di organico non reperiti" },
      { id: "cdp-compensi-sedi", label: "Compensi e sedi nel working set CDP" },
    ],
  },
  {
    section: "spese",
    slug: "eventi",
    title: "Eventi e convegni",
    description: "Spese documentate per eventi e convegni, con copertura dell’importo e fonte.",
    introduction: "La pagina rende leggibili oggetto, ente, destinatario e importo quando presenti. Non assegna automaticamente un giudizio negativo alla finalità dell’evento.",
    status: "Fatto documentato",
    primaryMetric: "109",
    primaryLabel: "eventi e convegni",
    hubSummary: "Oggetto, destinatario e importo delle spese per eventi, con copertura dichiarata.",
    facts: [
      { value: "71", label: "importi conosciuti", note: "Il totale parziale riguarda solo queste righe." },
      { value: "3.175.126,25 €", label: "totale parziale", note: "Nessun valore viene stimato per i record mancanti." },
    ],
    readingNotes: ["Una spesa per evento è un fatto documentato; utilità, risultato e congruità richiedono altre evidenze."],
    datasets: [{
      id: "eventi-convegni",
      label: "Eventi e convegni",
      columns: [
        { key: "ente", label: "Ente" },
        { key: "oggetto", label: "Evento" },
        { key: "contraente", label: "Fornitore" },
        { key: "anno", label: "Anno" },
        { key: "importo", label: "Importo" },
      ],
    }],
  },
  {
    section: "spese",
    slug: "campagne",
    title: "Campagne e pubblicità",
    description: "Campagne istituzionali e pubblicità con oggetto, affidatario, importo e fonte disponibili.",
    introduction: "La copertura economica è limitata: la pagina mostra insieme i valori noti e la parte che resta da documentare.",
    status: "Fatto documentato",
    primaryMetric: "94",
    primaryLabel: "campagne censite",
    hubSummary: "Campagne istituzionali e pubblicità, con i pochi importi disponibili separati dai mancanti.",
    facts: [
      { value: "19", label: "importi conosciuti", note: "20,21% delle righe." },
      { value: "2.635.328,45 €", label: "totale parziale", note: "Somma del solo sottoinsieme con importo." },
    ],
    readingNotes: ["Il costo non misura da solo copertura, efficacia o utilità pubblica della campagna."],
    datasets: [{
      id: "campagne-pubblicita",
      label: "Campagne e pubblicità",
      columns: [
        { key: "ente", label: "Ente" },
        { key: "oggetto", label: "Campagna" },
        { key: "contraente", label: "Fornitore" },
        { key: "anno", label: "Anno" },
        { key: "importo", label: "Importo" },
      ],
    }],
  },
  {
    section: "spese",
    slug: "affitti",
    title: "Affitti e immobili",
    description: "Canoni e immobili con la copertura necessaria a un confronto al metro quadrato resa esplicita.",
    introduction: "Canone, immobile e superficie sono mostrati per come risultano; pagamenti osservati e previsioni restano in colonne e anni distinti.",
    status: "Fatto documentato",
    primaryMetric: "1.172",
    primaryLabel: "righe su affitti e immobili",
    hubSummary: "Canoni, immobili e superfici disponibili; un solo record ha canone e metri quadrati positivi, troppo poco per un benchmark omogeneo.",
    facts: [
      { value: "901", label: "righe con canone", note: "Copertura economica del 76,88%." },
      { value: "82", label: "righe con superficie", note: "Solo una ha anche un canone annuo positivo." },
      { value: "1", label: "riga con canone e superficie", note: "Un singolo caso non costituisce un benchmark omogeneo." },
      { value: "0", label: "benchmark €/m² generali", note: "La copertura non consente un confronto generale fra immobili." },
    ],
    readingNotes: ["OpenBDAP 2024-2025 descrive pagamenti; il 2026 è previsione e non viene sommato ai pagamenti."],
    datasets: [{
      id: "affitti-immobili",
      label: "Affitti e immobili",
      columns: [
        { key: "ente", label: "Ente" },
        { key: "immobile", label: "Immobile" },
        { key: "anno", label: "Anno" },
        { key: "canone_annuo_eur", label: "Canone annuo" },
        { key: "mq", label: "Metri quadrati" },
      ],
    }],
  },
  {
    section: "spese",
    slug: "missioni",
    title: "Missioni e trasferte ministeriali",
    description: "Capitoli e pagamenti per missioni, non trasferte individuali.",
    introduction: "La vista isola le voci di missione dei ministeri e confronta gli anni disponibili senza attribuire la spesa a singole persone.",
    status: "Fatto documentato",
    primaryMetric: "618",
    primaryLabel: "capitoli di 15 ministeri",
    hubSummary: "Capitoli di missione e pagamenti 2024-2025, senza inventare trasferte individuali.",
    facts: [
      { value: "15", label: "ministeri", note: "Copertura del perimetro osservato." },
      { value: "dal 2024 al 2025", label: "pagamenti disponibili", note: "Confrontati per anno, non cumulati come missioni personali." },
      { value: "6 + 8", label: "righe CDP e buchi", note: "Sedute documentate e anni senza importo restano fuori dai 618 capitoli ministeriali." },
    ],
    readingNotes: [
      "Un capitolo è un aggregato contabile e non dimostra il numero, la destinazione o l’utilità delle singole trasferte.",
      "Le righe CDP con importo non disponibile documentano un buco informativo e non valgono zero.",
    ],
    datasets: [
      {
        id: "missioni",
        label: "Missioni ministeriali",
        columns: [
          { key: "ente", label: "Ministero" },
          { key: "codice_capitolo", label: "Capitolo" },
          { key: "descrizione", label: "Descrizione" },
          { key: "anno", label: "Anno" },
          { key: "pagato", label: "Pagato" },
        ],
      },
      { id: "missioni-cdp", label: "Missioni CDP documentate" },
      { id: "missioni-cdp-buchi", label: "Dati missione CDP non reperiti" },
    ],
  },
  {
    section: "spese",
    slug: "auto-welfare",
    title: "Auto e welfare",
    description: "Spese e massimali per auto e welfare mantenuti nella loro unità originale.",
    introduction: "La pagina conserva oggetto, ente, periodo e tipo di valore, evitando di sommare spese osservate e massimali teorici.",
    status: "Fatto documentato",
    primaryMetric: "153",
    primaryLabel: "righe su auto e welfare",
    hubSummary: "Spese documentate e massimali separati, con fonte e periodo vicini al dato.",
    facts: [{ value: "153", label: "osservazioni", note: "Spese, dotazioni e massimali non sono una misura unica." }],
    readingNotes: ["Il massimale non equivale a un pagamento; la disponibilità di un’auto non misura da sola necessità o inefficienza."],
    datasets: [{
      id: "auto-welfare",
      label: "Auto e welfare",
      columns: [
        { key: "ente", label: "Ente" },
        { key: "tipo", label: "Tipo" },
        { key: "oggetto", label: "Oggetto" },
        { key: "modello", label: "Modello" },
        { key: "importo", label: "Importo" },
      ],
    }],
  },
  {
    section: "spese",
    slug: "rimborsi",
    title: "Rimborsi spese",
    description: "Rimborsi documentati con beneficiario, oggetto, periodo e importo quando disponibili.",
    introduction: "Una vista piccola e puntuale per leggere ogni rimborso nel contesto dell’atto e della fonte disponibile.",
    status: "Fatto documentato",
    primaryMetric: "21",
    primaryLabel: "rimborsi censiti",
    hubSummary: "Un elenco breve, puntuale e collegato agli atti, senza aggregazioni che nascondono il contesto.",
    facts: [
      { value: "21", label: "righe documentate", note: "Ogni record mantiene il proprio perimetro documentale." },
      { value: "14", label: "buchi informativi", note: "Rimborsi cercati ma non reperiti o non separabili dal compenso." },
    ],
    readingNotes: [
      "Un rimborso è una restituzione di spese nel perimetro dell’atto; non è automaticamente un compenso aggiuntivo.",
      "Un rimborso non reperito resta dato mancante: non viene trasformato in zero.",
    ],
    datasets: [
      {
        id: "rimborsi-spese",
        label: "Rimborsi spese",
        columns: [
          { key: "ente", label: "Ente" },
          { key: "nome", label: "Beneficiario" },
          { key: "descrizione", label: "Oggetto" },
          { key: "anno", label: "Anno" },
          { key: "pagato", label: "Pagato" },
        ],
      },
      { id: "rimborsi-spese-buchi", label: "Rimborsi non reperiti" },
    ],
  },
  {
    section: "spese",
    slug: "capitoli-progetti",
    title: "Capitoli contabili e progetti",
    description: "Capitoli OpenBDAP, voci dedicate alle consulenze e finestra di riconciliazione CUP.",
    introduction: "Questa vista conserva anno, misura e livello di ogni voce contabile e tiene il censimento CUP come controllo di copertura, non come nuova somma di spesa.",
    status: "Fatto documentato",
    primaryMetric: "17.792",
    primaryLabel: "capitoli OpenBDAP dal 2024 al 2026",
    hubSummary: "Capitoli, voci consulenza e riconciliazione CUP con anni e misure tenuti separati.",
    facts: [
      { value: "224", label: "capitoli per consulenze", note: "Voci contabili dedicate, non incarichi nominativi." },
      { value: "5", label: "righe della finestra CUP", note: "Controllo di copertura catalogato, non elenco di progetti da sommare." },
      { value: "dal 2024 al 2026", label: "periodo OpenBDAP", note: "Pagamenti e previsioni restano misure distinte." },
      { value: "605", label: "piani di gestione CE2/CE3", note: "Dettaglio 2024-2025 per consulenze e prestazioni professionali." },
      { value: "42", label: "righe di copertura consulenze", note: "Assenza, zero osservato e non-BDAP restano stati distinti." },
      {
        value: "4",
        label: "insiemi OpenCUP aggiuntivi",
        note: "Progetti, soggetti, metadati e trend derivato restano separati dalla finestra di controllo a 5 righe e dai progetti OpenCoesione già pubblicati.",
      },
    ],
    readingNotes: [
      "Un capitolo è un’unità contabile e non identifica automaticamente beneficiario o singolo contratto.",
      "Il 2026 è una previsione nel perimetro documentato e non viene sommato ai pagamenti 2024-2025.",
      "Il dettaglio CE2/CE3 non si somma alle viste aggregate né agli incarichi nominativi.",
    ],
    datasets: [
      {
        id: "openbdap-capitoli-2024-2026",
        label: "Capitoli OpenBDAP",
        columns: [
          { key: "amministrazione", label: "Ente" },
          { key: "esercizio", label: "Anno" },
          { key: "numero_capitolo", label: "Numero capitolo" },
          { key: "capitolo", label: "Capitolo" },
          { key: "pagato", label: "Pagato" },
        ],
      },
      {
        id: "capitoli-consulenze",
        label: "Capitoli per consulenze",
        columns: [
          { key: "ente", label: "Ente" },
          { key: "anno", label: "Anno" },
          { key: "codice_capitolo", label: "Capitolo" },
          { key: "descrizione", label: "Descrizione" },
          { key: "pagato", label: "Pagato" },
        ],
      },
      {
        id: "opencup-census-window",
        label: "Finestra di riconciliazione CUP",
        catalogBoundary: "Le cinque righe misurano una finestra di controllo: non sono un elenco di progetti né una base per calcolare nuova spesa.",
      },
      { id: "openbdap-consulenze-ce", label: "Dettaglio OpenBDAP CE2/CE3" },
      { id: "capitoli-consulenze-copertura", label: "Copertura dei capitoli consulenza" },
      {
        id: "opencup-progetti-bulk",
        label: "Progetti OpenCUP in bulk",
        catalogBoundary: "Il dump conserva il grano progetto ma richiede una proiezione stabile e deduplica per CUP prima di affiancarlo alle viste OpenCoesione.",
      },
      {
        id: "opencup-soggetti",
        label: "Soggetti collegati ai CUP",
        catalogBoundary: "I soggetti sono relazioni con i progetti, non progetti o beneficiari unici; il loro conteggio non è additivo rispetto ai CUP.",
      },
      {
        id: "opencup-trend-area-soggetto",
        label: "Trend per area e soggetto",
        catalogBoundary: "È una vista derivata da progetti e soggetti: resta separata dai record sorgente per evitare doppi conteggi.",
      },
      {
        id: "opencup-metadati",
        label: "Metadati OpenCUP",
        catalogBoundary: "Descrive file, campi e acquisizione; non contiene ulteriori progetti da sommare al censimento.",
      },
      {
        id: "siope-inventario-enti",
        label: "Inventario SIOPE degli enti",
        columns: [
          { key: "entityType", label: "Tipo di ente" },
          { key: "year", label: "Anno" },
          { key: "registryRows", label: "Righe anagrafiche" },
          { key: "coverageStatus", label: "Copertura" },
        ],
      },
      {
        id: "siope-uscite-province",
        label: "Pagamenti SIOPE delle Province",
        columns: [
          { key: "entityName", label: "Ente" },
          { key: "year", label: "Anno" },
          { key: "month", label: "Mese" },
          { key: "amountCents", label: "Importo in centesimi" },
        ],
      },
      {
        id: "siope-uscite-regioni",
        label: "Pagamenti SIOPE delle Regioni",
        columns: [
          { key: "entityName", label: "Ente" },
          { key: "year", label: "Anno" },
          { key: "month", label: "Mese" },
          { key: "amountCents", label: "Importo in centesimi" },
        ],
      },
      {
        id: "siope-uscite-citta-metropolitane",
        label: "Pagamenti SIOPE delle Città metropolitane",
        columns: [
          { key: "entityName", label: "Ente" },
          { key: "year", label: "Anno" },
          { key: "month", label: "Mese" },
          { key: "amountCents", label: "Importo in centesimi" },
        ],
      },
    ],
  },
  {
    section: "trasparenza",
    slug: "documenti-mancanti",
    title: "Documenti che non risultano reperibili",
    description: "Problemi di trasparenza osservati, URL morti e percorsi per accesso civico o FOIA.",
    introduction: "La pagina indica che cosa non è stato reperito alla data del controllo e come risalire alla sezione o chiedere il documento, senza inviare richieste automaticamente.",
    status: "Dato mancante",
    primaryMetric: "291",
    primaryLabel: "problemi su 86 enti",
    hubSummary: "Sezioni e documenti non reperiti, URL morti e istruzioni per chiedere trasparenza.",
    facts: [
      { value: "258", label: "sezioni o documenti mancanti", note: "Osservazione datata, non accertamento di violazione." },
      { value: "98", label: "URL morti", note: "Il collegamento non rispondeva al controllo." },
      { value: "131", label: "percorsi di accesso civico", note: "Sono link e istruzioni, non invii automatici." },
      { value: "131", label: "percorsi FOIA", note: "Da usare valutando caso, destinatario e documento." },
    ],
    readingNotes: [
      "“Non reperito” significa che il documento non è stato trovato nel percorso controllato in quel momento.",
      "La pagina non invia automaticamente PEC, accessi civici o segnalazioni ANAC.",
    ],
    datasets: [
      {
        id: "problemi-trasparenza",
        label: "Problemi di trasparenza",
        columns: [
          { key: "ente", label: "Ente" },
          { key: "sezione", label: "Sezione" },
          { key: "buco", label: "Documento non reperito" },
          { key: "norma", label: "Norma" },
          { key: "istruzione_accesso_civico", label: "Accesso civico" },
        ],
      },
      { id: "catalogo-url-trasparenza", label: "Catalogo URL trasparenza" },
      { id: "buchi-trasparenza", label: "Sezioni e documenti mancanti" },
      { id: "url-morti", label: "URL non raggiungibili al controllo" },
    ],
  },
  {
    section: "trasparenza",
    slug: "perimetro-enti",
    title: "Enti nel perimetro del catalogo",
    description: "Indice degli enti usato per collegare URL, problemi di trasparenza e dataset tematici.",
    introduction: "L’indice rende esplicito quali amministrazioni compaiono nel materiale e con quali identificativi, così i conteggi delle pagine tematiche possono essere ricondotti allo stesso perimetro.",
    status: "Fatto documentato",
    primaryMetric: "170",
    primaryLabel: "righe nell’indice enti",
    hubSummary: "Perimetro istituzionale e identificativi usati per collegare le diverse tabelle del catalogo.",
    facts: [
      { value: "170", label: "righe indicizzate", note: "Indice di collegamento, non graduatoria degli enti." },
      { value: "1", label: "perimetro comune", note: "Aiuta a distinguere differenze reali da denominazioni non allineate." },
      {
        value: "109",
        label: "istanze URL supplementari",
        note: "Quattro file con schemi eterogenei, contabilizzati senza forzare una tabella unica accanto alle 1.240 righe del catalogo principale.",
      },
      {
        value: "300",
        label: "righe L38 dei parchi",
        note: "25 cataloghi settoriali da 12 righe, mantenuti come source-index autonomo.",
      },
    ],
    readingNotes: [
      "La presenza nell’indice indica soltanto che l’ente ricorre nel materiale; non attribuisce problemi o inefficienze.",
      "Una pagina catalogata indica un percorso osservato: non garantisce che ogni documento obbligatorio sia presente o aggiornato.",
    ],
    datasets: [
      {
        id: "indice-enti",
        label: "Indice degli enti",
        columns: [
          { key: "denominazione", label: "Ente" },
          { key: "Codice_IPA", label: "Codice IPA" },
          { key: "tipologia", label: "Tipologia" },
          { key: "sito", label: "Sito" },
        ],
      },
      {
        id: "cataloghi-url-supplementari",
        label: "Cataloghi URL supplementari",
        catalogBoundary: "Le 109 istanze provengono da quattro file con schemi diversi: restano contabilizzate senza forzare una tabella unica né deduplicare URL non ancora riconciliati.",
      },
      {
        id: "trasparenza-parchi-l38",
        label: "Trasparenza L38 dei parchi",
      },
    ],
  },
  {
    section: "controlli",
    slug: "segnalazioni",
    title: "Segnalazioni che richiedono una spiegazione",
    description: "Casi prioritizzati per tipo, ente e fonte, senza trasformarli in sprechi accertati.",
    introduction: "Il registro mette in ordine le domande pubbliche da verificare: che cosa è stato osservato, perché merita attenzione e quale fonte permette di controllarlo.",
    status: "Richiede una spiegazione",
    primaryMetric: "168",
    primaryLabel: "segnalazioni documentate",
    hubSummary: "Domande prioritarie con ente, motivo e fonte: una coda di verifica, non 168 accuse.",
    facts: [
      { value: "57", label: "priorità alta", note: "Priorità di verifica, non gravità accertata." },
      { value: "111", label: "priorità media", note: "Richiede comunque controllo della fonte." },
      { value: "123", label: "incarichi nominativi", note: "Il tipo più frequente nel registro." },
      { value: "168", label: "fonti presenti", note: "Ogni segnalazione conserva almeno un riferimento." },
    ],
    readingNotes: [
      "Gli importi non formano un totale editoriale: possono avere perimetri, formule e anni diversi.",
      "Priorità alta significa controllare prima, non dichiarare colpa o spreco.",
    ],
    datasets: [
      {
        id: "segnalazioni",
        label: "Segnalazioni",
        columns: [
          { key: "priorita", label: "Priorità" },
          { key: "tipo", label: "Tipo" },
          { key: "ente", label: "Ente" },
          { key: "perche", label: "Perché richiede verifica" },
          { key: "importo", label: "Importo" },
        ],
      },
      { id: "segnalazioni-parti", label: "Autorizzanti e destinatari delle segnalazioni" },
    ],
  },
  {
    section: "controlli",
    slug: "corte-dei-conti",
    title: "Atti della Corte dei conti",
    description: "Atti e importi citati conservati senza chiamarli automaticamente danni.",
    introduction: "La pagina organizza gli atti disponibili per ente e oggetto. Quando compare un importo, indica il valore menzionato nell’atto e non una quantificazione automatica del danno.",
    status: "Fatto documentato",
    primaryMetric: "93",
    primaryLabel: "righe riferite a 87 atti",
    hubSummary: "Atti, enti e importi citati, con una distinzione esplicita fra oggetto dell’atto e danno.",
    facts: [
      { value: "87", label: "atti distinti", note: "Riconciliati nelle 93 righe del catalogo." },
      { value: "56", label: "enti", note: "Perimetro istituzionale osservato." },
      { value: "8", label: "righe con importo", note: "L’importo non è necessariamente un danno né è sempre additivo." },
    ],
    readingNotes: ["Importo oggetto dell’atto ≠ danno accertato. La qualificazione compete al contenuto e all’esito dell’atto."],
    datasets: [{
      id: "corte-conti",
      label: "Atti Corte dei conti",
      columns: [
        { key: "ente", label: "Ente" },
        { key: "atto", label: "Atto" },
        { key: "importo", label: "Importo citato" },
        { key: "url", label: "Collegamento" },
      ],
    }],
  },
  {
    section: "controlli",
    slug: "working-set",
    title: "Working set dei casi da verificare",
    description: "Quattro lotti catalogati e mantenuti separati dalla lista editoriale delle segnalazioni.",
    introduction: "Il working set conserva candidati e provenienza dei quattro lotti. È una base di lavoro non additiva: nessuna riga diventa automaticamente un caso pubblicato o uno spreco.",
    status: "Richiede una spiegazione",
    primaryMetric: "3.144",
    primaryLabel: "candidati nei quattro lotti",
    hubSummary: "Quattro lotti di candidati contabilizzati, separati dalle 168 segnalazioni editoriali.",
    facts: [
      { value: "1.835", label: "lotto A", note: "Provenienza mantenuta nella scheda dataset." },
      { value: "492", label: "lotto B", note: "Nessuna sovrapposizione di ID fra lotti." },
      { value: "508", label: "lotto C", note: "Working set, non ledger probatorio definitivo." },
      { value: "309", label: "lotto D", note: "Gli importi non producono un totale editoriale." },
    ],
    readingNotes: [
      "I 3.144 candidati più le 168 segnalazioni formano 3.312 record distinti, ma i due strati restano separati.",
      "Il working set non va pubblicato sotto l’etichetta generica “sprechi”.",
    ],
    datasets: [
      {
        id: "c8-a",
        label: "Lotto A",
        catalogBoundary: "È un lotto di candidati eterogenei: prima delle righe pubbliche servono classificazione probatoria e riconciliazione con le segnalazioni curate.",
      },
      {
        id: "c8-b",
        label: "Lotto B",
        catalogBoundary: "È un lotto di candidati eterogenei: prima delle righe pubbliche servono classificazione probatoria e riconciliazione con le segnalazioni curate.",
      },
      {
        id: "c8-c",
        label: "Lotto C",
        catalogBoundary: "È un lotto di candidati eterogenei: prima delle righe pubbliche servono classificazione probatoria e riconciliazione con le segnalazioni curate.",
      },
      {
        id: "c8-d",
        label: "Lotto D",
        catalogBoundary: "È un lotto di candidati eterogenei: prima delle righe pubbliche servono classificazione probatoria e riconciliazione con le segnalazioni curate.",
      },
    ],
  },
  {
    section: "confronti",
    slug: "catalogo",
    title: "Benchmark da rendere omogenei",
    description: "Confronti di consulenze, contratti e istituzioni con gate esplicito di comparabilità.",
    introduction: "Questo catalogo resta distinto dai confronti già verificati sul sito: mostra quali casi hanno unità e perimetro confrontabili e quali richiedono ancora dati.",
    status: "Richiede una spiegazione",
    primaryMetric: "90",
    primaryLabel: "benchmark nei tre cataloghi",
    hubSummary: "Consulenze, contratti e istituzioni passano da un gate di unità, anno e perimetro.",
    facts: [
      { value: "56", label: "benchmark consulenze", note: "Molte unità e durate diverse impediscono un totale unico." },
      { value: "11", label: "benchmark contratti", note: "Tre casi sono dichiarati non confrontabili." },
      { value: "23", label: "confronti istituzionali", note: "12 risultano confrontabili nel catalogo integrato." },
    ],
    readingNotes: [
      "Comparabile significa stesso oggetto, unità, durata, anno e perimetro sufficientemente omogenei.",
      "Un valore sopra benchmark è uno scostamento solo dopo il gate; non prova automaticamente spreco.",
    ],
    datasets: [
      {
        id: "benchmark-consulenze",
        label: "Benchmark consulenze",
        catalogBoundary: "Oggetto, durata e unità non sono omogenei in tutte le righe: il catalogo resta un gate di verifica, non una classifica.",
      },
      {
        id: "benchmark-contratti",
        label: "Benchmark contratti",
        catalogBoundary: "Modello, quantità, servizi inclusi e base IVA non coincidono sempre; le righe restano bloccate finché il confronto non è omogeneo.",
      },
      {
        id: "benchmark-istituzioni",
        label: "Benchmark istituzioni",
        catalogBoundary: "Anno, valuta, FTE e perimetro istituzionale devono essere allineati prima di presentare confronti riga per riga.",
      },
    ],
  },
] as const;

export const EDITORIAL_SURFACE_PREVIEWS: readonly EditorialSurfacePreview[] = [
  {
    surface: "/partecipazioni",
    title: "Approfondimenti sulle partecipate statali",
    description: "Tre viste di dettaglio affiancano il censimento MEF nazionale senza sostituirne il totale né sommare perimetri diversi.",
    datasets: [
      {
        id: "partecipate-statali-focus",
        label: "Focus sulle partecipate statali",
        catalogBoundary: "Il focus seleziona società e documenti di interesse: non rappresenta l’universo nazionale delle relazioni MEF.",
      },
      {
        id: "partecipate-statali-perimetro",
        label: "Perimetro delle partecipate statali",
        catalogBoundary: "È un inventario di controllo del perimetro, non un secondo censimento di partecipazioni da aggiungere alle 53.656 relazioni MEF.",
      },
      {
        id: "partecipate-at-focus",
        label: "Trasparenza delle partecipate",
        catalogBoundary: "Raccoglie percorsi e documenti di Amministrazione Trasparente; non certifica completezza, controllo pubblico attuale o valore economico della quota.",
      },
    ],
  },
] as const;

export function getEditorialTopic(section: EditorialTopic["section"], slug: string) {
  return EDITORIAL_TOPICS.find((topic) => topic.section === section && topic.slug === slug);
}

export function getEditorialTopics(section: EditorialTopic["section"]) {
  return EDITORIAL_TOPICS.filter((topic) => topic.section === section);
}

export function getEditorialSurfacePreview(surface: EditorialSurfacePreview["surface"]) {
  return EDITORIAL_SURFACE_PREVIEWS.find((preview) => preview.surface === surface);
}
