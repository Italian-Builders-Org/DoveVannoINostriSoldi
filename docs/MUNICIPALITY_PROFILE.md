# Scheda economica comunale

La pagina `/enti/[codiceIPA]` e l'API corrispondente aggiungono un `municipalityProfile` alle
amministrazioni riconosciute con certezza come Comuni. La scheda IPA rimane disponibile anche
quando il profilo non può essere costruito. Non vengono mai usati denominazione, similarità del
testo o coordinate geografiche per collegare record.

## Regole di collegamento

Il profilo si attiva soltanto quando il codice fiscale IPA individua una riga dell'anagrafica
comunale SIOPE e il Codice IPA pubblicato nei due dataset coincide. I collegamenti successivi sono:

- MEF IRPEF: Codice ISTAT comunale a sei cifre; anche il codice catastale MEF deve coincidere con
  quello IPA;
- OpenCivitas: lo stesso Codice ISTAT, soltanto dopo la verifica MEF/IPA del codice catastale;
- PNRR asili e prima infanzia: codice fiscale esatto del soggetto attuatore;
- SIOPE: codice fiscale e Codice IPA, mantenendo separate le annualità 2024, 2025 e 2026.
- ISTAT SITUAS: codice ISTAT a sei cifre e codice fiscale comunale, mantenendo separati gli snapshot annuali 2022–2026.

Un identificativo ambiguo, assente o incoerente interrompe soltanto il collegamento interessato.
Non viene pubblicata una corrispondenza probabile.

## Copertura verificata

Audit eseguito sugli snapshot inclusi nel repository il 23 agosto 2026:

| Fonte/anno | Perimetro presente nello snapshot | Collegamenti disponibili |
| --- | ---: | ---: |
| SIOPE 2024 | 7.905 Comuni attivi | 7.904 con movimenti; 7.892 con Codice IPA univoco |
| SIOPE 2025 | 7.902 Comuni attivi | 7.896 con movimenti; 7.892 con Codice IPA univoco |
| SIOPE 2026 | 7.903 Comuni attivi | 7.896 con movimenti; 7.893 con Codice IPA univoco |
| MEF IRPEF 2024 | 7.896 righe comunali | collegamento subordinato anche alla coerenza del codice catastale |
| OpenCivitas 2022 | 6.557 Comuni | sole Regioni a statuto ordinario |
| PNRR asili | 3.841 progetti | 2.701 codici fiscali distinti di soggetti attuatori |

Il numero dei Comuni SIOPE cambia tra gli anni per istituzioni, cessazioni e variazioni
amministrative. Le dieci righe 2026 senza un Codice IPA univoco restano incluse nei totali
nazionali, ma non attivano una scheda economica per evitare falsi collegamenti.

Il confronto dei codici fiscali attivi quantifica anche le variazioni tra snapshot: dal 2024 al
2025 escono tre codici fiscali e non ne entra nessuno; dal 2025 al 2026 entra un nuovo codice e non
ne esce nessuno. Tra i codici fiscali presenti in due anni consecutivi non risultano cambi di
Codice IPA. Le righe senza Codice IPA univoco sono 13 nel 2024, 10 nel 2025 e 10 nel 2026. Queste
quantità descrivono la validità nelle anagrafiche ufficiali, non deducono fusioni o successioni dal
nome dell'ente.

## Artefatti SIOPE e riconciliazione

L'ETL continua a produrre gli snapshot aggregati e le top 100 esistenti. In aggiunta genera tre
artefatti compatti `siope-municipal-detail*.json`, con una riga per ogni Comune attivo, popolazione,
totale e importi per Titolo di spesa. Gli importi sono interi in centesimi.

Per ogni anno il contratto runtime verifica che:

- ogni codice fiscale sia unico;
- somma dei Titoli e totale comunale coincidano;
- somma dei Comuni e totale nazionale coincidano;
- periodo, data di osservazione e conteggi di copertura coincidano con lo snapshot aggregato.

`totalCents: null` significa che non sono stati osservati movimenti nel periodo; `0` significa che
il valore osservato è realmente zero. Questa distinzione viene conservata fino alla UI e all'API.

## Interpretazione dei pannelli

- IRPEF descrive redditi e imposte dichiarate dai contribuenti residenti, non entrate del Comune.
- OpenCivitas fuori dal proprio perimetro territoriale è indicato come “fuori perimetro”, non zero.
- zero progetti PNRR significa nessun progetto nel solo verticale asili e prima infanzia analizzato.
- finanziamenti PNRR, importi di gara e pagamenti sono misure differenti; la prima release mostra i
  finanziamenti noti senza chiamarli spesa realizzata.
- SIOPE 2026 può essere parziale: mese finale, data del dato e completezza sono visibili.
- La scheda mostra totale, valore per abitante e valore per km² dello stesso importo SIOPE. Il benchmark tra pari usa almeno dieci osservazioni, esclude il Comune corrente e pubblica criteri e livello di fallback; superficie e fattori geografici restano visibili come contesto, non come punteggio di complessità o efficienza.

La prima release non include confronti diretti tra Comuni, serie mensili comunali o dettaglio
comunale ANAC e consulenze.
