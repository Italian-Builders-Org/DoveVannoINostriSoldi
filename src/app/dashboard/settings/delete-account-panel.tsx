"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearAllLocalBoardsForUser } from "@/lib/boards/board-library";
import styles from "../settings.module.css";

const CONFIRM_WORD = "ELIMINA";

export function DeleteAccountPanel({ email }: { email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submitDelete() {
    setError(null);
    if (confirm.trim() !== CONFIRM_WORD) {
      setError(`Digita ${CONFIRM_WORD} per confermare.`);
      return;
    }
    startTransition(async () => {
      const response = await fetch("/api/boards/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_WORD }),
        credentials: "same-origin",
      });
      const data = (await response.json()) as {
        error?: string;
        redirectTo?: string;
        clearLocalUserId?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Cancellazione non riuscita.");
        return;
      }
      if (typeof data.clearLocalUserId === "string" && data.clearLocalUserId) {
        try {
          clearAllLocalBoardsForUser(data.clearLocalUserId);
        } catch {
          /* best-effort local cleanup */
        }
      }
      router.replace(data.redirectTo ?? "/accedi");
      router.refresh();
    });
  }

  return (
    <div className={`${styles.card} ${styles.dangerCard}`} data-testid="settings-delete-account">
      <h2>Elimina account</h2>
      <p className={styles.hint}>
        Cancella in modo permanente l&apos;account <strong>{email}</strong>, le board salvate
        e i link di condivisione. I dati pubblici del sito non cambiano. L&apos;azione non si può
        annullare.
      </p>
      {!open ? (
        <button
          type="button"
          className={styles.danger}
          data-testid="settings-delete-open"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
        >
          Elimina account…
        </button>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            submitDelete();
          }}
        >
          <label className={styles.label}>
            Digita <strong>{CONFIRM_WORD}</strong> per confermare
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={styles.input}
              data-testid="settings-delete-confirm"
              placeholder={CONFIRM_WORD}
            />
          </label>
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.danger}
              disabled={pending || confirm.trim() !== CONFIRM_WORD}
              data-testid="settings-delete-submit"
            >
              {pending ? "Eliminazione…" : "Elimina definitivamente"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setConfirm("");
                setError(null);
              }}
            >
              Annulla
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <p className={styles.hint}>
        Maggiori dettagli su <a href="/privacy">Privacy</a>.
      </p>
    </div>
  );
}
