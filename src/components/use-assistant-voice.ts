import { useCallback, useEffect, useRef, useState } from "react";
import { LocalVoiceSession, type LocalRecognitionConstructor, type VoiceUpdate } from "@/lib/assistant/local-voice";

/** Inline controls retain the local-only voice engine. */
export function useAssistantVoice(draft: string, setDraft: (value: string) => void) {
  const session = useRef<LocalVoiceSession | null>(null);
  const base = useRef("");
  const latestDraft = useRef(draft);
  const latestStatus = useRef<VoiceUpdate | null>(null);
  const [voice, setVoice] = useState<VoiceUpdate | null>(null);
  const [seconds, setSeconds] = useState(0);
  const active = voice !== null && ["starting", "listening", "stopping"].includes(voice.status);
  const busy = active || voice?.status === "checking" || voice?.status === "installing";

  useEffect(() => { latestDraft.current = draft; }, [draft]);

  const close = useCallback(() => {
    session.current?.close();
    session.current = null;
    latestStatus.current = null;
    setVoice(null);
  }, []);

  const cancel = useCallback(() => {
    if (session.current && latestStatus.current && ["starting", "listening", "stopping"].includes(latestStatus.current.status)) {
      setDraft(base.current);
    }
    close();
  }, [close, setDraft]);

  useEffect(() => {
    function hidden() { if (document.hidden) cancel(); }
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cancel);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancel);
      session.current?.close();
    };
  }, [cancel]);

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.min(30, Math.floor((Date.now() - startedAt) / 1000))), 250);
    return () => clearInterval(timer);
  }, [active]);

  function start() {
    if (busy) {
      if (active) session.current?.stop();
      return;
    }
    if (voice?.status === "ready" && session.current) {
      base.current = latestDraft.current;
      setSeconds(0);
      session.current.start();
      return;
    }
    session.current?.close();
    base.current = latestDraft.current;
    setSeconds(0);
    const checking: VoiceUpdate = { status: "checking", message: "Verifico la dettatura locale…" };
    latestStatus.current = checking;
    setVoice(checking);
    const Api = (window as Window & { SpeechRecognition?: LocalRecognitionConstructor }).SpeechRecognition;
    const current = new LocalVoiceSession(Api, (update) => {
      latestStatus.current = update;
      setVoice(update);
      if (update.transcript !== undefined) {
        const combined = [base.current.trimEnd(), update.transcript].filter(Boolean).join(" ");
        setDraft(combined);
      }
    });
    session.current = current;
    // The click requests dictation; availability alone never requests a microphone.
    void current.check().then(() => {
      if (session.current === current && latestStatus.current?.status === "ready") current.start();
    });
  }

  return {
    voice, active, busy, seconds, start, cancel, close,
    install: () => session.current?.install(),
  };
}
