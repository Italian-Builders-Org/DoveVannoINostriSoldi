# Roadmap

Guida operativa per scegliere il prossimo lavoro. Non è un elenco di idee:
ogni riga ha priorità, stato nel repo, issue o PR se esiste, e un prossimo
passo concreto.

Verificato sul repository il 2 settembre 2026 (issue e PR aperte lette da GitHub).
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
| Navigazione semplice e mobile stabile | Parziale su `main` ([#205](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/205) e [#235](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/235) mergiate) | Sì | Medio | Nessuna issue aperta dedicata | `src/components/navigation.tsx`, `/controlli`, `/dati` | Test di comprensione e regressioni visive su route reali a 390, 768 e 1280 px. Feedback: X-028, X-047, T-005, T-019, T-020, T-032, T-034. |
| Freschezza uniforme e refresh automatico | Inventario snapshot committato; publisher del data bot su 8 fonti incluso Atlante Imprese | Sì | Alto | [#189](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/189) aperta | [SOURCE_SNAPSHOT_INVENTORY.md](SOURCE_SNAPSHOT_INVENTORY.md), [FRESHNESS_AND_REFRESH.md](FRESHNESS_AND_REFRESH.md) | Prossima slice: un'altra fonte ancora manuale, una alla volta. Il trimestre addetti dell'Atlante resta pinnato all'URL 2026-Q2. Feedback: T-001, T-024, X-117. |
| Benchmark appalti davvero comparabili | Ranking ente su `main` ([#204](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/204), [#208](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/208), [#216](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/216)); concentrazione Top 1/Top 10 + HHI in questa slice; CPV e peer group assenti | Sì | Alto | [#185](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/185) aperta; [#183](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/183) TED, da valutare a parte | `/enti/[codice]`, `/enti/[codice]/appalti`, `docs/research/ANAC_*` | Confronti per CPV e gruppi di enti comparabili; poi soglie e bunching. Feedback: X-072, X-077, X-091, T-004, A-004. |
| Drill-down e confronto territoriale | Territori, IRPEF, OpenCivitas e schede ente già su `main` | Sì | Alto | [#130](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/130) aperta | `/territori`, `/enti/[codice]` | Completare Provincia/ASL dove la fonte lo consente; peer con denominatore coerente. Non inventare residui fiscali comunali. Feedback: X-019, X-066, X-097, X-104, T-012. |

## P1

| Iniziativa | Copertura | Implementabile | Effort | Issue / PR | Dove | Prossimo passo |
|---|---|---|---|---|---|---|
| Pensioni: distribuzione, cumuli e Casellario ISTAT oltre il 2022 | ISTAT 2012-2022 e stock INPS al 1 gennaio 2026 su `main` ([#153](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/153) chiusa, [#202](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/202) e [#227](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/227) mergiate). [#214](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/214) chiusa: il post-2022 INPS c'è. I due perimetri restano distinti. Mancano distribuzione, cumuli e un Casellario ISTAT successivo al 2022 | Dipende dalla fonte | Fonte | Nessuna issue aperta dedicata | `/spese/pensioni` | Cercare tavole ufficiali su distribuzione territoriale e cumuli, senza sommare INPS e ISTAT. Feedback: X-001, X-020, X-087, X-093. |
| Sanità: valori reali, demografia, outcome | Conto economico, serie storica e grafico contabile su `main` ([#207](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/207) mergiata). Demografia e outcome assenti | Dipende | Alto | PR [#207](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/207) mergiata: grafico contabile; non copre demografia/outcome | `/spese/sanita`, `/spese/sanita/storico` | Deflatore dichiarato, popolazione/anziani, un outcome ufficiale in verticale pilota. Feedback: X-009, X-021, X-022, X-035, A-003. |
| Assistente guidato con guardrail | Assistente deterministico su `main`; niente LLM né voce | Sì | Alto | [#17](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/17) aperta | `/assistente`, `docs/ASSISTENTE.md` | Estendere intenti ed esempi. Privacy gate prima di qualsiasi modello generativo o voce. Feedback: X-005, X-015, X-016, X-102, T-010, T-027. |
| Segnalazioni moderate e non accusatorie | Form pubblico su `main` ([#197](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/197) chiusa, [#201](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/201) mergiata). Manca la policy editoriale | Sì | Medio | [#19](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/19) aperta (registro community, non il form) | `ReportProblemDialog`, `/api/segnalazioni`, [SEGNALAZIONI.md](SEGNALAZIONI.md) | Separare issue pubblica GitHub da eventuale pubblicazione sul sito; rate limit durevole se l'abuso diventa reale. Feedback: X-029, A-085, T-026, A-006. |
| Sintesi pubblica: cosa emerge, dove approfondire, cosa potremmo fare | `/controlli` espone segnali e confronti; manca una sintesi leggibile «dai dati → dove → cosa fare» | Sì | Alto | [#243](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/243) aperta | `/controlli` (o route dedicata), nav Segnali | Spec IA/UX; prima slice con ≥3 percorsi verificabili end-to-end; copy da priorità di verifica, non spreco/illecito automatici. Collegamento opzionale alle piste [#190](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/190)/[#193](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/193) solo dopo review umana. |
| Report mensile e newsletter opt-in | Assente | Sì | Medio | Nessuna issue | Fuori dal codice | Titolare editoriale, consenso, template, archivio citabile. Feedback: T-002, T-014. |
| Sitemap delle schede dinamiche | Sitemap di base su `main` ([#172](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/172)); schede comunali enumerate dagli snapshot SIOPE committati | Sì | Basso | [#209](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/209) risolta dalla PR collegata | `src/app/sitemap.ts` | Restano fuori gli enti non comunali: il loro insieme completo non è enumerabile dai dati committati. Feedback: T-030. |
| Glossario e onboarding | Tooltip e `/metodologia` parziali | Sì | Medio | Nessuna issue dedicata | `/metodologia`, `InfoTooltip` | Glossario canonico e percorsi di primo utilizzo non bloccanti. Feedback: A-001, A-002, X-056, X-059. |
| Explorer dataset progressivo | Catalogo `/dati` su `main` | Sì | Medio | Nessuna issue dedicata | `/dati` | Ingresso «da dove parto», evidenze, vista semplice e dettaglio espandibile. Feedback: T-019, A-009. |
| Resilienza, mirror, governance del branch | Snapshot, ADR-001 e ruleset `protect-main` su `main` ([#38](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/38) chiusa): PR obbligatoria e check `required`, senza review reciproca obbligatoria | Sì | Alto | [#38](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/38) chiusa | [ADR-001](architecture/ADR-001-generated-artifacts-storage.md), [GOVERNANCE.md](../GOVERNANCE.md) | Runbook DR, mirror verificato, test di ripristino. Feedback: T-029, A-011. |
| Standard di import dati (corpus + skill agente) | Playbook e skill in PR collegata; helper di parsing e metadata ancora da colmare | Sì | Medio | [#264](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/264) aperta | [DATA_IMPORT_STANDARD.md](DATA_IMPORT_STANDARD.md), `.agents/skills/import-dvns-dataset/`, `CONTRIBUTING.md` | Mergiare il playbook; poi helper soldi/periodo e `sourceMetadata` incompleti. |
| Sicurezza e monitoraggio produzione | HSTS, CSP report-only, health e monitor già mergiati ([#165](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/165), [#173](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/173), [#169](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/169)) | Sì | Medio | Nessuna issue aperta dedicata | `SECURITY.md`, `/api/health` | Verifica esterna DNS, HTTPS, HSTS, CSP, uptime. Non si deduce dal solo repo. Feedback: X-065, X-082, X-095, A-007. |

## P2

| Iniziativa | Copertura | Implementabile | Effort | Issue / PR | Dove | Prossimo passo |
|---|---|---|---|---|---|---|
| Home quadro e territorio | Home con mappa e pagamenti su `main` | Sì | Medio | Nessuna issue | `/` | Densità e ordine da test utente, non da mockup. Feedback: X-023, X-038, X-042, T-003, T-023. |
| Card statiche condivisibili | Assente | Sì | Medio | Nessuna issue | UI | Export PNG con fonte, data, caveat e testo alternativo. Feedback: X-024, X-025, T-016. |
| Collegare spesa a outcome | Assente | Dipende | Alto | Nessuna issue; si innesta sulla verticale sanità | Verticale pilota | Una verticale con outcome ufficiale e latenza dichiarata. Feedback: A-003, X-035. |
| Interoperabilità CUP-CIG-IPA | Indici parziali su `main` | Sì | Alto | Stessa [#185](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/185) | OpenCUP, MOP, ANAC, IPA | Indice esatto e copertura pubblica; niente fuzzy. Feedback: X-103, X-105, T-013, A-005. |
| Nuove verticali: clima, sport, università | Solo proposte | Dipende | Fonte | [#86](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/86), [#83](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/83), [#101](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/101) aperte | Nuove route | Una verticale alla volta, fonte primaria matura. Feedback: X-069, X-074, X-090. |
| Altri aggregati proposti in community | Non specificato | No | | [#103](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/103) chiusa (troppo vaga) | | Una issue nuova, un solo aggregato, fonte ufficiale, perimetro e periodo. |

## P3

| Iniziativa | Copertura | Implementabile | Effort | Issue / PR | Prossimo passo |
|---|---|---|---|---|---|
| Home personalizzata | Assente | Sì | Alto | Nessuna | Preferenze locali prima di qualsiasi account. Feedback: X-013, X-058, T-028. |
| Auth, API commerciali, funzioni a pagamento | MCP pubblico gratuito su `main` | Dipende da decisione | Alto | Nessuna | Separare dal dato pubblico gratuito. Feedback: T-022, A-010. |
| Agenti di raccomandazione / piste investigative | Explorer relazioni su `main`; motori automatici no | Dipende | Alto | [#190](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/190), [#193](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/193) aperte; alimentano [#243](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/243) solo dopo review | Solo percorsi conservativi con review umana. Niente tagli automatici. Feedback: T-024. |
| Contenuti video e post automatici | Fuori dal portale | Sì, ma non nel backlog prodotto | Medio | Nessuna | Workflow editoriale a parte; bozze sempre approvate. Feedback: X-002, X-004, T-025. |

## Fuori perimetro

| Iniziativa | Perché | Issue / feedback | Azione |
|---|---|---|---|
| AI che decide quali leggi tenere | Giudizio automatico senza metodo, non verificabile | Feedback T-031, X-053, X-101 | Non pubblicare. |
| Ranking di spreco, frode o colpa da un form o da un modello | Contrasta le regole del sito | [SEGNALAZIONI.md](SEGNALAZIONI.md), [LEGAL_AND_ETHICS.md](LEGAL_AND_ETHICS.md) | Rifiutare. |
| Contatore live/stimato del debito | Interpolazione del trend, anche se etichettata stima | [#90](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/90) chiusa | Non pubblicare. `/debito` resta lo stock verificato. |

## Pull request aperte (non sono lavoro P0)

| PR | Stato letto | Nota per la roadmap |
|---|---|---|
| [#219](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/219) HHI e Top 1/Top 10 sugli appalti ente | Aperta, in conflitto con `main` | Slice di [#185](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/185). Rebase e `required` restano a Roberto. |
| [#211](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/211) ESLint 10 | Aperta | Dipendenza; `eslint-plugin-react` non è pronto. Non mergiare. |

## Issue aperte senza riga sopra

Tutte le issue aperte al 1 settembre 2026 sono in tabella, con queste eccezioni:

- [#220](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/220) è una segnalazione dal form (dettaglio IRPEF via MCP): triage, non una riga di roadmap.
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
