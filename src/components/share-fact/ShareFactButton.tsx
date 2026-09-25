"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildShareFactCardPath,
  buildShareFactMessage,
  type ShareFactCardInput,
} from "@/lib/share-fact-card";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "./share-fact.module.css";

type ShareFactButtonProps = ShareFactCardInput & {
  /** Visible label on the trigger; default "Condividi". */
  label?: string;
};

export function ShareFactButton({
  title,
  value,
  detail,
  source,
  path,
  label = "Condividi",
}: ShareFactButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"idle" | "download" | "native">("idle");
  const [error, setError] = useState<string | null>(null);

  const input = useMemo<ShareFactCardInput>(
    () => ({ title, value, detail, source, path }),
    [title, value, detail, source, path],
  );
  const imagePath = useMemo(() => buildShareFactCardPath(input), [input]);
  const pageUrl = useMemo(() => new URL(path, PUBLIC_SITE_URL).toString(), [path]);
  const shareMessage = useMemo(() => buildShareFactMessage(input, pageUrl), [input, pageUrl]);
  const encodedMessage = encodeURIComponent(shareMessage);
  const encodedUrl = encodeURIComponent(pageUrl);

  const socialLinks = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encodedMessage}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${encodedMessage}` },
    {
      label: "Telegram",
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(shareMessage)}`,
    },
  ];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setCopied(false);
      setError(null);
      setBusy("idle");
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function fetchCardBlob(): Promise<Blob> {
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error("card_fetch_failed");
    }
    return response.blob();
  }

  async function downloadCard() {
    setBusy("download");
    setError(null);
    try {
      const blob = await fetchCardBlob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const slug = path.replace(/^\//, "").replace(/\//g, "-") || "dato";
      anchor.href = objectUrl;
      anchor.download = `dvns-${slug}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Non sono riuscito a scaricare l’immagine. Riprova.");
    } finally {
      setBusy("idle");
    }
  }

  async function shareNative() {
    setBusy("native");
    setError(null);
    try {
      const blob = await fetchCardBlob();
      const file = new File([blob], "dvns-dato.png", { type: "image/png" });
      const canShareFiles =
        typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

      if (typeof navigator.share === "function" && canShareFiles) {
        await navigator.share({
          files: [file],
          text: shareMessage,
          title,
          url: pageUrl,
        });
        return;
      }

      if (typeof navigator.share === "function") {
        await navigator.share({ text: shareMessage, title, url: pageUrl });
        return;
      }

      setError("Su questo dispositivo usa «Scarica immagine» e caricala su Instagram o Stories.");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") {
        return;
      }
      setError("Condivisione non riuscita. Prova a scaricare l’immagine.");
    } finally {
      setBusy("idle");
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(shareMessage);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copia non disponibile su questo browser.");
    }
  }

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        {label}
      </button>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
      >
        <div className={styles.inner}>
          <button
            type="button"
            className={styles.close}
            aria-label="Chiudi"
            onClick={() => setOpen(false)}
          >
            ×
          </button>

          <h2 id={titleId} className={styles.heading}>
            Condividi questo dato
          </h2>
          <p className={styles.lead}>
            Scarica l’immagine quadrata (formato Instagram) e postala tu. Il link alla pagina
            resta nel testo di accompagnamento.
          </p>

          <figure className={styles.preview}>
            {/* eslint-disable-next-line @next/next/no-img-element -- share preview from same-origin PNG API */}
            <img src={imagePath} alt="" width={1080} height={1080} />
          </figure>

          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={downloadCard} disabled={busy !== "idle"}>
              {busy === "download" ? "Preparazione…" : "Scarica immagine"}
            </button>
            <button type="button" className={styles.secondary} onClick={shareNative} disabled={busy !== "idle"}>
              {busy === "native" ? "Apertura…" : "Condividi dal telefono"}
            </button>
          </div>

          <div className={styles.links}>
            {socialLinks.map((social) => (
              <a key={social.label} href={social.href} target="_blank" rel="noopener noreferrer">
                {social.label}
              </a>
            ))}
            <button type="button" onClick={copyMessage}>
              {copied ? "Copiato ✓" : "Copia testo"}
            </button>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}

          <small className={styles.hint}>
            L’immagine è 1080×1080 px: adatta a post e Stories. I dati restano quelli della
            fonte ufficiale citata sulla card.
          </small>
        </div>
      </dialog>
    </>
  );
}
