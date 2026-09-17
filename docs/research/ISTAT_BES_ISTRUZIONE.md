# BesT Istruzione e formazione — edizione 2025

Refs #281. Terzo dominio BesT: fonte `istat-bes-istruzione`, API
`/api/territori/bes-istruzione`, dataset MCP `istat_bes_istruzione`. Nessuna UI.
BES Salute ed economico conservano identità e contratti distinti.

## Fonte e lock

Il catalogo ufficiale `https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/all/latest?references=none`
identifica `IT1,DF_BES_TERRIT_2,1.0` come Istruzione e formazione, DSD
`BES_TERRIT` v1.1. Il [lock pubblicato prima del codice](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/281#issuecomment-5579602139)
fissa URL, byte e SHA-256. Lo spec
[`istat-bes-istruzione-2004-2024.source.json`](../../scripts/etl/specs/istat-bes-istruzione-2004-2024.source.json)
conserva definizioni italiane, fonti degli indicatori, unità inline, codelist,
gerarchia Parent e copertura per indicatore/sesso/anno.

Acquisizione e verifica: 2026-09-08. Edizione: 2025, unica nella risposta.
La query `/all` e quella con dominio/indicatori/sesso/edizione enumerati hanno
byte identici: 1.659.306, SHA-256
`51363ccf066fbb91757cf1d5a4e97e2bc58c007ebb6b45c36d5c37f02b25c2e0`.
Struttura `dataflow/IT1/DF_BES_TERRIT_2/1.0?references=all`: 13.319.281 byte,
SHA-256 `6e3da5817e43308fb3839c3058a3bb4019e8e7e0ed55fe45d1f8ad8683f17593`.
Licenza `not-declared`, data pubblicazione `null`: non dedotte dall'edizione
o dalla data di acquisizione.

## Misure e limiti

| Indicatore | Denominatore / misura | Anni | Sesso | Righe |
| --- | --- | --- | --- | ---: |
| 02IST001 | Bambini 4–5 anni, partecipazione scolastica (%) | 2013–2023 | T | 1378 |
| 02IST002-N22 | Persone 25–64 anni, almeno diploma (%) | 2018–2024 | T | 945 |
| 02IST003P-N22 | Persone 25–39 anni, titolo terziario (%) | 2018–2024 | T | 945 |
| 02IST004 | Neo-diplomati, primo ingresso universitario nello stesso anno, tasso specifico di coorte | 2014–2022 | F/M/T | 2700 |
| 02IST006-N22 | Persone 15–29 anni, NEET (%) | 2018–2024 | T | 852 |
| 02IST007-N22 | Persone 25–64 anni, formazione nelle quattro settimane precedenti (%) | 2018–2024 | T | 944 |
| 02IST010P | Studenti III secondaria I grado, competenza numerica insufficiente (%) | 2018–2024 senza 2020 | F/M/T | 2323 |
| 02IST011P | Studenti III secondaria I grado, competenza alfabetica insufficiente (%) | 2018–2024 senza 2020 | F/M/T | 2409 |
| 12SER002 | Bambini 0–2 anni, beneficiari servizi comunali infanzia (%) | 2004–2022 | T | 2456 |

14.952 osservazioni. `12SER002` è pubblicato in `BES_02`: il prefisso del codice
non determina il dominio. Il passaggio universitario esclude ITS, AFAM,
scuole per mediatori linguistici e università estere, come nella definizione ufficiale.
Le unità sono `VAL_PERC` e `SPEC_COHORT_RATE`, da `CL_BES_UNIT_MEASURE`.

Il flag `g` di `CL_FLAG` identifica 76 valori ignoti, tutti vuoti nella fonte:
`valueTenths: null, status: "g"`. Non equivale a zero, riga assente o soppressione
privacy. I valori osservati sono conservati in decimi interi dell'unità originale.
La fonte pubblica 136 valori di 02IST001 sopra 100, fino a 113,7: nessun clipping
e nessuna spiegazione causale inventata. Non si impone un tetto 100 universale.

139 territori: Italia, cinque ripartizioni, due compositi, venti regioni e
111 province, incluse province storiche. Nord e Mezzogiorno si sovrappongono
alle parti; Bolzano/Trento conservano i padri esterni ITD1/ITD2. Le coperture
non sono costanti nel tempo. Anche i servizi comunali per l'infanzia sono qui
osservazioni provinciali o sovraprovinciali, mai imputazioni comunali.

Asse soldi assente: non è spesa pubblica, qualità o efficienza amministrativa.
Nessuna somma geografica o F+M, media ricostruita, classifica, indice composito
o correlazione con SIOPE. Gli invarianti sono unicità, dimensioni, copertura,
flag e integrità; non viene trasferito il vincolo economico T fra F e M.

## Accesso e riproduzione

HTTP richiede almeno uno fra `territorio`, `anno`, `indicatore`, `sesso`;
MCP usa `territory`, `year`, `measure`, `sex`. Entrambi accettano `limit`
(1–100, default 100) e `offset` (0–100000), con `nextOffset` esplicito.
Ordine stabile per indicatore/territorio/sesso/anno, senza ranking. Parametri
sconosciuti, ripetuti o fuori contratto sono rifiutati. Le chiamate annullate
non restituiscono risultati; HTTP restituisce 499 senza cache se già annullato.

Esempio: `/api/territori/bes-istruzione?territorio=IT108&indicatore=02IST004&sesso=F&anno=2017`
restituisce la cella ignota, con unità, fonte e semantica.

Il percorso tipizzato è quello esplicitamente richiesto per questa fetta:
definizioni, gerarchia, decimi esatti e celle ignote sono verificati al confine
ETL e runtime. Nessun JSON di pagina o secondo id per gli stessi dati.
Il generatore richiede entrambi i file ufficiali e verifica byte/hash prima
del parsing; un refresh diverso richiede un nuovo lock revisionato.

```sh
python3 scripts/etl/istat_bes_istruzione.py --input /tmp/best-istruzione.csv --structure /tmp/best-istruzione-structure.xml --write
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/istat_bes_istruzione.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p test_istat_bes_istruzione.py
node --experimental-strip-types --test tests/istat-bes-istruzione.test.mjs
```

Registro artifact e inventario includono il check offline. Lo smoke HTTP/MCP
reale in `scripts/mcp_http_smoke.mjs` verifica cella ignota, provenance,
paginazione e richieste invalide nel job produzione CI. Build, browser,
Lighthouse e sicurezza restano gate CI; nessuna prova locale o preview
costituisce attestazione di aggiornamento live.
