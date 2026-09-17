# Prestazioni INPS di invalidità civile

## Che cosa pubblichiamo

La pagina `/spese/invalidita`, l'API `/api/spese/invalidita` e il dataset MCP
`inps_invalidita_civile` leggono lo stesso snapshot versionato. Lo snapshot tiene separate quattro
misure:

- uscite nazionali INPS per prestazioni di invalidità civile nella sezione inclusione sociale;
- dettaglio 2024 della Gestione n. 25 per pensioni e accompagnamento agli invalidi civili;
- prestazioni vigenti al 31 dicembre 2024;
- nuove pensioni di invalidità civile con decorrenza 2016-2024, per regione.

Queste misure hanno perimetri e unità diverse. Non vengono sommate, sottratte o distribuite sul
territorio per proporzione.

## Granularità territoriale

La serie strutturata verificata arriva alla regione. Trentino-Alto Adige e Valle d'Aosta non sono
incluse nella tabella INPS usata, perché la fonte attribuisce l'erogazione alle autonomie
territoriali. I valori 2024 sono dichiarati parziali dalla fonte.

INPS pubblica anche [rendiconti sociali provinciali in PDF](https://www.inps.it/it/it/dati-e-bilanci/rendiconti-sociali/rendiconti-sociali-2017-2024/rendiconti-sociali-2024/rendiconti-provinciali-2024.html),
ma non sono ancora normalizzati nel contratto del portale e non equivalgono automaticamente a una
serie di spesa provinciale comparabile. Il [Welfare Analytics Gate](https://www.inps.it/it/it/dati-e-bilanci/welfare-as-a-service/welfare-analytics-gate.html)
dichiara filtri per Comune, ma richiede l'abilitazione dell'ente e non costituisce un open data
pubblico anonimo. Per questo il portale non simula dati comunali e non ripartisce i totali nazionali
usando popolazione o conteggi regionali.

## Confronti e responsabilità

I dati aggregati non permettono di identificare persone, medici o commissioni e non provano frode o
corruzione. Un confronto territoriale serio richiede almeno popolazione coerente per anno,
standardizzazione per età, struttura sanitaria e demografica, copertura amministrativa e tempi di
liquidazione. Finché queste condizioni non sono soddisfatte, la UI mostra una tabella alfabetica e
non una graduatoria di presunte anomalie.

## Provenienza

Lo snapshot `src/data/generated/inps-civil-invalidity.json` registra URL, data osservata e SHA-256
dei tre PDF ufficiali. I test riconciliano:

- somma delle 18 regioni con il totale nazionale per ogni anno;
- accompagnamento più pensioni con lo stock totale di prestazioni;
- variazione 2025-2024 della spesa;
- dominio ufficiale e formato degli hash.

I PDF istituzionali non vengono presentati come dataset IODL. Quando sarà integrato un dataset open
INPS, la licenza verrà letta e registrata dalla specifica scheda di catalogo.
