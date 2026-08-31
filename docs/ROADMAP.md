# Roadmap

Guida operativa per scegliere il prossimo lavoro. Non è un elenco di idee:
ogni riga ha priorità, stato nel repo, issue o PR se esiste, e un prossimo
passo concreto.

Verificato sul repository il 31 agosto 2026 (issue e PR aperte lette da GitHub).
I codici tipo `T-001` / `X-028` vengono dalla sintesi dei feedback community;
non sono issue GitHub.

Come usare questo file:

1. Prendi una riga **P0** o **P1** con *Implementabile: sì* e issue aperta, oppure
   il prossimo passo già eseguibile senza nuova fonte.
2. Apri o collega l'issue prima di una PR sostanziale ([CONTRIBUTING.md](../CONTRIBUTING.md)).
3. Quando chiudi l'issue o mergi la PR, aggiorna questa tabella nello stesso
   cambiamento.
4. Le regole su fonti, confronti e copy restano in
   [COMMUNITY_FEEDBACK.md](COMMUNITY_FEEDBACK.md) e
   [LEGAL_AND_ETHICS.md](LEGAL_AND_ETHICS.md).

## Criteri di prodotto

- Utenti: chi legge i numeri sul sito, chi verifica una fonte, chi interroga MCP.
- Un numero pubblico ha sempre fonte, periodo e limiti.
- Pagamenti, costi previsti, debiti e ipotesi restano separati.
- Un segnale o una differenza non è una colpa.
- Non si pubblicano classifiche di spreco, giudizi automatici su leggi, né
  contatori stimati spacciati per dato osservato.
- Una nuova verticale parte solo con fonte ufficiale, licenza, perimetro e
  contratto fail-closed.

## Legenda

| Campo | Valori |
|---|---|
| Priorità | **P0** sblocca il resto o è già richiesto da più feedback. **P1** verticale o tool utile, perimetro chiaro. **P2** miglioramento. **P3** dopo una decisione di prodotto. **No** fuori perimetro. |
| Copertura | Quanto c'è già su `main`. |
| Implementabile | **Sì** si può aprire una PR ora. **Dipende** serve fonte o decisione. **No** non fare. |
| Effort | Basso, medio, alto, oppure bloccato dalla fonte. |

## P0

