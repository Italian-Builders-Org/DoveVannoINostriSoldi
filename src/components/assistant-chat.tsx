"use client";

import { FormEvent, useState } from "react";
import {
  ASSISTANT_EXAMPLES,
  ASSISTANT_MAX_PROMPT_CHARS,
  type AssistantResponse,
  type AssistantAnswer,
  type AssistantComparison,
} from "@/lib/assistant/contracts";
import styles from "@/app/assistente/assistant.module.css";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAssistantResponse(value: unknown): value is AssistantResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !isText(value.kind)) return false;
  if (value.ok === false) {
    return ["refusal", "invalid_request", "unavailable"].includes(value.kind) &&
      isText(value.code) && isText(value.message);
  }
  if (value.kind === "help") {
    return isText(value.message) && Array.isArray(value.examples) && value.examples.every(isText);
  }
  if (value.kind === "comparison" && isRecord(value.comparison)) {
    const { answers, change, caveats } = value.comparison;
    return Array.isArray(answers) && answers.length === 2 && answers.every(isAnswer) &&
      Array.isArray(caveats) && caveats.every(isText) &&
      (change === null || (isRecord(change) && typeof change.euro === "number" &&
        Number.isFinite(change.euro) && (change.percent === null ||
          (typeof change.percent === "number" && Number.isFinite(change.percent)))));
  }
  return value.kind === "answer" && isAnswer(value.answer);
}

function isAnswer(answer: unknown): answer is AssistantAnswer {
  if (!isRecord(answer)) return false;
  if (!isText(answer.dataset) || !isRecord(answer.period) || !isRecord(answer.observation) ||
      !isRecord(answer.source) || !Array.isArray(answer.caveats) || !Array.isArray(answer.facts)) {
    return false;
  }
  if (typeof answer.period.year !== "number" || !Number.isSafeInteger(answer.period.year) ||
      !isText(answer.period.label) || !isText(answer.observation.label) ||
      typeof answer.observation.value !== "number" || !Number.isFinite(answer.observation.value) ||
      !isText(answer.observation.scope) || !isText(answer.source.owner) ||
      !isText(answer.source.url) || !answer.source.url.startsWith("https://") ||
      !isText(answer.source.observedAt) || !answer.caveats.every(isText)) {
    return false;
  }
  return answer.facts.every((fact) => isRecord(fact) && isText(fact.label) &&
    typeof fact.value === "number" && Number.isFinite(fact.value) &&
    ["euro", "percent", "count"].includes(String(fact.unit)));
}

function euro(value: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);
}

