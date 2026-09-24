# Politici — riferimento operativo

Questo documento è il punto di ingresso operativo per `/politici`: moduli,
superfici UI/API, proxy/host, navigazione e verifiche. I dettagli dei singoli
snapshot e contratti rimandano ai documenti specialistici collegati.

## Moduli e contratti

- [src/lib/politici-repubblica.ts](../src/lib/politici-repubblica.ts): grafo
  unificato di Camera, Senato, Governo e Presidente della Repubblica; contiene
  i modelli di mappa, profilo, presenze e attività legislativa.
- [src/lib/politici-host.ts](../src/lib/politici-host.ts): host pubblico
  (`politici.dovevannoinostrisoldi.com`), header immersive e accordo con il
  proxy.
- [src/lib/politici-news.ts](../src/lib/politici-news.ts): raccolta e
  deduplicazione delle notizie per profilo.
- [src/lib/politici-education.ts](../src/lib/politici-education.ts): classificazione
  deterministica delle aree di formazione dalle note ufficiali.
- [src/lib/data/politici-repubblica-contract.ts](../src/lib/data/politici-repubblica-contract.ts):
  contratto Zod del grafo unificato.
- [src/lib/data/camera-atti-voti-contract.ts](../src/lib/data/camera-atti-voti-contract.ts)
  e [src/lib/data/senato-atti-voti-contract.ts](../src/lib/data/senato-atti-voti-contract.ts):
  contratti degli atti firmati e delle votazioni finali dei due rami.
- [scripts/etl/senato_atti_voti_xix_snapshot.py](../scripts/etl/senato_atti_voti_xix_snapshot.py):
  acquisizione ufficiale SPARQL Senato, con paginazione, lotti nominali,
  checkpoint giornaliero e pubblicazione atomica dopo riconciliazione.