| Iniziativa | Copertura | Implementabile | Effort | Issue / PR | Dove | Prossimo passo |
|---|---|---|---|---|---|---|
| Navigazione semplice e mobile stabile | Parziale su `main` ([#205](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/205) mergiata) | Sì | Medio | Nessuna issue aperta dedicata | `src/components/navigation.tsx`, `/controlli`, `/dati` | Test di comprensione e regressioni visive su route reali a 390, 768 e 1280 px. Feedback: X-028, X-047, T-005, T-019, T-020, T-032, T-034. |
| Freschezza uniforme e refresh automatico | Policy e health parziali; refresh non è ancora un job periodico | Sì | Alto | [#189](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/189) aperta | [FRESHNESS_AND_REFRESH.md](FRESHNESS_AND_REFRESH.md) | Inventario fonte per fonte, fallimento visibile, timestamp pubblico. Non chiamare «live» un polling. Feedback: T-001, T-024, X-117. |
| Benchmark appalti davvero comparabili | Contratti ANAC parziali su `main` ([#204](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/204), [#208](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/208)) | Sì | Alto | [#185](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/185) aperta; [#183](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/183) TED, da valutare a parte | `/appalti`, `/confronti`, `docs/research/ANAC_*` | Unità, quantità e categoria comparabile; bloccare i confronti deboli. Feedback: X-072, X-077, X-091, T-004, A-004. |
| Drill-down e confronto territoriale | Territori, IRPEF, OpenCivitas e schede ente già su `main` | Sì | Alto | [#130](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/130) aperta | `/territori`, `/enti/[codice]` | Completare Provincia/ASL dove la fonte lo consente; peer con denominatore coerente. Non inventare residui fiscali comunali. Feedback: X-019, X-066, X-097, X-104, T-012. |

## P1

| Iniziativa | Copertura | Implementabile | Effort | Issue / PR | Dove | Prossimo passo |
|---|---|---|---|---|---|---|
| Pensioni: aggiornamento oltre il 2022, distribuzione, cumuli | Verticale ISTAT 2012-2022 su `main` ([#153](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/153) chiusa, [#202](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/202) mergiata). Manca il post-2022 | Dipende dalla fonte | Fonte | [#214](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/214) segnalazione aperta (estendere dopo il 2022) | `/spese/pensioni` | Verificare se ISTAT/INPS pubblica tavole successive al 2022 su pensionati e cumuli, con lo stesso perimetro. Feedback: X-001, X-020, X-087, X-093. |
| Sanità: valori reali, demografia, outcome | Conto economico, serie storica e grafico contabile su `main` ([#207](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/207) mergiata). Demografia e outcome assenti | Dipende | Alto | PR [#207](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/207) mergiata: grafico contabile; non copre demografia/outcome | `/spese/sanita`, `/spese/sanita/storico` | Deflatore dichiarato, popolazione/anziani, un outcome ufficiale in verticale pilota. Feedback: X-009, X-021, X-022, X-035, A-003. |
| Assistente guidato con guardrail | Assistente deterministico su `main`; niente LLM né voce | Sì | Alto | [#17](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/17) aperta | `/assistente`, `docs/ASSISTENTE.md` | Estendere intenti ed esempi. Privacy gate prima di qualsiasi modello generativo o voce. Feedback: X-005, X-015, X-016, X-102, T-010, T-027. |
| Segnalazioni moderate e non accusatorie | Form pubblico su `main` ([#197](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/197) chiusa, [#201](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/201) mergiata). Manca la policy editoriale | Sì | Medio | [#19](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/19) aperta (registro community, non il form) | `ReportProblemDialog`, `/api/segnalazioni`, [SEGNALAZIONI.md](SEGNALAZIONI.md) | Separare issue pubblica GitHub da eventuale pubblicazione sul sito; rate limit durevole se l'abuso diventa reale. Feedback: X-029, A-085, T-026, A-006. |
| Report mensile e newsletter opt-in | Assente | Sì | Medio | Nessuna issue | Fuori dal codice | Titolare editoriale, consenso, template, archivio citabile. Feedback: T-002, T-014. |
| Sitemap delle schede dinamiche | Sitemap di base su `main` ([#172](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/172)). Mancano le schede comunali | Sì | Basso | [#209](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/209) aperta | `src/app/sitemap.ts` | Enumerare le schede ente/comune dai dati già versionati. Feedback: T-030. |
| Glossario e onboarding | Tooltip e `/metodologia` parziali | Sì | Medio | Nessuna issue dedicata | `/metodologia`, `InfoTooltip` | Glossario canonico e percorsi di primo utilizzo non bloccanti. Feedback: A-001, A-002, X-056, X-059. |
| Explorer dataset progressivo | Catalogo `/dati` su `main` | Sì | Medio | Nessuna issue dedicata | `/dati` | Ingresso «da dove parto», evidenze, vista semplice e dettaglio espandibile. Feedback: T-019, A-009. |
| Resilienza, mirror, governance del branch | Snapshot e ADR-001 su `main`. Protezione di `main` assente | Sì | Alto | [#38](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/38) aperta (ruleset PR + check `quality`; non è un runbook DR) | [ADR-001](architecture/ADR-001-generated-artifacts-storage.md), [GOVERNANCE.md](../GOVERNANCE.md) | Prima il ruleset della #38 (owner GitHub). Poi runbook DR, mirror verificato, test di ripristino. Feedback: T-029, A-011. |
| Sicurezza e monitoraggio produzione | HSTS, CSP report-only, health e monitor già mergiati ([#165](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/165), [#173](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/173), [#169](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/169)) | Sì | Medio | Nessuna issue aperta dedicata | `SECURITY.md`, `/api/health` | Verifica esterna DNS, HTTPS, HSTS, CSP, uptime. Non si deduce dal solo repo. Feedback: X-065, X-082, X-095, A-007. |

## P2

| Iniziativa | Copertura | Implementabile | Effort | Issue / PR | Dove | Prossimo passo |
|---|---|---|---|---|---|---|
| Home quadro e territorio | Home con mappa e pagamenti su `main` | Sì | Medio | Nessuna issue | `/` | Densità e ordine da test utente, non da mockup. Feedback: X-023, X-038, X-042, T-003, T-023. |
| Card statiche condivisibili | Assente | Sì | Medio | Nessuna issue | UI | Export PNG con fonte, data, caveat e testo alternativo. Feedback: X-024, X-025, T-016. |
| Collegare spesa a outcome | Assente | Dipende | Alto | Nessuna issue; si innesta sulla verticale sanità | Verticale pilota | Una verticale con outcome ufficiale e latenza dichiarata. Feedback: A-003, X-035. |
| Interoperabilità CUP-CIG-IPA | Indici parziali su `main` | Sì | Alto | Stessa [#185](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/185) | OpenCUP, MOP, ANAC, IPA | Indice esatto e copertura pubblica; niente fuzzy. Feedback: X-103, X-105, T-013, A-005. |
| Nuove verticali: clima, sport, università | Solo proposte | Dipende | Fonte | [#86](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/86), [#83](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/83), [#101](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/101) aperte | Nuove route | Una verticale alla volta, fonte primaria matura. Feedback: X-069, X-074, X-090. |
| Altri aggregati proposti in community | Non specificato | Dipende | Fonte | [#103](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/103) aperta | Da triage | Spezzare in fonti nominabili o chiudere come troppo vaga. |

## P3

| Iniziativa | Copertura | Implementabile | Effort | Issue / PR | Prossimo passo |
|---|---|---|---|---|---|
| Home personalizzata | Assente | Sì | Alto | Nessuna | Preferenze locali prima di qualsiasi account. Feedback: X-013, X-058, T-028. |
| Auth, API commerciali, funzioni a pagamento | MCP pubblico gratuito su `main` | Dipende da decisione | Alto | Nessuna | Separare dal dato pubblico gratuito. Feedback: T-022, A-010. |
| Agenti di raccomandazione / piste investigative | Explorer relazioni su `main`; motori automatici no | Dipende | Alto | [#190](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/190), [#193](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/193) aperte | Solo percorsi conservativi con review umana. Niente tagli automatici. Feedback: T-024. |
| Contenuti video e post automatici | Fuori dal portale | Sì, ma non nel backlog prodotto | Medio | Nessuna | Workflow editoriale a parte; bozze sempre approvate. Feedback: X-002, X-004, T-025. |
| Contatore live/stimato del debito | `/debito` pubblica stock verificato, senza stimatori | No, in questa forma | | [#90](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/90) aperta | Non aggiungere un contatore stimato. Eventuale chiusura o riformulazione sulla serie già pubblicata. |

## Fuori perimetro

| Iniziativa | Perché | Issue / feedback | Azione |
|---|---|---|---|
| AI che decide quali leggi tenere | Giudizio automatico senza metodo, non verificabile | Feedback T-031, X-053, X-101 | Non pubblicare. |
| Ranking di spreco, frode o colpa da un form o da un modello | Contrasta le regole del sito | [SEGNALAZIONI.md](SEGNALAZIONI.md), [LEGAL_AND_ETHICS.md](LEGAL_AND_ETHICS.md) | Rifiutare. |

## Pull request aperte (non sono lavoro P0)

| PR | Stato letto | Nota per la roadmap |
|---|---|---|
| [#211](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/211) ESLint 10 | Aperta | Dipendenza; `eslint-plugin-react` non è pronto. Non è una riga di prodotto. |

## Issue aperte senza riga sopra

Tutte le issue aperte al 31 agosto 2026 sono in tabella, con due eccezioni gestite così:

- [#214](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/214) è una segnalazione sul form, collegata alla riga Pensioni.
- Le segnalazioni future del form non diventano da sole righe di roadmap: prima triage.

## Definition of done per un connettore

Un connettore non è fatto finché non ha: fonte e condizioni documentate, fixture
reale e test, idempotenza, retry e timeout, schema validation, metriche di
qualità, provenance, gestione dei cambi di schema, stato/freschezza visibile in
UI.

## Debito ancora aperto sui connettori

Lavoro dati già in corso, da non dimenticare quando si sceglie una verticale:

- ingestore ANAC BDNCP e indice CIG-CUP senza replicare la BDNCP;
- crawler Amministrazione Trasparente da IPA;
- ReGiS / PNRR oltre il perimetro asili;
- drill-down OpenCoesione con anti-doppio conteggio;
- ingestione persistente opere OpenBDAP MOP;
- popolazione comunale ISTAT per denominatori annuali;
- spesa statale regionalizzata RGS e bilanci regionali Istat, fasi esplicite;
- indicatori automatici (concentrazione, soglie, proroghe) solo con test sui falsi positivi.
