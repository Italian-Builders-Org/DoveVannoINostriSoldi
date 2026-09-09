"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, BookOpen01Icon, Building03Icon, Cancel01Icon, ChartColumnIcon, Coins01Icon, Edit02Icon, Key01Icon, Mic01Icon, StopIcon, Copy01Icon, RefreshIcon, Tick02Icon, ArrowDown01Icon, Attachment01Icon } from "@hugeicons/core-free-icons";
import { AI_MAX_HISTORY_CHARS, AI_MAX_HISTORY_MESSAGES, AI_MAX_PROMPT_CHARS, AI_PROVIDERS, type AiConnection, type AiMessage, type AiResponse } from "@/lib/assistant/byok-contracts";
import { AssistantProviderSettings } from "@/components/assistant-provider-settings";
import { AssistantAiReply } from "@/components/assistant-ai-reply";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { readChatStream } from "@/lib/assistant/chat-stream";
import { AssistantActivity } from "@/components/assistant-activity";
import type { AiActivity } from "@/lib/assistant/activity-contracts";
import { AssistantAttachments, AssistantAttachmentPreview } from "@/components/assistant-attachments";
import { useAssistantAttachments } from "@/components/use-assistant-attachments";
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_FILES, ATTACHMENT_MAX_TEXT_CHARS, attachmentTextSize, type AiAttachment } from "@/lib/assistant/attachment-contracts";
import { useAssistantVoice } from "@/components/use-assistant-voice";
import styles from "@/app/assistente/assistant.module.css";

const EXAMPLES = [
  { label: "Pagamenti dei Comuni", source: "SIOPE", detail: "Pagamenti di cassa dei Comuni", command: "pagamenti", icon: Coins01Icon, prompt: "Quanto hanno speso i Comuni nel 2025?" },
  { label: "Redditi dichiarati", source: "MEF", detail: "Dichiarazioni dei redditi IRPEF", command: "redditi", icon: ChartColumnIcon, prompt: "Qual è l’imposta netta dichiarata in Calabria nel 2024?" },
  { label: "Bilancio dello Stato", source: "RGS", detail: "Pagamenti delle amministrazioni centrali", command: "stato", icon: Building03Icon, prompt: "Quanto ha speso lo Stato nel 2025?" },
  { label: "Confronta due anni", source: "SIOPE", detail: "Variazione tra annualità complete", command: "confronta", icon: ChartColumnIcon, prompt: "Come sono cambiati i pagamenti dei Comuni tra il 2024 e il 2025?" },
] as const;
const MAX_TURNS = 12;
type Turn = { id: number; prompt: string; response: AiResponse | null; attachments?: AiAttachment[]; activities?: AiActivity[]; contextReduced?: boolean; startedAt: number; finishedAt?: number; partial?: string; stopped?: boolean };

