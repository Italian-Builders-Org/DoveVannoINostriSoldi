"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "../accedi.module.css";

function paramsFromLocation(): {
  accessToken: string | null;
  tokenHash: string | null;
  type: string | null;
  error: string | null;
} {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  const query = new URLSearchParams(window.location.search);
  return {
    accessToken: hash.get("access_token") || query.get("access_token"),
    tokenHash: query.get("token_hash") || hash.get("token_hash"),
    type: query.get("type") || hash.get("type"),
    error: query.get("error_description") || hash.get("error_description") || query.get("error"),
  };
}

export function AccediCallbackClient() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Completo l'accesso…");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { accessToken, tokenHash, type, error: urlError } = paramsFromLocation();
      if (urlError) {
        if (!cancelled) setError(urlError);
        return;
      }
      if (!accessToken && !tokenHash) {
        if (!cancelled) {
          setError(
            "Link incompleto. Torna ad Accedi e richiedi una nuova email, poi apri il link più recente.",
          );
        }
        return;
      }
      try {
        const response = await fetch("/api/boards/auth/session-from-supabase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: accessToken ?? undefined,
            tokenHash: tokenHash ?? undefined,
            type: type ?? "signup",
          }),
        });
        const data = (await response.json()) as { error?: string; redirectTo?: string };
        if (!response.ok) {
          if (!cancelled) setError(data.error ?? "Accesso non riuscito.");
          return;
        }
        if (!cancelled) setStatus("Accesso riuscito. Reindirizzamento…");
        router.replace(data.redirectTo ?? "/dashboard");
        router.refresh();
      } catch {
        if (!cancelled) setError("Errore di rete durante l'accesso.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className={styles.formCard} style={{ margin: "4rem auto", maxWidth: "28rem" }}>
      <h1 className={styles.lead} style={{ fontSize: "1.1rem", fontWeight: 650 }}>
        DVNS Boards
      </h1>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        <p className={styles.message}>{status}</p>
      )}
      {error ? (
        <p className={styles.help}>
          <a href="/accedi">Torna ad Accedi</a>
        </p>
      ) : null}
    </div>
  );
}
