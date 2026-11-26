import "server-only";
import postgres from "postgres";

/**
 * Connection to the DVNS PostgreSQL project, shared by every reader. Kept
 * apart from the integrated corpus reader so that pages reading a single
 * snapshot (for example the DVNS Index badge on /comuni) do not pull the
 * corpus contract and the source ledger into their serverless bundle.
 */
let pool: ReturnType<typeof postgres> | undefined;

export function databaseConnectionUrl(value = process.env.DVNS_DATABASE_URL): string {
  try {
    const url = new URL(value ?? "");
    const project = "zvqhikeylxynsljwgosc";
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.password ||
      url.pathname !== "/postgres" ||
      url.searchParams.getAll("sslmode").length !== 1 ||
      !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) throw new Error();
    if (url.hostname === `db.${project}.supabase.co` && url.username === "postgres") return value!;
    if (url.hostname !== "aws-0-eu-west-1.pooler.supabase.com") throw new Error();
    if (url.username === `postgres.${project}`) return value!;
    const canary = process.env.VERCEL_ENV === "preview" && url.username === `dvns_vercel_canary.${project}`;
    if (!canary && url.username !== `dvns_vercel_preview.${project}`) throw new Error();
    if (url.port && url.port !== "5432" && url.port !== "6543") throw new Error();
    // Session pooling holds a PostgreSQL connection for each warm function.
    // Transaction pooling releases it after each bounded read, across instances.
    url.port = "6543";
    return url.href;
  } catch {
    throw new Error("Configurazione PostgreSQL DVNS mancante o non valida per il progetto selezionato.");
  }
}

export function database() {
  // One small pool per server module, not per request. No credentials in errors/debug.
  pool ??= postgres(databaseConnectionUrl(), {
    max: 2, max_pipeline: 1, prepare: false, fetch_types: false,
    idle_timeout: 20, connect_timeout: 10, queue_timeout: 10,
    connection: { application_name: "dvns-local-reader" },
    onnotice: () => {},
  });
  return pool;
}
