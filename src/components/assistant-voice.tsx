import { useCallback, useEffect, useRef, useState } from "react";
import { ASSISTANT_MAX_PROMPT_CHARS } from "@/lib/assistant/contracts";
import { LocalVoiceSession, type LocalRecognitionConstructor, type VoiceUpdate } from "@/lib/assistant/local-voice";
import styles from "@/app/assistente/assistant.module.css";

export function AssistantVoice({ disabled, onConfirm }: { disabled: boolean; onConfirm: (text: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const session = useRef<LocalVoiceSession | null>(null);
  const [voice, setVoice] = useState<VoiceUpdate>({ status: "checking", message: "Verifica della dettatura locale…" });
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const busy = ["checking", "installing", "starting", "listening", "stopping"].includes(voice.status);

  const close = useCallback(() => {
    session.current?.close();
    session.current = null;
    setDraft("");
    setVoice({ status: "checking", message: "" });
    setOpen(false);
    dialog.current?.close();
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    function hidden() { if (document.hidden && dialog.current?.open) close(); }
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", close);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", close);
      session.current?.close();
    };
  }, [close]);

  function show() {
    if (disabled || dialog.current?.open) return;
    setDraft("");
    setVoice({ status: "checking", message: "Verifica della dettatura locale… Il microfono è spento." });
    setOpen(true);
    dialog.current?.showModal();
    const Api = (window as Window & { SpeechRecognition?: LocalRecognitionConstructor }).SpeechRecognition;
    session.current = new LocalVoiceSession(Api, (update) => {
      setVoice(update);
      if (update.transcript !== undefined) setDraft(update.transcript);
    });
    void session.current.check();
  }

  return (
    <>
      <button ref={trigger} type="button" className="btn btn-secondary" disabled={disabled}
        aria-haspopup="dialog" aria-controls="assistant-voice-dialog" aria-expanded={open} onClick={show}>Detta la domanda</button>
      <dialog id="assistant-voice-dialog" ref={dialog} className={styles.voiceDialog} aria-labelledby="assistant-voice-title"
        aria-describedby="assistant-voice-privacy" onCancel={(event) => { event.preventDefault(); close(); }}
        onClose={() => { if (session.current && !dialog.current?.open) close(); }}>
        <div className={styles.voiceHeader}>
          <h2 id="assistant-voice-title">Detta in italiano</h2>
          <button type="button" className="btn btn-secondary" onClick={close}>Annulla e chiudi</button>
        </div>
        <p id="assistant-voice-privacy">
          Il browser trascrive sul dispositivo. Il microfono si attiva solo con “Inizia dettatura”
          e si ferma entro 30 secondi. DVNS non riceve né conserva audio. Controlla il testo:
          sarà inviato solo quando premi “Cerca nei dati”.
        </p>
        <p role="status" className={styles.voiceStatus}>{voice.message}</p>
        {voice.status === "downloadable" || voice.status === "installing" ? (
          <p>Il pacchetto viene scaricato dal servizio del browser e occupa spazio sul dispositivo.
            Chiudere questa finestra potrebbe non interrompere il download del browser.</p>
        ) : null}
        {voice.status === "downloadable" ? (
          <button type="button" className="btn" onClick={() => void session.current?.install()}>Scarica pacchetto italiano</button>
        ) : voice.status === "ready" ? (
          <button type="button" className="btn" onClick={() => session.current?.start()}>Inizia dettatura</button>
        ) : ["starting", "listening"].includes(voice.status) ? (
          <button type="button" className="btn" onClick={() => session.current?.stop()}>Termina dettatura</button>
        ) : null}
        <div className={styles.voiceDraft}>
          <label htmlFor="assistant-voice-draft">Trascrizione da controllare</label>
          <textarea id="assistant-voice-draft" value={draft} rows={4} disabled={busy}
            maxLength={ASSISTANT_MAX_PROMPT_CHARS} aria-describedby="assistant-voice-count"
            onChange={(event) => setDraft(event.target.value)} />
          <p id="assistant-voice-count">{draft.length}/{ASSISTANT_MAX_PROMPT_CHARS}
            {draft.length > ASSISTANT_MAX_PROMPT_CHARS ? ". Trascrizione troppo lunga: la parte finale non è stata acquisita. Accorcia il testo prima di confermare." : ". Puoi anche scrivere qui."}</p>
          <button type="button" className="btn" disabled={busy || !draft.trim() || draft.length > ASSISTANT_MAX_PROMPT_CHARS}
            onClick={() => { onConfirm(draft.trim()); close(); }}>Usa questo testo</button>
          <p>Sostituisce la domanda senza avviare la ricerca.</p>
        </div>
      </dialog>
    </>
  );
}
