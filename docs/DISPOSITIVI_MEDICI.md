# Dispositivi medici: corpus e viste 2018–2021

Questo documento descrive il corpus e le viste pubbliche della issue #370. La
pagina sanitaria, l'API e il dataset MCP usano la stessa libreria lato server.
Le fonti conservano gli identificativi del catalogo condiviso.

| Tabella | Periodo/snapshot | Righe |
| --- | --- | ---: |
| `salute-spesa-dispositivi-2018` | 2018 | 718.808 |
| `salute-spesa-dispositivi-2019` | 2019 | 768.233 |
| `salute-spesa-dispositivi-2020` | 2020 | 787.845 |
| `salute-spesa-dispositivi-2021` | 2021 | 846.878 |
| `salute-dispositivi-bdrdm` | 14 settembre 2026 | 2.416.708 |
| `salute-classificazione-cnd` | 1 settembre 2026 | 11.115 |

Titolare: Ministero della Salute. IODL 2.0 verificata per ciascuna risorsa.
URL ufficiali, SHA-256 dei file e membri ZIP, byte, schema, date e conteggi sono
in `scripts/etl/specs/medical-device-spending-pilot.source.json`. Le appendici
2022 e 2023 restano fuori dal corpus, con licenza `not-declared`; non si estende
la licenza delle schede Open Data ad altri allegati.

La fonte riporta la spesa per acquisti nel perimetro pubblicato. Non riporta la
spesa completa del SSN, pagamenti al fabbricante o prezzi unitari. Originali
monetari italiani e rettifiche restano stringhe; il modello
usa `parse_source_euros` e `monetary.add_decimals` senza float. Totali osservati:
2018 **4.761.199.569,23 euro**, 2019 **5.029.122.308,87 euro**,
2020 **5.054.732.845,13 euro**, 2021 **5.785.471.036,54 euro**. Non sommare CE,
SIOPE, aggiudicazioni o release sovrapposte dello stesso anno.

BD/RDM e CND non hanno misure monetarie. La chiave BD/RDM è tipo + identificativo,
non il flag di iscrizione, il nome o il solo numero. Lo snapshot corrente non
ricostruisce la situazione storica. CND della spesa, CND dell'anagrafica e
intervalli della classificazione rimangono separati; nessuna conversione CID/EMDN.
La data `9999/12/31` è convenzionale, non una scadenza commerciale reale.

## Copertura storica

La serie pubblicata in questa integrazione copre il 2018–2021. Gli anni
precedenti non sono rappresentati come zero:

- il 2012 non contiene il numero di repertorio;
- il 2013 è diviso in due semestri e non contiene tipo dispositivo o CND;
- il 2014 contiene il numero di repertorio, ma non tipo dispositivo o CND;
- il 2015–2017 contiene tipo e numero di repertorio, ma non la CND della riga.

