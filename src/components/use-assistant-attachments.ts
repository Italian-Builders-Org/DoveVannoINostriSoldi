"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ATTACHMENT_MAX_FILES, ATTACHMENT_MAX_TEXT_CHARS, attachmentTextSize, type AiAttachment } from "@/lib/assistant/attachment-contracts";
import { prepareAttachment } from "@/lib/assistant/attachment-prepare";

export type AttachmentDraft = { id: number; name: string; file?: AiAttachment; error?: string; progress?: number };
export function useAssistantAttachments() {
  const [items, setItems] = useState<AttachmentDraft[]>([]);
  const [error, setError] = useState("");
  const [noticeVersion, setNoticeVersion] = useState(0);
  const current = useRef<AttachmentDraft[]>([]);
  const jobs = useRef(new Map<number, AbortController>());
  const next = useRef(0);
  const queue = useRef(Promise.resolve());
  const update = useCallback((value: AttachmentDraft[]) => { current.current = value; setItems(value); }, []);
  const clear = useCallback(() => {
    for (const job of jobs.current.values()) job.abort();
    jobs.current.clear(); update([]); setError("");
  }, [update]);
  useEffect(() => {
    window.addEventListener("pagehide", clear);
    const active = jobs.current;
    return () => { window.removeEventListener("pagehide", clear); for (const job of active.values()) job.abort(); active.clear(); };
  }, [clear]);
  function remove(id: number) {
    jobs.current.get(id)?.abort(); jobs.current.delete(id);
    update(current.current.filter((item) => item.id !== id)); setError("");
  }
  function add(files: readonly File[]) {
    setError("");
    if (files.length + current.current.length > ATTACHMENT_MAX_FILES) { notifyLimit(); return false; }
    for (const file of files) {
      const id = next.current++;
      const controller = new AbortController(); jobs.current.set(id, controller);
      update([...current.current, { id, name: file.name, progress: 0 }]);
      const work = queue.current.then(async () => {
        controller.signal.throwIfAborted();
        return prepareAttachment(file, controller.signal, (progress) => {
          if (!controller.signal.aborted) update(current.current.map((item) => item.id === id ? { ...item, progress } : item));
        });
      }).then((prepared) => {
        if (controller.signal.aborted) return;
        const ready = current.current.flatMap((item) => item.file ? [item.file] : []);
        if (attachmentTextSize([...ready, prepared]) > ATTACHMENT_MAX_TEXT_CHARS) throw new Error("Gli allegati insieme superano 80.000 caratteri. Rimuovi un file o usa estratti più brevi.");
        update(current.current.map((item) => item.id === id ? { id, name: file.name, file: prepared, progress: 100 } : item));
      }).catch((failure: unknown) => {
        if (!controller.signal.aborted) update(current.current.map((item) => item.id === id ? { id, name: file.name, error: failure instanceof Error ? failure.message : "Non riesco a leggere il file." } : item));
      }).finally(() => jobs.current.delete(id));
      queue.current = work;
    }
    return true;
  }
  function notifyLimit() {
    setError("Puoi allegare fino a 8 file per messaggio. Rimuovine uno o scegli meno file.");
    setNoticeVersion((version) => version + 1);
  }
  return { items, error, noticeVersion, notifyLimit, add, remove, clear, ready: items.flatMap((item) => item.file ? [item.file] : []), blocked: items.some((item) => !item.file) };
}
