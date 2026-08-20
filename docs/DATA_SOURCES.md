# Fonti dati

Questa è la mappa iniziale delle fonti. Il criterio è semplice: prima fonti istituzionali nazionali, strutturate e con identificativi stabili; poi portali territoriali e documenti meno standardizzati.

## Tier 1 — infrastrutture nazionali

### SIOPE / SIOPE+
**Titolari/gestori:** RGS e Banca d'Italia.  
**Uso:** incassi e pagamenti degli enti pubblici.  
**Join:** ente, periodo, codifica gestionale/contabile.  
**Nota:** SIOPE contiene dati per oltre 10.000 enti. SIOPE+ è l'infrastruttura degli ordinativi di pagamento e incasso; non va confusa la frequenza del flusso operativo con la frequenza del dato pubblico esposto dalla dashboard.

### OpenBDAP
**Titolare:** Ragioneria Generale dello Stato.  
**Uso:** bilancio dello Stato, spesa, SIOPE, opere pubbliche, PNRR e altri domini.  
**Accesso:** catalogo CKAN con API ufficiali.  
**Primo endpoint implementato:** `GET /api/fonti/bdap`, proxy con timeout e metadati di osservazione.

### BDNCP / ANAC
**Titolare:** ANAC.  
**Uso:** contratti pubblici, CIG, stazioni appaltanti, aggiudicazioni e ciclo di vita.  
**Freschezza:** il cruscotto Analytics ANAC dichiara aggiornamento settimanale. Le pubblicazioni open data hanno una propria periodicità.

### IPA
**Titolare:** AgID.  
**Uso:** anagrafe canonica degli enti, Codice IPA, codice fiscale, sito istituzionale, categoria.  
**Freschezza:** dataset Enti con aggiornamento giornaliero.  
**Ruolo:** base per scoprire i siti istituzionali e alimentare il crawler di Amministrazione Trasparente.

Risorse integrate:

- Enti: chiave `Codice_IPA`, con codice fiscale e codici territoriali come identificativi separati;
- Unità Organizzative: chiave globale `Codice_uni_uo`, relazione all'ente via `Codice_IPA` e gerarchia dichiarata via `Codice_uni_uo_padre`;
- Aree Organizzative Omogenee: chiave globale `Codice_uni_aoo`, relazione all'ente via `Codice_IPA`;
- amministrazioni centrali: categoria IPA `C1`; i ministeri vengono distinti dalla PCM con i codici natura, non dal testo della denominazione.

Le UO non hanno un campo semantico che certifichi “dipartimento”, “direzione generale” o “ufficio”. Queste qualifiche richiedono un crosswalk ufficiale con regolamenti e sezioni Amministrazione Trasparente.

## Tier 2 — trasparenza distribuita

### Dati sui pagamenti art. 4-bis
Nel 2026 ANAC ha pubblicato uno schema di riferimento per i dati sui pagamenti nella sezione “Amministrazione Trasparente”.

Campi centrali dello schema:

```text
amministrazione.codiceFiscale
amministrazione.denominazione
dataPrimaPubblicazione
dataUltimaModifica
anno
trimestre
categoria
tipologia
importo
beneficiario
```

Strategia:

1. enumerare gli enti IPA;
2. ottenere il sito istituzionale;
3. individuare la sezione Amministrazione Trasparente;
4. cercare le risorse art. 4-bis;
5. preferire JSON/CSV/XML;
6. validare rispetto allo schema;
7. salvare fonte e hash;
8. non fare OCR di PDF se esiste un formato strutturato;
9. pubblicare un indice di copertura separato dalla spesa.

ANAC TrasparenzAI dimostra che il monitoraggio automatico della struttura di Amministrazione Trasparente è tecnicamente applicabile su scala IPA. DoveVannoINostriSoldi non deve duplicare il giudizio di conformità ANAC: deve usare la stessa idea di discovery per aggregare i dati effettivamente pubblicati.

