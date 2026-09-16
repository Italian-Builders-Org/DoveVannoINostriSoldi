# Dispositivi medici: corpus e viste del pilota 2020 e 2021

Questo documento descrive il corpus e le viste derivate della issue #370. La
fase successiva aggiungerà la pagina sanitaria, l'API dedicata e gli strumenti
MCP. Le fonti conservano gli identificativi del catalogo condiviso.

| Tabella | Periodo/snapshot | Righe |
| --- | --- | ---: |
| `salute-spesa-dispositivi-2020` | 2020 | 787.845 |
| `salute-spesa-dispositivi-2021` | 2021 | 846.878 |
| `salute-dispositivi-bdrdm` | 14 settembre 2026 | 2.416.708 |
| `salute-classificazione-cnd` | 1 settembre 2026 | 11.115 |

Titolare: Ministero della Salute. IODL 2.0 verificata per ciascuna risorsa.
URL ufficiali, SHA-256 dei file e membri ZIP, byte, schema, date e conteggi sono
in `scripts/etl/specs/medical-device-spending-pilot.source.json`. Le appendici
2022 e 2023 restano fuori dal pilota, con licenza `not-declared`; non si estende
la licenza delle schede Open Data ad altri allegati.

La spesa è quella rilevata per acquisti nel perimetro pubblicato, non un totale
automaticamente completo del SSN, un pagamento al fabbricante o un prezzo
unitario. Originali monetari italiani e rettifiche restano stringhe; il modello
usa `parse_source_euros` e `monetary.add_decimals` senza float. Totali osservati:
2020 **5.054.732.845,13 euro**, 2021 **5.785.471.036,54 euro**. Non sommare CE,
SIOPE, aggiudicazioni o release sovrapposte dello stesso anno.

BD/RDM e CND non hanno misure monetarie. La chiave BD/RDM è tipo + identificativo,
non il flag di iscrizione, il nome o il solo numero. Lo snapshot corrente non
ricostruisce la situazione storica. CND della spesa, CND dell'anagrafica e
intervalli della classificazione rimangono separati; nessuna conversione CID/EMDN.
La data `9999/12/31` è convenzionale, non una scadenza commerciale reale.

## Trasformazione e privacy

Le due spese e CND conservano tutti i byte CSV. Il CSV BD/RDM ha un separatore
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

Prima dell'append, nella checkout priva dei quattro dataset:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/medical_device_spending_corpus.py \
  --spending-2020 /percorso/spesa-2020.zip --spending-2021 /percorso/spesa-2021.zip \
  --registry /percorso/bdrdm.zip --cnd /percorso/cnd.csv --output-dir /percorso/candidato-nuovo
```

Il preparatore verifica input e profili, genera la spec candidata e non cambia
artifact del prodotto. La funzione condivisa `siope_nonmunicipal_corpus.append`
aggiunge le quattro tabelle; usare `corpus_release_proof_path` e il callback
`siope_nonmunicipal.build_committed_view_proof` nella stessa transazione per
sigillare la prova globale e riallineare il riferimento SIOPE. Gli altri
dataset, le identità delle fonti e gli elementi del vecchio archivio non cambiano.

Dopo l'append, confrontare ogni riga, chunk, ricevuta e voce di catalogo con i
CSV preparati e vincolati dagli hash della spec:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/medical_device_spending_corpus.py --check --input-dir /percorso/candidato-nuovo
```

L'append legge un CSV a blocchi di mille righe usando la stessa proiezione del
builder storico. La parità byte per byte è testata, compresi ID oltre il primo
blocco, newline interne e privacy. Il buffer compresso serve alla transazione;
non viene introdotto un database o un nuovo backend di storage.

Le tabelle usano `/dati/<id>`, `/api/dati/<id>` e MCP `spesa_pa_dettaglio` con
`code=<id>`, tutti attraverso `integrated-public-view.ts`. Le date/frequenze
sono nei metadati condivisi del corpus; non viene aggiunto un fetch live
all'anagrafica durante una richiesta. La verticale sanitaria è una fase distinta.

## Ricerca, dettaglio e aggregazioni

`medical_device_spending_index.py` deriva le viste soltanto dalle partizioni
pubbliche già verificate. Il controllo offline rilegge gli hash registrati nella
prova di release, riconcilia le ricevute e ricostruisce ogni byte dell'indice.
Lo script usa SQLite in una directory temporanea durante la generazione e lo
elimina alla fine. Il prodotto non usa né distribuisce quel database.

