# Rifiniture frontend — 11 novembre 2026

Base: `7346b4513b00a72e37134d03a2ec414f7db96284`, produzione verificata READY.
Branch: `nuovo-stile-rifiniture`. Le PR aperte riguardano altri interventi;
nessuna sovrapposizione sui componenti previsti. Backend, dataset, API,
autenticazione, dipendenze e configurazione di produzione restano invariati.

## Comportamenti e verifiche previste

- Home compatta, cinque analisi senza indice intermedio; anteprime da snapshot
  esistenti con fonte, periodo, unità e copertura; niente dati inventati.
- Distinguere dato osservato, esito dei controlli e previsione nella sezione controlli.
- Directory completa filtrabile: accenti, query vuota, nessun risultato, reset,
  tastiera e gruppi espandibili su mobile; link nella stessa scheda.
- Contesto comune delle pagine e copia della vista con filtri; nessun parametro
  di autenticazione nel link condiviso; fallback manuale se la clipboard è negata.
- Filtri degli atlanti con selezioni leggibili, ripristino e cronologia; ritorno
  alla vista selezionata dopo navigazione al dettaglio.
- Definizioni vicino alle visualizzazioni di spesa, mantenendo i perimetri distinti.
- Verifica desktop/mobile, temi chiaro/scuro, focus, Escape, overflow, console,
  stati vuoti e navigazione home → dashboard → footer → home.
- Test pertinenti, TypeScript, lint dei file toccati, build, controllo diff e SHA.
  Browser tramite ambiente di anteprima gestito; nessun server alternativo.
- Un solo push delle modifiche validate e preview del sito completo su Vercel.
  Nessun merge o rilascio in produzione.

## Esito

Implementazione completata, verifica finale in corso.

- PASS: 78 test mirati (directory e condivisione, navigazione, imprese,
  istruzione, indicatori dei controlli, UI responsive, mappe e palette).
- PASS: `npm run lint`, `npm run design:check`, `git diff --check`.
- PASS: compilazione Next/Turbopack del frontend (57 secondi).
- Il typecheck completo locale ha esaurito la memoria: primo tentativo al
  limite predefinito di 2 GiB, secondo terminato dall'ambiente con exit 137.
  La build completa e la preview Vercel restano da verificare.
- Il runner locale non ha `/tmp`: i test mirati sono stati eseguiti con
  `TMPDIR` in scratch; nessun file dell'applicazione modificato per aggirarlo.
- Browser locale NON VERIFICATO: `sites-preview start` e `status` riportano
  `preview relay unavailable`. Nessun server alternativo avviato.
- ETL: NOT RUN. Backend e test live non rientrano nell'intervento.

## Note di revisione

I link alle mappe usano `/comuni` e `/politici`, anche dalla home e dalla
directory: una preview non deve portare alla produzione. I domini canonici,
le API e i link alle fonti rimangono invariati. Il link alla Presidenza usa
l'identificatore istituzionale già supportato e apre il relativo pannello.

Le anteprime di imprese, scuola e Camera sono renderizzate sul server usando
gli adapter esistenti. Dataset grezzi e contratti non entrano nei nuovi
componenti client. I mancanti non diventano zero; i totali scolastici mantengono
la copertura del dataset; i pagamenti della Camera sono espressi in milioni.

Il reset degli atlanti conserva indicatore e periodo e rimuove solo i filtri
territoriali/categoriali. La cronologia conserva ogni selezione; i controlli
mostrano lo stato di aggiornamento durante la navigazione.

