# Avvisi TED con committenti in Italia

L’issue #183 collega TED alla piattaforma con un primo archivio mensile:
**2.825 avvisi pubblicati dal 1 al 31 agosto 2026**, con almeno un committente
che dichiara `buyer-country=ITA`. La pagina è `/appalti/ted`, accanto ad Appalti.
La fonte è l’Ufficio delle pubblicazioni dell’Unione europea.

## Contratto della fonte

- [Search API TED](https://docs.ted.europa.eu/api/latest/search.html), pubblica e senza autenticazione: `POST https://api.ted.europa.eu/v3/notices/search`.
- [Paginazione ufficiale](https://docs.ted.europa.eu/ODS/latest/reuse/search-api.html): massimo 250 avvisi per pagina; qui 11 pagine da 250 e una da 75, nessun timeout o duplicato. Query con `scope=ALL`, `paginationMode=PAGE_NUMBER` e ordinamento per numero di pubblicazione.
- Query: `buyer-country = ITA AND publication-date >= 20260801 AND publication-date <= 20260831 SORT BY publication-number`.
- Periodo: **data di pubblicazione dell’avviso**, presente in ogni record; non data di aggiudicazione, esecuzione o pagamento. Nessuna data di rilascio della risposta API è dichiarata: `publicationDate` del dataset resta `null`.
- Acquisizione e verifica: **6 settembre 2026**. TED pubblica quotidianamente; questo snapshot mensile si aggiorna con nuova acquisizione, revisione del lock e PR.
- [Nota sul riuso TED](https://ted.europa.eu/en/legal-notice): avvisi GUUE liberamente riutilizzabili, salvo diversa indicazione, secondo la decisione 2011/833/UE; metadati SIMAP CC0 1.0. La CC BY 4.0 dell’editoriale del sito **non** viene estesa agli avvisi. Attribuzione: © Unione europea; proiezione DVNS.

Il lock `scripts/etl/specs/ted-notices.source.json` registra corpo della richiesta,
byte e SHA-256 di ciascuna delle dodici risposte e i riferimenti di licenza/API.
I gzip in `tests/fixtures/ted-notices/` conservano integralmente i byte delle
risposte, per una riproduzione offline. La richiesta seleziona i campi
dell’avviso e i nomi dei committenti; non richiede campi di contatto né usa account.

## Che cosa misura

L’unità è un **numero di pubblicazione TED**. Non è un contratto, un lotto,
un CIG unico o un pagamento. Non si estraggono né sommano importi. Un risultato
può contenere più lotti, annullamenti o altri esiti: non certifica da solo un
contratto aggiudicato. I tipi originali rimangono separati:

| `form-type` | Avvisi | Etichetta nella pagina |
| --- | ---: | --- |
| `result` | 1.450 | Risultato |
| `competition` | 1.210 | Gara |
| `cont-modif` | 84 | Modifica del contratto |
| `planning` | 39 | Programmazione |
| `dir-awa-pre` | 32 | Aggiudicazione diretta prevista |
| `consultation` | 10 | Consultazione |

Il paese del committente non è il luogo di esecuzione. Sono inclusi enti UE con
sede in Italia e tre avvisi con committenti di più paesi. Non si ricostruisce
la geografia dei lavori, non si escludono questi avvisi e non li si attribuisce
interamente alla PA italiana. L’archivio non rappresenta tutti gli appalti italiani.

TED e ANAC possono contenere le stesse procedure. Non sommare le due fonti,
né usare un CIG trovato in testo libero come chiave stabile di join. Nessuna
deduzione di elusione delle soglie, frode, spreco o efficienza.

## Proiezione e superfici

Un solo dataset, `ted-avvisi-italia-2026-08`, passa dal corpus integrato e da
`selectIntegratedDataset`. La pagina mostra 25 avvisi per volta, in ordine
decrescente di data e numero; ricerca e cursore hanno gli stessi limiti del
selettore pubblico. Gli avvisi restano sul server fino alla selezione della pagina.

Le nove colonne sono numero, data, tipo, titolo, committenti, lingua dei
committenti, paesi dei committenti, CPV e URL ufficiale. La data conserva il
giorno di calendario pubblicato, rimuovendo solo il suffisso `+02:00`; non
viene convertita a mezzanotte UTC. Titoli italiani come
pubblicati; nomi italiani dove presenti, altrimenti inglesi in 21 avvisi,
con lingua esplicita. Nomi, paesi e CPV restano array JSON nella tabella:
non vengono associati per posizione e non sono righe di lotto. Le traduzioni
alternative rimangono nelle risposte originali. La pagina elimina soltanto
le ripetizioni dei codici CPV e dei paesi nella presentazione, non nel corpus.

La proiezione PSV occupa **1.217.822 byte**, SHA-256
`f5125940d68d72f1f29a228e3a3f07641f182df6535b46acee2a0c49049a05eb`.
Il delta della release è +1 dataset e +2.825 righe sorgente/pubbliche; le righe
del ledger contano la proiezione, non le molteplici traduzioni o i link della
risposta API. I tre chunk pubblici sono verificati contro le risposte originali.

- `/appalti/ted`: pagina leggibile, ricerca, cursori e link agli avvisi.
- `/dati/ted-avvisi-italia-2026-08`: tabella completa, provenienza, caveat e condizioni di riuso.
- `/api/dati/ted-avvisi-italia-2026-08?q=533445-2026&limit=25`: stesse righe pubbliche.
- MCP `query_dataset`: `{"dataset":"spesa_pa_dettaglio","code":"ted-avvisi-italia-2026-08","query":"533445-2026","limit":25}`. Nessun identificativo MCP parallelo.

## Riproduzione

Con `.venv` e guard offline da `CONTRIBUTING.md`:

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/ted_notices.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python -m unittest discover -s tests/etl -p 'test_ted_notices.py'
node --experimental-strip-types --test tests/ted-notices.test.mjs
```

Per confrontare le risposte originali già acquisite, passare `--input-dir` con
i file `page-01.json` … `page-12.json`. Per rigenerare la proiezione usare
`--output-dir`. Il programma non scarica implicitamente nulla.

Una nuova acquisizione usa il corpo `request` del lock, aggiungendo `page`
da 1 a 12, con `Content-Type: application/json`; `checkQuerySyntax=false`
esegue la ricerca. Devono coincidere conteggio totale, dimensione di ogni
pagina, identificativi univoci, mese, geografia, tipi e link. Un cambiamento
dei byte interrompe `--check`: nessun aggiornamento silenzioso del lock.

I test esercitano anche pagine mancanti, timeout, duplicati, schema, hash,
paesi, date, lingue e URL incoerenti, più concordanza fra pagina, API e MCP,
cursori e ricerca vuota. La CI controlla la release completa separatamente.
