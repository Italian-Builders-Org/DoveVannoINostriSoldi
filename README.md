# DoveVannoINostriSoldi

DoveVannoINostriSoldi è un progetto civico open source per capire come vengono usati i soldi pubblici italiani.

Riunisce dati ufficiali che oggi si trovano in portali diversi. Ogni numero mostra la fonte, il periodo a cui si riferisce e i limiti da conoscere. Un valore insolito può indicare dove controllare meglio, ma non dimostra da solo uno spreco o un illecito.

## Cosa puoi consultare

| Sezione | Che cosa mostra | Fonte |
| --- | --- | --- |
| Home | Pagamenti dei Comuni, mappa regionale, andamento mensile e dati OpenCoesione | SIOPE, IPA, OpenCoesione |
| Spese dello Stato | Pagamenti per funzione, amministrazione e tipo di spesa | RGS, OpenBDAP |
| Territori | Confronti tra regioni e Comuni per il 2024, 2025 e 2026 | SIOPE, IPA |
| Enti | Ministeri, Presidenza del Consiglio, enti pubblici, uffici e contatti | IPA, AgID |
| Partecipazioni | Società e organizzazioni partecipate dichiarate dalle amministrazioni | MEF |
| Controlli | Dati che meritano verifiche più approfondite, con spiegazioni e fonti | ANAC, MEF, Corte dei conti e altre fonti ufficiali |
| Fonti | Stato dei collegamenti e date di aggiornamento | Registro interno delle fonti |

Gli appalti ANAC, il PNRR ReGiS e altre fonti già censite non sono ancora presentati come dati correnti. Il sito lo indica chiaramente e non usa numeri dimostrativi per riempire gli spazi mancanti.

## Scegliere l'anno

La home e la pagina Territori permettono di scegliere il 2024, 2025 o 2026. La scelta resta nell'indirizzo della pagina, per esempio:

```text
/?anno=2025
/territori?anno=2025
```

I dati SIOPE e la serie annuale OpenCoesione cambiano con l'anno scelto. Se un indicatore non esiste per quel periodo, viene mostrato come non disponibile. Non riutilizziamo un dato di un altro anno.

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
```

Le attività automatiche controllano periodicamente la presenza di nuovi dati. Un'interruzione di una fonte esterna non viene confusa con un errore del codice.

Dettagli: [docs/FRESHNESS_AND_REFRESH.md](docs/FRESHNESS_AND_REFRESH.md).

## Struttura essenziale

```text
src/app/                 pagine e servizi web
src/components/          grafici, mappa e controlli dell'interfaccia
src/lib/                 lettura, controllo e collegamento dei dati
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
