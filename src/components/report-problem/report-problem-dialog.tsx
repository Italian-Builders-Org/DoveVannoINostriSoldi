"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_IDS,
  REPORT_ENDPOINT,
  REPORT_LIMITS,
  reportRequestSchema,
  SECURITY_ADVISORY_URL,
  type ReportCategory,
  type ReportResponse,
} from "@/lib/report/contract";
import styles from "./report-problem.module.css";

type ReportProblemDialogProps = Readonly<{
  open: boolean;
  onClose: () => void;
}>;

type FieldName = "category" | "observed" | "expected" | "steps" | "sourceUrl";
type FieldErrors = Partial<Record<FieldName, string>>;

type Submission =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "sending" }>
  | Readonly<{ state: "sent"; number: number; url: string; duplicate: boolean }>
  | Readonly<{ state: "failed"; message: string; fallbackUrl: string | null }>;

const FIELD_LABELS: Record<FieldName, string> = {
  category: "Tipo di problema",
  observed: "Cosa è successo",
  expected: "Cosa ti aspettavi",
  steps: "Passaggi per riprodurre il problema",
  sourceUrl: "Fonte ufficiale",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReportResponse(value: unknown): value is ReportResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (value.ok) {
    return isRecord(value.issue) && typeof value.issue.number === "number" &&
      typeof value.issue.url === "string" && value.issue.url.startsWith("https://github.com/");
  }
  return typeof value.code === "string" && typeof value.message === "string" &&
    (value.fallbackUrl === undefined ||
      (typeof value.fallbackUrl === "string" && value.fallbackUrl.startsWith("https://github.com/")));
}

/** Only the fields the user can act on are mapped; everything else is a generic error. */
function fieldErrorsFrom(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    if (field in FIELD_LABELS && !(field in errors)) {
      errors[field as FieldName] = issue.message;
    }
  }
  return errors;
}

