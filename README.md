# DoveVannoINostriSoldi

Progetto civico open source per capire come vengono usati i soldi pubblici italiani.

Riunisce dati ufficiali sparsi su portali diversi. Ogni numero mostra **fonte**, **periodo** e **limiti**. Un valore insolito indica dove controllare meglio: non dimostra da solo uno spreco o un illecito.

**Sito:** [dovevannoinostrisoldi.com](https://www.dovevannoinostrisoldi.com)

<a href="https://www.buymeacoffee.com/dovevannoinostrisoldi"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me an AI compute" height="32" width="114" /></a>

Il progetto resta indipendente. Un contributo su Buy Me a Coffee aiuta a pagare compute e hosting; non influenza i dati pubblicati.

![Home: pagamenti dei Comuni, mappa regionale e composizione della spesa](docs/readme/home.jpg)

| Territori | Cosa controllare |
| --- | --- |
| ![Territori: pagamenti comunali per regione e per Comune](docs/readme/territori.jpg) | ![Cosa controllare: segnali da fonti ufficiali, con limiti visibili](docs/readme/controlli.jpg) |

## Cosa trovi sul sito

| Sezione | In sintesi |
| --- | --- |
| [Home](https://www.dovevannoinostrisoldi.com/) | Pagamenti dei Comuni, mappa regionale, andamento mensile |
| [Soldi](https://www.dovevannoinostrisoldi.com/spese) | Uscite di cassa comunali (SIOPE), mese per mese |
| [Territori](https://www.dovevannoinostrisoldi.com/territori) | Confronti per regione/Comune, CPT e IRPEF MEF |
| [Fondi e progetti](https://www.dovevannoinostrisoldi.com/coesione) | OpenCoesione e traccia PNRR asili (Italia Domani) |
| [Spese dello Stato](https://www.dovevannoinostrisoldi.com/stato) | Pagamenti per funzione e amministrazione (OpenBDAP/RGS) |
| [Enti e società](https://www.dovevannoinostrisoldi.com/enti) | Indice PA, schede enti, partecipazioni MEF |
| [Istituzioni](https://www.dovevannoinostrisoldi.com/istituzioni) | Parlamento, sanità, invalidità e altri dossier |
| [Cosa controllare](https://www.dovevannoinostrisoldi.com/controlli) | Segnali da fonti ufficiali, con limiti espliciti |
| [Fonti](https://www.dovevannoinostrisoldi.com/fonti) | Stato dei collegamenti e date di aggiornamento |
| [Dati](https://www.dovevannoinostrisoldi.com/dati) | Catalogo integrato interrogabile |

Altre viste utili: [sanità](https://www.dovevannoinostrisoldi.com/spese/sanita), [invalidità civile](https://www.dovevannoinostrisoldi.com/spese/invalidita), [partecipazioni](https://www.dovevannoinostrisoldi.com/partecipazioni), [assistente](https://www.dovevannoinostrisoldi.com/assistente).

## Regole in breve

- Nessun numero senza fonte e data.
- Nessun dato inventato o dimostrativo nelle pagine pubbliche.
- Pagamenti, costi previsti, debiti e ipotesi restano separati.
- Un segnale non è una colpa.
- I confronti usano solo misure compatibili.
- Se una fonte non risponde, il problema resta visibile.

Dettaglio: [docs/LEGAL_AND_ETHICS.md](docs/LEGAL_AND_ETHICS.md) e [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Anno e limiti

Su Home, Soldi e Territori puoi scegliere `2024`, `2025` o `2026` (resta nell’URL, es. `/?anno=2025`).

Limiti importanti:

- ANAC CIG 2025: snapshot mensile verificato, non ricerca live per CIG o fornitore.
- PNRR: perimetro asili e prima infanzia; non include i pagamenti ReGiS né tutto il Piano.
- Contabilità diverse non si sommano (SIOPE, IRPEF, CPT, costi previsti, debiti).

Registro integrato, copertura e caveat: [docs/INTEGRATED_SOURCE_LEDGER.md](docs/INTEGRATED_SOURCE_LEDGER.md).

## Per chi sviluppa

### Avvio locale

Node.js **22.19+**.

```bash
npm ci
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000).

### MCP (assistenti AI)

Server [Model Context Protocol](https://modelcontextprotocol.io/) pubblico, sola lettura:

```text
https://www.dovevannoinostrisoldi.com/api/mcp
```

In locale: `http://localhost:3000/api/mcp`. Pagina catalogo: [/mcp](https://www.dovevannoinostrisoldi.com/mcp). Per evitare errori di configurazione, `POST /mcp` e `OPTIONS /mcp` sono alias compatibili dell'endpoint canonico; `GET /mcp` resta la pagina informativa.

Strumenti principali: `list_datasets`, `query_dataset`.

```json
{
  "mcpServers": {
    "dove-vanno-i-nostri-soldi": {
      "type": "http",
      "url": "https://www.dovevannoinostrisoldi.com/api/mcp"
    }
  }
}
```

Guida completa: [docs/MCP.md](docs/MCP.md). Distribuzione su client esterni: [docs/MCP_DISTRIBUTION.md](docs/MCP_DISTRIBUTION.md).

Il MCP pubblico di [Cruscotto Italia](https://cruscotto-italia.dati.gov.it/about.html#accesso-mcp) (AgID) è un servizio esterno complementare: DVNS non lo inoltra e non lo tratta come dato validato localmente.

### API HTTP

Esempi:

```text
GET /api/spese/comuni
GET /api/territori/irpef?anno=2024&livello=regione
GET /api/controlli
GET /api/dati/consulenze-legali?q=2024&limit=20
```

Elenco e contratti: documentazione in `docs/` e catalogo su [/mcp](https://www.dovevannoinostrisoldi.com/mcp).

### Controlli prima di una modifica

```bash
npm run lint
npm test
npm run typecheck
npm run design:check
npm run build
npm run test:browser:e2e
npm run test:lighthouse
```

Gli ultimi due richiedono il build di produzione su `http://127.0.0.1:3000`. Dettagli in [CONTRIBUTING.md](CONTRIBUTING.md).

### Aggiornamento dati

Gli script in `scripts/etl/` scaricano le fonti ufficiali e producono gli snapshot usati dal sito. Esempio:

```bash
python3 scripts/etl/siope_municipal_snapshot.py --year 2025 \
  --output src/data/generated/siope-municipal-2025.json
python3 scripts/etl/opencoesione_snapshot.py --check
python3 scripts/etl/public_debt_snapshot.py --check
```

La route `/debito`, `GET /api/debito` e il dataset MCP `debito_pubblico_italiano`
usano lo stesso snapshot verificato di Banca d'Italia ed Eurostat. Il refresh
live è atomico; la CI delle pull request usa esclusivamente fixture offline.

Politica di freschezza: [docs/FRESHNESS_AND_REFRESH.md](docs/FRESHNESS_AND_REFRESH.md).

### Struttura del repository

```text
src/app/            pagine e API
src/components/     interfaccia
src/lib/            lettura e collegamento dati
src/lib/mcp/        catalogo MCP
src/data/generated/ snapshot verificati
scripts/etl/        aggiornamento fonti
tests/              controlli automatici
docs/               metodo, architettura, note legali
```

## Contribuire

Segnalazioni utili: fonti mancanti, correzioni alle spiegazioni, qualità dei dati, accessibilità.

Prima di una PR leggi [CONTRIBUTING.md](CONTRIBUTING.md).

Per una vulnerabilità non ancora corretta non aprire una issue: usa il [canale privato](SECURITY.md).

Per una nuova fonte, in issue indica: ente, URL ufficiale, licenza, formato, frequenza, identificativi (IPA, CF, CIG, CUP) e cosa il dato **non** misura.

Richieste della community: [docs/COMMUNITY_FEEDBACK.md](docs/COMMUNITY_FEEDBACK.md).

## Contributori

- [@fragiannicola](https://x.com/fragiannicola)
- [@dom_gag_96](https://x.com/dom_gag_96)

## Licenza

Il codice è sotto [GNU Affero GPL v3](LICENSE).

Puoi usare, studiare e migliorare il progetto rispettando l’AGPL (incluso, quando richiesto, il codice sorgente corrispondente). Per un prodotto o servizio proprietario da vendere senza obblighi AGPL serve una [licenza commerciale](COMMERCIAL.md).

I dati di terzi restano sotto le loro licenze: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
