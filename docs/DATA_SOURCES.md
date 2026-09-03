# Fonti dati

Questa è la mappa iniziale delle fonti. Il criterio è semplice: prima fonti istituzionali nazionali, strutturate e con identificativi stabili; poi portali territoriali e documenti meno standardizzati.

## Registro integrato row-level

Oltre alle pipeline istituzionali descritte sotto, il repository contiene un
rilascio integrato di 79 dataset curati. Prima delle viste applicative sono
stati chiusi tre registri: 51.303 elementi inventariati, 34.071 identità di fonte e
13.321.128 righe sorgente. Le equazioni, tutti i dataset, gli stati di licenza
e i comandi di verifica sono documentati in
[INTEGRATED_SOURCE_LEDGER.md](INTEGRATED_SOURCE_LEDGER.md).

Il catalogo non promuove una nota secondaria a fonte ufficiale: conserva i
collegamenti pubblicabili e mette in quarantena valori locali, malformed,
sensibili o di processo senza eliminare l'identità. La proiezione row-level
mantiene 338.782 righe interrogabili; `not-declared` resta una cautela di riuso,
non un gate che nasconde la riga.

La UI non usa il catalogo come esperienza primaria: 21 percorsi editoriali
e un'anteprima nella pagina Partecipazioni coprono tutti i 79 insiemi,
partendo da anteprime nelle pagine esistenti e arrivando a risultati, limiti,
prime righe, fonte e drill-down completo. Il registro tecnico resta espandibile
per chi deve controllare schema e stato di
pubblicazione. Le schede dataset espongono titolare, periodo di riferimento,
pubblicazione, acquisizione, ultimo controllo e frequenza. I campi non presenti
nel materiale sono indicati come non disponibili, senza ricostruzioni; quando
una riga non porta un URL puntuale, la UI usa il portale canonico dichiarato o
segnala esplicitamente che l’URL non è disponibile. Ricevute e hash del dataset
restano verificabili nel registro di copertura senza creare link circolari.

Per aggiungere una nuova fonte in modo ripetibile (contributor o agente), usa
[DATA_IMPORT_STANDARD.md](DATA_IMPORT_STANDARD.md).

Il periodo è valorizzato per 32 dataset su 79 soltanto quando il confine è
ricavabile da una colonna temporale dedicata (`anno`, `data`, `esercizio`,
`dal`/`al`, `periodo_*`, `source_year`, `data_aggiornamento`) o dal contratto
esplicito di un aggregato derivato. Gli anni presenti solo in testo libero o
negli URL non vengono usati. I 47 dataset senza un confine non ambiguo restano
quindi su “Non disponibile”; gli estremi futuri degli incarichi descrivono la
durata dichiarata del record e non una data di pubblicazione o acquisizione.

Due insiemi `catalog-only` espongono anche il denominatore fisico usato nella
verifica. OpenCUP contiene 11.942.784 record CSV, mentre 11.991.275 è il numero
di linee fisiche di dati: il delta di 48.491 deriva da newline dentro campi
quotati. Consip conserva 1.028.559 unità fisiche, formate da 1.028.557 record
validi e 2 frammenti malformati che non vengono ricostruiti.

## Tier 1: infrastrutture nazionali

### SIOPE / SIOPE+
**Titolari/gestori:** RGS e Banca d'Italia.  
**Uso:** incassi e pagamenti degli enti pubblici.  
**Join:** ente, periodo, codifica gestionale/contabile.  
**Nota:** SIOPE contiene dati per oltre 10.000 enti. SIOPE+ è l'infrastruttura degli ordinativi di pagamento e incasso; non va confusa la frequenza del flusso operativo con la frequenza del dato pubblico esposto dalla dashboard.

Nelle graduatorie comunali, la Provincia viene dall'associazione tra `ANAG_ENTI_SIOPE` e `ANAG_REG_PROV` del registro ufficiale SIOPE. La Regione è quella della sede legale ottenuta tramite codice fiscale da IPA: non indica necessariamente il luogo fisico in cui ogni pagamento produce effetti.

### OpenBDAP
**Titolare:** Ragioneria Generale dello Stato.  
**Uso:** bilancio dello Stato, spesa, SIOPE, opere pubbliche, PNRR e altri domini.  
**Accesso:** catalogo e API OData ufficiali.
**Endpoint implementati:** pagamenti dello Stato e `GET /api/opere?cup=...` per le opere pubbliche MOP.

Per i pagamenti dello Stato, i rilasci `PBS_SPE_Mxx_*` sono mensili e cumulati dal 1° gennaio al mese contabile indicato. I rilasci `PBS_SPE_RND_*` sono consuntivi annuali: per una query con il solo anno vengono preferiti quando disponibili, mentre query mensili e storico restano esclusivamente sulla serie mensile. Le serie non vengono sommate o mescolate.

