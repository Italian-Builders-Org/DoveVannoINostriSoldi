"use client";

import { useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { FREE_DAILY_QUESTIONS } from "@/lib/assistant/free-contracts";
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
    <h2 id="assistant-free-title">Domande gratuite: cosa condividi</h2>
    <p id="assistant-free-description">{FREE_DAILY_QUESTIONS} domande al giorno, generate da Regolo, il servizio AI che usiamo per la prova. La quota riparte a mezzanotte, ora italiana.</p>
    <ul className={styles.consentPoints}>
      <li>Regolo riceve domanda, contesto della chat e allegati, e dichiara di non conservarli né usarli per il training. <a href="https://regolo.ai/zero-data-retention/" target="_blank" rel="noreferrer">Zero data retention<span aria-hidden="true">{" "}↗</span></a></li>
      <li>Non inviare dati personali o riservati. <a href="/privacy" target="_blank" rel="noreferrer">Privacy DVNS<span aria-hidden="true">{" "}↗</span></a></li>
      <li>Un cookie tecnico identifica il browser; il limite può essere condiviso sulla stessa rete.</li>
      <li>Anche una risposta interrotta usa una domanda.</li>
    </ul>
    <div className={styles.providerActions}>
      <button type="button" className={styles.inlineAction} onClick={onClose}>Annulla</button>
      <button type="button" className={styles.providerSave} onClick={onAccept}>Accetta e invia</button>
    </div>
  </dialog>;
}
