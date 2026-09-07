"use client";

import { useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, File01Icon } from "@hugeicons/core-free-icons";
import { attachmentLabel, type AiAttachment } from "@/lib/assistant/attachment-contracts";
import type { AttachmentDraft } from "@/components/use-assistant-attachments";
import styles from "@/app/assistente/assistant.module.css";

function fileAppearance(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (extension === "pdf") return { tone: "pdf", label: "PDF" };
  if (["xlsx", "xls", "ods", "csv", "tsv"].includes(extension)) return { tone: "sheet", label: extension.toUpperCase() };
  if (extension === "docx") return { tone: "word", label: "DOCX" };
  if (["md", "json"].includes(extension)) return { tone: "code", label: extension.toUpperCase() };
  if (extension === "txt") return { tone: "text", label: "TXT" };
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return { tone: "image", label: "IMG" };
  return { tone: "text", label: "FILE" };
}

export function AssistantAttachments({ items, onRemove, onPreview }: { items: readonly AttachmentDraft[]; onRemove?: (id: number) => void; onPreview: (file: AiAttachment) => void }) {
  return <><ul className={styles.attachments} aria-label={onRemove ? "Allegati da inviare" : "Allegati del messaggio"}>
    {items.map((item, index) => <li key={item.id} style={{ transitionDelay: `${index * 60}ms` }} className={styles.attachment} data-format={fileAppearance(item.name).tone} data-error={!!item.error} data-ready={!!item.file || !!item.error} title={item.file ? `${item.name} · ${item.file.note}` : item.error ?? `Preparazione ${item.name}`}>
      <button type="button" className={styles.attachmentOpen} disabled={!item.file} aria-label={`Anteprima ${item.name}`} onClick={() => { if (item.file) onPreview(item.file); }}>
        {item.file?.kind === "image"
          // Locally decoded JPEG; do not send user images to the image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={`data:${item.file.mime};base64,${item.file.data}`} alt="" width={56} height={56} />
          : <><span className={styles.attachmentGlyph} aria-hidden="true"><HugeiconsIcon icon={File01Icon} size={25} strokeWidth={1.4} /><em>{fileAppearance(item.name).label}</em></span><span className={styles.attachmentName}><strong>{item.name.replace(/\.[^.]+$/u, "")}</strong></span></>}
        <span className={styles.srOnly}>{item.file ? attachmentLabel(item.file) : item.error ? "File non disponibile" : "Lettura in corso…"}</span>
      </button>
      {onRemove && item.progress !== undefined ? <>
        <svg className={styles.attachmentRing} viewBox="0 0 56 56" aria-hidden="true"><path d="M28 1H43A12 12 0 0 1 55 13V43A12 12 0 0 1 43 55H13A12 12 0 0 1 1 43V13A12 12 0 0 1 13 1Z" fill="none" stroke="currentColor" strokeWidth="1.5" pathLength={100} strokeDasharray={100} strokeDashoffset={100 - item.progress} /></svg>
        <span className={styles.attachmentPercent} role={item.file || item.error ? undefined : "progressbar"} aria-label={`Preparazione ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress}>{item.progress}%</span>
      </> : null}
      {onRemove ? <button type="button" className={styles.attachmentRemove} aria-label={`Rimuovi ${item.name}`} onClick={() => onRemove(item.id)}><HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden="true" /></button> : null}
    </li>)}
  </ul>{items.some((item) => item.error) ? <ul className={styles.attachmentErrors}>{items.filter((item) => item.error).map((item) => <li key={item.id} role="alert"><strong>{item.name}:</strong> {item.error}</li>)}</ul> : null}</>;

}

export function AssistantAttachmentPreview({ file, onClose }: { file: AiAttachment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.attachmentDialog} aria-labelledby="attachment-preview-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id="attachment-preview-title">{file.name}</h2><button type="button" className={styles.iconButton} aria-label="Chiudi anteprima allegato" onClick={onClose}><HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden="true" /></button></header>
    <p>{file.note}</p>
    <div className={styles.attachmentPreviewContent}>
      {file.kind === "image"
        // Local, decoded JPEG data only; this must not contact the Next image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={`data:${file.mime};base64,${file.data}`} alt={`Anteprima di ${file.name}`} width={file.width} height={file.height} />
        : <pre>{file.text}</pre>}
    </div>
    <small>Questo è il contenuto disponibile per l’AI. Gli allegati dell’utente sono distinti dai dataset verificati di DVNS.</small>
  </dialog>;
}
