# Presenze al voto alla Camera

Quaderno DVNS sulla tabella ufficiale della partecipazione alle votazioni
elettroniche alla Camera (XIX legislatura, fino a febbraio 2026).

## Versioni

- v2.1 (20 novembre 2026): Umberto Bossi, deceduto, esce dalle classifiche dei
  singoli deputati; la sua riga ufficiale resta nella tabella completa e nei totali.
- v2 (20 novembre 2026): tutte le 397 righe ufficiali, voti espressi separati
  dalle missioni, gruppi, maggioranza e opposizione, membri del Governo e
  Ufficio di Presidenza, assenze giustificate, profili (genere, età, tipo di
  elezione), diaria, appendice deputato per deputato.
- v1 (20 novembre 2026): distribuzione e gruppi sui 394 deputati abbinati.
  Il PDF resta in `public/studi/presenze-camera/v1/`.

## Pubblicazione

- Pagina HTML: `/studi/presenze-camera`
- PDF versionato: `public/studi/presenze-camera/v2.1/presenze-camera.pdf` (v2 e v1 restano pubblicati)
- Copia di ricerca: `paper/presenze-camera.pdf` (byte identici al PDF pubblico)
- Capsule congelata: `src/content/studies/camera-presenze.json`
- Righe per deputato: `src/content/studies/camera-presenze-deputati.json`
  (separate per non appesantire il registro degli studi)
- Tabella di lavoro: `generated/distribution.json`

## Fonti

- Camera dei deputati, «Partecipazione al voto», vista deputati:
  https://www.camera.it/deputati/statistiche_voto/vista?leg=19&type=deputati&riepil_mese_end=2026-02-28
  (snapshot `src/data/generated/camera-partecipazione-voto.json`).
- Anagrafe dei deputati: `src/data/generated/politici-camera-xix.json`.
- Incarichi di governo in corso: `src/data/generated/governo-meloni.json`.
- Diaria: `src/data/generated/camera-trattamento-economico.json`.

Nessuna lettura di rete: lo script legge solo snapshot già validati.

## Limiti

Presenza = voti espressi + missioni. Le missioni non sono presenza fisica in
Aula. Il lavoro in commissione non è incluso. Il Senato non è incluso.
Incarichi di governo e dell'Ufficio di Presidenza sono quelli in corso alla
data degli snapshot (settembre 2026), non lungo tutto il periodo.

## Ricostruzione

```bash
python3 research/camera-presenze-voto/freeze.py
CHROME_PATH=/percorso/chrome node research/camera-presenze-voto/render-pdf.mjs
```

Il render usa i font Inter e JetBrains Mono installati sul sistema.