export function ReportProblemDialog({ open, onClose }: ReportProblemDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const id = (suffix: string) => `${baseId}-${suffix}`;

  const [category, setCategory] = useState<ReportCategory>("bug");
  const [observed, setObserved] = useState("");
  const [expected, setExpected] = useState("");
  const [steps, setSteps] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submission, setSubmission] = useState<Submission>({ state: "idle" });
  const [page, setPage] = useState<{ path: string; title: string; openedAt: string; clientKey: string } | null>(null);

  // Page context is captured when the dialog opens, so a report describes the
  // page the person was actually looking at even if they navigate afterwards.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setPage((current) => ({
        path: `${window.location.pathname}${window.location.search}`,
        title: document.title,
        openedAt: new Date().toISOString(),
        // The key survives a reopen so a retry of the same report never duplicates it.
        clientKey: current?.clientKey ?? crypto.randomUUID(),
      }));
      dialog.showModal();
      firstFieldRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const sourceRequired = category === "dato";
  const observedLeft = REPORT_LIMITS.observedMax - observed.length;
  const expectedLeft = REPORT_LIMITS.expectedMax - expected.length;
  const stepsLeft = REPORT_LIMITS.stepsMax - steps.length;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submission.state === "sending" || submission.state === "sent" || !page) return;

    const fresh = {
      clientKey: page.clientKey,
      category,
      observed,
      expected,
      steps,
      ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
      page: { path: page.path, title: page.title },
      context: {
        reportedAt: new Date().toISOString(),
        openedAt: page.openedAt,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        userAgent: navigator.userAgent.slice(0, REPORT_LIMITS.userAgentMax),
      },
      website,
    };
    const validation = reportRequestSchema.safeParse(fresh);
    if (!validation.success) {
      const fieldErrors = fieldErrorsFrom(validation.error.issues);
      setErrors(fieldErrors);
      const first = (Object.keys(fieldErrors) as FieldName[])[0];
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    setErrors({});
    setSubmission({ state: "sending" });

    try {
      const response = await fetch(REPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fresh),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!isReportResponse(body)) {
        throw new Error(`Risposta inattesa (HTTP ${response.status})`);
      }
      if (body.ok) {
        setSubmission({ state: "sent", number: body.issue.number, url: body.issue.url, duplicate: body.duplicate });
        return;
      }
      setSubmission({ state: "failed", message: body.message, fallbackUrl: body.fallbackUrl ?? null });
    } catch {
      setSubmission({
        state: "failed",
        message: "Non è stato possibile contattare il server. I dati inseriti sono ancora qui: riprova fra poco.",
        fallbackUrl: null,
      });
    }
  }

  function resetAndClose() {
    if (submission.state === "sent") {
      setObserved("");
      setExpected("");
      setSteps("");
      setSourceUrl("");
      setCategory("bug");
      setSubmission({ state: "idle" });
      setPage(null);
    }
    onClose();
  }

  const sending = submission.state === "sending";
  const sent = submission.state === "sent";
  const errorList = (Object.keys(errors) as FieldName[]).map((field) => ({ field, message: errors[field]! }));

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={id("title")}
      aria-describedby={id("intro")}
      onCancel={(event) => {
        event.preventDefault();
        resetAndClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      <div className={styles.header}>
        <div>
          <h2 id={id("title")} className={styles.title}>Segnala un problema</h2>
          <p id={id("intro")} className={styles.intro}>
            La segnalazione diventa una issue <strong>pubblica</strong> su GitHub. Non inserire dati
            personali, credenziali o informazioni riservate.
          </p>
        </div>
        <button type="button" className={styles.close} onClick={resetAndClose} aria-label="Chiudi">
          ×
        </button>
      </div>

      {sent ? (
        <div className={styles.success} role="status" aria-live="polite">
          <p className={styles.successTitle}>
            <span aria-hidden="true">✓ </span>
            {submission.duplicate ? "Segnalazione già registrata" : "Segnalazione inviata"}
          </p>
          <p>
            {submission.duplicate
              ? "Questa segnalazione era già arrivata: non ne è stata creata una seconda."
              : "Grazie. La issue è pubblica e verrà valutata confrontandola con la fonte ufficiale."}
          </p>
          <p>
            <a href={submission.url} target="_blank" rel="noreferrer" className={styles.issueLink}>
              Apri la issue #{submission.number} su GitHub
            </a>
          </p>
          <button type="button" className={styles.secondary} onClick={resetAndClose}>Chiudi</button>
        </div>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {errorList.length > 0 ? (
            <div className={styles.errorSummary} role="alert" id={id("errors")}>
              <strong>Controlla i campi segnalati</strong>
              <ul>
                {errorList.map(({ field, message }) => (
                  <li key={field}>
                    <a href={`#${id(field)}`} onClick={(event) => { event.preventDefault(); document.getElementById(id(field))?.focus(); }}>
                      {FIELD_LABELS[field]}
                    </a>: {message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <fieldset className={styles.fieldset} disabled={sending}>
            <legend className={styles.label}>{FIELD_LABELS.category}</legend>
            <div className={styles.radios} role="radiogroup" aria-describedby={errors.category ? id("category-error") : undefined}>
              {REPORT_CATEGORY_IDS.map((value, index) => (
                <label key={value} className={styles.radio}>
                  <input
                    ref={index === 0 ? firstFieldRef : undefined}
                    id={index === 0 ? id("category") : undefined}
                    type="radio"
                    name="category"
                    value={value}
                    checked={category === value}
                    onChange={() => setCategory(value)}
                  />
                  {REPORT_CATEGORIES[value]}
                </label>
              ))}
            </div>
            {errors.category ? <p id={id("category-error")} className={styles.fieldError}>{errors.category}</p> : null}
          </fieldset>

          {category === "dato" ? (
            <p className={styles.hint}>
              Un dato diverso da quello atteso non dimostra da solo spreco, frode o responsabilità.
              Indica la fonte ufficiale con cui lo confronti: la verifica parte da lì.
            </p>
          ) : null}

          <TextField
            id={id("observed")}
            label={FIELD_LABELS.observed}
            value={observed}
            onChange={setObserved}
            max={REPORT_LIMITS.observedMax}
            left={observedLeft}
            error={errors.observed}
            disabled={sending}
            placeholder="Es. il totale della tabella non corrisponde alla somma delle righe"
          />
          <TextField
            id={id("expected")}
            label={FIELD_LABELS.expected}
            value={expected}
            onChange={setExpected}
            max={REPORT_LIMITS.expectedMax}
            left={expectedLeft}
            error={errors.expected}
            disabled={sending}
            placeholder="Es. il totale dovrebbe essere uguale alla somma"
          />
          <TextField
            id={id("steps")}
            label={FIELD_LABELS.steps}
            value={steps}
            onChange={setSteps}
            max={REPORT_LIMITS.stepsMax}
            left={stepsLeft}
            error={errors.steps}
            disabled={sending}
            placeholder={"1. Apri la pagina\n2. Seleziona…\n3. Osserva…"}
          />

          <div className={styles.field}>
            <label htmlFor={id("sourceUrl")} className={styles.label}>
              {FIELD_LABELS.sourceUrl}{" "}
              <span className={styles.optional}>{sourceRequired ? "(obbligatoria per contestare un dato)" : "(facoltativa)"}</span>
            </label>
            <input
              id={id("sourceUrl")}
              type="url"
              inputMode="url"
              className={styles.input}
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              maxLength={REPORT_LIMITS.sourceUrlMax}
              placeholder="https://…"
              disabled={sending}
              aria-required={sourceRequired}
              aria-invalid={errors.sourceUrl ? true : undefined}
              aria-describedby={errors.sourceUrl ? id("sourceUrl-error") : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            {errors.sourceUrl ? <p id={id("sourceUrl-error")} className={styles.fieldError}>{errors.sourceUrl}</p> : null}
          </div>

          {/* Honeypot: invisible to people, tempting for bots. */}
          <div className={styles.honeypot} aria-hidden="true">
            <label htmlFor={id("website")}>Sito web</label>
            <input
              id={id("website")}
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>

          <div className={styles.context}>
            <strong>Cosa viene allegato automaticamente</strong>
            <p>
              Pagina <code>{page?.path ?? "…"}</code>, titolo della pagina, data e ora, dimensione della finestra e
              versione del browser. Nessun nome, email o indirizzo IP viene salvato nella issue.
            </p>
          </div>

          <p className={styles.securityNote}>
            Hai trovato una vulnerabilità non ancora corretta? Non usare questo modulo: usa il{" "}
            <a href={SECURITY_ADVISORY_URL} target="_blank" rel="noreferrer">report privato GitHub</a>.
          </p>

          {submission.state === "failed" ? (
            <div className={styles.failure} role="alert">
              <strong>Invio non riuscito</strong>
              <p>{submission.message}</p>
              {submission.fallbackUrl ? (
                <a href={submission.fallbackUrl} target="_blank" rel="noreferrer" className={styles.fallbackLink}>
                  Apri il modulo GitHub precompilato
                </a>
              ) : null}
            </div>
          ) : null}

          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={sending} aria-busy={sending}>
              {sending ? "Invio in corso…" : "Invia la segnalazione pubblica"}
            </button>
            <button type="button" className={styles.secondary} onClick={resetAndClose} disabled={sending}>
              Annulla
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

type TextFieldProps = Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  left: number;
  error?: string;
  disabled: boolean;
  placeholder: string;
}>;

function TextField({ id, label, value, onChange, max, left, error, disabled, placeholder }: TextFieldProps) {
  const describedBy = [error ? `${id}-error` : null, `${id}-count`].filter(Boolean).join(" ");
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>{label}</label>
      <textarea
        id={id}
        className={styles.textarea}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={max}
        rows={3}
        required
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      <div className={styles.fieldMeta}>
        {error ? <p id={`${id}-error`} className={styles.fieldError}>{error}</p> : <span />}
        <span id={`${id}-count`} className={styles.counter}>{left} caratteri disponibili</span>
      </div>
    </div>
  );
}