- [src/lib/data/parlamento-mandati-contract.ts](../src/lib/data/parlamento-mandati-contract.ts):
  contratto delle legislature per ramo dei parlamentari in carica (#556), che
  alimenta il filtro **Legislature** e il profilo; vedi
  [PARLAMENTO_MANDATI.md](PARLAMENTO_MANDATI.md).
- [src/lib/parlamento-giudiziario.ts](../src/lib/parlamento-giudiziario.ts) e
  [src/lib/data/parlamento-giudiziario-contract.ts](../src/lib/data/parlamento-giudiziario-contract.ts):
  accesso e contratto dello snapshot curato dei procedimenti documentati; lo
  snapshot alimenta pagina e API, ma non è esposto come dataset MCP.

## Superfici UI e API

- [src/app/politici/page.tsx](../src/app/politici/page.tsx): pagina immersiva
  con il grafo interattivo.
- [src/app/politici/repubblica-graph.tsx](../src/app/politici/repubblica-graph.tsx)
  e [src/app/politici/repubblica-panel.tsx](../src/app/politici/repubblica-panel.tsx):
  componenti del grafo e del pannello profilo.
- [src/app/politici/foto/[id]/route.ts](../src/app/politici/foto/%5Bid%5D/route.ts):
  proxy per i ritratti ufficiali.
- [src/app/api/politici/profili/route.ts](../src/app/api/politici/profili/route.ts):
  bundle completo dei profili; il client seleziona il profilo per ID.
- [src/app/api/politici/[id]/news/route.ts](../src/app/api/politici/%5Bid%5D/news/route.ts):
  notizie per profilo.
- [src/app/api/politici/[id]/atti/route.ts](../src/app/api/politici/%5Bid%5D/atti/route.ts):
  atti firmati e votazioni finali per deputati e senatori.
- [src/app/api/politici/[id]/voti-tema/route.ts](../src/app/api/politici/%5Bid%5D/voti-tema/route.ts):
  storico di voto per tema sulla singola persona (raggruppamento per parole chiave
  nei titoli ufficiali delle votazioni finali della XIX legislatura).
- [src/app/api/politici/voti-tema/route.ts](../src/app/api/politici/voti-tema/route.ts):
  directory dello storico per tema su tutti i parlamentari (vista **Storico voti**).
- [src/app/api/politici/giudiziario/route.ts](../src/app/api/politici/giudiziario/route.ts):
  procedimenti documentati, copertura, cautele e fonti per persona.

## Proxy e host

Il dominio pubblico di `/politici` è `politici.dovevannoinostrisoldi.com`. Il
proxy aggiunge l'header `x-dvns-immersive: politici` solo sull'atlante
(`/politici` e sulla rewrite della root del sottodominio), in modo che il root
layout possa togliere il chrome del sito prima dell'hydration. Le sotto-route
come `/politici/europa` restano pagine scrollabili con il menu del sito.
Quando si lavora in locale, `/politici` è raggiungibile sullo stesso host di
sviluppo.

## Navigazione

- Overview del grafo: `/politici`.
- Persona: `/politici?person=<id>` dove `<id>` è `dep-<numericId>`,
  `sen-<id>` o `gov-<personaId>`. Nella scheda, la tab **Voti per tema** mostra
  lo storico delle votazioni finali raggruppate per tema (non una tassonomia
  ufficiale: match sul titolo dell’atto). I chip mostrano `voti espressi/votazioni
  in aula`; «non ha votato» resta distinto dal conteggio delle votazioni.
- Gruppo: `/politici?group=<id>`.
- Legislature: `mandato=primo-ramo|primo-parlamento|gia-parlamento` filtra
  deputati e senatori per legislature nel proprio ramo o in Parlamento; esclude
  i membri del Governo senza seggio.
- Istituzione: `/politici?istituzione=<id>`.
- Condanne documentate nello snapshot curato: `/politici?vista=condanne`.
- Storico voti per tema (directory cercabile su tutti i parlamentari):
  `/politici?vista=storico-voti&tema=<id>` (filtra per nome con `q=`, ramo con
  `ramo=camera|senato`, assenze con `espressi=0`). Mostra sempre **cosa si è
  votato** (titolo atto, esito, totali d’aula) e **chi ha votato** (F/C/A nel
  perimetro filtrato); click su un parlamentare espande i suoi voti sul tema.
  «Apri scheda» apre **Voti per tema** (`scheda=temi`) restando nella vista storico.
- Un voto finale Senato può riferirsi a più disegni abbinati: compare come un
  solo evento con collegamenti a tutti gli atti ufficiali. L'iniziativa
  governativa deriva da `osr:tipoIniziativa` e i presentatori dall'etichetta
  ufficiale `osr:presentatore`, non dal comportamento di voto.
- Eurodeputati eletti in Italia (vista separata): `/politici/europa`.
- Deputato per id numerico legacy: `/politici?deputy=<numericId>`
  (risolve in `dep-<numericId>`).

## Verifiche

Lo snapshot Senato include i disegni di iniziativa senatoriale presentati al
Senato e quelli governativi con almeno una fase Senato. Il refresh usa solo GET
verso l'endpoint ufficiale; `--checkpoint` riprende risposte della stessa
giornata UTC. Prima di aggiornare i digest in
[senato-atti-voti-xix.source.json](../scripts/etl/specs/senato-atti-voti-xix.source.json),
controllare conteggi, esclusioni e semantica delle risposte. Un refresh
incompleto non sostituisce lo snapshot già verificato. Per ogni ticket eseguire
soltanto i test ETL mirati ai producer/contratti/dati cambiati; la suite ETL
completa richiede una richiesta esplicita di Lorenzo.

### Contratti e route

```bash
node --experimental-strip-types --test tests/camera-atti-voti-contract.test.mjs
node --experimental-strip-types --test tests/senato-atti-voti-contract.test.mjs
node --experimental-strip-types --test tests/politici-atti-route.test.mjs
node --experimental-strip-types --test tests/politici-voti-tema-route.test.mjs
node --experimental-strip-types --test tests/parlamento-giudiziario-contract.test.mjs
node --experimental-strip-types --test tests/parlamento-giudiziario-route.test.mjs
node --experimental-strip-types --test tests/parlamento-giudiziario-ui.test.mjs
node --experimental-strip-types --test tests/politici-news-route.test.mjs
node --experimental-strip-types --test tests/politici-repubblica-contract.test.mjs
node --experimental-strip-types --test tests/politici-camera-contract.test.mjs
node --experimental-strip-types --test tests/parlamento-mandati-contract.test.mjs
```

### Build e contesto agenti

```bash
npm run agent-context:check
npm run agent-public:check
npm run ci:static
```

### Browser

Per modifiche al grafo, al pannello o alla navigazione: verifica 390/768/1280 px,
tastiera, focus, stati di errore/caricamento/vuoto, console e overflow. I test
Node non sostituiscono la verifica visiva del grafo interattivo.

## Cosa non misura

`/politici` mostra ruoli istituzionali ufficiali, non influenza politica o
merito. Firme, presentazione governativa e voti sono relazioni distinte: non
misurano produttività, coerenza con promesse o paternità del testo finale.
Le percentuali e le assenze seguono le regole di conteggio proprie di ciascun
ramo; l'assenza da una lista di voto non spiega il motivo. I collegamenti fra
gruppi dei due rami indicano una famiglia politica
omologa ricavata dalle denominazioni ufficiali: non implicano identità giuridica
né coordinamento. La presenza di un procedimento non equivale a colpevolezza:
assoluzioni, prescrizioni e condanne restano stati distinti, con grado e fonti
espliciti. I dati provengono dagli archivi pubblicati dalle istituzioni e portano
le loro date di osservazione. «Primo mandato» conta soltanto le legislature
repubblicane alla Camera e al Senato: non misura altri incarichi né il diritto al
vitalizio.

La rappresentanza al Parlamento europeo resta fuori da questo atlante nazionale:
vedi issue #566. Ritratti e simboli di partito passano dai proxy
`/politici/foto` e `/politici/simboli` senza l’optimizer `/_next/image`.
