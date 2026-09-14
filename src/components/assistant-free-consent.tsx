"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/assistente/assistant.module.css";

export function AssistantFreeConsent({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    cancel.current?.focus({ preventScroll: true });
  }, []);
  return <dialog ref={dialog} className={styles.providerDialog} aria-labelledby="assistant-free-title" aria-describedby="assistant-free-description"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <h2 id="assistant-free-title">Prova l’assistente con Regolo</h2>
    <p id="assistant-free-description">10 domande gratuite al giorno; anche gli invii interrotti contano. Regolo riceve domanda, contesto della chat e allegati.</p>
    <p>La quota riparte a mezzanotte, ora italiana. Un cookie tecnico identifica il browser; il limite può essere condiviso sulla stessa rete.</p>
    <p>Regolo dichiara di non conservare domande, risposte e allegati né usarli per il training. <a href="https://regolo.ai/zero-data-retention/" target="_blank" rel="noreferrer">Zero data retention ↗</a></p>
    <p>Non inviare dati personali o riservati. <a href="/privacy" target="_blank" rel="noreferrer">Privacy DVNS ↗</a></p>
    <div className={styles.providerActions}>
      <button ref={cancel} type="button" className={styles.inlineAction} onClick={onClose}>Annulla</button>
      <button type="button" className={styles.providerSave} onClick={onAccept}>Accetta e invia</button>
    </div>
  </dialog>;
}
