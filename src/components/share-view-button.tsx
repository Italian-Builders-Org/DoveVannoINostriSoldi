"use client";

import { useEffect, useId, useRef, useState } from "react";
import { shareableViewUrl } from "@/lib/frontend-exploration";
import styles from "./share-view-button.module.css";

export function ShareViewButton() {
  const [status, setStatus] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => { if (manualUrl) { input.current?.focus(); input.current?.select(); } }, [manualUrl]);

  async function copyView() {
    const url = shareableViewUrl(window.location.href);
    try {
      await navigator.clipboard.writeText(url);
      setManualUrl("");
      setStatus("Link copiato, con i filtri selezionati.");
    } catch {
      setManualUrl(url);
      setStatus("Copia il link dal campo qui sotto.");
    }
  }
  function close() { setManualUrl(""); setStatus(""); trigger.current?.focus(); }

  return <div className={styles.share}>
    <button ref={trigger} type="button" className={styles.trigger} onClick={copyView}>Condividi questa vista <span aria-hidden="true">↗</span></button>
    <span role="status" className={styles.status}>{status}</span>
    {manualUrl ? <div className={styles.fallback} onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <label htmlFor={id}>Link alla vista corrente</label>
      <input ref={input} id={id} value={manualUrl} readOnly onFocus={(event) => event.target.select()} />
      <button type="button" onClick={close}>Chiudi</button>
    </div> : null}
  </div>;
}