## Tier 3 — investimenti

### ReGiS / PNRR
Gli open data PNRR sono pubblicati come estrazioni periodiche da ReGiS e comprendono informazioni finanziarie, fisiche e procedurali. Useremo CUP come una delle chiavi fondamentali.

### OpenCoesione
L'API e gli open data espongono progetti e soggetti, con tabelle relazionali per localizzazioni, pagamenti, impegni, fasi e indicatori. I dati sono pubblicati con licenza CC BY 4.0.

La prima integrazione usa l’aggregato nazionale ufficiale `/it/api/aggregati/`, che espone costo pubblico, pagamenti, numero di progetti, stati, temi, nature, serie annuale e data del rilascio. Lo snapshot viene controllato ogni 6 ore e committato soltanto quando cambia il payload normalizzato, esclusi i timestamp di osservazione.

Ogni dimensione deve riconciliarsi con il totale nazionale, sia per i valori generali sia per la componente coesione: sono tollerati al massimo 2 euro di scarto monetario dovuto agli arrotondamenti della fonte e nessuno scarto nel conteggio dei progetti. Le aggregazioni territoriali non sono ancora sommate perché i progetti multilocalizzati possono comparire in più territori e rendere i valori non additivi.

## Tier 4 — incarichi e istituzioni

### Partecipazioni pubbliche MEF

La prima integrazione usa il CSV annuale del Dipartimento dell'Economia riferito al 2023. Il file sorgente è delimitato da `;` e usa byte Windows-1252 nonostante header HTTP incoerenti osservati: l'ETL rileva la codifica e conserva l'hash SHA-256.

Lo snapshot pubblico contiene aggregati nazionali e le organizzazioni dichiarate dal maggior numero di amministrazioni. La relazione è identificata tramite codice fiscale dell'amministrazione e della partecipata, insieme all'anno. Non pubblichiamo un booleano “in-house corrente”: controllo analogo e affidamento diretto restano dichiarazioni riferite all'anno di rilevazione.

L'elenco ANAC ex art. 192 è trattato come archivio storico perché ANAC lo dichiara non più operativo dal 1° luglio 2023. AUSA identifica stazioni appaltanti, ma non certifica la natura in-house. Registro Imprese resta fuori dall'ingestione open: l'accesso è contrattuale e le condizioni standard limitano redistribuzione e diffusione.

### Classificazione ISTAT S13

S13 e IPA hanno perimetri diversi. Finché la pubblicazione ufficiale corrente non espone una distribuzione analitica machine-readable verificabile, il portale mantiene S13 come fonte censita e non deduce l'appartenenza dal solo `Codice_ISTAT` presente in IPA.

### Consulenti Pubblici
Il Dipartimento della Funzione Pubblica pubblica gli incarichi comunicati dalle amministrazioni nell'Anagrafe delle prestazioni. Sono esposti, tra gli altri, compenso lordo, ammontare erogato e data di aggiornamento del singolo incarico.

### Camera dei deputati
Camera Trasparente pubblica informazioni su bilancio, amministrazione e procedure di gara. L'integrazione deve distinguere il trattamento economico “previsto” dagli importi individualmente e realmente erogati quando questi ultimi non siano esposti dalla fonte.

### Senato della Repubblica
La sezione Spese e trasparenza pubblica bilancio, conto consuntivo e informazioni sul trattamento economico dei senatori. Vale la stessa cautela sulla granularità individuale.

## Fonti successive

Da valutare nella fase 2:

- sovvenzioni e contributi art. 26/27 D.Lgs. 33/2013;
- patrimonio e partecipazioni pubbliche;
- tempi di pagamento e debiti commerciali;
- personale pubblico;
- sanità;
- dati regionali e comunali con maggiore granularità;
- Corte dei conti per contesto e referti, senza confondere contestazioni, sentenze e dati di spesa.