La pagina Ministeri usa invece `2025_RND_SPE_ELB_CAP_001`, rendiconto elaborabile per capitolo: 5.395 righe, 41 colonne e 15 amministrazioni. L'ETL `scripts/etl/rgs_ministries_account.py` blocca la pubblicazione se cambiano file, schema, anno, amministrazioni o identità contabili. CP (competenza), RS (residui) e CS (cassa) restano campi distinti. La scheda di questo specifico rilascio dichiara CC BY 3.0; la licenza non viene estesa ad altri dataset RGS.

Il connettore MOP legge prima i metadati e lo schema ufficiale. Gli alias tecnici delle colonne vengono scoperti a ogni controllo e accettati soltanto se nome, significato e tipo restano quelli previsti dal contratto. Questo evita di pubblicare valori nella colonna sbagliata dopo una modifica della fonte.

Al controllo del 3 agosto 2026, lo schema dichiarava 560.245 codici locali di progetto e 541.539 CUP distinti. La ricerca usa il CUP esatto e interroga soltanto le righe necessarie: non scarica oltre mezzo milione di opere durante una richiesta web.

Per ogni opera manteniamo distinti:

- costo previsto e costo effettivo;
- finanziamenti statali, europei, territoriali, privati e altre fonti;
- finanziamenti ancora da trovare;
- date previste e date effettive;
- avvisi sulla qualità del dato.

Gli avvisi su tempi, costi o copertura finanziaria hanno uso di screening. Indicano cosa verificare e includono spiegazioni alternative plausibili. Non classificano automaticamente un'opera come spreco, irregolarità o illecito.

### Rendiconto RGS: consulenze e lavoro parasubordinato

La pagina `/spese/consulenze` usa i rendiconti elaborabili per piano di
gestione 2024 e 2025, risorse `spd_rnd_spe_elb_pig_01_2024` e
`spd_rnd_spe_elb_pig_01_2025`. I due CSV ufficiali sono bloccati per URL,
dimensione, SHA-256 e schema; le landing collegate dichiarano CC BY 3.0.

La selezione contiene 268 righe contabili e mantiene distinti anno,
amministrazione, centro di responsabilità, missione, programma, capitolo e
piano di gestione. `Pagato CS` ammonta a 113.570.396,41 euro; 153 righe hanno
uno zero osservato. Sono aggregati di rendiconto, non contratti, beneficiari o
prestazioni individuali, e il confronto fra amministrazioni non è una
classifica di efficienza.

### Spesa del Bilancio dello Stato per territorio destinatario 2023

La pagina `/spese/territoriale` usa il record RGS
`SRS_SPE_BIL_SPESR_001`: 20.268 righe sorgente, organizzate in 5.067
combinazioni territorio/titolo/categoria/missione con quattro misure separate.
Il CSV CP1252 da 3.933.609 byte è bloccato con SHA-256; la singola landing non
dichiara una licenza e il portale non gliene attribuisce una.

Italia, cinque macroaree e venti Regioni sono livelli sovrapposti e non vengono
sommati. Valore assoluto, quota di PIL, euro per abitante ed euro per km²
restano misure distinte; i denominatori delle ultime tre sono calcolati
dall'editore ma non versionati nel record. Una riga assente non diventa zero.

### Conto Economico degli enti del SSN 2024