Le 1.634.723 righe di spesa coinvolgono 194.079 chiavi composte distinte. Di
queste, 194.078 trovano la registrazione BD/RDM e una resta non risolta. Il dato
non contraddice le sette righe non risolte: quelle righe condividono la stessa
chiave assente. L'anagrafica completa da 2.416.708 righe rimane nel corpus; la
ricerca dedicata indicizza soltanto i dispositivi presenti nella spesa pilota.

`medical-device-spending.ts` espone tre letture lato server:

- ricerca per numero e tipologia, denominazione, catalogo,
  fabbricante/assemblatore e CND;
- dettaglio paginato dei fatti per dispositivo, anno, Regione e azienda;
- aggregazioni paginate per territorio, CND e fabbricante/assemblatore.

Il solo numero non sostituisce mai la chiave composta. Quando lo stesso numero
compare nelle tipologie 1 e 2, il risultato segnala che la tipologia va scelta.
Il codice azienda è accettato soltanto insieme ad anno e Regione. I cursori sono
legati ai filtri e al source lock; un cursore di un'altra ricerca viene rifiutato.
Ogni fatto conserva dataset e numero di riga del corpus. La lettura di dettaglio
usa questi riferimenti per tornare alla tabella condivisa senza duplicare il CSV.

Le 446 viste di aggregazione coprono due annualità nazionali, 42 coppie
anno/Regione e 402 terne anno/Regione/azienda. Ogni vista riporta righe e spesa
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
delle 194.079 chiavi. Dettagli e aggregazioni sono blocchi gzip indipendenti. Una
scheda legge uno dei 256 blocchi di dettaglio. Una vista aggregata legge soltanto
il perimetro richiesto. Il manifest registra hash, byte compressi e byte estratti
di ciascun blocco. Il limite pubblico è di 100 risultati per pagina e ogni
lettura controlla il segnale di annullamento. Durante le scansioni, il processo
cede il controllo a Node ogni 4.096 righe per ricevere gli annullamenti.
Il dettaglio di un'aggregazione
esamina al massimo 100.000 fatti per chiamata, poi restituisce un cursore che
riprende dal fatto successivo.

L'indice occupa 88.336.009 byte. La prima ricerca legge 18.450.784 byte
compressi e conserva un buffer verificato da 62.037.079 byte; un blocco di
dettaglio non supera 258.426 byte compressi e un blocco di aggregazione non
supera 213.203 byte. In una prova locale a processo freddo, la ricerca ha
richiesto 192 ms; una seconda ricerca 73 ms, l'aggregazione 11 ms e il dettaglio
meno di 1 ms. Il picco RSS osservato è stato 276.455.424 byte, sceso a
224.133.120 byte dopo la raccolta della memoria inutilizzata. Sono misure
indicative della macchina di sviluppo, non soglie prestazionali del prodotto.

Il delta supera le soglie di rivalutazione ADR-001. L'ADR-005 conserva gli
shard pubblici in Git, sul precedente tecnico dell'ADR-004 ma con una decisione
limitata alla #370. Nessuna pubblicazione esterna è implicita nei comandi.

Misura del candidato completo: 4.064 chunk per 344.033.179 byte gzip;
chunk compresso massimo 120.476 byte. La verifica globale a blocchi usa
346.368 KiB di picco RSS e richiede 419,90 secondi su questa macchina; non è
un benchmark comparativo a macchina libera. I 97 dataset precedenti rimangono
identici, compresi 1.970 artifact di ricevute e righe e l'archivio storico.
La build locale passa. I 4.064 shard compaiono soltanto in sette trace: catalogo
e dettaglio dataset, relativa API, pagina/API MCP e le due API dell'assistente.
Le trace del dettaglio, della relativa API e dell'API MCP misurano rispettivamente
575.483.523, 574.458.028 e 878.004.773 byte. Sono misure dei manifest Next, non
di un deploy del provider: prima del merge resta necessaria una preview riuscita.

L'indice derivato aggiunge ricerca, dettagli e aggregazioni senza modificare i
4.064 chunk. Le sue dimensioni e i limiti di lettura sono registrati nel
manifest `src/data/generated/medical-device-spending-index/meta.json` e
verificati dal registro degli artifact generati.
