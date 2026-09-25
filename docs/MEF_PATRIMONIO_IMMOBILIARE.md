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
| Acquisizione e controllo | 23 settembre 2026 |
| Formato | 42 ZIP con un CSV ciascuno, separatore `;`, codifica Windows-1252 |
| Perimetro | 20 archivi regionali dei Comuni e 1 degli enti territoriali per l'edilizia residenziale pubblica, per beni e per detenzioni |
| Frequenza | rilevazione annuale; rilasci open data 2015-2019, 2022, 2023 |

Il lock `scripts/etl/specs/mef-patrimonio-immobiliare.source.json` fissa URL,
byte, SHA-256, membro CSV e numero di righe di ogni archivio, gli header e i
domini dei campi chiusi.

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
  alcuna comunicazione non compaiono.
- Catalogo e API cercano a pagine: una pagina vuota non significa che l'ente
  sia assente. La scheda ente usa il filtro esatto sul codice fiscale.
- La fonte non pubblica nome e codice fiscale delle persone fisiche che
  ricevono i beni; l'aggregazione per ente non espone singoli alloggi.

## Riproduzione

I 42 ZIP non sono versionati. Scaricali dagli URL del lock in una directory
locale, poi:

```bash
PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/mef_patrimonio_immobiliare.py --input-dir DIR --check
```

`--output-dir DIR_OUT` scrive le due proiezioni `.psv` con byte, SHA-256 e
righe; `--publish` le accoda al corpus. Su Windows `--publish` richiede Python
3.13: 3.12 non espone `os.fchmod` e le build Windows di 3.14 usano zlib-ng,
che non riproduce i gzip canonici già versionati.

I test `tests/etl/test_mef_patrimonio_immobiliare.py` usano archivi sintetici
generati al volo; `tests/mef-patrimonio-immobiliare.test.mjs` verifica le righe
pubblicate tramite selettore, API e MCP.
