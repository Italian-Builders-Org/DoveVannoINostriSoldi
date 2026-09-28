# Approvazione delle build

Le PR restano aperte ai contributori. L'apertura e i push non devono avviare
preview Vercel a pagamento; l'approvazione della CI e quella del deploy sono
operazioni distinte.

## Configurazione del progetto

Verificata il 28 settembre 2026 su `dove-vanno-i-nostri-soldi`:

| Controllo | Stato |
| --- | --- |
| Vercel, Environments → Preview → Branch Tracking | Disabilitato |
| Vercel, Environments → Production | Branch `main`, domini automatici attivi |
| Vercel, Security → Git Fork Protection | Attivo |
| GitHub Actions, approvazione workflow dei fork | Tutti i contributori esterni |

Queste impostazioni sono nel provider, non nel branch proposto dal contributor.
Non sostituirle con un'etichetta PR, un controllo del solo autore o uno script
nel branch: il codice da revisionare può modificare quei controlli.
Il blocco delle preview non annulla deployment già partiti e non impedisce a
un membro autorizzato di avviare un deploy manuale.

## Procedura del manutentore

1. Rivedere il diff e lo SHA corrente, compresi workflow e dipendenze, prima
   di approvare la CI di un fork. Un autore già accettato non autorizza nuovi
   cambiamenti automaticamente.
2. Eseguire i gate locali pertinenti e lasciare passare `required` su GitHub.
   Non usare `pull_request_target` per eseguire il codice della PR con segreti.
3. Raggruppare le modifiche compatibili. Se serve una preview, crearne una
   manualmente tramite CLI/API Vercel dal checkout pulito dello SHA revisionato,
   con target Preview. Non passare credenziali di produzione al codice dei fork.
4. Prima del merge ricontrollare lo SHA, la CI e le modifiche concorrenti di
   `main`. Il merge pubblica la produzione; verificare `READY` e le route
   interessate. Una CI verde non prova un deploy riuscito.

Se arriva un altro push dopo la verifica, serve rivederne il diff. Un commento
«approvato» non vincola un branch mobile a uno SHA. Non riattivare le preview
per ottenere un badge Vercel verde: i controlli applicativi restano in CI.

Dependabot raggruppa patch e minor npm settimanali e aggiornamenti compatibili
delle Actions mensili. Le major di ESLint e dei tipi Node richiedono una
migrazione coordinata con i plugin e il runtime; gli aggiornamenti di sicurezza
vanno valutati tempestivamente e non aspettano il raggruppamento ordinario.

## Verifica e ripristino

Dopo un push PR controllare che non compaia un nuovo deployment automatico.
Prima di riabilitare Branch Tracking valutare il costo: ripristinarlo in Preview
riattiva le build per tutti i branch non assegnati, Dependabot compreso.
Cambiare questi controlli richiede una decisione del manutentore, non è una
correzione automatica di CI.

Questa misura riduce le build; la Fluid Active CPU delle richieste al sito
richiede cache e limiti runtime, descritti in [CAPACITY_AND_INCIDENTS.md](CAPACITY_AND_INCIDENTS.md).

Fonti: [ambienti Vercel](https://vercel.com/docs/deployments/custom-environments#branch-tracking),
[protezione fork](https://vercel.com/docs/project-configuration/security-settings#git-fork-protection),
[approvazione GitHub Actions](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/approving-workflow-runs-from-public-forks).
