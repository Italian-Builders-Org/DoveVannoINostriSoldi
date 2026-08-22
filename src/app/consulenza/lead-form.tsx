"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CONSULTING_TOPICS,
  ORGANIZATION_TYPES,
  PROJECT_BUDGETS,
} from "@/lib/consulting-contract";
import styles from "./consulenza.module.css";

type FormStatus = "idle" | "sending" | "success" | "error";

const TOPIC_KEYS = Object.keys(CONSULTING_TOPICS) as Array<keyof typeof CONSULTING_TOPICS>;
const TYPE_KEYS = Object.keys(ORGANIZATION_TYPES) as Array<keyof typeof ORGANIZATION_TYPES>;
const BUDGET_KEYS = Object.keys(PROJECT_BUDGETS) as Array<keyof typeof PROJECT_BUDGETS>;

export function LeadForm() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const submissionRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const sending = status === "sending";

  useEffect(() => {
    if (status === "success") successRef.current?.focus();
    else if (error) errorRef.current?.focus();
  }, [error, status]);

  if (status === "success") {
    return (
      <div className="notice" role="status" tabIndex={-1} ref={successRef}>
        <strong>Richiesta inviata</strong>
        <p>
          Grazie. Rispondiamo di solito entro due giorni lavorativi, sullo stesso indirizzo
          email che hai indicato.
        </p>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setStatus("sending");
    setError(null);

    const draft = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      organization: String(data.get("organization") ?? ""),
      organizationType: String(data.get("organizationType") ?? ""),
      role: String(data.get("role") ?? ""),
      organizationWebsite: String(data.get("organizationWebsite") ?? ""),
      topic: String(data.get("topic") ?? ""),
      budget: String(data.get("budget") ?? ""),
      message: String(data.get("message") ?? ""),
      consent: data.get("consent") === "on",
      company_fax: String(data.get("company_fax") ?? ""),
    };
    const fingerprint = JSON.stringify(draft);
    if (submissionRef.current?.fingerprint !== fingerprint) {
      submissionRef.current = { fingerprint, id: crypto.randomUUID() };
    }
    const body = { ...draft, submissionId: submissionRef.current.id };

    try {
      const response = await fetch("/api/consulenza", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || payload.ok === false) {
        setStatus("error");
        setError(payload.error ?? "Non siamo riusciti a inviare la richiesta. Riprova.");
        return;
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setError("Invio non riuscito. Riprova tra un minuto.");
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={onSubmit}
      aria-busy={sending}
      aria-describedby={error ? "consulting-form-error" : undefined}
    >
      <p className={styles.requiredNote}>I campi con * sono obbligatori.</p>

      <label>
        <span>Nome e cognome *</span>
        <input className="input" name="name" type="text" autoComplete="name" required maxLength={120} />
      </label>

      <label>
        <span>Email di lavoro *</span>
        <input className="input" name="email" type="email" autoComplete="email" required maxLength={180} />
      </label>

      <label>
        <span>Organizzazione o ente *</span>
        <input
          className="input"
          name="organization"
          type="text"
          autoComplete="organization"
          required
          maxLength={180}
        />
      </label>

      <label>
        <span>Sito web dell&apos;ente o dell&apos;azienda</span>
        <input
          className="input"
          name="organizationWebsite"
          type="text"
          inputMode="url"
          autoComplete="url"
          maxLength={300}
          placeholder="https://www.esempio.it"
        />
      </label>

      <label>
        <span>Tipo *</span>
        <select className="input" name="organizationType" required defaultValue="">
          <option value="" disabled>
            Seleziona
          </option>
          {TYPE_KEYS.map((key) => (
            <option key={key} value={key}>
              {ORGANIZATION_TYPES[key]}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Ruolo</span>
        <input className="input" name="role" type="text" autoComplete="organization-title" maxLength={120} />
      </label>

      <label>
        <span>Progetto che ti interessa *</span>
        <select className="input" name="topic" required defaultValue="">
          <option value="" disabled>
            Seleziona
          </option>
          {TOPIC_KEYS.map((key) => (
            <option key={key} value={key}>
              {CONSULTING_TOPICS[key]}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Budget indicativo *</span>
        <select className="input" name="budget" required defaultValue="">
          <option value="" disabled>
            Seleziona
          </option>
          {BUDGET_KEYS.map((key) => (
            <option key={key} value={key}>
              {PROJECT_BUDGETS[key]}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.message}>
        <span>Obiettivo del progetto *</span>
        <textarea
          className="input"
          name="message"
          required
          minLength={30}
          maxLength={4000}
          rows={6}
          placeholder="Per chi è, su quali dati (pubblici, aziendali, o altri), che cosa deve trovare o scrivere."
        />
      </label>

      <label className={styles.honeypot} aria-hidden="true">
        <span>Fax</span>
        <input name="company_fax" type="text" tabIndex={-1} autoComplete="off" />
      </label>

      <label className={styles.consent}>
        <input name="consent" type="checkbox" required />
        <span>
          Ho letto l&apos;
          <Link href="/privacy">informativa privacy</Link> e acconsento al trattamento dei dati
          per rispondere a questa richiesta. *
        </span>
      </label>

      {error ? (
        <p
          className={styles.error}
          id="consulting-form-error"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          {error}
        </p>
      ) : null}

      <button className="btn btn-primary" type="submit" disabled={sending}>
        {sending ? "Invio in corso" : "Invia la richiesta"}
      </button>
    </form>
  );
}
