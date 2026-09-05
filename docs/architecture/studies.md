# Studi occasionali

`/studi` è l'archivio di ricerca, distinto dal calendario degli articoli mensili
`/report` sviluppato separatamente. La PR degli studi non importa né pubblica
le capsule dei report e non introduce link a route non ancora disponibili.
Le due sezioni possono essere raccolte in futuro in un indice editoriale comune,
senza cambiare gli URL o trasformare una revisione scientifica in un'edizione mensile.

## Percorso del contenuto

Snapshot storico verificato con manifest e SHA-256 →
`research/pnrr-childcare-delivery/scripts/analyze.py` e `robustness.py` →
figure e tabelle → LaTeX/PDF → `export_web.py` →
capsula aggregata `src/content/studies/childcare.json` e asset pubblici versionati.

`src/lib/studies.ts` espone il registro. Le pagine sono Server Components
prerenderizzati, senza query di rete e senza importare i microdati correnti.
Grafico e tabella web leggono i medesimi aggregati dell'analisi.

## Revisione e diffusione

- Un nuovo studio ha uno slug e una domanda propria: non serve una cadenza fissa.
- Una revisione espone data, versione, riferimento dei dati e correzioni.
- Dopo il merge, non sovrascrivere gli asset di una versione pubblicata:
  creare una nuova directory di versione e conservarne le precedenti.
- Una nuova estrazione non deve riscrivere uno studio storico.
- Working paper non significa peer review. Verifica umana e approvazione
  editoriale sono distinte dai test tecnici.
- Nessun deploy o merge automatico è autorizzato dalla preparazione della PR.

## Controlli

Test Node confrontano capsula/analisi, identità PDF e checksum degli asset.
Test Python coprono classificazione degli stati e Kaplan-Meier con ties e censura.
Il gate di produzione include archivio → dettaglio, download PDF verificato
via SHA-256, un H1, canonical e assenza di overflow a 390/1.440 px.
Il PDF non è tagged: la sintesi HTML offre un'alternativa accessibile ai risultati
principali; non si dichiara conformità PDF/UA.
