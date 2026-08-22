# Gerarchia UI — architettura incrementale

## Problema

Le route possiedono correttamente snapshot, perimetri e fonti, ma ricompongono gerarchia, stati e provenienza con pattern diversi. Un refactor solo CSS ridurrebbe il drift visivo senza impedire che periodo, unità o confine interpretativo tornino a separarsi dal dato. Un secondo modello universale della pagina, invece, duplicherebbe i contratti dominio.

## Usage (vista del caller)

La route resta proprietaria dei dati e usa primitive solo quando nascondono una policy condivisa:

```tsx
<main className="shell page">
  <DataReading metric={primaryMetric} evidence={evidence} />
  <DataComparison items={comparisons} />
  <section aria-labelledby="territori-title">
    <ItalyRegionsMap regions={snapshot.regions} period={period} />
  </section>
  <DataBoundary fact={fact} comparison={comparison} limitation={limitation} />
</main>
```

Mappe, tabelle e grafici conservano i contratti attuali. Non ricevono `tone`, colori o interpretazioni sciolte.

## Shape

La forma scelta è ibrida e progressiva:

1. `design-system.css` possiede foreground, spacing, stato, confronto e geometria condivisi.
2. Le route mantengono i tipi dominio e la composizione specifica.
3. Una primitiva React nasce solo quando incorpora almeno una policy verificabile: evidenza obbligatoria, stato completo, heading/anchor, o geometria riservata.
4. Formatter e data contract restano in `src/lib`; nessun presenter duplica validazione o acquisizione.
5. L'ordine DOM è dato → confronto → contesto → dettaglio → fonte. Il responsive cambia la composizione, non il significato.

Interfacce candidate, da introdurre solo nella slice che le usa:

```ts
type ClaimKind = "documented" | "calculated" | "signal" | "missing";
type Direction = { kind: "none" } | {
  kind: "explicit";
  preferred: "higher" | "lower";
  rationale: string;
};

type Evidence = {
  period: string;
  scope: string;
  denominator: string;
  unit: string;
  checkedAt: string;
  transformations: readonly string[];
  sources: readonly [{ id: string; owner: string; url: string }, ...Array<{ id: string; owner: string; url: string }>];
};

type SurfaceState<T> =
  | { kind: "loading"; label: string }
  | { kind: "ready"; data: T }
  | { kind: "partial"; data: T; message: string }
  | { kind: "empty"; title: string; message: string }
  | { kind: "error"; title: string; message: string };
```

L'interfaccia resta profonda perché impedisce omissioni semantiche; un wrapper che aggiunge soltanto una classe è rifiutato.

## Synthesis decision

Sono state confrontate due forme indipendenti:

- **CSS-first:** token e classi condivise, nessun nuovo tipo. È la base per le slice piccole e riduce subito il blast radius.
- **Registro di lettura:** presenter di route più nove primitive tipizzate. Protegge meglio evidenza e stati, ma introdotto tutto insieme sarebbe una seconda architettura prima di avere consumer reali.

La sintesi usa CSS-first per la slice A e adotta dal Registro di lettura solo i contratti che una slice usa realmente. Niente barrel export, mega-dashboard, schema JSON universale o migrazione di massa.

## Reference lock e grammatica dei dati

Il reference part-to-whole dell'utente blocca una qualità, non un layout: linguaggio semplice, macro-funzioni riconoscibili, quota associata alla categoria e dettaglio subordinato. Non autorizza una conversione generalizzata a treemap né una palette decorativa.

La rappresentazione parte dalla domanda:

- geografia → mappa con legenda testuale e tabella equivalente;
- trend → linea, con punti/valori interrogabili;
- confronto ordinato → barre o dot plot;
- benchmark → distribuzione e percentili;
- valore esatto o lookup → tabella;
- singolo insight verificabile → card o lettura primaria;
- composizione di un totale → treemap soltanto se valori additivi, categorie mutuamente esclusive e copertura dichiarata.

Prima di un treemap vanno verificati additività, totale coperto, periodo, perimetro e denominatore comune. Il visual mostra categorie e percentuali anche in testo, mantiene una tabella equivalente e su mobile collassa le celle sotto la soglia di leggibilità in una lista ordinata. Fonte, periodo e perimetro restano visibili o raggiungibili dalla prima lettura. Nessuna codifica dipende soltanto dal colore.

## Tradeoff accettati

- Accettiamo coesistenza temporanea con `.panel` in cambio di PR piccole e prove confrontabili.
- Accettiamo qualche composizione specifica per route in cambio di contratti dati intatti.
- Accettiamo di introdurre tipi semantici più tardi, quando almeno due consumer dimostrano la policy condivisa.

## Alternative considerate

- Solo token/CSS: perde perché non può rendere obbligatori fonte, periodo e stati.
- Presenter e primitive completi in una sola PR: perde perché espone una migrazione troppo ampia e rischia pass-through.
- Schema JSON universale: perde perché crea un secondo CMS e appiattisce mappe e tabelle specifiche.

## Open questions and risks

- Quali due route dimostrano per prime che `Evidence` nasconde policy reale invece di duplicare markup?
- La nav mobile richiede un affordance di overflow o una diversa organizzazione per argomenti senza cambiare URL?
- Quale tabella Coesione merita una vista mobile prioritaria oltre allo scroll dei valori esatti?

## Next implementation step

Chiudere la slice A con token definiti, contrasto Coesione provato e browser smoke Consulenza; poi ricomporre la home senza cambiare `ItalyRegionsMap` o gli snapshot.