function factValue(value: number, unit: "euro" | "percent" | "count"): string {
  if (unit === "euro") return euro(value);
  if (unit === "percent") return `${value.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
  return value.toLocaleString("it-IT");
}

function observedDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "Europe/Rome" }).format(parsed);
}

function AnswerCard({ answer, comparison = false }: { answer: AssistantAnswer; comparison?: boolean }) {
  const titleId = comparison ? `assistant-answer-${answer.period.year}` : "assistant-answer-title";
  const Heading = comparison ? "h4" : "h3";
  return (
    <article className={styles.answer} aria-labelledby={titleId}>
      <p className={styles.answerEyebrow}>Risposta verificata · {answer.dataset}</p>
      <Heading id={titleId}>{answer.observation.label}</Heading>
      <p className={styles.answerValue}>{euro(answer.observation.value)}</p>
      <p className={styles.answerScope}>{answer.observation.scope} · {answer.period.label}</p>
      <dl className={styles.facts}>
        {answer.facts.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{factValue(item.value, item.unit)}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.sourceBox}>
        <strong>Fonte</strong>
        <a href={answer.source.url} target="_blank" rel="noreferrer">{answer.source.owner} ↗</a>
        <small>Osservato il {observedDate(answer.source.observedAt)}</small>
      </div>
      <div className={styles.caveats}>
        <strong>Da leggere con attenzione</strong>
        <ul>{answer.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
      </div>
    </article>
  );
}

function ComparisonCard({ comparison }: { comparison: AssistantComparison }) {
  const [before, after] = comparison.answers;
  return (
    <section className={styles.comparison} aria-labelledby="assistant-comparison-title">
      <h3 id="assistant-comparison-title">Confronto pagamenti SIOPE dei Comuni</h3>
      <p>{before.observation.scope} · {before.period.year} → {after.period.year}</p>
      {comparison.change ? (
        <dl className={styles.facts} aria-label="Variazione tra gli anni">
          <div>
            <dt>Differenza {after.period.year} meno {before.period.year}</dt>
            <dd>{euro(comparison.change.euro)}</dd>
          </div>
          <div>
            <dt>Variazione rispetto al {before.period.year}</dt>
            <dd>{comparison.change.percent === null ? "Non calcolabile: base zero" : factValue(comparison.change.percent, "percent")}</dd>
          </div>
        </dl>
      ) : null}
      <div className={styles.caveats}>
        <strong>Come leggere il confronto</strong>
        <ul>{comparison.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
      </div>
      <div className={styles.comparisonYears}>
        {comparison.answers.map((answer) => <AnswerCard key={answer.period.year} answer={answer} comparison />)}
      </div>
    </section>
  );
}

export function AssistantChat() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || loading) return;
    setLoading(true);
    setResponse(null);
    try {
      const result = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: value }),
      });
      const payload: unknown = await result.json();
      setResponse(isAssistantResponse(payload)
        ? payload
        : { ok: false, kind: "unavailable", code: "data_unavailable", message: "Risposta non valida." });
    } catch {
      setResponse({ ok: false, kind: "unavailable", code: "data_unavailable", message: "Non riesco a raggiungere il servizio in questo momento." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`panel ${styles.assistantPanel}`} aria-labelledby="assistant-form-title">
      <div className={styles.formHeader}>
        <div>
          <h2 id="assistant-form-title">Fai una domanda</h2>
          <p>Rispondo con dati aggregati verificati e posso confrontare i pagamenti dei Comuni tra due anni.</p>
        </div>
        <span className="tag tag-neutral">Sola lettura</span>
      </div>

      <form onSubmit={submit} className={styles.form}>
        <label htmlFor="assistant-prompt">Domanda in italiano</label>
        <textarea
          id="assistant-prompt"
          name="prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={ASSISTANT_MAX_PROMPT_CHARS}
          rows={3}
          placeholder="Quanto hanno speso i Comuni in Calabria nel 2025?"
          aria-describedby="assistant-help assistant-count"
          disabled={loading}
        />
        <div className={styles.formMeta}>
          <span id="assistant-help">Niente cronologia, account o provider AI: la domanda viene interpretata da regole allowlisted.</span>
          <span id="assistant-count">{prompt.length}/{ASSISTANT_MAX_PROMPT_CHARS}</span>
        </div>
        <button className="btn" type="submit" disabled={loading || prompt.trim().length === 0}>
          {loading ? "Controllo la fonte…" : "Cerca nei dati"}
        </button>
      </form>

      <div className={styles.examples} aria-label="Esempi di domande">
        <span className={styles.exampleLabel}>Prova:</span>
        {ASSISTANT_EXAMPLES.map((example) => (
          <button key={example} type="button" className={styles.example} onClick={() => setPrompt(example)} disabled={loading}>
            {example}
          </button>
        ))}
      </div>

      <div className={styles.result} aria-live="polite" aria-busy={loading}>
        {response?.ok && response.kind === "answer" ? (
          <AnswerCard answer={response.answer} />
        ) : response?.ok && response.kind === "comparison" ? (
          <ComparisonCard comparison={response.comparison} />
        ) : response ? (
          <div className={styles.message} role={response.ok ? undefined : "alert"}>
            <strong>{response.kind === "help" ? "Posso aiutarti così" : "Richiesta non eseguita"}</strong>
            <p>{response.message}</p>
            {"examples" in response && response.examples ? (
              <ul>{response.examples.map((example) => <li key={example}>{example}</li>)}</ul>
            ) : null}
          </div>
        ) : (
          <p className={styles.empty}>La risposta apparirà qui, con periodo, fonte e cautele.</p>
        )}
      </div>
    </section>
  );
}
