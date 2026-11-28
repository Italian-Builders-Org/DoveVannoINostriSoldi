# Brief del critico (stesso testo per ogni critico del pannello)

## Decisioni già prese — NON contestarle e non chiederne l'opposto
1. Un solo avviso sull'AI, in fondo alla pagina sotto il composer («L'AI può sbagliare: verifica le fonti»). Nessuna etichetta o nota di verifica dentro le risposte.
2. «Approfondisci» elenca solo le pagine DVNS non già linkate nel testo o dal nome del dataset: una sezione con una sola scheda è normale. Il nome del dataset sotto «Fonti» porta sempre alla sua pagina DVNS (provenienza), anche se il testo la cita.
3. Le pagine si aprono in una nuova scheda (la chat vive solo in memoria, per privacy), segnalate con ↗.
4. Il dataset è nominato una volta, in «Fonti» (con il periodo); la riga di stato accanto al marchio dice solo «Dati consultati» ed è apribile.
5. I «Limiti del dato» sono sempre visibili, in un riquadro di sistema distinto dal testo del modello.
6. Il dialog di consenso ha sia la X sia «Annulla» (accessibilità).
7. Su mobile, durante la conversazione, la barra «Assistente» si nasconde scorrendo verso il basso e ricompare verso l'alto; copia/modifica restano solo sull'ultima domanda. Gli screenshot statici mostrano la barra visibile.
8. «Vai in fondo» è una pillola centrata sopra il composer, visibile solo quando si è risaliti.
9. Fuori perimetro: header globale del sito, logo, colori di brand (incluso il colore dei link nel testo), testo scritto dal modello, tabelle che scorrono in orizzontale su mobile, quota «7 domande» (esempio).
10. Il bordo più marcato del composer è il suo stato di focus: dopo l'invio il cursore resta nel campo, quindi negli screenshot della conversazione appare così. Non è un'incoerenza tra stati.
11. Pulsanti del consenso: su desktop «Annulla | Accetta e invia» affiancati; su mobile, nel foglio dal basso, impilati con il primario sopra (convenzione delle piattaforme).
12. Nello stato vuoto l'avviso sull'AI resta in fondo alla pagina, come piè di pagina; in conversazione è sotto il composer agganciato in basso. È lo stesso posto (in fondo), non un'incoerenza.
13. Su telefono i controlli isolati (fonti, «Dati consultati», copia/rigenera, «Come funziona», «Vai in fondo») hanno un bersaglio di 44px misurato nel DOM; i link dentro una frase sono testo e ne sono esenti.

14. Su telefono le righe di link in «Fonti» distano di più che su desktop perché ogni link è alto 44px (decisione 13): non si comprimono con aree di tocco sovrapposte. Il passo titolo → contenuto invece è lo stesso in ogni sezione.
15. Copia/modifica della domanda: su desktop compaiono al passaggio del mouse e al focus da tastiera; copia/rigenera della risposta sono sempre visibili perché sono l'azione successiva più probabile.

## Rubrica
Per ogni difetto indica la classe:
- **[OGGETTIVO]**: misurabile o verificabile sugli screenshot — contrasto insufficiente, testo tagliato o sovrapposto, allineamento rotto, incoerenza dello stesso componente tra stati/temi/dispositivi, testo ripetuto alla lettera, a capo rotto, elemento che copre contenuto, bersaglio touch < 44px, gerarchia invertita (un'etichetta più debole del contenuto che introduce).
- **[PREFERENZA]**: gusto o alternativa di design equivalente.

Ancoraggio dei voti: un parametro **senza difetti [OGGETTIVO] vale almeno 9**; ogni difetto oggettivo rilevante toglie 0,5–1. Le preferenze non abbassano il voto: elencale a parte.
