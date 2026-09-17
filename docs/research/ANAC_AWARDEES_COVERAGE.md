# Contratto e copertura ANAC aggiudicatari

Questa prima slice misura quanto i full snapshot ANAC `aggiudicatari` e
`aggiudicazioni` si colleghino tramite la chiave ufficiale composta
`CIG + ID_AGGIUDICAZIONE`. Non pubblica righe sorgente, codici fiscali,
denominazioni, ranking, HHI, soglie o indicatori di integrità.

## Fonti e perimetro

- [Aggiudicatari](https://dati.anticorruzione.it/opendata/dataset/aggiudicatari),
  full snapshot con ultima modifica dichiarata 23 gennaio 2026;
- [Aggiudicazioni](https://dati.anticorruzione.it/opendata/dataset/aggiudicazioni),
  full snapshot con ultima modifica dichiarata 15 gennaio 2026;
- licenza dichiarata sulle due risorse: CC BY-SA 4.0;
- catalogo e asset osservati il 30 agosto 2026.

Il [source lock](../../scripts/etl/specs/anac-awardees.source.json) conserva per
ogni input URL e ID risorsa ufficiali, byte e SHA-256 dell'archivio, nome, byte,
CRC32 e SHA-256 del membro CSV, encoding, delimitatore e header esatto.

Il manifest misura soltanto i due full snapshot. I delta mensili pubblicati dopo
la loro data non vengono sommati: prima serve un contratto separato sulla
semantica degli aggiornamenti. Per questo la replica non dichiara una popolazione
nazionale corrente o completa.

I due full snapshot sono editorialmente indipendenti e hanno date di ultima
modifica diverse (23 e 15 gennaio 2026). La riconciliazione è quindi
cross-snapshot: gli unmatched descrivono la copertura di questa coppia di file,
non una mancanza osservata nello stesso istante.

## Contratto

La grana di `aggiudicatari` è una riga sorgente per relazione tra aggiudicazione
e soggetto. La grana di `aggiudicazioni` è una riga sorgente di aggiudicazione.
Il join usa sempre la coppia `CIG + ID_AGGIUDICAZIONE`; né il solo CIG, né il
solo ID, né la denominazione sono chiavi sufficienti.

`ID_AGGIUDICAZIONE` resta una stringa. Il codice fiscale originale resta nel
record transitorio dell'audit; la forma derivata applica soltanto Unicode NFKC,
trim e maiuscole. Punteggiatura e zeri non vengono rimossi. La classificazione
separa:

- 11 cifre e 16 caratteri alfanumerici, con checksum valido o non valido;
- altri valori alfanumerici;
- valori esteri o anomali;
- placeholder o valori oscurati;
- valori mancanti.

Forma e checksum non certificano l'identità anagrafica. Duplicati esatti,
mandatarie, mandanti, imprese ausiliarie, RTI e consorzi vengono misurati e non
deduplicati silenziosamente.

Il numero di soggetti distinti per aggiudicazione usa il codice fiscale
normalizzato: più righe o ruoli con lo stesso valore restano visibili nei
conteggi di riga e di ruolo, ma non creano soggetti distinti aggiuntivi. Gli
importi non sono analizzati in questa slice: non ne vengono validati formato,
segno o scala e non sono inclusi nel manifest.

## Risultato del full snapshot

Il [manifest aggregato](../../src/data/generated/anac-awardees-coverage.json)
riporta:

- 5.437.334 righe aggiudicatario e 4.862.077 righe aggiudicazione;
- 5.437.331 righe aggiudicatario con codice fiscale valorizzato;
- 5.357.835 valori con forma italiana a 11 o 16 caratteri;
- 5.345.384 valori che superano anche il checksum applicabile;
- 1.370 placeholder o valori oscurati e 3 valori mancanti;
- 276 duplicati esatti oltre la prima riga, in 224 gruppi;
- 4.822.171 coppie distinte `CIG + ID_AGGIUDICAZIONE` lato aggiudicatari;
- 255.594 coppie con più codici fiscali distinti, fino a 151;
- 641.556 righe con ruolo o tipo ufficiale riconducibile a gruppo, RTI o consorzio;
- 23.490 codici fiscali normalizzati associati a più denominazioni esatte e
  31.507 denominazioni esatte associate a più codici fiscali.

La riconciliazione esatta trova 5.433.631 righe. Restano:

- 7 righe con lo stesso ID ma nessun CIG corrispondente;
- 105 righe con lo stesso CIG ma nessun ID corrispondente;
- 3.591 righe senza corrispondenza su nessuna delle due chiavi;
- 34.032 coppie nel file aggiudicazioni prive di una riga aggiudicatario esatta.

Le partizioni annuali derivano da `data_aggiudicazione_definitiva` soltanto per
le coppie riconciliate. 42.479 date sono mancanti, 815 future rispetto
all'osservazione e 1.112 anteriori al 1990: confluiscono nel periodo sconosciuto
e non vengono corrette o imputate.

## Riproduzione

Scaricati i due ZIP ufficiali fissati nel source lock:

```bash
python3 scripts/etl/anac_awardees_coverage.py \
  --awardees-input /percorso/aggiudicatari_csv.zip \
  --awards-input /percorso/aggiudicazioni_csv.zip \
  --observed-at 2026-08-30T18:30:00Z
```

Il controllo offline del manifest committato non richiede rete né dataset:

```bash
python3 scripts/etl/anac_awardees_coverage.py --check
```

I test usano soltanto fixture sintetiche. Il manifest contiene esclusivamente
provenienza, contratto e conteggi aggregati.

## Limiti per le slice successive

Gli importi appartengono all'aggiudicazione e, in una slice futura, dovranno
essere contati una sola volta anche quando un RTI ha più componenti. L'identità
dell'ente richiede un ulteriore join ufficiale con CIG e stazione appaltante. Prima di pubblicare
ranking, quote, HHI o benchmark serviranno inoltre denominatori per periodo e
CPV, policy per l'identità pubblica dell'operatore e drill-down verificabile.

Nessuno dei conteggi di questa replica indica spreco, illecito, corruzione o
frazionamento artificioso.
