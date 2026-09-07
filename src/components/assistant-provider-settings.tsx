"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { AI_KEY_PATTERN, AI_MODEL_PATTERN, AI_PROVIDERS, type AiConnection, type AiProvider, type AiReasoning } from "@/lib/assistant/byok-contracts";
import styles from "@/app/assistente/assistant.module.css";

export function AssistantProviderSettings({ connection, onSave, onClose }: {
  connection: AiConnection | null; onSave: (connection: AiConnection | null) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keyField = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState<AiProvider>(connection?.provider ?? "openrouter");
  const [model, setModel] = useState<string>(connection?.model ?? AI_PROVIDERS.openrouter.defaultModel);
  const [reasoning, setReasoning] = useState<AiReasoning>(connection?.reasoning ?? "auto");
  const supportsReasoning = provider === "openrouter" && model.trim() === "openai/gpt-5.6-luna";
  const [apiKey, setApiKey] = useState(connection?.apiKey ?? "");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const description = AI_PROVIDERS[provider];
  useEffect(() => {
    dialog.current?.showModal();
    const field = keyField.current;
    const clear = () => { if (field) field.value = ""; setApiKey(""); };
    window.addEventListener("pagehide", clear);
    return () => { window.removeEventListener("pagehide", clear); if (field) field.value = ""; };
  }, []);
  function changeProvider(value: AiProvider) {
    setProvider(value); setModel(AI_PROVIDERS[value].defaultModel); setApiKey(""); setConsent(false); setError("");
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const key = apiKey.trim();
    if (!AI_KEY_PATTERN.test(key)) { setError("Controlla la chiave API: non deve contenere spazi o andare a capo."); return; }
    if (!AI_MODEL_PATTERN.test(model.trim())) { setError("Inserisci l’identificativo del modello indicato dal provider."); return; }
    if (!consent) { setError("Conferma l’invio al provider e i costi sul tuo conto."); return; }
    onSave({ provider, model: model.trim(), apiKey: key, ...(supportsReasoning ? { reasoning } : {}) });
    setApiKey("");
    onClose();
  }
  return <dialog ref={dialog} className={styles.providerDialog} aria-labelledby="assistant-provider-title" aria-describedby="assistant-provider-description"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <button type="button" className={styles.iconButton} aria-label="Chiudi impostazioni AI" onClick={onClose}><HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden="true" /></button>
    <h2 id="assistant-provider-title">La tua AI, la tua chiave</h2>
    <p id="assistant-provider-description">Scegli il servizio che vuoi usare per conversare sui dati del sito.</p>
    <form onSubmit={save} autoComplete="off">
      <label htmlFor="assistant-provider">Provider</label>
      <div className={styles.providerSelect}>
      <select id="assistant-provider" value={provider} onChange={(event) => changeProvider(event.target.value as AiProvider)}>
        {Object.entries(AI_PROVIDERS).map(([id, entry]) => <option key={id} value={id}>{entry.label}</option>)}
      </select>
      <HugeiconsIcon icon={ArrowDown01Icon} size={18} aria-hidden="true" />
      </div>
      <label htmlFor="assistant-model">Modello</label>
      <input id="assistant-model" list="assistant-models" value={model} maxLength={120} onChange={(event) => setModel(event.target.value)} autoComplete="off" spellCheck={false} required />
      <datalist id="assistant-models">{description.models.map((id) => <option key={id} value={id} />)}</datalist>
      <small>Scegli un esempio o inserisci l’ID di un modello disponibile sul tuo conto. Per allegare immagini serve un modello che le legga.</small>
      {supportsReasoning ? <>
        <label htmlFor="assistant-reasoning">Analisi</label>
        <div className={styles.providerSelect}>
          <select id="assistant-reasoning" value={reasoning} onChange={(event) => setReasoning(event.target.value as AiReasoning)}>
            <option value="auto">Automatica</option><option value="none">Rapida</option><option value="medium">Approfondita</option>
          </select>
          <HugeiconsIcon icon={ArrowDown01Icon} size={18} aria-hidden="true" />
        </div>
        <small>Automatica adatta l’analisi alla domanda. Approfondita può richiedere più tempo e consumi.</small>
      </> : null}
      <label htmlFor="assistant-api-key">API key personale</label>
      <input ref={keyField} id="assistant-api-key" name="personal-api-credential" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} required aria-describedby="assistant-key-help" />
      <small id="assistant-key-help"><a href={description.keysUrl} target="_blank" rel="noreferrer">Crea una chiave su {description.label} ↗</a>. Usa una chiave dedicata con limiti di spesa.</small>
      {provider === "openai" ? <p className={styles.providerNote}>La chiave API OpenAI è distinta dall’abbonamento ChatGPT; i consumi API sono fatturati separatamente.</p> : null}
      <div className={styles.providerPrivacy}>
        <p>La chiave resta nella memoria di questa scheda. Per rispondere, chiave, domanda, allegati e contesto passano attraverso DVNS e raggiungono il servizio scelto. L’applicazione non li archivia né li scrive nei propri log.</p>
        <p>{provider === "openrouter" ? "OpenRouter inoltra la richiesta al fornitore del modello. La conservazione dipende anche dalle impostazioni del tuo conto. " : "Il provider può conservare dati secondo le proprie condizioni. "}<a href={description.privacyUrl} target="_blank" rel="noreferrer">Condizioni sui dati ↗</a> · <a href="/privacy" target="_blank" rel="noreferrer">Privacy DVNS ↗</a></p>
      </div>
      <label className={styles.providerConsent}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>Autorizzo l’invio al provider selezionato e gli eventuali costi sul mio conto.</span>
      </label>
      <small>Ogni domanda può richiedere fino a due chiamate al modello. Interrompere una risposta non annulla i costi già maturati. Non inserire dati personali o altre credenziali nelle domande.</small>
      {error ? <p role="alert" className={styles.draftError}>{error}</p> : null}
      <div className={styles.providerActions}>
        {connection ? <button type="button" className={styles.inlineAction} onClick={() => { setApiKey(""); onSave(null); onClose(); }}>Scollega e rimuovi chiave</button> : <button type="button" className={styles.inlineAction} onClick={onClose}>Annulla</button>}
        <button type="submit" className={styles.providerSave}>Usa in questa scheda</button>
      </div>
      <small>La configurazione avvia una nuova conversazione. Le chiavi non vengono verificate finché non invii una domanda; ricaricando o lasciando la pagina vengono rimosse.</small>
    </form>
  </dialog>;
}
