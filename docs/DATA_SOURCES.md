# Fonti dati

Questa è la mappa iniziale delle fonti. Il criterio è semplice: prima fonti istituzionali nazionali, strutturate e con identificativi stabili; poi portali territoriali e documenti meno standardizzati.

## Tier 1: infrastrutture nazionali

### SIOPE / SIOPE+
**Titolari/gestori:** RGS e Banca d'Italia.  
**Uso:** incassi e pagamenti degli enti pubblici.  
**Join:** ente, periodo, codifica gestionale/contabile.  
**Nota:** SIOPE contiene dati per oltre 10.000 enti. SIOPE+ è l'infrastruttura degli ordinativi di pagamento e incasso; non va confusa la frequenza del flusso operativo con la frequenza del dato pubblico esposto dalla dashboard.

### OpenBDAP
**Titolare:** Ragioneria Generale dello Stato.  
**Uso:** bilancio dello Stato, spesa, SIOPE, opere pubbliche, PNRR e altri domini.  
**Accesso:** catalogo e API OData ufficiali.
**Endpoint implementati:** pagamenti dello Stato e `GET /api/opere?cup=...` per le opere pubbliche MOP.

Il connettore MOP legge prima i metadati e lo schema ufficiale. Gli alias tecnici delle colonne vengono scoperti a ogni controllo e accettati soltanto se nome, significato e tipo restano quelli previsti dal contratto. Questo evita di pubblicare valori nella colonna sbagliata dopo una modifica della fonte.

Al controllo del 3 agosto 2026, lo schema dichiarava 560.245 codici locali di progetto e 541.539 CUP distinti. La ricerca usa il CUP esatto e interroga soltanto le righe necessarie: non scarica oltre mezzo milione di opere durante una richiesta web.

Per ogni opera manteniamo distinti:

- costo previsto e costo effettivo;
- finanziamenti statali, europei, territoriali, privati e altre fonti;
- finanziamenti ancora da trovare;
- date previste e date effettive;
- avvisi sulla qualità del dato.

Gli avvisi su tempi, costi o copertura finanziaria hanno uso di screening. Indicano cosa verificare e includono spiegazioni alternative plausibili. Non classificano automaticamente un'opera come spreco, irregolarità o illecito.

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

## Tier 2: trasparenza distribuita

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
Gli open data PNRR sono pubblicati come estrazioni periodiche da ReGiS e comprendono informazioni finanziarie, fisiche e procedurali. Useremo CUP come una delle chiavi fondamentali.

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

Per il consuntivo sono disponibili pagamenti e categorie arrotondati come nel documento ufficiale. Il totale degli impegni comprende anche le partite di giro, mentre le categorie pubblicate riguardano la spesa effettiva. Per il bilancio 2026 gli importi sono previsioni, non pagamenti già effettuati.

### Senato della Repubblica
La sezione Spese e trasparenza pubblica bilancio, conto consuntivo e informazioni sul trattamento economico dei senatori. Il monitor interno controlla i metadati dei nuovi documenti ufficiali e li registra nel manifesto della pipeline.

I valori del Senato non sono ancora normalizzati e non compaiono nell'API o nella pagina pubblica. La pubblicazione istituzionale non offre al momento una tabella aperta stabile e l'accesso automatico ai PDF può essere bloccato. Non estraiamo né stimiamo importi finché il formato non è verificabile. Camera e Senato hanno bilanci autonomi e non verranno sommati automaticamente.

## Fonti successive

### Anagrafe delle opere incompiute

Il Ministero delle Infrastrutture e dei Trasporti pubblica una rilevazione annuale nazionale e le anagrafi regionali. La pubblicazione contiene CUP, stazione appaltante, importi, oneri per completare l'opera, stato e percentuale di avanzamento.

La fonte è registrata ma non ancora importata. Il rilascio nazionale corrente è un PDF: serve un estrattore versionato con fixture reali e arresto esplicito quando cambia il layout. Il CUP consentirà il collegamento esatto con MOP senza confronti incerti sul nome dell'opera.

### Conti Pubblici Territoriali

CPT permette di leggere la spesa consolidata per territorio, settore, categoria economica e tipo di soggetto. È utile per spiegare dove si concentra la spesa del Settore Pubblico Allargato.

Non va sommato a SIOPE. Perimetro, classificazione e regole di consolidamento sono diversi. La fonte resta mappata finché il catalogo non viene acquisito con una pipeline stabile e verificabile.

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
