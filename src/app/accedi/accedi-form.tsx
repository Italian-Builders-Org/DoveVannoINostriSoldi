"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import styles from "./accedi.module.css";

type Step = "email" | "code";

export function AccediForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [localMagicLink, setLocalMagicLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  function requestCode() {
    setError(null);
    setMessage(null);
    if (!consent) {
      setError("Per continuare conferma il trattamento dell'email per l'accesso.");
      return;
    }
    startTransition(async () => {
      const response = await fetch("/api/boards/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        previewCode?: string;
        localMagicLink?: string;
        magicLink?: boolean;
      };
      if (!response.ok) {
        setError(data.error ?? "Invio non riuscito.");
        return;
      }
      setPreviewCode(data.previewCode ?? null);
      setLocalMagicLink(data.localMagicLink ?? null);
      setMessage(data.message ?? "Email inviata.");
      setStep("code");
      setCode("");
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
      const data = (await response.json()) as { error?: string; redirectTo?: string };
      if (!response.ok) {
        setError(data.error ?? "Verifica non riuscita.");
        return;
      }
      router.replace(data.redirectTo ?? "/dashboard");
      router.refresh();
    });
  }

  function resetToEmail() {
    setStep("email");
    setCode("");
    setPreviewCode(null);
    setLocalMagicLink(null);
    setMessage(null);
    setError(null);
  }

  const isLocalPreview = Boolean(previewCode);

  return (
    <div className={styles.formCard} data-testid="accedi-form">
      <div className={styles.tabs} role="tablist" aria-label="Accesso">
        <span className={styles.tabActive} role="tab" aria-selected="true">
          Accedi o registrati
        </span>
      </div>
      {step === "email" ? (
        <form
          className={styles.form}
          data-testid="accedi-email-step"
          onSubmit={(event) => {
            event.preventDefault();
            requestCode();
          }}
        >
          <label className={styles.label}>
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={styles.input}
              placeholder="nome@esempio.it"
            />
          </label>
          <label className={styles.consent}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              Acconsento al trattamento dell&apos;email per accedere alla dashboard personale.
              Dettagli in <a href="/privacy">Privacy</a>.
            </span>
          </label>
          <button type="submit" className={styles.primaryBtn} disabled={pending}>
            {pending ? "Invio…" : "Invia link di accesso"}
          </button>
        </form>
      ) : (
        <form
          className={styles.form}
          data-testid="accedi-code-step"
          onSubmit={(event) => {
            event.preventDefault();
            if (isLocalPreview) verifyCode();
          }}
        >
          <p className={styles.emailHint}>
            Accesso per <strong>{email}</strong>
          </p>
          {isLocalPreview ? (
            <>
              <div className={styles.previewOtp} data-testid="preview-otp">
                <strong>Anteprima locale</strong>
                <p>
                  Nessuna email inviata. Usa il codice{" "}
                  <code data-testid="preview-otp-code">{previewCode}</code>.
                </p>
              </div>
              <label className={styles.label}>
                Codice a sei cifre
                <input
                  type="text"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  className={styles.input}
                  placeholder="000000"
                />
              </label>
              <div className={styles.actions}>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={pending || code.length !== 6}
                >
                  {pending ? "Verifica…" : "Entra nella dashboard"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={pending}
                  onClick={resetToEmail}
                >
                  Cambia email
                </button>
              </div>
            </>
          ) : localMagicLink ? (
            <>
              <div className={styles.previewOtp} data-testid="local-magic-link">
                <strong>Link pronto (locale)</strong>
                <p>
                  Resend non è in <code>.env.local</code>, quindi niente email: apri il link qui
                  sotto per entrare.
                </p>
              </div>
              <div className={styles.actions}>
                <a className={styles.primaryBtn} href={localMagicLink} data-testid="open-magic-link">
                  Apri link di accesso
                </a>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={pending}
                  onClick={resetToEmail}
                >
                  Cambia email
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={pending}
                  onClick={() => requestCode()}
                >
                  {pending ? "Invio…" : "Rigenera link"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.previewOtp}>
                <strong>Apri il link nell&apos;email</strong>
                <p>
                  Cerca il messaggio con subject <strong>Accedi a DVNS Boards</strong> (anche in
                  Spam) e clicca il pulsante.
                </p>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={pending}
                  onClick={resetToEmail}
                >
                  Cambia email
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={pending}
                  onClick={() => requestCode()}
                >
                  {pending ? "Invio…" : "Reinvia link"}
                </button>
              </div>
            </>
          )}
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
