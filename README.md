# DoveVannoINostriSoldi

DoveVannoINostriSoldi è un progetto civico open source per capire come vengono usati i soldi pubblici italiani.

Riunisce dati ufficiali che oggi si trovano in portali diversi. Ogni numero mostra la fonte, il periodo a cui si riferisce e i limiti da conoscere. Un valore insolito può indicare dove controllare meglio, ma non dimostra da solo uno spreco o un illecito.

L'AI serve a confrontare dati omogenei, trovare scostamenti e ordinare i casi da verificare. Non decide se esiste uno spreco e non attribuisce responsabilità.

## Cosa puoi consultare

| Sezione | Che cosa mostra | Fonte |
| --- | --- | --- |
| Home | Pagamenti dei Comuni, mappa regionale, andamento mensile e dati OpenCoesione | SIOPE, IPA, OpenCoesione |
| Soldi | Per cosa pagano i Comuni: le voci di uscita e il flusso mese per mese | SIOPE |
| Territori | Confronti pro capite di default tra regioni e Comuni per il 2024, 2025 e 2026 | SIOPE, IPA |
| Fondi e progetti | Costo previsto, pagamenti e stato dei progetti di coesione | OpenCoesione |
| Enti e società | Ministeri, enti pubblici, uffici, contatti e società partecipate | IPA, AgID, MEF |
| Spese dello Stato | Pagamenti per funzione, amministrazione e tipo di spesa | RGS, OpenBDAP |
| Fabbisogni comunali | Spesa storica, spesa standard e servizi dei Comuni nel 2022 | OpenCivitas |
| Partecipazioni | Società e organizzazioni partecipate dichiarate dalle amministrazioni | MEF |
| Parlamento | Consuntivo e bilancio della Camera | Camera dei deputati |
| Controlli | Dati che meritano verifiche più approfondite, con spiegazioni e fonti | ANAC, MEF, Corte dei conti e altre fonti ufficiali |
| Fonti | Stato dei collegamenti e date di aggiornamento | Registro interno delle fonti |

Per ANAC è disponibile uno snapshot verificato sui dodici file mensili CIG 2025; non è ancora una ricerca live per singolo CIG o fornitore. Il PNRR ReGiS e altre fonti già censite non sono ancora presentati come dati correnti. Il sito dichiara questi limiti e non usa numeri dimostrativi per riempire gli spazi mancanti.

Il backend espone inoltre:

- `GET /api/incarichi`, con statistiche nazionali ufficiali di Consulenti Pubblici dal 2023;
- `GET /api/spese/comuni/fabbisogni?anno=2022`, con il confronto OpenCivitas per 6.557 Comuni delle Regioni a statuto ordinario;
- `GET /api/spese/stato?anno=2024`, con l'ultimo mese OpenBDAP disponibile nell'anno richiesto;
- `GET /api/spese/stato/amministrazioni/2?anno=2024`, con missioni e categorie di una singola amministrazione;
- `GET /api/opere?cup=I39B05000060005`, con stato, date, costi e finanziamenti di un'opera pubblica OpenBDAP;
- `GET /api/parlamento`, con i dati strutturati verificati della Camera; il monitor segue anche i nuovi documenti del Senato senza pubblicare valori non ancora estraibili in modo affidabile;
- `GET /api/controlli`, con indicatori classificati, scenari separati e regole per il loro uso.

## MCP per assistenti AI

