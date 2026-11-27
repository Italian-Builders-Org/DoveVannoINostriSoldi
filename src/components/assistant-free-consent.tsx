"use client";

import { useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import styles from "@/app/assistente/assistant.module.css";

export function AssistantFreeConsent({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    // The dialog itself takes focus: screen readers start from its title, and no button looks pre-selected.
    dialog.current?.focus({ preventScroll: true });
  }, []);
  return <dialog ref={dialog} tabIndex={-1} className={`${styles.providerDialog} ${styles.consentDialog}`} aria-labelledby="assistant-free-title" aria-describedby="assistant-free-description"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <button type="button" className={styles.iconButton} aria-label="Chiudi" title="Chiudi" onClick={onClose}><HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden="true" /></button>
    <h2 id="assistant-free-title">Come usiamo le tue domande</h2>
    <p id="assistant-free-description">Le risposte gratuite sono generate da Regolo: riceve domanda, conversazione e allegati, e dichiara di non conservarli. <a href="https://regolo.ai/zero-data-retention/" target="_blank" rel="noreferrer">Policy di Regolo<span aria-hidden="true">{"\u00a0"}↗</span><span className={styles.srOnly}> (nuova scheda)</span></a></p>
    <ul className={styles.consentPoints}>
      <li>Non inserire dati personali o riservati. <a href="/privacy" target="_blank" rel="noreferrer">Privacy<span aria-hidden="true">{"\u00a0"}↗</span><span className={styles.srOnly}> (nuova scheda)</span></a></li>
      <li>Contiamo le domande, anche quelle interrotte, con un cookie tecnico e l’indirizzo IP.</li>
    </ul>
    <div className={styles.providerActions}>
      <button type="button" className={styles.inlineAction} onClick={onClose}>Annulla</button>
      <button type="button" className={styles.providerSave} onClick={onAccept}>Accetta e invia</button>
    </div>
  </dialog>;
}