export function AssistantChat() {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState<"sources" | "commands" | "add" | null>(null);
  const [query, setQuery] = useState("");
  const [activeOption, setActiveOption] = useState(0);
  const [info, setInfo] = useState(false);
  const [preview, setPreview] = useState<AiAttachment | null>(null);
  const [dragging, setDragging] = useState(false);
  const previewTrigger = useRef<HTMLElement | null>(null);
  function openPreview(file: AiAttachment) { previewTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPreview(file); }
  const fileInput = useRef<HTMLInputElement>(null);
  const attachments = useAssistantAttachments();
  const [connection, setConnection] = useState<AiConnection | null>(null);
  const connectionRef = useRef<AiConnection | null>(null);
  const [settings, setSettings] = useState(false);
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const followBottom = useRef(true);
  const composerArea = useRef<HTMLDivElement>(null);
  const beforeComposer = useRef<DOMRect | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const providerButton = useRef<HTMLButtonElement>(null);
  const pageRoot = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastTurn = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const voice = useAssistantVoice(draft, setDraft);
  const hasConversation = turns.length > 0;
  const tooLong = draft.length > AI_MAX_PROMPT_CHARS;
  const atLimit = turns.length >= MAX_TURNS;
  const options = (menu === "add" ? [] : menu === "sources" ? EXAMPLES.slice(0, 3) : EXAMPLES).filter((option) =>
    `${option.source} ${option.label} ${option.command}`.toLocaleLowerCase("it-IT").includes(query.toLocaleLowerCase("it-IT")),
  );

  useLayoutEffect(() => {
    const header = document.querySelector(".site-header");
    const update = () => { if (header) pageRoot.current?.style.setProperty("--assistant-header-height", `${header.getBoundingClientRect().height}px`); };
    update();
    const observer = new ResizeObserver(update);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const leave = () => { connectionRef.current = null; pending.current?.abort(); pending.current = null; setConnection(null); setSettings(false); setLoading(false); setTurns([]); setEditing(null); setPreview(null); };
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); pending.current?.abort(); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "0px";
      field.style.height = `${Math.min(180, Math.max(hasConversation ? 58 : 94, field.scrollHeight))}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draft, hasConversation]);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (!hasConversation || !beforeComposer.current || !composerArea.current) return;
    const from = beforeComposer.current;
    beforeComposer.current = null;
    const to = composerArea.current.getBoundingClientRect();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      composerArea.current.animate([{ transform: `translateY(${from.top - to.top}px)` }, { transform: "translateY(0)" }], { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    }
  }, [hasConversation]);
  useEffect(() => {
    if (followBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [turns]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!composer.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);

  const chooseExample = useCallback((value: string) => {
    setDraft(value);
    setMenu(null);
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  function changeDraft(value: string) {
    setDraft(value);
    const token = /(?:^|\s)([@/])([^\s]*)$/u.exec(value);
    setMenu(token ? token[1] === "@" ? "sources" : "commands" : null);
    setQuery(token?.[2] ?? "");
    setActiveOption(0);
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label); setCopyError(false);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1800);
    } catch { setCopyError(true); }
  }
  async function ask(value: string, retryId?: number) {
    if ((retryId === undefined && attachments.blocked) || pending.current || !value.trim() || value.length > AI_MAX_PROMPT_CHARS || (atLimit && retryId === undefined)) return;
    const ai = connectionRef.current;
    if (!ai) { setSettings(true); return; }
    if (!hasConversation) beforeComposer.current = composerArea.current?.getBoundingClientRect() ?? null;
    followBottom.current = true;
    setAwayFromBottom(false);
    setEditing(null);
    const controller = new AbortController();
    pending.current = controller;
    const id = retryId ?? nextId.current++;
    const files = retryId === undefined ? attachments.ready : turns.find((turn) => turn.id === id)?.attachments ?? [];
    voice.close();
    setMenu(null);
    setLoading(true);
    if (retryId === undefined) {
      setTurns((current) => [...current, { id, prompt: value.trim(), response: null, attachments: files, startedAt: Date.now() }]);
      setDraft("");
      attachments.clear();
    } else setTurns((current) => current.slice(0, current.findIndex((turn) => turn.id === id) + 1).map((turn) => turn.id === id ? { id, prompt: value.trim(), response: null, attachments: files, startedAt: Date.now() } : turn));
    const history: AiMessage[] = [];
    if (ai) {
      for (const turn of turns) {
        if (turn.id === retryId) break;
        if (turn.response?.ok && turn.response.kind === "ai_answer") {
          history.push({ role: "user", content: turn.prompt, ...(turn.attachments?.length ? { attachments: turn.attachments } : {}) }, { role: "assistant", content: turn.response.text });
        }
      }
    }
    const messages = history.slice(-AI_MAX_HISTORY_MESSAGES);
    const contextTooLarge = () => {
      const included = [...messages.flatMap((message) => message.attachments ?? []), ...files];
      return messages.reduce((sum, message) => sum + message.content.length, 0) + value.trim().length > AI_MAX_HISTORY_CHARS || included.length > ATTACHMENT_MAX_FILES || attachmentTextSize(included) > ATTACHMENT_MAX_TEXT_CHARS;
    };
    let removedFiles = 0;
    while (messages.length && contextTooLarge()) removedFiles += messages.splice(0, 2).reduce((sum, message) => sum + (message.attachments?.length ?? 0), 0);
    if (removedFiles) setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, contextReduced: true } : turn));
    messages.push({ role: "user", content: value.trim(), ...(files.length ? { attachments: files } : {}) });
    const deadline = setTimeout(() => controller.abort(), 55_000);
    try {
      const result = await fetch("/api/assistant/chat", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${ai.apiKey}` },
        body: JSON.stringify({ provider: ai.provider, model: ai.model, ...(ai.reasoning ? { reasoning: ai.reasoning } : {}), consent: true, messages }), signal: controller.signal,
        cache: "no-store", credentials: "same-origin",
      });
      const response = await readChatStream(result, controller.signal, (partial) => {
        if (pending.current === controller) setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, partial } : turn));
      }, (activity) => {
        if (pending.current === controller) setTurns((current) => current.map((turn) => {
          if (turn.id !== id) return turn;
          const previous = turn.activities ?? [];
          return { ...turn, activities: previous.some((item) => item.id === activity.id) ? previous.map((item) => item.id === activity.id ? activity : item) : [...previous, activity] };
        }));
      });
      if (pending.current !== controller) return;
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, response, partial: undefined, finishedAt: Date.now() } : turn));
    } catch {
      if (pending.current !== controller) return;
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, finishedAt: Date.now(), response: {
        ok: false, kind: "ai_error", code: controller.signal.aborted ? "timeout" : "data_unavailable",
        message: controller.signal.aborted ? "La ricerca sta impiegando troppo tempo. Puoi riprovare." : "Non riesco a raggiungere il servizio. Puoi riprovare tra poco.",
      } } : turn));
    } finally {
      clearTimeout(deadline);
      if (pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  }

  function stop() {
    pending.current?.abort();
    pending.current = null;
    setLoading(false);
    setTurns((current) => current.map((turn) => turn.response === null ? { ...turn, stopped: true, finishedAt: Date.now() } : turn));
  }
  function reset() {
    stop();
    voice.close();
    setTurns([]);
    setEditing(null);
    attachments.clear();
    setPreview(null);
    setDraft("");
    setMenu(null);
    input.current?.focus();
  }
  function submit(event: FormEvent) { event.preventDefault(); if (!voice.busy) void ask(draft); }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      if (menu) { event.preventDefault(); setMenu(null); }
      else if (voice.voice) { event.preventDefault(); voice.cancel(); }
    } else if (menu && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (options.length) setActiveOption((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (menu) { if (options[activeOption]) chooseExample(options[activeOption].prompt); }
      else if (!voice.busy) void ask(draft);
    }
  }

  return (
    <main ref={pageRoot} className={styles.page} data-conversation={hasConversation} aria-label="Assistente sui dati pubblici"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (menu) { event.preventDefault(); setMenu(null); input.current?.focus(); }
        else if (voice.voice) { event.preventDefault(); voice.cancel(); input.current?.focus(); }
        else if (info) { event.preventDefault(); setInfo(false); }
      }}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarTitle}><span>Assistente</span></div>
        <div className={styles.toolbarActions}>
          <button ref={providerButton} type="button" className={styles.providerButton} onClick={() => setSettings(true)} aria-haspopup="dialog" aria-label={connection ? `Impostazioni AI: ${AI_PROVIDERS[connection.provider].label}, ${connection.model}` : "Collega la tua AI"}>
            <HugeiconsIcon icon={Key01Icon} size={17} aria-hidden="true" /><span>{connection ? AI_PROVIDERS[connection.provider].label : "Collega AI"}</span>
          </button>
          <button type="button" className={styles.newChat} aria-label="Nuova chat" onClick={reset}><HugeiconsIcon icon={Edit02Icon} size={18} strokeWidth={1.7} aria-hidden="true" /><span>Nuova chat</span></button>
        </div>
      </header>

      <div className={styles.stage}>
        {hasConversation ? (
          <div className={styles.conversation} ref={scroller} onScroll={() => { const element = scroller.current; if (element) { followBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; setAwayFromBottom(!followBottom.current); } }} role="log" aria-label="Conversazione di questa pagina">
            <div className={styles.thread}>
              {turns.map((turn, index) => (
                <div className={styles.turn} key={turn.id} ref={index === turns.length - 1 ? lastTurn : undefined}>
                  <div className={styles.userBlock}>
                    {turn.attachments?.length ? <AssistantAttachments items={turn.attachments.map((file, id) => ({ id, name: file.name, file }))} onPreview={openPreview} /> : null}
                    {editing?.id === turn.id ? <form className={styles.editMessage} onSubmit={(event) => { event.preventDefault(); void ask(editing.value, turn.id); }}>
                      <label className={styles.srOnly} htmlFor={`edit-message-${turn.id}`}>Modifica la domanda</label>
                      <textarea id={`edit-message-${turn.id}`} autoFocus value={editing.value} aria-invalid={editing.value.length > AI_MAX_PROMPT_CHARS || undefined} onChange={(event) => setEditing({ id: turn.id, value: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditing(null); } }} />
                      <p>{editing.value.length > AI_MAX_PROMPT_CHARS ? `Massimo 8.000 caratteri. Rimuovine ${(editing.value.length - AI_MAX_PROMPT_CHARS).toLocaleString("it-IT")} per inviare.` : "La modifica sostituirà la risposta e gli eventuali messaggi successivi."}</p>
                      <div><button type="button" onClick={() => setEditing(null)}>Annulla modifica</button><button type="submit" disabled={!editing.value.trim() || editing.value.length > AI_MAX_PROMPT_CHARS || loading}>Invia modifica</button></div>
                    </form> : <><div className={styles.userMessage}><span className={styles.srOnly}>Tu: </span>{turn.prompt}</div>
                    <div className={styles.messageActions}>
                      <button type="button" aria-label="Copia domanda" title={copied === `user-${turn.id}` ? "Copiato" : "Copia domanda"} onClick={() => void copyText(turn.prompt, `user-${turn.id}`)}><HugeiconsIcon icon={copied === `user-${turn.id}` ? Tick02Icon : Copy01Icon} size={17} aria-hidden="true" /></button>
                      <button type="button" aria-label="Modifica domanda" title="Modifica domanda" disabled={loading} onClick={() => setEditing({ id: turn.id, value: turn.prompt })}><HugeiconsIcon icon={Edit02Icon} size={17} aria-hidden="true" /></button>
                    </div></>}
                  </div>
                  <div className={styles.assistantMessage} data-assistant-reply aria-live={loading && !turn.response ? "off" : "polite"} aria-busy={!turn.response && !turn.stopped}>
                    <div className={styles.replyIdentity}><Image src="/brand/dvns-mark-transparent.png" alt="" width={22} height={26} /><span>DVNS</span><small>AI</small></div>
                    {turn.contextReduced ? <p className={styles.contextNotice}>I nuovi allegati superano il limite del contesto: i file dei messaggi più vecchi non sono inclusi in questa risposta. Per confrontarli, riallega insieme i file utili (massimo 3).</p> : null}
                    <AssistantActivity activities={turn.activities ?? []} active={loading && !turn.response && !turn.stopped} stopped={turn.stopped || turn.response?.ok === false} startedAt={turn.startedAt} finishedAt={turn.finishedAt} />
                    {turn.response ? <AssistantAiReply response={turn.response} /> : turn.partial ? <div className={styles.aiText} data-streaming={!turn.stopped}><AssistantMarkdown text={turn.partial} />{turn.stopped ? <p className={styles.status}>Risposta interrotta.</p> : null}</div> : !turn.stopped && turn.activities?.some((item) => item.id === "attachments" || item.id.startsWith("query-")) ? null : <p className={styles.status}>{turn.stopped ? "Ricerca interrotta." : <><span className={styles.workingDot} />Preparo la ricerca…</>}</p>}
                    {turn.response || turn.stopped ? <div className={styles.messageActions}>
                      {turn.response?.ok ? <button type="button" aria-label="Copia risposta" title={copied === `assistant-${turn.id}` ? "Copiato" : "Copia risposta"} onClick={() => void copyText([turn.response?.ok ? turn.response.text : "", ...(turn.response?.ok ? turn.response.evidence.flatMap((entry) => entry.sources.map((source) => `${source.name}: ${source.url}`)) : [])].join("\n\n"), `assistant-${turn.id}`)}><HugeiconsIcon icon={copied === `assistant-${turn.id}` ? Tick02Icon : Copy01Icon} size={17} aria-hidden="true" /></button> : null}
                      <button type="button" aria-label="Rigenera risposta" title="Rigenera risposta; sostituisce anche i messaggi successivi" disabled={loading} onClick={() => void ask(turn.prompt, turn.id)}><HugeiconsIcon icon={RefreshIcon} size={17} aria-hidden="true" /></button>
                    </div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : <div className={styles.welcome}>
          <Image className={styles.heroMark} src="/brand/dvns-mark-transparent.png" alt="" width={48} height={56} priority />
          <h1>Cosa vuoi sapere?</h1>

        </div>}

        <div className={styles.composerArea} ref={composerArea}>
          {hasConversation && awayFromBottom ? <button type="button" className={styles.jumpLatest} aria-label="Vai all’ultimo messaggio" onClick={() => { followBottom.current = true; setAwayFromBottom(false); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }}><HugeiconsIcon icon={ArrowDown01Icon} size={18} aria-hidden="true" /></button> : null}
          <div className={styles.composerAnchor} ref={composer}>
            {menu && menu !== "add" ? <div className={styles.optionMenu} id="assistant-options" role="listbox" aria-label={menu === "sources" ? "Domande dalle fonti" : "Scorciatoie"}>
              <p>{menu === "sources" ? "Scegli una domanda dalla fonte" : "Inizia da una domanda"}</p>
              {options.length ? options.map((option, index) => <button type="button" role="option" aria-selected={activeOption === index} id={`assistant-option-${index}`} key={option.command} className={styles.option} onMouseEnter={() => setActiveOption(index)} onClick={() => chooseExample(option.prompt)}>
                <HugeiconsIcon icon={option.icon} size={20} strokeWidth={1.6} aria-hidden="true" />
                <span><strong>{menu === "sources" ? option.source : `/${option.command}`}</strong><small>{menu === "sources" ? option.detail : option.label}</small></span>
                <span className={styles.optionArrow} aria-hidden="true">↵</span>
              </button>) : <p className={styles.noOptions}>Nessun esempio per questa ricerca.</p>}
            </div> : null}
            {menu === "add" ? <div className={styles.optionMenu} id="assistant-add-menu" role="group" aria-label="Aggiungi alla domanda">
              <button type="button" className={styles.option} onClick={() => { setMenu(null); if (attachments.items.length >= ATTACHMENT_MAX_FILES) attachments.notifyLimit(); else fileInput.current?.click(); }}><HugeiconsIcon icon={Attachment01Icon} size={20} aria-hidden="true" /><span><strong>Allega file o immagini</strong><small>PDF, Word, Excel e testo · fino a 8 file, 10 MB ciascuno</small></span></button>
              <button type="button" className={styles.option} onClick={() => { setMenu("sources"); setQuery(""); setActiveOption(0); input.current?.focus(); }}><HugeiconsIcon icon={BookOpen01Icon} size={20} aria-hidden="true" /><span><strong>Fonti ed esempi</strong><small>Inizia dai dataset del sito</small></span></button>
            </div> : null}
            <input ref={fileInput} type="file" accept={ATTACHMENT_ACCEPT} multiple className={styles.srOnly} tabIndex={-1} aria-label="Scegli gli allegati" onChange={(event) => { attachments.add(Array.from(event.target.files ?? [])); event.target.value = ""; input.current?.focus({ preventScroll: true }); }} />
            <form className={styles.composer} onSubmit={submit} data-dragging={dragging}
              onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
              onDrop={(event) => { event.preventDefault(); setDragging(false); if (!voice.busy && !loading) attachments.add(Array.from(event.dataTransfer.files)); }}
              onPaste={(event) => {
                if (voice.busy || loading) return;
                const files = Array.from(event.clipboardData.files);
                if (files.length) { event.preventDefault(); attachments.add(files); return; }
                const text = event.clipboardData.getData("text/plain");
                if (event.target === input.current && text.length > AI_MAX_PROMPT_CHARS) {
                  event.preventDefault();
                  const name = `testo-incollato-${attachments.items.length + 1}.txt`;
                  if (attachments.add([new File([text], name, { type: "text/plain;charset=utf-8" })]) && !draft.trim()) setDraft("Analizza il testo allegato.");
                }
              }}>

              <div className={styles.inputSurface} data-recording={voice.active}>
                {attachments.items.length ? <AssistantAttachments items={attachments.items} onRemove={attachments.remove} onPreview={openPreview} /> : null}
                {dragging ? <span className={styles.dropHint}>Rilascia i file qui</span> : null}
                <label htmlFor="assistant-prompt" className={styles.srOnly}>Domanda in italiano</label>
                <textarea ref={input} id="assistant-prompt" value={draft} onChange={(event) => changeDraft(event.target.value)} onKeyDown={keyDown}
                  placeholder="Chiedi qualcosa sui dati pubblici…" rows={3} readOnly={voice.busy} aria-invalid={tooLong || undefined}
                  aria-describedby={`assistant-help assistant-count${tooLong ? " assistant-prompt-limit" : ""}`} aria-controls={menu && menu !== "add" ? "assistant-options" : undefined}
                  aria-activedescendant={menu && options[activeOption] ? `assistant-option-${activeOption}` : undefined} aria-haspopup="listbox" />
                <div className={styles.composerControls}>
                  <button type="button" className={styles.iconButton} disabled={voice.busy || loading} aria-label="Aggiungi allegati e fonti" aria-expanded={menu === "add"} aria-controls="assistant-add-menu" title="Aggiungi allegati e fonti" onClick={() => setMenu(menu === "add" ? null : "add")}>
                    <HugeiconsIcon icon={Add01Icon} size={23} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                  {attachments.items.length ? <span key={attachments.items.length} className={styles.attachmentCount} data-full={attachments.items.length === ATTACHMENT_MAX_FILES} aria-label={`Allegati: ${attachments.items.length} di ${ATTACHMENT_MAX_FILES}`}><HugeiconsIcon icon={Attachment01Icon} size={13} aria-hidden="true" />{attachments.items.length}/{ATTACHMENT_MAX_FILES}</span> : <span className={styles.keyboardHint}>@ fonti <span>·</span> / scorciatoie</span>}
                  <span id="assistant-count" className={styles.count} data-overflow={tooLong}>{draft.length >= AI_MAX_PROMPT_CHARS * .8 ? `${draft.length}/${AI_MAX_PROMPT_CHARS}` : ""}</span>
                  <button type="button" className={`${styles.iconButton} ${styles.microphone}`} data-recording={voice.active} disabled={loading || voice.voice?.status === "checking" || voice.voice?.status === "installing" || voice.voice?.status === "stopping"}
                    aria-label={voice.active ? "Termina dettatura" : "Detta la domanda"} aria-pressed={voice.active} title={voice.active ? "Termina dettatura" : "Detta la domanda"} onClick={voice.start}>
                    <HugeiconsIcon icon={voice.active ? StopIcon : Mic01Icon} size={22} strokeWidth={1.8} aria-hidden="true" />
                    <span className={styles.micLabel}>{voice.active ? "Termina" : "Detta"}</span>
                  </button>
                  {loading ? <button type="button" className={styles.send} aria-label="Interrompi ricerca" title="Interrompi ricerca" onClick={stop}><HugeiconsIcon icon={StopIcon} size={21} strokeWidth={1.9} aria-hidden="true" /></button>
                    : <button type="submit" className={styles.send} disabled={!draft.trim() || tooLong || voice.busy || atLimit || attachments.blocked} aria-label="Invia domanda" title="Invia domanda"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" /></svg></button>}
                </div>
              </div>
              {voice.voice ? <div className={styles.voiceNotice} data-recording={voice.active}>
                <div role="status" aria-live="polite">
                  {voice.active ? <p><span className={styles.recordingDot} />{voice.voice.status === "starting" ? "Attendo il permesso microfono…" : voice.voice.status === "stopping" ? "Completo la trascrizione…" : "Ti ascolto…"}<time>{`0:${String(voice.seconds).padStart(2, "0")}`}</time></p>
                    : <p>{voice.voice.status === "downloadable" ? "Per dettare serve il pacchetto italiano del browser." : voice.voice.status === "review" ? "Testo pronto. Controllalo prima di inviare." : voice.voice.message}</p>}
                  {voice.voice.status === "downloadable" || voice.voice.status === "installing" ? <small>Download gestito dal browser; può proseguire se chiudi. Il microfono resta spento.</small> : null}
                  {voice.active ? <small>Dettatura locale · massimo 30 secondi · invio manuale</small> : null}
                </div>
                {voice.voice.status === "downloadable" ? <button type="button" className={styles.inlineAction} onClick={async () => { await voice.install(); input.current?.focus(); }}>Scarica italiano</button> : null}
                <button type="button" className={styles.iconButton} aria-label={voice.active ? "Annulla dettatura" : "Chiudi messaggio voce"} title={voice.active ? "Annulla dettatura" : "Chiudi"} onClick={() => { if (voice.active) voice.cancel(); else voice.close(); input.current?.focus(); }}><HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden="true" /></button>
              </div> : null}
              <div className={styles.composerFoot}>
                <span><HugeiconsIcon icon={BookOpen01Icon} size={16} strokeWidth={1.6} aria-hidden="true" />Esempi da fonti ufficiali</span>
                <div className={styles.sourceChips}>{EXAMPLES.slice(0, 3).map((example) => <button key={example.source} type="button" disabled={voice.busy} title={example.detail} onClick={() => chooseExample(example.prompt)}>{example.source}</button>)}</div>
              </div>
            </form>
          </div>
          {attachments.error ? <p key={attachments.noticeVersion} className={styles.limitNotice} role="alert">{attachments.error}</p> : null}
          {tooLong ? <p id="assistant-prompt-limit" className={styles.draftError} role="alert">Massimo 8.000 caratteri. Rimuovine {(draft.length - AI_MAX_PROMPT_CHARS).toLocaleString("it-IT")} per inviare.</p> : null}
          {atLimit ? <p className={styles.draftError}>Hai raggiunto il limite di questa conversazione. Apri una nuova chat per continuare.</p> : null}
          {!hasConversation ? <div className={styles.suggestions} aria-label="Domande di esempio">
            {EXAMPLES.map((example) => <button key={example.label} type="button" onClick={() => chooseExample(example.prompt)} disabled={voice.busy}><HugeiconsIcon icon={example.icon} size={17} strokeWidth={1.6} aria-hidden="true" />{example.label}</button>)}
          </div> : null}
          <p className={styles.composerHint} id="assistant-help">{voice.active ? "Premi il microfono per terminare." : connection ? `${AI_PROVIDERS[connection.provider].label} · L’AI può commettere errori.` : "Collega la tua AI per iniziare a conversare sui dati."}</p>
        </div>
      </div>

      <footer className={styles.footer}>
        <span>L’AI può commettere errori. Verifica le fonti.</span>
        <div><button type="button" aria-expanded={info} aria-controls="assistant-info" onClick={() => setInfo(!info)}>Come funziona</button><a href="/privacy">Privacy</a></div>
      </footer>
      {settings ? <AssistantProviderSettings connection={connection} onSave={(next) => { stop(); voice.close(); connectionRef.current = next; setConnection(next); setTurns([]); setEditing(null); if (!next) { attachments.clear(); setPreview(null); } }} onClose={() => { setSettings(false); requestAnimationFrame(() => providerButton.current?.focus()); }} /> : null}
      {preview ? <AssistantAttachmentPreview file={preview} onClose={() => { setPreview(null); requestAnimationFrame(() => { if (previewTrigger.current?.isConnected) previewTrigger.current.focus({ preventScroll: true }); else input.current?.focus(); }); }} /> : null}
      <span className={styles.srOnly} role="status">{copied ? "Testo copiato" : copyError ? "Copia non disponibile: seleziona il testo e copialo manualmente." : loading ? "L’assistente sta rispondendo" : ""}</span>
      {info ? <div className={styles.infoPanel} id="assistant-info" role="region" aria-label="Come funziona l’assistente">
        <button type="button" className={styles.iconButton} aria-label="Chiudi informazioni" onClick={() => setInfo(false)}><HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden="true" /></button>
        <h2>Dati e conversazione</h2>
        <p>Collega la tua chiave per conversare con l’AI: il modello consulta i dataset del sito attraverso ricerche validate e può commettere errori. Controlla sempre periodo, fonti e limiti.</p>
        <p>La conversazione resta nella memoria di questa pagina. “Nuova chat” la svuota. La voce usa il riconoscimento locale nei browser compatibili: nessun audio viene inviato a DVNS.</p>
      </div> : null}
    </main>
  );
}
