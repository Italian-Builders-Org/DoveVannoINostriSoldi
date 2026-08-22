# Fonti dati

Questa è la mappa iniziale delle fonti. Il criterio è semplice: prima fonti istituzionali nazionali, strutturate e con identificativi stabili; poi portali territoriali e documenti meno standardizzati.

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
**Stato:** il MCP espone uno snapshot aggregato verificato sui dodici file CIG 2025. Conserva copertura, hash, criteri di replica e limiti; non offre ancora ricerca live per singolo CIG, aggiudicatario o fornitore.

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

Il rilascio nazionale dei progetti supera 1,7 GB. Per questo la fonte è registrata ma non viene scaricata durante una richiesta Next.js. L'integrazione prevista usa:

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
