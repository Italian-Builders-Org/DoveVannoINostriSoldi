# Archivio di ricerca

Archivio pubblico canonico: `/studi`. `/paper` risponde con un redirect permanente
308 verso l'archivio. Le pubblicazioni sono occasionali e distinte dai report
mensili. La scheda di *Dai fondi ai posti*, già pubblicato, conserva il dettaglio
HTML `/studi/dai-fondi-ai-posti` e gli asset delle revisioni precedenti.

## Confine editoriale

- `src/content/papers/drafts`: appunti editoriali, mai importati dal sito.
- `src/content/papers/published/index.ts`: metadati delle pubblicazioni. Per lo
  studio sugli asili, versione e checksum derivano dalla capsula aggregata.
- `src/lib/papers-contract.ts`: valida data, autori, versione, limiti, URL HTTPS,
  hash SHA-256 del PDF e link ai materiali riproducibili.
- `papers.listPublished()`: catalogo ordinato, isolato dalle mutazioni esterne.
- Navigazione, ricerca globale, sitemap e discovery LLM espongono gli URL
  canonici; la ricerca indicizza solo il registro pubblicato.

Ogni scheda ha un'ancora stabile `/studi#slug`, abstract e limiti in HTML,
autori, data, versione e link al PDF e ai materiali riproducibili. Uno studio
può avere anche una pagina HTML dedicata tramite `webPath`. Il PDF non è
l'unica spiegazione accessibile. Le bozze non hanno route pubbliche e un
paper di ricerca non attesta una revisione scientifica esterna.

## Versioni e provenienza

La versione è una stringa numerica, per esempio `1`, `1.3` o `1.3.0`. Per una
revisione usare un PDF con URL versionata distinta, conservare le versioni
precedenti e documentare le correzioni nei materiali pubblici. Non sostituire
silenziosamente il PDF a parità di versione.

La versione 1.3 di *Dai fondi ai posti* modifica tipografia e denominazione del PDF:
nessun riquadro colorato nelle note e nessun cambiamento ai risultati. I
materiali sono collegati a un commit preciso, non al contenuto mutevole di
`main`. Il percorso scientifico è descritto in [studies.md](studies.md).

## Verifica

`node --experimental-strip-types --test tests/papers.test.mjs tests/studies.test.mjs`

`npm run test:browser:papers` controlla redirect, archivio popolato, canonical,
navigazione attiva, tastiera e viewport 390/768/1280 px. Il runner di produzione
include anche il percorso archivio → dettaglio e il checksum del PDF scaricato.

Prima della pubblicazione verificare domanda e contributo, coerenza del campione,
misure e denominatori, riproducibilità, sensibilità, confronto con la letteratura
e limiti delle conclusioni. I test tecnici non certificano il valore scientifico
e non sostituiscono una peer review esterna. Le bozze restano fuori dal catalogo.
