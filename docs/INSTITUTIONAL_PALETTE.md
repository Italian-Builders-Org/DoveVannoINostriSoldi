# Palette istituzionale

La palette della issue #374 mantiene il «registro pubblico»: superfici piatte,
font Geist, struttura e marchio invariati. Carta fredda e inchiostro blu danno
continuità a header, navigazione, pannelli e footer senza fondi crema, accenti
terracotta o effetti luminosi. Il rosso segnala un'azione; il petrolio descrive
una quantità senza suggerire un giudizio sulla spesa.

| Ruolo | Token light | Valore | Uso |
| --- | --- | --- | --- |
| Carta | `--color-bg` | `#f3f5f7` | Chrome e fondo pagina |
| Superficie | `--color-surface` | `#e8edf2` | Sezioni secondarie |
| Pannello | `--color-raised` | `#ffffff` | Dati e controlli |
| Inchiostro | `--color-text` | `#182b3a` | Testo principale |
| Testo secondario | `--color-neutral-600` | `#536474` | Note e metadati |
| Azione/focus | `--color-accent` | `#b42332` | Interazioni, mai normali barre di valore |
| Link/CTA | `--color-accent-700` | `#a51d2d` | Link e pulsanti; varianti 800/900 per hover/active |
| Dati | `--chart-data-primary` | `#176575` | Serie principale e barre |
| Traccia | `--chart-data-track` | `#dce7ec` | Base delle barre |
| Confine controllo | `--color-neutral-400` | `#71808e` | Input e pulsanti secondari |

Tutti i valori rimangono in `src/app/design-system.css`. I nomi pubblici dei
token sono conservati. Le categorie additive usano blu, petrolio, malva spento,
ocra, verde e ardesia: solo quando le categorie sono mutuamente esclusive, con
etichette e tabella dei valori. Nessuna nuova serie viola dominante.

La mappa usa cinque passi sequenziali dal chiaro `#dbe8ed` al petrolio
`#176575`. In dark mode la scala va da `#324e59` a `#a1cbd4`: più quantità,
più luminosità. La legenda, i valori, il selettore regionale e il bordo di
selezione mantengono l'informazione accessibile senza riconoscere il colore.
La composizione e le barre mensili della home già leggono i ruoli dedicati:
la migrazione avviene aggiornando i token, senza duplicare stili di pagina.
Il mese incompleto resta grigio con asterisco e spiegazione; l'indicatore di
freschezza ordinaria diventa neutro. Il quinto ruolo di serie non eredita più
l'accento rosso. Gli stati fonte mantengono testo e significato espliciti:
positivo verde, attenzione ocra, critico rosso.

## Contrasto e verifica

Le coppie testuali previste devono raggiungere 4,5:1; focus, confini dei
controlli e barra/traccia almeno 3:1. Soglie tratte dalle spiegazioni W3C di
[WCAG 2.2 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
e [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
Non si arrotonda un rapporto insufficiente per farlo passare.

`tests/institutional-ui-palette.test.mjs` calcola luminanza sRGB e contrasto
per testo, metadati, link, CTA, stati, foreground inversi, focus, input e barre
in entrambi i temi; verifica anche ordine delle rampe e ruoli delle superfici
principali. `institutional-chart-palette` conserva il controllo sulle sei
famiglie e sui valori testuali delle composizioni; `ui-craft-regressions` e
`coesione-ui` proteggono gli altri contratti visivi.

La suite produzione `core` legge gli stili realmente applicati a home,
chrome, testi e barre a 320, 375, 390, 768, 1024, 1280 e 1600px, nei due temi.
Verifica overflow, valori regionali accessibili e contrasto; salva screenshot
home a 390 e 1280px in `artifacts/browser/institutional-palette/`.
Il test dei token non equivale a una certificazione WCAG dell'intero sito:
restano necessari i controlli browser della revisione esatta distribuita.
