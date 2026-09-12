"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/assistente/assistant.module.css";

export function AssistantFreeConsent({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.providerDialog} aria-labelledby="assistant-free-title" aria-describedby="assistant-free-description"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <h2 id="assistant-free-title">Prova l’assistente con Regolo</h2>
    <p id="assistant-free-description">Puoi inviare 10 domande gratuite al giorno. Regolo riceverà la domanda, il contesto della conversazione e gli allegati che scegli di inviare.</p>
    <p>Usiamo un cookie tecnico e un contatore per browser e rete. La quota riparte a mezzanotte, ora italiana; chi condivide la stessa rete può condividerne il limite.</p>
    <p>Non inserire dati personali o riservati. <a href="/privacy" target="_blank" rel="noreferrer">Come trattiamo i dati ↗</a></p>
    <div className={styles.providerActions}>
      <button type="button" className={styles.inlineAction} onClick={onClose}>Annulla</button>
      <button type="button" className={styles.providerSave} onClick={onAccept}>Accetta e invia</button>
    </div>
  </dialog>;
}
