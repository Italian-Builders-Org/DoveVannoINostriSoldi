# ADR-002 — Object storage OpenCUP

- **Stato:** proposto; provider approvato, provisioning e restore non eseguiti
- **Data:** 7 settembre 2026
- **Ambito:** raw OpenCUP, oggetti pubblici redatti, manifest e recupero
- **Decisione:** Cloudflare R2 nell'account del progetto, con prodotto spento fino alla prova di ripristino

## Contesto

Il rilascio nazionale verificato contiene 11.973.988 righe e occupa
2.203.779.590 byte nello ZIP ufficiale. La trasformazione produce 58.979
oggetti redatti e indirizzati per hash, per 3.650.205.754 byte. Questi file non
possono entrare in Git né essere letti integralmente durante una richiesta
Next.js.

Questo ADR applica il contratto di
[ADR-001](ADR-001-generated-artifacts-storage.md) alla issue #249. Il
maintainer ha approvato R2 come prima scelta, ma bucket, credenziali, backup e
oggetti non esistono ancora. La PR mantiene quindi OpenCUP configurato ma non
visibile in UI, API pubblica, stato fonti o MCP.

## Decisione

1. I bucket appartengono all'organizzazione o a un account di progetto gestito
   dai maintainer. Non si usano account personali dei contributor.
2. Il raw CSV/ZIP resta privato, in un bucket separato e accessibile soltanto al
   processo di acquisizione. Il runtime non riceve credenziali per quel bucket.
3. Il bucket prodotto contiene soltanto oggetti già redatti. Ogni chiave è
   `sha256/<digest>` e i byte devono corrispondere al digest indicato nel
   manifest versionato in Git.
4. Il bucket non espone il listing. Le letture runtime sono server-side e
   limitate agli oggetti indicati dal manifest; nessun URL o nome oggetto arriva
   dall'utente.
5. Gli oggetti non vengono sovrascritti. Content addressing, manifest
   immutabili e Bucket Lock forniscono il versionamento operativo richiesto.
   Un rollback seleziona un manifest precedente, senza modificare gli oggetti.
6. Si conservano la release corrente e le due release approvate precedenti.
   La cancellazione è ammessa soltanto dopo aver verificato che nessun manifest
   mantenuto o deploy attivo referenzi l'oggetto.
7. Il backup deve trovarsi in un dominio di guasto distinto da R2. La
   destinazione sarà scelta dai maintainer prima del primo upload di produzione.

## Configurazione proposta

Credenziali, inserite dai maintainer in CI e runtime:

- `DVNS_OPENCUP_R2_RUNTIME_ACCESS_KEY_ID`
- `DVNS_OPENCUP_R2_RUNTIME_SECRET_ACCESS_KEY`
- `DVNS_OPENCUP_R2_CI_ACCESS_KEY_ID`
- `DVNS_OPENCUP_R2_CI_SECRET_ACCESS_KEY`

Configurazione server-side, senza valori nella issue o nella PR:

- `DVNS_OPENCUP_R2_ACCOUNT_ID`
- `DVNS_OPENCUP_R2_PRODUCT_BUCKET`
- `DVNS_OPENCUP_R2_RAW_BUCKET`

Le credenziali runtime sono di sola lettura sul bucket prodotto. Le
credenziali CI possono scrivere gli oggetti candidati, ma non rendono attiva
una release: la promozione resta una modifica del manifest e del gate nel
repository.

## Stima prima del primo upload

La stima va ricalcolata immediatamente prima del primo upload usando il listino
R2 corrente e il traffico atteso. Con la candidata locale:

- una release prodotto occupa 3,650 GB;
- tre release completamente diverse occuperebbero al massimo 10,951 GB;
- una ricerca con risultato legge normalmente 5 oggetti, circa 386–422 KB;
- una ricerca assente usa da 1 a 3 letture.

Al listino consultato il 7 settembre 2026, R2 Standard include 10 GB-mese,
1 milione di operazioni Class A e 10 milioni di operazioni Class B al mese;
oltre soglia costa 0,015 USD/GB-mese e 0,36 USD per milione di letture. R2 non
addebita egress Internet. Nel caso conservativo di tre release senza
deduplicazione, il solo storage oltre franchigia è circa 0,02 USD/mese; 10
milioni di ricerche da 5 letture genererebbero circa 14,40 USD/mese di Class B.
Queste cifre non includono backup esterno, compute, log, IVA o traffico del
provider applicativo.

Riferimenti: [prezzi R2](https://developers.cloudflare.com/r2/pricing/),
[Bucket Lock](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

## Prova di backup e ripristino

Prima di attivare OpenCUP:

1. scegliere un oggetto prodotto dal manifest e annotare chiave, byte e SHA-256;
2. copiarlo nel backup esterno e rimuoverlo soltanto dall'ambiente di prova;
3. ripristinarlo in un bucket R2 di prova;
4. scaricarlo per digest, verificare byte e SHA-256 prima della decompressione;
5. avviare il reader con il manifest candidato e verificare la canary e una
   ricerca CUP completa;
6. registrare in issue o PR data, ambiente, release, digest ed esito, senza
   credenziali o identificativi sensibili.

Un restore fallito lascia il prodotto spento. Non si usa `latest`, un digest
diverso o una release precedente come fallback silenzioso.

## Attivazione e aggiornamento obbligatorio

La visibilità può essere attivata soltanto dopo review del codice, provisioning
R2, upload di prova, stima costi approvata e restore riuscito. La stessa modifica
deve attivare source policy e stato fonte, API/UI e catalogo MCP.

Questo ADR deve essere aggiornato prima dell'attivazione con:

- nomi reali dei bucket e permessi effettivi, senza segreti;
- destinazione e retention del backup esterno;
- stima mensile approvata per storage, letture CI/runtime e backup;
- manifest e release testati;
- ricevuta della prova di restore e decisione finale di promozione.
