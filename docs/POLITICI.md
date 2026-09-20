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
- [src/app/api/politici/giudiziario/route.ts](../src/app/api/politici/giudiziario/route.ts):
  procedimenti documentati, copertura, cautele e fonti per persona.

## Proxy e host

Il dominio pubblico di `/politici` è `politici.dovevannoinostrisoldi.com`. Il
proxy aggiunge l'header `x-dvns-immersive: politici` in modo che il root layout
possa togliere il chrome del sito prima dell'hydration. Quando si lavora in
locale, `/politici` è raggiungibile sullo stesso host di sviluppo.

## Navigazione

- Overview del grafo: `/politici`.
- Persona: `/politici?person=<id>` dove `<id>` è `dep-<numericId>`,
  `sen-<id>` o `gov-<personaId>`.
- Gruppo: `/politici?group=<id>`.
- Istituzione: `/politici?istituzione=<id>`.
- Condanne documentate nello snapshot curato: `/politici?vista=condanne`.
- Deputato per id numerico legacy: `/politici?deputy=<numericId>`
  (risolve in `dep-<numericId>`).

## Verifiche

### Contratti e route

```bash
node --experimental-strip-types --test tests/camera-atti-voti-contract.test.mjs
node --experimental-strip-types --test tests/senato-atti-voti-contract.test.mjs
node --experimental-strip-types --test tests/politici-atti-route.test.mjs
node --experimental-strip-types --test tests/parlamento-giudiziario-contract.test.mjs
node --experimental-strip-types --test tests/parlamento-giudiziario-route.test.mjs
node --experimental-strip-types --test tests/parlamento-giudiziario-ui.test.mjs
node --experimental-strip-types --test tests/politici-news-route.test.mjs
node --experimental-strip-types --test tests/politici-repubblica-contract.test.mjs
node --experimental-strip-types --test tests/politici-camera-contract.test.mjs
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
merito. I collegamenti fra gruppi dei due rami indicano una famiglia politica
omologa ricavata dalle denominazioni ufficiali: non implicano identità giuridica
né coordinamento. La presenza di un procedimento non equivale a colpevolezza:
assoluzioni, prescrizioni e condanne restano stati distinti, con grado e fonti
espliciti. I dati provengono dagli archivi pubblicati dalle istituzioni e portano
le loro date di osservazione.

La rappresentanza al Parlamento europeo resta fuori da questo atlante nazionale:
vedi issue #566. Ritratti e simboli di partito passano dai proxy
`/politici/foto` e `/politici/simboli` senza l’optimizer `/_next/image`.
