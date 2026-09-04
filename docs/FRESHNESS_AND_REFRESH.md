# Freshness, refresh e observability delle fonti

DoveVannoINostriSoldi non usa la parola **live** come sinonimo di polling continuo. Il dato può essere aggiornato soltanto quando la fonte ufficiale pubblica nuova informazione.

L'obiettivo operativo è diverso: **rilevare ogni nuovo rilascio ufficiale il prima possibile, conservarne la provenienza e non servire dati inventati quando l'upstream ha problemi**.

## Principi

1. La cadenza ufficiale della fonte e la frequenza con cui la controlliamo sono due concetti distinti.
2. Il discovery può essere più frequente della pubblicazione, ma non rende il dataset più recente della fonte.
3. Gli outage delle fonti non devono rendere non deterministica la CI del codice.
4. I retry sono limitati ai problemi transitori; gli errori permanenti e gli errori di schema restano visibili.
5. Ogni fetch server verso una fonte integrata deve passare progressivamente dal layer `src/lib/data/source-fetch.ts`.
6. Nessun endpoint interno di refresh accetta URL arbitrari.
7. La cache è segmentata per source tag, in modo da invalidare una fonte senza svuotare tutto il sito.

## Inventario degli snapshot

L'elenco operativo degli snapshot committati è in
[SOURCE_SNAPSHOT_INVENTORY.md](SOURCE_SNAPSHOT_INVENTORY.md): periodo nello
snapshot, URL ufficiale, controlli, workflow, modo di aggiornamento e rollback.
È generato dal registro `scripts/ci/generated-artifacts.json`. Un inventario
stale fallisce la CI.