**Dataset:** `spd_ssn_cce_elb_voccn_01_2024`, Modello di rilevazione del Conto Economico degli enti del SSN.
**Titolare:** Ragioneria Generale dello Stato · Data Warehouse RGS.
**Periodo:** consuntivo 2024; i dati sono osservati al 10 febbraio 2026. Il catalogo package è stato creato/modificato l'11 febbraio 2026; le tre pagine di landing risultano aggiornate il 16 febbraio 2026.
**Licenza catalogata:** Creative Commons Attribution (`cc-by`); la pagina metadati collega alla [CC BY 3.0 Unported](https://creativecommons.org/licenses/by/3.0/). Non viene attribuita una versione diversa da quella indicata dalla fonte.
**Formato:** CSV UTF-8, separatore `;`, virgolette doppie, terminatori CRLF; 76.124 righe dati e 11 colonne. La risorsa CSV e l'identificativo OData sono registrati nel source lock `scripts/etl/specs/ssn-cce-2024.source.json` insieme a dimensione e SHA-256.

**Landing ufficiali:** [enti](https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn), [nazionale](https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn-livello-nazionale), [regionale](https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn-livello-regionale). Il [package_show OpenBDAP](https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_show?id=94083af2-a542-482d-8ad6-5877d04cd1ca) fornisce licenza e metadati del pacchetto. La risorsa collegata per le definizioni del modello è il [report ufficiale PDF](https://bdap-opendata.rgs.mef.gov.it/sites/default/files/metadata_updfile/report/5424_Modello%20di%20rilevazione%20del%20Conto%20Economico.pdf); CSV e OData restano le risorse machine-readable usate dall'ETL.

Il dato è un **Conto Economico consuntivo** e quindi una contabilità economica: non è una serie di pagamenti di cassa SIOPE. La pagina e l'API mantengono le voci contabili pubblicate dalla fonte:

- `BA2080` · `Totale Costo del personale`;
- `BA1350` · `B.2.A.15) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro sanitarie e sociosanitarie`;
- `BA1750` · `B.2.B.2) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro non sanitarie`;
- `BA0390` · `B.2) Acquisti di servizi`;
- `BZ9999` · `Totale costi della produzione (B)`.

La fonte non pubblica una categoria chiamata “gettonisti” o “cooperative”: non usiamo queste parole come sinonimi e non deduciamo il tipo di contratto dal nome della voce. Il totale nazionale proviene esclusivamente da `SSN_CCE_NAZ_VOCCN_001`; gli aggregati regionali esclusivamente da `SSN_CCE_REG_VOCCN_001`. Il CSV enti (`SSN_CCE_ELB_VOCCN_001`) alimenta soltanto il dettaglio: le 21 righe `Codice Ente SSN = 999` sono escluse dall'elenco e usate per controllare gli aggregati regionali, evitando il doppio conteggio. I codici 041 e 042 sono mantenuti separati perché la fonte distingue le due Province autonome. Non sono classifiche di efficienza, qualità sanitaria, fabbisogno o frode.

La rigenerazione offline è fail-closed:

```bash
python3 scripts/etl/ssn_cce_snapshot.py \
  --input /percorso/94083af2-a542-482d-8ad6-5877d04cd1ca.csv \
  --national-input /percorso/SSN_CCE_NAZ_VOCCN_001.json \
  --regional-input /percorso/SSN_CCE_REG_VOCCN_001.json \
  --output src/data/generated/ssn-cce-2024.json \
  --generated-at 2026-08-22T00:00:00Z
python3 scripts/etl/ssn_cce_snapshot.py --check
```

Il refresh interrompe l'operazione se cambiano URL, hash, dimensione, colonne, tipo di rilevazione, codici delle voci, righe duplicate o riconciliazioni nazionale/Regione/ente.

Il monitor delle fonti non scarica questi input durante una richiesta del sito: l'health endpoint
riporta per ciascuno dei tre dataset lo stato dell'ultimo source lock verificato, dimensione, SHA-256,
righe attese e landing ufficiale. L'artifact JSON viene inoltre vincolato a bytes e SHA-256 in fase
di import. Se il lock, lo schema, l'hash o l'artifact non coincidono, l'import e la pubblicazione
falliscono chiusi; nessun refresh silenzioso sostituisce lo snapshot.

### BDNCP / ANAC
**Titolare:** ANAC.  
**Uso:** contratti pubblici, CIG, stazioni appaltanti, aggiudicazioni e ciclo di vita.  
**Accesso ufficiale:** [catalogo open data](https://dati.anticorruzione.it/opendata/dataset), [Analytics appalti](https://dati.anticorruzione.it/superset/dashboard/appalti/), [documentazione OCDS](https://dati.anticorruzione.it/opendata/ocds_it) e [Swagger OCDS](https://dati.anticorruzione.it/opendata/ocds/api/ui).
**Freschezza:** gli open data sono pubblicati mensilmente, dal 2023 anche tramite file delta; il cruscotto Analytics dichiara aggiornamento settimanale e ANAC documenta endpoint API OCDS. Il portale non garantisce qui la disponibilità runtime di tali endpoint.
**Licenza della distribuzione CIG 2025 usata nella replica:** CC BY-SA 4.0, come dichiarato nelle pagine delle singole risorse CSV.
**Stato:** l'applicazione pubblica il profilo minimizzato di ogni ente IPA con codice fiscale valido e univoco, inclusi quelli senza CIG nella coorte, nell'artifact `src/data/generated/anac-entity-procurement-page/` (meta più 256 shard). I dati ANAC entrano nel profilo soltanto dopo il join esatto e risolto tra AUSA e CF dell'amministrazione; il valore AUSA e i CF degli operatori non sono pubblicati. La scheda `/enti/[codice]` mostra il riepilogo e `/enti/[codice]/appalti` il drill-down SSR paginato con ranking per numero e valore attribuibile, stati di conflitto/assenza e link al dettaglio CIG ufficiale. Il perimetro è CIG pubblicati nel 2025, tutti i dodici mesi, snapshot cross-temporale: non è copertura nazionale corrente e l'importo è quello di aggiudicazione dichiarato, non un pagamento. Il loader verifica offline source spec, parent lock, provenance, hash/bytes dei 256 shard, schema, privacy e riconciliazioni; assenza, identity drift o tampering non diventano zeri. Il [contratto separato](./research/ANAC_AWARDEES_COVERAGE.md) resta aggregate-only e misura i full snapshot `aggiudicatari`/`aggiudicazioni`, il codice fiscale e il join `CIG + id_aggiudicazione`; non va confuso con l'artifact pagina.

I file CIG, aggiudicazioni, aggiudicatari ed esecuzione restano dataset distinti. Verranno collegati solo tramite identificativi ufficiali, in particolare `CIG` e `id_aggiudicazione`: il nome testuale di un fornitore non è una chiave affidabile. In caso di RTI o più aggiudicatari, l'importo di aggiudicazione non deve essere contato una volta per ogni componente.

### IPA
**Titolare:** AgID.  
**Uso:** anagrafe canonica degli enti, Codice IPA, codice fiscale, sito istituzionale, categoria.  
**Freschezza:** dataset Enti con aggiornamento giornaliero.  

**Ruolo:** base per scoprire i siti istituzionali e alimentare il crawler di Amministrazione Trasparente.

Risorse integrate:

- Enti: chiave `Codice_IPA`, con codice fiscale e codici territoriali come identificativi separati;
- Unità Organizzative: chiave globale `Codice_uni_uo`, relazione all'ente via `Codice_IPA` e gerarchia dichiarata via `Codice_uni_uo_padre`;
- Aree Organizzative Omogenee: chiave globale `Codice_uni_aoo`, relazione all'ente via `Codice_IPA`;
- amministrazioni centrali: categoria IPA `C1`; i ministeri vengono distinti dalla PCM con i codici natura, non dal testo della denominazione.

Le UO non hanno un campo semantico che certifichi “dipartimento”, “direzione generale” o “ufficio”. Queste qualifiche richiedono un crosswalk ufficiale con regolamenti e sezioni Amministrazione Trasparente.

### Bilanci consuntivi Istat delle Regioni 2024

**Titolare:** Istat.

**Periodo:** consuntivo definitivo 2024, pubblicato il 5 maggio 2026.

**Perimetro:** 22 amministrazioni individuali: 15 Regioni ordinarie, 5 Regioni speciali e 2 Province autonome. I tre fogli aggregati Italia/ordinario/speciale servono solo come contesto e non vengono sommati alle amministrazioni.

**Misura pubblicata:** impegni per Titolo. Pagamenti di competenza e sui residui restano fuori da questa vista.
**Licenza:** non dichiarata sulla pagina o nell'archivio verificato; non ne viene attribuita una.

L'ETL `scripts/etl/istat_regions_account.py` blocca archivio ZIP, workbook spese, 25 fogli, coordinate e totali ufficiali. Per ogni amministrazione i sei Titoli devono riconciliarsi con il `TOTALE GENERALE DELLE SPESE`. La pagina non usa una mappa perché 22 amministrazioni non corrispondono alle 20 geometrie regionali e non calcola valori pro capite finché popolazione e mapping non sono bloccati sullo stesso periodo.

## Tier 2: trasparenza distribuita

### Conti Pubblici Territoriali
**Titolare:** Dipartimento per le Politiche di Coesione e per il Sud.

**Uso:** entrate e spese effettivamente incassate e pagate, territorializzate nello stesso conto consolidato.

**Accesso:** [Catalogo Open CPT](https://politichecoesione.governo.it/it/politica-di-coesione/misurazione-valutazione-e-trasparenza/la-misurazione-delle-politiche-di-coesione/conti-pubblici-territoriali-cpt/i-dati/catalogo-open-cpt/).
**Copertura integrata:** serie 2000-2023 del perimetro Pubblica Amministrazione consolidata, 19 Regioni e Province autonome di Trento e Bolzano.

Lo snapshot unisce soltanto `EN_PA_CEMACRO` e `SP_PA_CEMACRO`, appartenenti alla stessa release e base di cassa. Gli input sono bloccati con SHA-256; una modifica della fonte interrompe l'ETL finché schema e risultati non vengono ricontrollati. Il valore derivato è `entrate meno spese`. È chiamato saldo contabile territoriale e non residuo fiscale: non misura pressione fiscale, qualità dei servizi, merito politico o trasferimenti netti tra territori. Il pro capite 2023 usa la popolazione residente ISTAT al 31 dicembre 2023; per gli altri anni resta `null` finché non viene integrata una serie demografica annuale verificata. I 21 denominatori sono una normalizzazione manuale della tavola ufficiale: oltre all'hash del PDF, l'ETL blocca il mapping ordinato con un secondo SHA-256 per rendere visibile qualunque modifica o scambio fra territori. Le condizioni di riuso sono registrate come nota per ciascun input e vanno controllate sulla relativa scheda ufficiale: le note legali generali del sito non sostituiscono eventuali indicazioni specifiche della risorsa.

La rigenerazione è intenzionalmente fail-closed: scaricare le tre distribuzioni dagli URL registrati nel manifest corrente, quindi eseguire:

```bash
python3 scripts/etl/cpt_regional_fiscal_snapshot.py \
  --revenue /percorso/en_pa_cemacro.csv \
  --expenditure /percorso/sp_pa_cemacro.csv \
  --population /percorso/CENSIMENTO-E-DINAMICA-DELLA-POPOLAZIONE-2023.pdf \
  --output src/data/generated/cpt-regional-fiscal.json \
  --observed-at 2026-08-20T22:46:15Z
```

`--observed-at` indica quando gli input sono stati verificati, non l'anno di aggiornamento dei dati. Se URL, hash, dimensione, schema o copertura cambiano, l'ETL deve fallire: prima di aggiornare le costanti occorre ricontrollare la nuova release e rieseguire l'intera suite.

### Redditi e variabili IRPEF comunali MEF

**Titolare:** MEF – Dipartimento delle Finanze.

**Uso:** contribuenti, reddito complessivo e imponibile, imposta netta dichiarata e addizionali dovute su base comunale.

**Release integrata:** anno d'imposta 2024, dichiarazioni 2025, pubblicata il 23 aprile 2026.

**Licenza:** CC BY 3.0.

Il CSV ufficiale contiene 7.896 Comuni e una riga residuale `Mancante/errata`.
Quest'ultima partecipa soltanto alla riconciliazione nazionale e non viene
distribuita artificialmente. Le celle oscurate dal MEF per segreto statistico
restano `null`: gli aggregati interessati espongono un subtotale noto e lo
stato parziale, non un totale stimato.

L'imposta netta è un valore dichiarato/calcolato, non gettito totale o cassa
riscossa. Non viene sottratta alle spese o al saldo CPT e non consente inferenze
su evasione, frode, responsabilità individuali o qualità amministrativa.
Manifest, hash, schema, definizioni e procedura di refresh sono documentati in
[MEF_IRPEF_COMUNALE.md](MEF_IRPEF_COMUNALE.md).

### Dati sui pagamenti art. 4-bis
Nel 2026 ANAC ha pubblicato uno schema di riferimento per i dati sui pagamenti nella sezione “Amministrazione Trasparente”.

Campi centrali dello schema:

```text
amministrazione.codiceFiscale
amministrazione.denominazione
dataPrimaPubblicazione
dataUltimaModifica
anno
trimestre
categoria
tipologia
importo
beneficiario
```

Strategia:

1. enumerare gli enti IPA;
2. ottenere il sito istituzionale;
3. individuare la sezione Amministrazione Trasparente;
4. cercare le risorse art. 4-bis;
5. preferire JSON/CSV/XML;
6. validare rispetto allo schema;
7. salvare fonte e hash;
8. non fare OCR di PDF se esiste un formato strutturato;
9. pubblicare un indice di copertura separato dalla spesa.

ANAC TrasparenzAI dimostra che il monitoraggio automatico della struttura di Amministrazione Trasparente è tecnicamente applicabile su scala IPA. DoveVannoINostriSoldi non deve duplicare il giudizio di conformità ANAC: deve usare la stessa idea di discovery per aggregare i dati effettivamente pubblicati.

## Tier 3: investimenti

### ReGiS / PNRR
Italia Domani pubblica estrazioni periodiche dei dati di attuazione PNRR. La prima integrazione copre esclusivamente la submisura `M4C1I1.01.00`, relativa ad asili nido, scuole dell'infanzia e servizi di educazione e cura per la prima infanzia.

Lo snapshot unisce quattro CSV ufficiali: progetti e localizzazioni tramite CUP; gare e aggiudicatari conservano inoltre CIG, Codice interno PDA e Codice procedura utente. Non vengono usati nomi testuali come chiavi. La release estratta il 13 giugno 2026 comprende 3.841 CUP, 3.842 localizzazioni, 18.851 gare e 18.250 righe aggiudicatario. Due righe aggiudicatario non hanno una chiave gara completa corrispondente e restano esplicitamente non collegate.

Gli importi sono distinti per significato: finanziamento PNRR, finanziamento totale, importo di gara e importo di aggiudicazione. Lo snapshot non contiene i pagamenti ReGiS e quindi non trasforma nessuno di questi valori in “spesa erogata”. Hash, dimensioni, copertura, rigenerazione e limiti sono documentati in [PNRR_CHILDCARE.md](PNRR_CHILDCARE.md).

### OpenCoesione
L'API e gli open data espongono progetti e soggetti, con tabelle relazionali per localizzazioni, pagamenti, impegni, fasi e indicatori. I dati sono pubblicati con licenza CC BY 4.0.

La prima integrazione usa l’aggregato nazionale ufficiale `/it/api/aggregati/`, che espone costo pubblico, pagamenti, numero di progetti, stati, temi, nature, serie annuale e data del rilascio. Lo snapshot viene controllato ogni 6 ore e committato soltanto quando cambia il payload normalizzato, esclusi i timestamp di osservazione.

Ogni dimensione deve riconciliarsi con il totale nazionale, sia per i valori generali sia per la componente coesione: sono tollerati al massimo 2 euro di scarto monetario dovuto agli arrotondamenti della fonte e nessuno scarto nel conteggio dei progetti. Le aggregazioni territoriali non sono ancora sommate perché i progetti multilocalizzati possono comparire in più territori e rendere i valori non additivi.

### OpenCUP

OpenCUP è l'anagrafe nazionale dei progetti di investimento pubblico promossa dal DIPE della Presidenza del Consiglio dei Ministri. Pubblica ogni mese progetti, localizzazioni, soggetti titolari e fonti di copertura con licenza CC BY 4.0. Il CUP è la chiave necessaria per collegare investimento, finanziamento, contratto e avanzamento senza usare corrispondenze testuali.

Il rilascio nazionale dei progetti supera 1,7 GB. Lo snapshot bulk registrato
contiene 11.942.784 record CSV reali; le 11.991.275 linee fisiche di dati
includono 48.491 newline interne a campi quotati e non indicano progetti
aggiuntivi. Per questo la fonte è registrata ma non viene scaricata durante una
richiesta Next.js. L'integrazione prevista usa:

1. discovery del rilascio mensile e dei suoi metadati;
2. download in object storage con hash e validator HTTP;
3. lettura streaming del CSV separato da pipe;
4. indice persistente per CUP e codice fiscale del soggetto titolare;
5. collegamenti a OpenCoesione, ReGiS e ANAC soltanto tramite identificativi esatti.

Il dataset OpenCUP che segnala candidati PNRR non certifica l'ammissione al finanziamento. Per i progetti PNRR effettivi resta necessaria la fonte ReGiS o l'elenco ufficiale dell'amministrazione responsabile.

### OpenCivitas

OpenCivitas pubblica dati comunali su fabbisogni standard, spesa storica e servizi. La prima integrazione usa il rilascio 2022 dei servizi totali e copre 6.557 Comuni delle 15 Regioni a statuto ordinario.

Per ogni Comune conserviamo:

- codice ISTAT, nome, provincia e regione;
- spesa storica e spesa standard;
- differenza totale, per abitante e percentuale;
- livello della spesa e dei servizi su scala 0-10;
- differenza dei servizi rispetto ai Comuni della stessa fascia di popolazione;
- motivi di non valutabilità e avvisi della fonte.

La differenza monetaria non è una prova di spreco. Un Comune può avere costi diversi o offrire più o meno servizi. Per questo l'API non ordina i risultati per differenza assoluta senza una richiesta esplicita e restituisce sempre le note metodologiche.

Il join con IPA e SIOPE usa il codice ISTAT del Comune. Le Regioni a statuto speciale e le Province autonome non sono trattate come dati mancanti: sono fuori dal perimetro dichiarato da questa pubblicazione.

### ISTAT SITUAS · caratteristiche geografiche comunali

La normalizzazione territoriale usa uno snapshot annuale dei report ufficiali SITUAS “Comuni - Dimensione”, “Comuni - Caratteristiche del territorio” e “Identificativi dei Comuni”. Le annualità 2022–2026 sono collegate esclusivamente con il codice ISTAT a sei cifre o, per SIOPE, con il codice fiscale comunale ufficiale. Lo snapshot conserva superficie, popolazione residente e anno della popolazione, densità, zona altimetrica, altitudine, grado di urbanizzazione, litoraneità e insularità, insieme a URL, dimensione e SHA-256 di ogni risposta acquisita.

`Euro per km²` è calcolato come importo in centesimi diviso per la superficie ISTAT espressa in km², con arrotondamento al centesimo. Se il denominatore non è disponibile o non è positivo, il valore resta `null`; per l'aggregato nazionale anche numeratore e superficie devono avere copertura completa. La metrica non è un giudizio di efficienza: rende confrontabile l'intensità finanziaria rispetto all'estensione amministrata. I confronti tra pari mantengono sempre fasce dichiarate di popolazione e superficie, pubblicano l'anno della popolazione ISTAT distinto dall'anno SIOPE e rilassano progressivamente gli altri fattori soltanto per ottenere almeno dieci osservazioni.

## Tier 4: incarichi e istituzioni

### Partecipazioni pubbliche MEF

La prima integrazione usa il CSV annuale del Dipartimento dell'Economia riferito al 2023. Il file sorgente è delimitato da `;` e usa byte Windows-1252 nonostante header HTTP incoerenti osservati: l'ETL rileva la codifica e conserva l'hash SHA-256.

Lo snapshot pubblico contiene aggregati nazionali e le organizzazioni dichiarate dal maggior numero di amministrazioni. La relazione è identificata tramite codice fiscale dell'amministrazione e della partecipata, insieme all'anno. Non pubblichiamo un booleano “in-house corrente”: controllo analogo e affidamento diretto restano dichiarazioni riferite all'anno di rilevazione.

L'elenco ANAC ex art. 192 è trattato come archivio storico perché ANAC lo dichiara non più operativo dal 1° luglio 2023. AUSA identifica stazioni appaltanti, ma non certifica la natura in-house. Registro Imprese resta fuori dall'ingestione open: l'accesso è contrattuale e le condizioni standard limitano redistribuzione e diffusione.

### Classificazione ISTAT S13

S13 e IPA hanno perimetri diversi. Finché la pubblicazione ufficiale corrente non espone una distribuzione analitica machine-readable verificabile, il portale mantiene S13 come fonte censita e non deduce l'appartenenza dal solo `Codice_ISTAT` presente in IPA.

### Consulenti Pubblici
Il Dipartimento della Funzione Pubblica pubblica gli incarichi comunicati dalle amministrazioni nell'Anagrafe delle prestazioni. Sono esposti, tra gli altri, compenso lordo, ammontare erogato e data di aggiornamento del singolo incarico.

La prima integrazione usa l'endpoint JSON pubblico impiegato dal portale per le statistiche nazionali. Lo snapshot contiene, dal 2023:

- incarichi esterni, incarichi conclusi e somme erogate comunicate;
- conteggi dei percettori persone fisiche e organizzazioni;
- incarichi conferiti o autorizzati ai dipendenti pubblici;
- ripartizione degli incarichi ai dipendenti tra dirigenti e non dirigenti.

Gli importi vengono convertiti in centesimi interi. Per gli incarichi ai dipendenti, dirigenti e non dirigenti devono riconciliarsi esattamente con il totale annuale. L'anno corrente resta esplicitamente parziale. Il campo tecnico `paConferenteCount` non viene reinterpretato come numero di amministrazioni distinte.

### Camera dei deputati
Camera Trasparente pubblica informazioni su bilancio, amministrazione e procedure di gara. L'API parlamentare espone il conto consuntivo 2025 e il bilancio 2026 come documenti distinti.

Per il consuntivo conserviamo gli importi effettivi estratti e li arrotondiamo
soltanto nella presentazione. Il PDF è bloccato nel manifesto con dimensione,
SHA-256 e riferimenti alle pagine usate. Il totale degli impegni comprende anche
le partite di giro, mentre le categorie pubblicate riguardano la spesa
effettiva. Per il bilancio 2026 gli importi sono previsioni, non pagamenti già
effettuati.

Il Titolo III “Spese previdenziali” del consuntivo 2025 è composto dalla
Categoria XII “Deputati cessati dal mandato” e dalla Categoria XIII “Personale
in quiescenza”. Non equivale ai soli vitalizi: il documento include anche
pensioni dirette e di reversibilità, rimborsi, accantonamenti e oneri del
personale in quiescenza. Le sottovoci non espongono una colonna separata di
pagamenti effettivi, quindi non ne stimiamo l'importo.

### Senato della Repubblica
La sezione Spese e trasparenza pubblica bilancio, conto consuntivo e informazioni sul trattamento economico dei senatori. Il monitor interno controlla i metadati dei nuovi documenti ufficiali e li registra nel manifesto della pipeline.

I valori del Senato non sono ancora normalizzati e non compaiono nell'API o nella pagina pubblica. La pubblicazione istituzionale non offre al momento una tabella aperta stabile e l'accesso automatico ai PDF può essere bloccato. Non estraiamo né stimiamo importi finché il formato non è verificabile. Camera e Senato hanno bilanci autonomi e non verranno sommati automaticamente.

### Presidenza del Consiglio dei ministri

La sezione Amministrazione trasparente della PCM pubblica bilanci di previsione e conti finanziari. La prima integrazione usa il workbook ufficiale del Rendiconto 2024, approvato il 10 giugno 2025 e pubblicato il 19 giugno 2025.

Il file contiene 572 righe di capitolo. La pipeline conserva separati stanziamento definitivo di competenza, impegni, pagamenti in conto competenza e pagamenti in conto residui. Il totale pagato della pagina è la somma dichiarata delle due colonne di pagamento; non è sommato agli impegni o agli stanziamenti. Tutte le righe riconciliano `impegnato = pagato C/C + rimasto da pagare C/C`.

Il perimetro è la sola Presidenza del Consiglio. Non viene unito al bilancio dello Stato, ai Ministeri o ai bilanci autonomi di Camera e Senato. La pagina ufficiale non dichiara una licenza per il workbook; il portale non ne inventa una. Manifesto, checksum, trasformazione e comandi di verifica sono documentati in `docs/PCM_FINANCIAL_2024.md`.

## Fonti successive

### Anagrafe delle opere incompiute

Il Ministero delle Infrastrutture e dei Trasporti pubblica una rilevazione annuale nazionale e le anagrafi regionali. La pubblicazione contiene CUP, stazione appaltante, importi, oneri per completare l'opera, stato e percentuale di avanzamento.

La fonte è registrata ma non ancora importata. Il rilascio nazionale corrente è un PDF: serve un estrattore versionato con fixture reali e arresto esplicito quando cambia il layout. Il CUP consentirà il collegamento esatto con MOP senza confronti incerti sul nome dell'opera.

### Estensioni Conti Pubblici Territoriali

CPT permette anche di leggere i conti per settore, categoria economica, tipo di soggetto e perimetro del Settore Pubblico Allargato. Queste dimensioni sono ulteriori rispetto allo snapshot PA macroeconomico già integrato.

Non vanno sommate a SIOPE o allo snapshot corrente: perimetro, classificazione e regole di consolidamento sono diversi. Ogni estensione richiederà un dataset autonomo, lo stesso blocco di provenienza e test di riconciliazione dedicati.

### ReNDiS

ISPRA e MASE raccolgono dati tecnici, finanziari e attuativi sugli interventi contro il dissesto idrogeologico. Il CUP permette di collegare un intervento a OpenBDAP MOP e, in seguito, a OpenCUP e ai contratti ANAC.

La piattaforma dichiara aggiornamento continuo e sincronizzazione settimanale con BDAP per gli interventi associati a CUP. L'adapter resta da implementare: prima vanno identificati il canale open data stabile, la licenza della singola risorsa e le regole per distinguere interventi MASE ed extra-MASE.

Altre fonti da valutare nella fase 2:

- sovvenzioni e contributi art. 26/27 D.Lgs. 33/2013;
- patrimonio e partecipazioni pubbliche;
- tempi di pagamento e debiti commerciali;
- personale pubblico;
- sanità;
- dati regionali e comunali con maggiore granularità;
- serie storica OpenCivitas 2015-2022 e singole funzioni comunali;
- Corte dei conti per contesto e referti, senza confondere contestazioni, sentenze e dati di spesa.

### Debito pubblico italiano

La pagina `/debito` usa esclusivamente i cubi BDS di Banca d'Italia
`TCCE0125`, `TCCE0175`, `TCCE0200`, `TCCE0325` e il dataset Eurostat
`gov_10a_main`, limitato a `D41PAY` e `TE` per l'Italia. Gli importi sono
convertiti da milioni di euro a centesimi interi sicuri e riconciliati prima
della pubblicazione. Stock mensile, detentori, vita residua e interessi annuali
mantengono date distinte; non vengono prodotti valori pro capite o previsioni.

Il primo snapshot, acquisito il 24 agosto 2026, è stato confrontato con le
Tavole 2, 4, 5 e 7 della [pubblicazione Banca d'Italia del 14 agosto
2026](https://www.bancaditalia.it/pubblicazioni/finanza-pubblica/2026-finanza-pubblica/statistiche_FPI_20260814.pdf). I
valori BDS di giugno coincidono con il PDF, tenendo conto dell'arrotondamento
del PDF al milione: debito 3.207.247,3 milioni di euro, variazione mensile
26.183,9 milioni, fabbisogno 13.259,2 milioni, transazioni 23.035,2 milioni,
variazione della liquidità −9.776,0 milioni e vita media residua 7,9 anni. I
detentori completi restano correttamente riferiti a maggio 2026.

Nello stesso controllo, il Data Browser e la Statistics API Eurostat
`gov_10a_main` esponevano per il 2025 interessi `D41PAY` pari a 87.146 milioni
di euro e spesa totale `TE` pari a 1.155.309 milioni, da cui la quota half-up
del 7,54%. La versione upstream dichiarata era
`2026-07-21T11:00:00+0200`. Questi numeri documentano la caratterizzazione del
primo rilascio: il runtime continua a leggere lo snapshot aggiornabile e non li
usa come costanti dell'interfaccia.
