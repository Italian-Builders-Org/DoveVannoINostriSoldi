import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Eurodeputati eletti in Italia",
};

export default function PoliticiEuropaLoading() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Caricamento eurodeputati…</h1>
        <p>Stiamo preparando l’elenco ufficiale del Parlamento europeo.</p>
      </div>
    </main>
  );
}
