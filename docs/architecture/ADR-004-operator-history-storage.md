# ADR-004 — Distribuzione dello storico operatori

- **Stato:** decisione per la #457; efficace al merge dopo i gate e la preview.
- **Data:** 12 settembre 2026.
- **Ambito:** primo snapshot completo degli affidamenti degli operatori ANAC.

## Misure

Il nuovo derivato contiene 478.418 operatori e 5.337.887 relazioni di
aggiudicazione. Non dichiara la completezza nazionale corrente: conserva il
perimetro degli archivi bloccati e la loro copertura temporale.

| Artefatti | Byte |
| --- | ---: |
| 256 shard di riepiloghi gzip | 144.242.789 |
| 256 pack di blocchi gzip indipendenti | 648.927.950 |
| Totale, incluso manifest | 793.241.703 |
| File più grande | 4.756.580 |

Il totale è 756,49 MiB di contenuto, distinto dallo spazio allocato dal
filesystem. Ogni blocco contiene al massimo 100 righe; la pagina ne restituisce
25. Il reader verifica hash, dimensioni e identità dei blocchi effettivamente
letti. Il controllo offline verifica tutti i file e riconcilia i riepiloghi
con le righe dei blocchi, compresi gli importi decimali esatti.

La base `801873f7` contiene 645.533.168 byte nelle radici generate. L'aumento
supera le soglie dell'ADR-001 e richiede questa decisione esplicita. Nessun
nuovo file supera 25 MiB. Database SQLite e archivi originali restano locali,
esclusi da Git e dagli upload CLI.

## Decisione limitata a questo rilascio

Conservare il derivato compresso in Git mantiene codice, source lock e dati
nello stesso commit. Build, controlli offline e rollback non dipendono dalla
disponibilità di un servizio di storage. Il pacchetto include lo storico solo
nella funzione della scheda operatore; il gate dei tracciamenti ne vieta
l'inclusione nelle altre funzioni.

Il pacchetto supera il limite standard Node.js di 250 MB. Vercel documenta
[Large Functions fino a 5 GB su Fluid compute](https://vercel.com/changelog/vercel-functions-can-now-be-up-to-5-gb-in-package-size),
in beta pubblica dal 29 giugno 2026. Il progetto esistente usa Fluid compute
ed è stato creato dopo tale data. Questa configurazione non viene considerata
una prova di accettazione del pacchetto: il merge richiede una preview riuscita
sul commit candidato, oltre alla build e alle prove funzionali.

Non viene attivato un nuovo piano né un servizio di storage. Le invocazioni
restano soggette alle quote e alla tariffazione del progetto esistente; non
si deducono costi invarianti dalla sola dimensione dei file. Le misure di
letture, latenza e dimensione del tracciamento accompagnano la PR, distinguendo
cache applicativa, cache del sistema operativo e ambiente locale da remoto.

## Alternative e limiti

[Supabase Free](https://supabase.com/pricing) include 1 GB di file storage.
Due versioni complete di questo snapshot lo supererebbero, prima di considerare
backup e altri usi. Conservare soltanto la versione corrente non soddisfa il
contratto di rollback e retention dell'ADR-001. Supabase continua a gestire la
quota dell'assistente; lo storico non viene caricato nel suo database.

R2 resta l'alternativa già proposta per OpenCUP nell'ADR-002. Una sua adozione
per gli operatori richiederebbe manifest immutabili, verifica degli oggetti,
backup indipendente, ripristino provato e gestione degli errori di rete.
Questa PR non dichiara tale infrastruttura operativa. LFS e Releases mantengono
i limiti descritti nell'ADR-001.

Il costo principale della scelta è la crescita di Git e dei checkout CI.
Non sono autorizzati refresh automatici di questo derivato: ogni nuova
versione richiede misure di crescita, tempi CI e pacchetto, e una rivalutazione
dello storage. Un rifiuto del provider per dimensione blocca il merge; non si
disabilitano i controlli né si riduce silenziosamente la copertura pubblicata.

## Riferimenti

- [ADR-001](ADR-001-generated-artifacts-storage.md)
- [ADR-002](ADR-002-opencup-object-storage.md)
- [ADR-003](ADR-003-conto-annuale-storage.md)
- [Limiti delle funzioni Vercel](https://vercel.com/docs/functions/limitations)
