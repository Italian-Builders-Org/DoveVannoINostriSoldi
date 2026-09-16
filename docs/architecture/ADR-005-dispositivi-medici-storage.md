# ADR-005: distribuzione dei dati sui dispositivi medici

- **Stato:** decisione per la #370; efficace al merge dopo i gate e la preview.
- **Data:** 15 settembre 2026.
- **Ambito:** pilota 2020 e 2021 della spesa rilevata e anagrafiche di raccordo.

## Misure

Le quattro fonti selezionate contengono 4.062.546 righe e 630.919.303 byte
di CSV verificati fuori da Git. La proiezione pubblica conserva tutte le righe
in 4.064 shard gzip per 344.033.179 byte complessivi; il file più grande misura
120.476 byte. Le radici generate del checkout candidato misurano
1.851.511.340 byte.

I due dataset monetari coprono il 2020 e il 2021. BD/RDM e CND sono snapshot
correnti di raccordo, non anagrafiche storiche degli anni di spesa. I CSV
ufficiali originali e la mappa dei campi fiscali rimangono locali; nel
repository entrano la proiezione minimizzata, i source lock, le ricevute e le
prove riproducibili.

## Decisione limitata a questo rilascio

Conservare gli shard pubblici compressi in Git, seguendo il modello adottato
per lo storico operatori ANAC nell'ADR-004. Codice, contratti e dati restano
nello stesso commit; build, test e rollback non richiedono uno storage esterno.
Non vengono introdotti Git LFS, download a runtime, credenziali o nuovi costi
operativi.

Gli shard dei dispositivi medici sono ammessi soltanto nelle funzioni che
interrogano il corpus: catalogo e pagina/API del singolo dataset, pagina/API
MCP e API dell'assistente. Il gate dei tracciamenti ne vieta l'inclusione nelle
altre route. Il merge richiede una preview riuscita sul commit candidato: la
build locale e la dimensione dei manifest non provano da sole che il provider
accetti il pacchetto.

Le viste derivate di ricerca, dettaglio e aggregazione restano nello stesso
repository. Le ricevute e la prova del corpus ne vincolano il contenuto, quindi
non costituiscono una seconda fonte. La generazione usa SQLite in una directory
temporanea per ordinare e aggregare le righe; nessun database viene distribuito
o interrogato a runtime. La ricerca usa un file condiviso, mentre dettagli e
aggregazioni sono divisi in blocchi con hash e limiti di lettura indipendenti.
Le viste aggiungono 88.336.009 byte: il totale dei dati del corpus e delle viste
specifiche della #370 è 432.369.188 byte.

Ogni futuro aggiornamento richiede nuove misure di crescita, tempi CI e
pacchetti runtime. Un rifiuto del provider blocca il merge; non autorizza a
ridurre righe, anni o anagrafiche senza una nuova decisione esplicita.

## Alternative considerate

- **Object storage:** resta adatto ai raw voluminosi, ma per questi shard
  introdurrebbe manifest remoti, credenziali, backup e gestione dei guasti che
  il progetto non possiede oggi.
- **Git LFS o GitHub Releases:** separerebbero i byte dal normale checkout e
  dai controlli offline, con quote e un percorso diverso per fork e CI.
- **Aggregare o campionare:** ridurrebbe la dimensione ma violerebbe la scelta
  della #370 di rendere interrogabili le righe pubbliche selezionate.

## Riferimenti

- [ADR-001](ADR-001-generated-artifacts-storage.md)
- [ADR-004](ADR-004-operator-history-storage.md)
- [Integrazione completa del corpus](source-corpus-integration.md)
- [Pacchetti runtime](../VERCEL_RUNTIME_BUNDLES.md)
