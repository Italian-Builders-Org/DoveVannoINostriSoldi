# Patrimonio immobiliare MEF di Comuni ed enti ERP (2023)

Issue: [#609](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/609).

## Fonte

| | |
| --- | --- |
| Titolare | Ministero dell'Economia e delle Finanze – Dipartimento dell'Economia |
| Pagine | [beni immobili 2023](https://www.de.mef.gov.it/it/attivita_istituzionali/patrimonio_pubblico/censimento_immobili_pubblici/open_data_immobili/dati_immobili_2023.html), [detenzioni a favore di terzi 2023](https://www.de.mef.gov.it/it/attivita_istituzionali/patrimonio_pubblico/censimento_immobili_pubblici/open_data_immobili/detenzioni_favore_di_terzi_2023.html) |
| Base normativa | art. 2, c. 222, L. 191/2009 |
| Licenza | CC BY 4.0, dichiarata nelle pagine di pubblicazione |
| Periodo | anno 2023 dichiarato dalla fonte; vedi Limiti per gli enti che non hanno comunicato |
| Pubblicazione | 5 maggio 2026 |
| Acquisizione e controllo | 23 settembre 2026 per gli archivi, 24 settembre 2026 per il file di adempimento |
| Formato | 42 ZIP con un CSV ciascuno, separatore `;`, codifica Windows-1252; `Dati_Adempimento_Anno_2023.csv`, separatore `;`, codifica UTF-8 |
| Perimetro | 20 archivi regionali dei Comuni e 1 degli enti territoriali per l'edilizia residenziale pubblica, per beni e per detenzioni |
| Frequenza | rilevazione annuale; rilasci open data 2015-2019, 2022, 2023 |

Il lock `scripts/etl/specs/mef-patrimonio-immobiliare.source.json` fissa URL,
byte, SHA-256, membro CSV e numero di righe di ogni archivio, gli header e i
domini dei campi chiusi. Il blocco `adempimento` fa lo stesso per il file di
adempimento e fissa i conteggi riconciliati descritti sotto.

## Proiezione

Gli archivi contano 2.640.689 righe di beni e 449.258 detenzioni. La
pubblicazione riga per riga richiederebbe una decisione dimensionale (ADR-001):
questa proiezione aggrega per ente dichiarante, identificato dal codice fiscale.

- `mef-patrimonio-beni-2023` (140.712 righe): ente × titolo × stato d'uso ×
  dato a terzi × tipologia × comune del bene, con numero di beni, beni con
  superficie positiva e somma esatta della superficie di riferimento.
- `mef-patrimonio-contratti-2023` (21.034 righe): ente × tipo di detenzione ×
  finalità dichiarata per le persone fisiche × tipologia, con contratti su
  intera unità, contratti con canone positivo, zero o assente, canone totale e
  i due addendi del rapporto canone/superficie.
- `mef-patrimonio-adempimento-2023` (7.977 righe): una riga per Comune o ente
  ERP del file di adempimento, con obbligo, invio della comunicazione 2023,
  dichiarazione negativa, dichiarazione di completezza, beni dichiarati e
  presenza nei due censimenti pubblicati. Nessuna aggregazione.

Il rapporto €/m² annuo è `Canone annuo per rapporto (EUR) ÷ Superficie per
rapporto (m²)`, calcolato solo sui contratti su intera unità con canone
positivo e superficie dichiarata. Somme e conteggi si possono aggregare tra enti;
le mediane no, e per questo non sono pubblicate.

## Contratto fail-closed

L'ETL blocca: byte o hash divergenti, membri ZIP inattesi, codifica non
Windows-1252, header o numero di colonne diversi, righe diverse dal lock,
codice fiscale ente non nella forma `[11 cifre]`, tipologia ente fuori
perimetro, titolo assente o doppio, valori fuori dominio (titolo, stato d'uso,
tipo di detenzione, intera unità, finalità), superfici non nella forma
`intero[,decimali]`, canoni non interi o negativi (primitiva `monetary`),
anagrafica dello stesso ente diversa tra righe o archivi, e ogni aggregazione
che non si riconcilia con il totale delle righe sorgente. Il lock dichiara anche
l'unica riga di beni ripetuta identica, che resta conteggiata come nella fonte.

## Adempimento 2023

La rilevazione 2023 chiedeva di aggiornare «quanto presente a sistema alla
chiusura del censimento relativo al 31/12/2022». Un ente che non invia la
comunicazione resta quindi nel censimento con i dati dell'ultima comunicazione.
Il file di adempimento lo rende visibile: nel perimetro 1.293 enti (1.254 Comuni
e 39 enti ERP) hanno `Invio comunicazione = No` e beni nel censimento pubblicato.

Il file copre 11.326 amministrazioni; ne entrano 7.977 (7.900 Comuni e 77 enti
ERP), le altre 3.349 sono validate ma non pubblicate. I valori della fonte
restano «Si» e «No»; una cella vuota non è un «No». Il dataset si collega ai
due del censimento sul codice fiscale dell'ente.

L'ETL blocca, oltre a byte, codifica, header e righe diversi dal lock: codice
fiscale non nella forma `[11 cifre]` o ripetuto; invio o obbligo fuori dominio;
dichiarazione negativa o di completezza valorizzata senza invio, o assente con
invio; obbligo vuoto per un'amministrazione S13; conteggi dei beni non interi.
Per il perimetro riconcilia in modo esatto con i dataset del censimento:
«Nome sezione» e «Nome file Beni Immobili Dichiarati» sono valorizzati se e solo
se l'ente ha beni nel censimento, «Nome file Detenzioni a favore di terzi» se e
solo se ha detenzioni, ogni ente del censimento ha una riga di adempimento e
denominazione, tipologia, regione, provincia e codice catastale coincidono. Il
nome del Comune non è confrontato: per due Comuni nati da fusione differisce
solo per maiuscole e trattino. I conteggi per tipologia, invio, invio mancato
con beni nel censimento, dichiarazioni negative con beni e completezza negata
sono fissati nel lock.

I conteggi «Beni in proprietà dichiarati» e «Beni in detenzione dichiarati»
sono quelli del file di adempimento e per alcuni enti differiscono dalle righe
del censimento: non lo sostituiscono.

## Limiti

- «Non utilizzato» è dichiarato dall'ente e non dice se il bene sia agibile,
  affittabile o occupato. «Non indicato» è una cella vuota nella fonte: nel
  66% dei casi il bene è dato interamente a terzi. La colonna «Dato a terzi»
  lo esplicita dai due flag della fonte (interamente, parzialmente, no, non
  indicato); combinazioni non osservate bloccano l'ETL.
- Il comune del bene può differire dal Comune dell'ente: Roma Capitale
  dichiara beni in 17 Comuni. Una mappa per luogo usa il comune del bene.
- Il titolo separa beni posseduti e beni detenuti da terzi; gli enti ERP
  dichiarano anche alloggi gestiti per conto dei Comuni. Non si sommano.
- Il canone è contrattuale: non misura incassi o morosità. Il canone ERP è
  determinato per legge e non è confrontabile con il mercato.
- Il censimento include enti che non hanno inviato la comunicazione 2023:
  per loro restano a sistema dati di comunicazioni precedenti, di anno non
  dichiarato. Nel rilascio 2023 sono 1.254 Comuni e 39 enti ERP, per 403.192
  beni, secondo `Dati_Adempimento_Anno_2023.csv`, pubblicato a parte come
  dataset collegato `mef-patrimonio-adempimento-2023` (#609). Gli enti senza
  alcuna comunicazione non compaiono nel censimento.
- Catalogo e API cercano a pagine: una pagina vuota non significa che l'ente
  sia assente. La scheda ente usa il filtro esatto sul codice fiscale.
- La fonte non pubblica nome e codice fiscale delle persone fisiche che
  ricevono i beni; l'aggregazione per ente non espone singoli alloggi.

## Riproduzione

I 42 ZIP e il file di adempimento non sono versionati. Scaricali dagli URL del
lock in una directory locale, poi:

```bash
PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/mef_patrimonio_immobiliare.py --input-dir DIR --check
```

`--output-dir DIR_OUT` scrive le tre proiezioni `.psv` con byte, SHA-256 e
righe; `--publish` accoda al corpus quelle non ancora presenti. Su Windows `--publish` richiede Python
3.13: 3.12 non espone `os.fchmod` e le build Windows di 3.14 usano zlib-ng,
che non riproduce i gzip canonici già versionati.

I test `tests/etl/test_mef_patrimonio_immobiliare.py` usano archivi sintetici
generati al volo; `tests/mef-patrimonio-immobiliare.test.mjs` verifica le righe
pubblicate tramite selettore, API e MCP.