Questi file richiedono contratti distinti prima di entrare nel corpus. Non si
completano i campi assenti usando lo snapshot corrente. Le
[versioni storiche della CND](https://www.salute.gov.it/new/it/tema/dispositivi-medici/le-diverse-versioni-e-i-criteri-di-revisione-della-cnd/)
pubblicate dal Ministero aiutano a interpretare un codice presente nella fonte,
ma non dimostrano quale classificazione avesse una riga che non lo riporta.

Il Ministero pubblica il
[dataset completo corrente della BD/RDM](https://www.dati.salute.gov.it/it/dataset/dispositivi-medici/)
e le
[variazioni settimanali](https://www.dati.salute.gov.it/it/dataset/dispositivi-medici-variazioni-settimanali/).
La seconda risorsa conserva sul portale la pubblicazione corrente e le due
settimane precedenti, quindi non costituisce una serie di snapshot annuali. Il
[dizionario BD/RDM](https://www.dati.salute.gov.it/dati/documenti/ID_1_16_Dataset_Dispositivi_medici_v2.0.pdf)
documenta date di validità e un riferimento facoltativo alla notifica
precedente. Sono informazioni della singola registrazione, non una
ricostruzione certificata dell'anagrafica per ciascun anno di spesa.

La CND è alla base della
[EMDN europea](https://health.ec.europa.eu/medical-devices-topics-interest/european-medical-devices-nomenclature-emdn_en),
ma questo rapporto non equivale a un raccordo riga per riga. La ricognizione
delle fonti ufficiali, compreso il
[decreto che adotta la CID](https://www.gazzettaufficiale.it/eli/id/2026/02/13/26A00710/SG),
è stata chiusa il 18 settembre 2026 senza individuare un crosswalk pubblicato e
versionato tra CND, EMDN e CID. Il corpus conserva quindi i codici della fonte
senza convertirli.

## Aggiornamenti e revisioni

Ogni aggiornamento passa da una pull request e dai controlli offline. Non viene
eseguito alcun download durante le richieste al sito.

- **Nuovo anno:** aggiungere un dataset distinto, bloccare URL, licenza, periodo,
  byte, hash e schema, quindi profilare e appendere le righe. Gli anni già
  pubblicati non vengono sostituiti.
- **Revisione dello stesso anno:** trattare byte diversi per lo stesso periodo
  come una release candidata. Mantenere la release corrente finché provenienza e
  precedenza non sono verificate; poi confrontare totali e righe e sostituire la
  release in un'unica modifica. Due release sovrapposte non si sommano.
- **Aggiornamento BD/RDM o CND:** registrare un nuovo snapshot e la sua data,
  lasciare invariati i fatti di spesa e rigenerare raccordi e indici. Le
  differenze nei collegamenti devono essere visibili nella review. Né la CND
  della spesa né il ruolo del fabbricante vengono riscritti con valori correnti.

Le annualità 2022 e 2023 restano escluse finché la licenza della singola risorsa
non è dichiarata. Una licenza generale del portale non viene estesa per
inferenza agli allegati.

## Trasformazione e privacy

Le quattro spese e CND conservano tutti i byte CSV. I file 2018 e 2019 hanno
una colonna `RegioneCommit` in più rispetto al 2020 e al 2021. Codici come
`010` e `010203` restano stringhe nel lessico della fonte e non vengono
normalizzati nei valori `10` e `10203` usati dalle annualità successive.

Il CSV BD/RDM ha un separatore
finale nell'header che dichiara un diciassettesimo campo senza nome; tutte le
2.416.708 righe ne hanno sedici. La normalizzazione elimina **solo quel byte**
dell'header, lasciando inalterato il resto del file. Una riga con diciassette
campi, anche con ultimo valore vuoto, blocca la trasformazione.

La ricevuta BD/RDM vincola il CSV così normalizzato; il source lock conserva
separatamente hash e byte del CSV originale e del suo archivio. Gli identificativi
del modello derivato usano gli stessi sedici campi e gli stessi ID del corpus.
`cod_fiscale` e `PARTITAIVA_VATNUMBER_MAND`, incluse eventuali copie nel testo,
sono oscurati prima dell'hash pubblico. Il secondo header non è reinterpretato
come partita IVA del fabbricante: differisce dal dizionario pubblicato.

Gli originali e i CSV intermedi contenenti identificativi fiscali rimangono
fuori da Git, in directory locali protette. Nel prodotto entrano solo i chunk
pubblici, le ricevute e i contratti. La riproduzione forte richiede gli input
bloccati già acquisiti; i gate delle prove pubbliche restano offline e non
pretendono di ricostruire identificativi oscurati.

## Riproduzione

Il pilota 2020–2021 e le due tabelle di raccordo si preparano con:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/medical_device_spending_corpus.py \
  --spending-2020 /percorso/spesa-2020.zip --spending-2021 /percorso/spesa-2021.zip \
  --registry /percorso/bdrdm.zip --cnd /percorso/cnd.csv \
  --base-spec /percorso/spec-corpus-prima-del-pilota.json \
  --output-dir /percorso/candidato-pilota
```

Il preparatore verifica input e profili, genera la spec candidata e non cambia
artifact del prodotto. L'estensione storica parte dal corpus che contiene già
il pilota:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/medical_device_spending_corpus.py \
  --historical --spending-2018 /percorso/spesa-2018.zip \
  --spending-2019 /percorso/spesa-2019.zip --registry /percorso/bdrdm.zip \
  --cnd /percorso/cnd.csv --base-spec /percorso/spec-corpus-con-pilota.json \
  --output-dir /percorso/candidato-storico
```

La funzione condivisa `siope_nonmunicipal_corpus.append`
aggiunge le tabelle selezionate; usare `corpus_release_proof_path` e il callback
`siope_nonmunicipal.build_committed_view_proof` nella stessa transazione per
sigillare la prova globale e riallineare il riferimento SIOPE. Gli altri
dataset, le identità delle fonti e gli elementi del vecchio archivio non cambiano.

Dopo l'append, confrontare ogni riga, chunk, ricevuta e voce di catalogo con i
CSV preparati e vincolati dagli hash della spec. Il controllo del pilota usa la
directory candidata con le quattro tabelle; quello storico usa la directory con
i due CSV annuali:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/medical_device_spending_corpus.py \
  --check --check-scope pilot --input-dir /percorso/candidato-pilota
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/medical_device_spending_corpus.py \
  --check --check-scope historical --input-dir /percorso/candidato-storico
```

L'append legge un CSV a blocchi di mille righe usando la stessa proiezione del
builder storico. La parità byte per byte è testata, compresi ID oltre il primo
blocco, newline interne e privacy. Il buffer compresso serve alla transazione;
non viene introdotto un database o un nuovo backend di storage.

Le tabelle usano `/dati/<id>`, `/api/dati/<id>` e MCP `spesa_pa_dettaglio` con
`code=<id>`, tutti attraverso `integrated-public-view.ts`. Le date/frequenze
sono nei metadati condivisi del corpus; non viene aggiunto un fetch live
all'anagrafica durante una richiesta.

## Ricerca, dettaglio e aggregazioni

`medical_device_spending_index.py` deriva le viste soltanto dalle partizioni
pubbliche già verificate. Il controllo offline rilegge gli hash registrati nella
prova di release, riconcilia le ricevute e ricostruisce ogni byte dell'indice.
Lo script usa SQLite in una directory temporanea durante la generazione e lo
elimina alla fine. Il prodotto non usa né distribuisce quel database.

Le 3.121.764 righe di spesa coinvolgono 237.660 chiavi composte distinte. Di
queste, 237.659 trovano la registrazione BD/RDM e una resta non risolta. Le 20
righe non risolte nelle quattro annualità condividono quella chiave assente.
L'anagrafica completa da 2.416.708 righe rimane nel corpus; la ricerca dedicata
indicizza soltanto i dispositivi presenti nella spesa pubblicata.

`medical-device-spending.ts` espone le letture lato server:

- ricerca per numero e tipologia, denominazione, catalogo,
  fabbricante/assemblatore e CND;
- dettaglio paginato dei fatti per dispositivo, anno, Regione e azienda;
- scheda del dispositivo con totali annuali e distribuzione per Regione e azienda;
- aggregazioni paginate per territorio, CND e fabbricante/assemblatore;
- righe da cui deriva ciascun aggregato, con limite e cursore.

Il solo numero non sostituisce mai la chiave composta. Quando lo stesso numero
compare nelle tipologie 1 e 2, il risultato segnala che la tipologia va scelta.
Il codice azienda è accettato soltanto insieme ad anno e Regione. I cursori sono
legati ai filtri e al source lock; un cursore di un'altra ricerca viene rifiutato.
Ogni fatto conserva dataset e numero di riga del corpus. La lettura di dettaglio
usa questi riferimenti per tornare alla tabella condivisa senza duplicare il CSV.

Le 894 viste di aggregazione coprono quattro annualità nazionali, 84 coppie
anno/Regione e 806 terne anno/Regione/azienda. Ogni vista riporta righe e spesa
totali, abbinate e non risolte, oltre al numero di zeri e rettifiche negative.
Il denominatore comprende tutte le righe osservate nel perimetro. Non usiamo la
copertura del join come misura della copertura nazionale del flusso.

Le aggregazioni per fabbricante o assemblatore si riferiscono allo snapshot
BD/RDM del 14 settembre 2026. Non descrivono il beneficiario del pagamento, un
incasso, un fatturato o un ruolo storico. Il gruppo senza anagrafica rimane
visibile invece di essere attribuito per somiglianza.

Per rigenerare o controllare le viste, senza rete:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/medical_device_spending_index.py
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/medical_device_spending_index.py --check
```

La ricerca usa un file compresso condiviso. Il processo conserva in memoria il
buffer verificato e lo legge una riga alla volta. Non crea un oggetto per ognuna
delle 237.660 chiavi. Dettagli e aggregazioni sono blocchi gzip indipendenti. Una
scheda legge uno dei 256 blocchi di dettaglio. Una vista aggregata legge soltanto
il perimetro richiesto. Il manifest registra hash, byte compressi e byte estratti
di ciascun blocco. Il limite pubblico è di 100 risultati per pagina e ogni
lettura controlla il segnale di annullamento. Durante le scansioni, il processo
cede il controllo a Node ogni 4.096 righe per ricevere gli annullamenti.
Il dettaglio di un'aggregazione
esamina al massimo 100.000 fatti per chiamata, poi restituisce un cursore che
riprende dal fatto successivo.

## Pagina, API e MCP

La pagina `/spese/sanita/dispositivi` parte dall'hub Sanità. Cerca per numero di
repertorio, denominazione, catalogo, fabbricante o assemblatore e CND. I filtri
per Regione e azienda richiedono un anno. La pagina mostra anche gli aggregati
per territorio, classificazione e fabbricante o assemblatore. Il gruppo non
collegato alla BD/RDM resta visibile.

La scheda `/spese/sanita/dispositivi/<tipo>/<numero>` usa sempre la chiave
composta. Mostra l'anagrafica acquisita, i totali 2018–2021, la
distribuzione per Regione e azienda e fino a 50 righe alla volta. Ogni riga
torna al dataset del corpus che la contiene.

L'endpoint `/api/spese/sanita/dispositivi` accetta queste viste:

| `vista` | Parametri principali | Risposta |
| --- | --- | --- |
| `filtri` | nessuno | anni, Regioni e aziende disponibili |
| `ricerca` | `q`, `tipo`, `anno`, `regione`, `azienda` | dispositivi trovati |
| `aggregati` | `anno`, `dimensione`, filtri territoriali | totali riconciliati |
| `dispositivo` | `tipo`, `numero`, filtri territoriali | scheda e righe di spesa |
| `righe` | `anno`, `dimensione`, `valore`, `ruolo` | righe dell'aggregato |

`limit` non può superare 100. `cursor` è opaco e vale soltanto per i filtri che
lo hanno generato. Parametri sconosciuti o ripetuti vengono rifiutati.

Il dataset MCP `salute_dispositivi_medici` usa le stesse funzioni della pagina e
dell'API.
`view` accetta `search`, `aggregate`, `device`, `facts` e `filters`;
`deviceType` e `deviceNumber` formano l'identità del dispositivo. In MCP,
`code` indica l'azienda sanitaria e `query` contiene il testo di ricerca.

L'indice occupa 144.263.125 byte. La ricerca legge 26.846.865 byte compressi e
conserva un buffer verificato da 89.111.641 byte; un blocco di dettaglio non
supera 428.974 byte compressi e un blocco di aggregazione non supera 213.203
byte. Sono misure del manifest generato, non soglie prestazionali del prodotto.

Il delta supera le soglie di rivalutazione ADR-001. L'ADR-005 conserva gli
shard pubblici in Git, sul precedente tecnico dell'ADR-004 ma con una decisione
limitata alla #370. Nessuna pubblicazione esterna è implicita nei comandi.

Misura del corpus dispositivi completo: 5.552 chunk per 451.408.266 byte gzip;
chunk compresso massimo 120.476 byte. I due anni storici aggiungono 1.488 chunk
per 107.375.087 byte. La preview del commit candidato resta necessaria prima del
merge: la build locale non dimostra da sola che il provider accetti il pacchetto.

L'indice derivato aggiunge ricerca, dettagli e aggregazioni senza modificare i
5.552 chunk. Le sue dimensioni e i limiti di lettura sono registrati nel
manifest `src/data/generated/medical-device-spending-index/meta.json` e
verificati dal registro degli artifact generati.
