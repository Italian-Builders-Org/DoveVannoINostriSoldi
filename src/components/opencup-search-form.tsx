"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function OpenCupSearchForm({ className }: { className?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const cup = String(data.get("cup") ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{15}$/.test(cup)) {
      setError("Inserisci un CUP alfanumerico di 15 caratteri.");
      return;
    }
    setError("");
    router.push(`/progetti/${cup}`);
  }

  return (
    <form className={className} onSubmit={submit} noValidate>
      <label htmlFor="opencup-cup">Cerca un CUP esatto</label>
      <div>
        <input
          className="input"
          id="opencup-cup"
          name="cup"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={15}
          pattern="[A-Za-z0-9]{15}"
          required
        />
        <button className="btn btn-primary" type="submit">Apri il progetto</button>
      </div>
      <p aria-live="polite">{error}</p>
    </form>
  );
}