Il sito include un server [Model Context Protocol](https://modelcontextprotocol.io/) pubblico e in sola lettura. Un client MCP compatibile può scoprire e interrogare i dataset del portale senza dover conoscere ogni API separatamente.

Endpoint di produzione:

```text
https://<dominio-del-sito>/api/mcp
```

In locale è `http://localhost:3000/api/mcp`. La pagina `/mcp` mostra l'indirizzo corretto del deployment e il catalogo corrente.

Il server espone:

- `list_datasets`, per elencare dataset, filtri, freschezza e cautele interpretative;
- `query_dataset`, per interrogare snapshot verificati e fonti ufficiali live con filtri e paginazione;
- la risorsa `dvns://datasets`, che contiene il catalogo machine-readable.

Tra i dataset c'è `anac_cig_snapshot`: espone copertura annuale, conteggi, procedure, fasce di importo, hash degli input e cautele della replica CIG 2025. `opencoesione_progetti` include anche quota del costo pubblico, rapporto pagamenti/costo e costo medio per progetto per tema, natura e stato.

Esempio di configurazione per un client che accetta server HTTP remoti:

```json
{
  "mcpServers": {
    "dove-vanno-i-nostri-soldi": {
      "type": "http",
      "url": "https://<dominio-del-sito>/api/mcp"
    }
  }
}
```

Verifica rapida del protocollo:

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

L'accesso anonimo è intenzionale perché il server espone esclusivamente dati pubblici e operazioni read-only. Le richieste hanno input limitati, paginazione massima e controlli sugli header `Origin` e `Host`; eventuali origini browser aggiuntive si configurano con `MCP_ALLOWED_ORIGINS`, mentre i domini pubblici ammessi si dichiarano in `MCP_ALLOWED_HOSTS`. I filtri estranei al dataset vengono rifiutati esplicitamente, senza produrre risultati che sembrino filtrati ma non lo siano. Non vengono esposte credenziali di ingestione.

Per aggiungere una fonte all'MCP si registra la descrizione in `src/lib/mcp/catalog.ts` e l'adapter in `src/lib/mcp/datasets.ts`. Gli strumenti restano gli stessi, quindi i client non devono essere riconfigurati quando il catalogo cresce. Dettagli e checklist sono in [docs/MCP.md](docs/MCP.md).

Per OpenCivitas, la differenza tra spesa storica e spesa standard non viene chiamata spreco. L'API restituisce anche i valori per abitante, il confronto sui servizi e i limiti territoriali della fonte.

Per le opere pubbliche, l'API può segnalare date da controllare, crescita dei costi, finanziamenti ancora da trovare o problemi di qualità del dato. Sono indicazioni per scegliere cosa approfondire, non prove automatiche di spreco.

La sezione Controlli tiene separate sette letture: esiti di controlli ufficiali, concorrenza ridotta, ritardi, debiti, crediti difficili da riscuotere, misure da valutare e ipotesi di miglioramento. Gli scenari non vengono sommati ai dati osservati.

Non confrontiamo come prezzi unitari gli importi totali di contratti con lo stesso codice CPV. Per parlare di anomalia di prezzo servono anche quantità, unità di misura, specifiche, durata e perimetro compatibili. Finché questi campi non sono disponibili, il sito non pubblica classifiche basate sul solo rapporto tra importo minimo e massimo.

La replica sui microdati CIG 2025, con formula, filtri e limiti, è documentata in [docs/research/ANAC_2025_REPLICATION.md](docs/research/ANAC_2025_REPLICATION.md). Quando il risultato ricalcolato non coincide con l'aggregato della relazione ANAC, mostriamo la differenza invece di correggere il dato a mano.

## Scegliere l'anno

La home e le pagine Soldi e Territori permettono di scegliere il 2024, 2025 o 2026. La scelta resta nell'indirizzo della pagina, per esempio:

```text
/?anno=2025
/spese?anno=2025
/territori?anno=2025
```

I dati SIOPE, OpenBDAP e la serie annuale OpenCoesione cambiano con l'anno scelto. Se un indicatore non esiste per quel periodo, viene mostrato come non disponibile. Non riutilizziamo un dato di un altro anno.

Le classifiche territoriali usano il valore per abitante come default e conservano il totale come confronto. Le due graduatorie comunali sono calcolate separatamente sull'intero insieme osservato, non riordinando una lista già tagliata per volume.

## Regole del progetto

- Nessun numero senza fonte e data.
- Nessun dato inventato o dimostrativo nelle pagine pubbliche.
- Pagamenti, costi previsti, debiti e ipotesi restano separati.
- Un segnale non viene presentato come una colpa.
- I confronti usano solo casi e misure compatibili.
- Se una fonte non risponde, il problema resta visibile.

Le regole complete sono in [docs/LEGAL_AND_ETHICS.md](docs/LEGAL_AND_ETHICS.md) e [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Avvio locale

Richiede Node.js 22 o successivo.

```bash
npm ci
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000).

## Controlli prima di una modifica

```bash
npm run lint
npm test
npm run typecheck
npm run design:check
npm run build
```

La verifica automatica deve terminare senza avvisi ESLint, errori TypeScript o test falliti.

## Aggiornamento dei dati

Gli script in `scripts/etl/` scaricano le fonti ufficiali, controllano il formato e producono file piccoli usati dal sito.

```bash
python3 scripts/etl/siope_municipal_snapshot.py --year 2025 \
  --output src/data/generated/siope-municipal-2025.json
python3 scripts/etl/opencoesione_snapshot.py --check
python3 scripts/etl/mef_participations_snapshot.py --check
python3 scripts/etl/consulenti_snapshot.py --check
python3 scripts/etl/opencivitas_snapshot.py --check
python3 scripts/etl/parliament_sources.py --check
```

Le attività automatiche controllano periodicamente la presenza di nuovi dati. Un'interruzione di una fonte esterna non viene confusa con un errore del codice.

Dettagli: [docs/FRESHNESS_AND_REFRESH.md](docs/FRESHNESS_AND_REFRESH.md).

## Struttura essenziale

```text
src/app/                 pagine e servizi web
src/components/          grafici, mappa e controlli dell'interfaccia
src/lib/                 lettura, controllo e collegamento dei dati
src/lib/mcp/             catalogo e adapter del server MCP
src/data/generated/      copie ridotte e verificate usate dal sito
scripts/etl/             aggiornamento delle fonti
tests/                   controlli automatici
docs/                    metodo, architettura e note legali
```

Il registro delle fonti è in [src/lib/sources.ts](src/lib/sources.ts). Le regole operative sono in [src/lib/data/source-policy.ts](src/lib/data/source-policy.ts).

## Contribuire

Sono utili segnalazioni di fonti mancanti, correzioni alle spiegazioni, controlli sulla qualità dei dati e miglioramenti di accessibilità.

Per proporre una nuova fonte, apri una issue con:

- ente che pubblica il dato;
- collegamento ufficiale;
- licenza;
- formato e frequenza di aggiornamento;
- identificativi utili, come Codice IPA, codice fiscale, CIG o CUP.

## Contributori

- [@fragiannicola](https://x.com/fragiannicola)
- [@dom_gag_96](https://x.com/dom_gag_96)

## Licenza

Il codice è distribuito con licenza MIT. I dati e gli elementi di terze parti mantengono le licenze indicate dalle rispettive fonti. Le attribuzioni sono raccolte in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
