import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <main className="shell page">
      <div className="notice">
        <strong>Progetto non trovato nei rilasci consultati</strong>
        <p>Il CUP non compare nei rilasci pubblici interrogati. Questo non dimostra che il codice non esista nel Sistema CUP.</p>
        <Link className="btn btn-secondary" href="/coesione">Torna a fondi e progetti</Link>
      </div>
    </main>
  );
}