Questo risponde a [#189](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/189)
prima di automatizzare una fonte alla volta. Non sostituisce la tabella delle
cadenze qui sotto.

## Componenti

### `source-policy.ts`

È il registro operativo delle sorgenti. Per ogni fonte dichiara:

- proprietario;
- URL ufficiale;
- cadenza pubblicata o natura periodica;
- frequenza di discovery;
- durata cache dei dati;
- soglia di stale soltanto quando ha senso assegnarla;
- timeout;
- numero massimo di retry;
- cache tag.

Questa è configurazione di dominio, non configurazione della UI.

### `source-fetch.ts`

È l'unico fetch layer generico per gli upstream ufficiali.

Garantisce:

- allowlist per host e HTTPS;
- richieste read-only (`GET` / `HEAD`);
- User-Agent identificabile;
- timeout per sorgente;
- retry limitato su `408`, `425`, `429` e `5xx` transitori;
- cache/revalidation Next.js;
- tag per sorgente;
- nessun parsing o recupero silenzioso degli errori di schema.

La validazione semantica resta responsabilità dell'adapter specifico.

### `/api/fonti/stato`

Espone observability separata dal dato economico. Per ora esegue probe reali soltanto sugli adapter attivi e maturi. Una fonte mappata ma non ancora integrata viene indicata come **non ancora sondata**, non come online/offline per supposizione.

### Calendario dei documenti programmatici

`/fonti/calendario` registra le principali pubblicazioni annuali del ciclo di
bilancio con stato, data o finestra attesa, periodo di riferimento, URL
ufficiale e `observedAt`. Il registro è curato e versionato: una finestra
abituale non viene trasformata automaticamente in una scadenza o in un ritardo.

La disponibilità documentale resta separata dall'integrazione dei dati. Il
calendario non estrae importi o previsioni dai PDF e non considera i loro
contenuti acquisiti dai dataset del sito finché non esistono un ETL, un hash e
un contratto verificato dedicati.

Questa prima superficie risponde alla
[#260](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/260).

### `/api/internal/refresh-sources`

Endpoint interno autenticato tramite `SOURCE_REFRESH_SECRET`.

Può:

- invalidare i tag di una o più fonti;
- invalidare le route che oggi usano ancora adapter precedenti al tag-based fetch layer;
- preparare il sistema al successivo accesso con semantica stale-while-revalidate.

Se il secret non è configurato l'endpoint risponde `503`: non esiste una modalità aperta di fallback.

### `.github/workflows/source-refresh.yml`

Una volta impostati i repository secrets:

- `REFRESH_URL`: origin pubblico del deployment, ad esempio `https://example.org`;
- `SOURCE_REFRESH_SECRET`: lo stesso valore configurato nel deployment;

GitHub Actions invalida ogni ora, al minuto 17, le sorgenti integrate. Il minuto non è `00` per evitare la finestra più congestionata dei cron GitHub.

Se i secret non esistono il workflow termina con successo e un notice, perché il repository deve rimanere utilizzabile prima del primo deployment.

### OpenCoesione snapshot versionato

OpenCoesione usa un flusso dedicato perché la dashboard deve rimanere disponibile anche durante un disservizio dell’upstream:

1. il workflow controlla l’API aggregata ufficiale ogni 6 ore con timeout e retry limitati;
2. schema, domini, interi monetari e riconciliazioni vengono ricalcolati prima della scrittura;
3. su errore transitorio viene mantenuto l’ultimo snapshot valido e il degrado resta visibile nei log;
4. il file viene committato soltanto quando cambia il payload normalizzato, esclusi i timestamp di osservazione;
5. l’API normalizzata usa cache CDN di 6 ore e stale-while-revalidate di 7 giorni.

La cadenza dichiarata dalla fonte resta bimestrale prevista. `/api/fonti/stato` classifica la freshness dalla data del rilascio ma non ripete il probe di rete: la reachability è controllata dal workflow dedicato.

### Italia Domani PNRR asili

Il verticale PNRR usa uno snapshot di quattro CSV ufficiali bloccati con SHA-256. La CI valida offline artefatto, metadati, copertura e join. Ogni lunedì il workflow `pnrr-childcare-refresh.yml` scarica in streaming i quattro asset e confronta hash e dimensione; una variazione apre un errore revisionabile e non aggiorna automaticamente i dati pubblicati. La rigenerazione manuale produce un artefatto candidato, mai un commit automatico.

La data di freshness è la `Data di Estrazione` comune ai quattro file, non il giorno in cui GitHub Actions li ha ricontrollati. Non viene assegnata una soglia “stale” inventata perché Italia Domani non dichiara nel contratto una periodicità garantita.

### Consulenti Pubblici

Il workflow controlla ogni 6 ore l'endpoint ufficiale usato dal portale. Gli importi vengono salvati in centesimi interi e l'anno corrente resta indicato come parziale. Se il contenuto non cambia, il timestamp di osservazione non produce un nuovo commit.

### OpenCivitas

Il rilascio comunale 2022 viene verificato ogni giorno. L'ETL controlla i metadati degli indicatori, il join sul codice ISTAT, gli importi, i livelli dei servizi e gli avvisi della fonte prima di scrivere lo snapshot.

Il server OpenCivitas non invia al momento il certificato intermedio della propria catena TLS. La verifica resta attiva: l'ETL aggiunge il solo certificato pubblico intermedio verificato e documentato in `scripts/etl/certs/README.md`. Non usa `--insecure`, proxy o fonti alternative.

Una nuova annualità non viene accettata alla cieca. Il workflow la rileva e si ferma con un errore esplicito, lasciando disponibile l'ultimo snapshot valido. Prima si convalidano schema, definizioni e copertura; poi si aggiorna il contratto e si abilita il nuovo anno.

### OpenBDAP MOP

La ricerca delle opere pubbliche non dipende da alias OData scritti a mano. Il connettore controlla metadati e schema, ricava gli alias tecnici ufficiali e si ferma se una colonna richiesta cambia nome, significato o tipo.

Il refresh orario invalida il tag OpenBDAP e la route `/api/opere`. Al primo accesso successivo vengono ricontrollati metadati e schema; i dati di una singola ricerca CUP hanno cache di 6 ore e possono essere serviti per altre 24 ore mentre avviene la riconvalida. La risposta espone separatamente data della fonte e momento del controllo della piattaforma.

### OpenBDAP pagamenti Stato — verifica del ripristino

Dopo un disservizio del dump CSV («Cannot convert data to csv») o un timeout dell'host,
controllare prima la fonte e poi la produzione:

```bash
# Dump CSV atteso: intestazioni testuali, non JSON Dataset Error
curl -sS 'https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/<package-uuid>.csv?download=1' | head

# Produzione: ultimo rilascio disponibile (nessun filtro)
curl -sS 'https://www.dovevannoinostrisoldi.com/api/spese/stato'

# Produzione: periodo specifico — usare i nomi italiani anno/mese, non year/month
curl -sS 'https://www.dovevannoinostrisoldi.com/api/spese/stato?anno=2025&mese=8'
```

`year` e `month` non sono parametri riconosciuti: se presenti soli, la route restituisce
l'ultimo rilascio pubblicato (comportamento atteso, non un bug del filtro). Per scegliere
un mese contabile usare sempre `anno` e, se serve, `mese` (1–12).

### MEF IRPEF comunale

Il dataset è annuale e snapshot-managed. La pubblicazione della fonte, l'anno
d'imposta, l'anno delle dichiarazioni e il momento di osservazione restano
campi distinti. Il workflow dedicato può rilevare una nuova risorsa, ma non
aggiorna automaticamente URL, hash, schema o licenza nel source lock.

La CI ordinaria esegue soltanto il controllo offline sugli artefatti versionati.
Una nuova release viene rigenerata manualmente dopo la revisione del manifest;
se download, member ZIP, header, copertura o riconciliazioni divergono, i due
output precedenti restano invariati.

### Parlamento

Il monitor controlla ogni 6 ore i registri ufficiali di Camera e Senato. La validazione offline dello snapshot e del manifesto resta sempre obbligatoria. Un nuovo documento, un formato cambiato o un errore HTTP permanente interrompono il workflow e richiedono una revisione.

Timeout, errori di rete, risposte `408`, `425`, `429` e alcuni errori `5xx` vengono ritentati. I siti parlamentari possono inoltre rispondere con `403` ai runner automatici o restituire temporaneamente un CSV con campi indispensabili vuoti: in questi casi il controllo viene segnato come non riuscito e genera un avviso, ma non invalida l'ultimo snapshot verificato. Il monitor non completa i campi usando il manifesto e non registra un falso successo. Un valore presente ma malformato, un documento rimosso o un cambio di struttura restano invece errori bloccanti. Il timestamp pubblico non viene aggiornato durante questi fallimenti.

### Debito pubblico

Il workflow giornaliero scarica quattro cubi BDS della Banca d'Italia e il
dataset annuale Eurostat, quindi valida schema, serie, interi monetari e
riconciliazioni prima della scrittura atomica. Gli hash e le dimensioni dei file
grezzi vengono sempre ricalcolati e verificati durante il download.

La Banca d'Italia rigenera il contenitore ZIP a ogni richiesta: timestamp e hash
del trasporto possono quindi cambiare anche quando i CSV normalizzati sono
identici. Queste sole differenze non riscrivono lo snapshot e non producono un
commit. Hash, dimensioni e data di acquisizione già versionati vengono sostituiti
soltanto quando cambia il contenuto normalizzato o la versione upstream; una
variazione semantica continua a richiedere l'intera validazione.

### Pagella politico-economica dei governi

Il workflow `government-scorecard-refresh.yml` controlla ogni martedì AMECO e
le nove fonti Eurostat della pagina. È discovery settimanale: non trasforma una
serie annuale o trimestrale in un dato settimanale.

AMECO determina il voto soltanto fino all'ultimo anno comune osservato; le sue
previsioni restano escluse. Eurostat aggiorna i grafici secondo la cadenza della
singola serie. Ogni punto mantiene il proprio periodo e lo stato pubblicato
(`observed`, `provisional` o `estimated`). Un cambiamento genera una PR dati
separata dopo i controlli su filtri, paesi, periodi, unità, hash,
riconciliazioni e contratto runtime. Un errore di rete o di schema conserva
l'ultimo snapshot valido.

Il contesto documentato non viene estratto automaticamente dalle notizie: è
revisionato almeno ogni tre mesi, dopo eventi economici rilevanti e al cambio
di governo. La procedura completa è in
[PAGELLA_POLITICO_ECONOMICA.md](PAGELLA_POLITICO_ECONOMICA.md).

## Policy iniziali

| Fonte | Cadenza sorgente | Discovery DoveVannoINostriSoldi | Dati |
| --- | --- | ---: | ---: |
| IPA Enti | giornaliera | 1 h | 1 h |
| OpenBDAP · Pagamenti Stato e opere MOP | mensile + consuntivo annuale per i pagamenti; data propria per MOP | 1 h · invalidazione, metadati entro 2 h | 6 h |
| ANAC open dataset | mensile | 3 h | 12 h |
| OpenCoesione | bimestrale prevista | 6 h · workflow snapshot | 6 h · cache API |
| OpenCivitas | irregolare | 24 h · workflow snapshot | 24 h · cache API |
| MEF IRPEF comunale | annuale | 24 h · discovery snapshot | snapshot versionato |
| ReGiS | periodica | 6 h | 12 h |
| Art. 4-bis | dipende dall'ente | 3 h | 6 h |
| Consulenti Pubblici | dipende dall'ente | 6 h | 6 h |
| Camera dei deputati | su pubblicazione | 6 h | 12 h |
| Senato della Repubblica | su pubblicazione | 6 h | 12 h |
| Banca d'Italia · debito pubblico | mensile, circa 45 giorni di ritardo | controllo giornaliero 06:17 UTC | snapshot versionato; stale oltre 75 giorni |
| Eurostat · interessi e spesa totale | annuale | controllo giornaliero 06:17 UTC | snapshot versionato; warning oltre 540 giorni |
| AMECO + Eurostat · pagella governi | da mensile ad annuale, secondo la serie | controllo settimanale martedì 07:37 UTC | snapshot versionato; pubblicazione tramite PR |

Camera ha un riepilogo strutturato con data del documento. Senato resta documentale: i nuovi atti vengono collegati, ma i valori non sono pubblicati finché non superano una normalizzazione verificabile.

## CI vs source health

La CI ordinaria verifica esclusivamente proprietà del repository:

```text
install → lint/test/ETL → typecheck → Impeccable → build
        → HTTP/MCP smoke + load → Browser responsive → Lighthouse lab (proxy CWV)
```

Browser e Lighthouse interrogano esclusivamente il build locale prodotto dal job; il report
Lighthouse resta un artefatto della CI e non sostituisce dati real-user. La pipeline non deve
fallire perché MEF, RGS, AgID o ANAC sono momentaneamente offline.

Le verifiche live appartengono invece a:

```text
source refresh → source probe → alert/observability
snapshot refresh → validazione → commit → deploy
```

Questo rende distinguibili un bug introdotto nel codice e un problema di disponibilità esterno.

## Strategia di migrazione

Gli adapter vengono migrati uno alla volta al source fetch layer.

Stato attuale:

- IPA Data API: migrata;
- IPA aggregazioni SQL: migrate;
- OpenBDAP: pagamenti con revalidation temporale; opere MOP sul source fetch layer con tag, schema verificato e ricerca CUP;
- OpenCoesione: snapshot ETL versionato attivo; freshness applicativa esposta, reachability demandata al workflow dedicato;
- Consulenti Pubblici: snapshot ETL versionato attivo; anno corrente esplicitamente parziale;
- OpenCivitas: snapshot comunale 2022 attivo; nuove annualità ammesse dopo convalida del contratto;
- Camera: consuntivo 2025 e bilancio 2026 separati per significato contabile;
- Senato: documenti ufficiali collegati, valori strutturati ancora sospesi;
- altre fonti: useranno direttamente il nuovo contratto quando verranno implementate.
- Debito pubblico: quattro ZIP BDS e una risposta JSON-stat Eurostat sono scaricati soltanto dal workflow dedicato; schema, serie, hash e riconciliazioni devono passare prima della sostituzione atomica dello snapshot.

Non riscriviamo tutti gli adapter contemporaneamente soltanto per uniformità estetica: ogni migrazione deve mantenere gli stessi risultati e passare lint, typecheck, design gate e build.
