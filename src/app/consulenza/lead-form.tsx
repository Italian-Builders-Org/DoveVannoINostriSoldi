"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CONSULTING_TOPICS, ORGANIZATION_TYPES } from "@/lib/leads";
import { CONTACT_EMAIL } from "@/lib/site";
import styles from "./consulenza.module.css";

type FormStatus = "idle" | "sending" | "success" | "error";

const TOPIC_KEYS = Object.keys(CONSULTING_TOPICS) as Array<keyof typeof CONSULTING_TOPICS>;
const TYPE_KEYS = Object.keys(ORGANIZATION_TYPES) as Array<keyof typeof ORGANIZATION_TYPES>;

export function LeadForm() {
  const [startedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<FormStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const sending = status === "sending";

  if (status === "success") {
    return (
      <div className="notice" role="status">
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

    const body = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      organization: String(data.get("organization") ?? ""),
      organizationType: String(data.get("organizationType") ?? ""),
      role: String(data.get("role") ?? ""),
      topic: String(data.get("topic") ?? ""),
      message: String(data.get("message") ?? ""),
      consent: data.get("consent") === "on",
      website: String(data.get("website") ?? ""),
      startedAt,
    };

    try {
      const response = await fetch("/api/consulenza", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };

      if (response.status === 503) {
        setStatus("error");
        setError(
          `Il form non è ancora collegato alla posta. Scrivi a ${CONTACT_EMAIL} con gli stessi dati.`,
        );
        return;
      }

      if (!response.ok || payload.ok === false) {
        setStatus("error");
        setError(payload.error ?? "Non siamo riusciti a inviare la richiesta. Riprova.");
        return;
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setError(`Invio non riuscito. Scrivi a ${CONTACT_EMAIL} se il problema continua.`);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-busy={sending}>
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
        <span>Di che cosa hai bisogno *</span>
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

      <label className={styles.message}>
        <span>Messaggio *</span>
        <textarea
          className="input"
          name="message"
          required
          minLength={20}
          maxLength={4000}
          rows={6}
          placeholder="Ente o territorio, periodo, e che cosa ti servirebbe dopo la prima conversazione."
        />
      </label>

      <label className={styles.honeypot} aria-hidden="true">
        <span>Sito web</span>
        <input name="website" type="text" tabIndex={-1} autoComplete="off" />
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
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <button className="btn btn-primary" type="submit" disabled={sending}>
        {sending ? "Invio in corso" : "Invia la richiesta"}
      </button>
    </form>
  );
}
