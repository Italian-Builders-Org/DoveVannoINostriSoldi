"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PUBLIC_SITE_URL } from "@/lib/site";
import type { Plan, Verdict } from "./reallocation";
import { netToneColor, shortLabel, toneColor } from "./reallocation";
import styles from "./simulatore.module.css";

const SHARE_HOST = new URL(PUBLIC_SITE_URL).host.replace(/^www\./, "");
const SHARE_HASHTAG = "#lamialeggedibilancio";

const compactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function signedCompactEuro(value: number): string {
  return `${value >= 0 ? "+" : "−"}${compactEuro.format(Math.abs(value))}`;
}

function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

export function ShareDialog({
  open,
  onClose,
  plan,
  verdict,
  shareUrl,
}: {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  verdict: Verdict;
  /** Link dello scenario corrente, calcolato dal chiamante dallo stato React
   * (non da window.location, che si aggiorna solo dopo un giro di router). */
  shareUrl: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setLinkCopied(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const missionCount = plan.entries.length;
  const shareText =
    `E se la prossima Legge di Bilancio la scrivessi tu? La mia proposta: ${verdict.headline}. ` +
    `Saldo netto ${signedCompactEuro(plan.net)} su ${missionCount} ` +
    `${missionCount === 1 ? "missione" : "missioni"}. ` +
    `Fatta con Dove Vanno I Nostri Soldi, ora prova a scrivere la tua:`;
  const shareMessage = `${shareText}\n${shareUrl}\n\n${SHARE_HASHTAG}`;
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedMessage = encodeURIComponent(shareMessage);

  const socialLinks = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encodedMessage}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${encodedMessage}` },
    {
      label: "Telegram",
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(
        `${shareText}\n\n${SHARE_HASHTAG}`,
      )}`,
    },
  ];

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareMessage);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* clipboard non disponibile: resta lo screenshot del riquadro */
    }
  }

  // Le barre raccontano "quanto hai spinto ogni leva": scala sul punto %, non
  // sull'importo (altrimenti il Debito, enorme, schiaccia tutte le altre).
  const topMovements = [...plan.entries]
    .sort((left, right) => Math.abs(right.pct) - Math.abs(left.pct))
    .slice(0, 5);
  const maxAbsPct = Math.max(1, ...topMovements.map((entry) => Math.abs(entry.pct)));

  return (
    <dialog
      ref={dialogRef}
      className={styles.shareDialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className={styles.shareDialogInner}>
        <button type="button" className={styles.shareClose} aria-label="Chiudi" onClick={onClose}>
          ×
        </button>

        <figure className={styles.shareCard} style={{ borderTopColor: netToneColor(plan.net) }}>
          <figcaption id={titleId} className={styles.shareKicker}>
            La mia proposta per la prossima Legge di Bilancio
          </figcaption>
          <p className={styles.shareNet} style={{ color: netToneColor(plan.net) }}>
            {signedCompactEuro(plan.net)}
          </p>
          <p className={styles.shareVerdict}>
            {verdict.headline}
            {verdict.detail ? (
              <span className={styles.shareVerdictDetail}>{verdict.detail}</span>
            ) : null}
          </p>

          <div className={styles.shareBars}>
            {topMovements.map((entry) => {
              const width = (Math.abs(entry.pct) / maxAbsPct) * 48;
              const up = entry.pct > 0;
              return (
                <div key={entry.mission} className={styles.shareBarRow}>
                  <span className={styles.shareBarLabel}>
                    {shortLabel(entry.mission)}{" "}
                    <b style={{ color: toneColor(entry.pct) }}>{signedPercent(entry.pct)}</b>
                  </span>
                  <span className={styles.shareBarTrack}>
                    <span
                      className={styles.shareBarFill}
                      style={{
                        width: `${width}%`,
                        background: toneColor(entry.pct),
                        ...(up ? { left: "50%" } : { right: "50%" }),
                      }}
                    />
                  </span>
                </div>
              );
            })}
            {missionCount > topMovements.length ? (
              <p className={styles.shareBarsMore}>
                + altre {missionCount - topMovements.length} missioni
              </p>
            ) : null}
          </div>

          <p className={styles.shareCta}>
            Crea la tua finanziaria · {SHARE_HOST}/spese/legge-di-bilancio
          </p>
        </figure>

        <div className={styles.shareLinks}>
          {socialLinks.map((social) => (
            <a key={social.label} href={social.href} target="_blank" rel="noopener noreferrer">
              {social.label}
            </a>
          ))}
          <button type="button" onClick={copyShareLink}>
            {linkCopied ? "Copiato ✓" : "Copia link"}
          </button>
        </div>

        <small className={styles.shareHint}>
          Oppure fai uno screenshot di questo riquadro e postalo.
        </small>
      </div>
    </dialog>
  );
}
