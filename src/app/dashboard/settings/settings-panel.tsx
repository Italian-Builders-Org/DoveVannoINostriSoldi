"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import styles from "../settings.module.css";

type Step = "form" | "code";

export function SettingsPanel({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  function requestCode() {
    setError(null);
    setMessage(null);
    const next = email.trim().toLowerCase();
    if (next === currentEmail.toLowerCase()) {
      setError("Indica un indirizzo diverso da quello attuale.");
      return;
    }
    if (!consent) {
      setError("Conferma il trattamento della nuova email.");
      return;
    }
    startTransition(async () => {
      const response = await fetch("/api/boards/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: next }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        previewCode?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Invio non riuscito.");
        return;
      }
      setPreviewCode(data.previewCode ?? null);
      setMessage(data.message ?? "Codice inviato.");
      setStep("code");
    });
  }

  function verifyCode() {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/boards/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Verifica non riuscita.");
        return;
      }
      router.replace("/dashboard/settings");
      router.refresh();
      setStep("form");
      setEmail("");
      setCode("");
      setPreviewCode(null);
      setMessage("Email aggiornata.");
      setConsent(false);
    });
  }

  return (
    <div className={styles.card} data-testid="settings-email">
      <h2>Cambia email</h2>
      {step === "form" ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            requestCode();
          }}
        >
          <label className={styles.label}>
            Nuova email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={styles.input}
              placeholder="nuova@esempio.it"
            />
          </label>
          <label className={styles.consent}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>Acconsento al trattamento della nuova email per l&apos;accesso.</span>
          </label>
          <button type="submit" className={styles.primary} disabled={pending}>
            {pending ? "Invio…" : "Invia codice"}
          </button>
        </form>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            verifyCode();
          }}
        >
          <p className={styles.hint}>
            Codice inviato a <strong>{email}</strong>
          </p>
          {previewCode ? (
            <div className={styles.preview} data-testid="preview-otp">
              Anteprima locale: usa <code data-testid="preview-otp-code">{previewCode}</code>
            </div>
          ) : null}
          <label className={styles.label}>
            Codice a sei cifre
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className={styles.input}
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={pending || code.length !== 6}>
              {pending ? "Verifica…" : "Conferma nuova email"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={pending}
              onClick={() => {
                setStep("form");
                setCode("");
                setPreviewCode(null);
                setError(null);
              }}
            >
              Annulla
            </button>
          </div>
        </form>
      )}
      {message ? <p className={styles.message}>{message}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
