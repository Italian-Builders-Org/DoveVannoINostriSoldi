/**
 * Public contract of the "Segnala un problema" form.
 *
 * The client sends only what the user typed plus the technical context of the
 * page. Everything that decides *where* and *how* the issue is created
 * (repository, labels, title format, body structure) lives on the server and
 * cannot be influenced by the payload. This module is imported by the browser
 * too, so it must stay free of secrets and of `server-only` imports.
 */
import { z } from "zod";
import { PUBLIC_SITE_URL, REPO_URL } from "@/lib/site";

export const REPORT_ENDPOINT = "/api/segnalazioni";
export const SECURITY_ADVISORY_URL = `${REPO_URL}/security/advisories/new`;
export const REPORT_ISSUE_LABEL = "segnalazione";

export const REPORT_CATEGORIES = Object.freeze({
  bug: "Bug del sito",
  dato: "Dato potenzialmente errato",
  accessibilita: "Accessibilità",
  altro: "Altro",
} as const);
export type ReportCategory = keyof typeof REPORT_CATEGORIES;
export const REPORT_CATEGORY_IDS = Object.freeze(
  Object.keys(REPORT_CATEGORIES) as [ReportCategory, ...ReportCategory[]],
);

export const REPORT_LIMITS = Object.freeze({
  observedMax: 2_000,
  expectedMax: 2_000,
  stepsMax: 2_000,
  sourceUrlMax: 500,
  pagePathMax: 300,
  pageTitleMax: 200,
  userAgentMax: 300,
  /** Upper bound of the JSON body accepted by the endpoint, in bytes. */
  requestBytesMax: 12_288,
  /** Minimum time a human plausibly needs between opening and sending the form. */
  minFillMs: 3_000,
  /** A form opened longer ago than this is considered stale. */
  maxFillMs: 24 * 60 * 60 * 1_000,
});

// Control characters (tab excluded), bidi overrides and zero-width characters.
const INVISIBLE_CHARACTERS =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/gu;

/**
 * Normalises free text typed by a person: NFC, no control or invisible
 * characters, CRLF folded to LF, no trailing spaces, at most one blank line
 * in a row.
 */
export function normalizeUserText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function boundedText(max: number, { required }: { required: boolean }) {
  const base = z.string().max(max * 4).transform(normalizeUserText);
  return required
    ? base.pipe(z.string().min(1, "campo obbligatorio").max(max, `massimo ${max} caratteri`))
    : base.pipe(z.string().max(max, `massimo ${max} caratteri`));
}

const publicHttpsUrl = z
  .string()
  .max(REPORT_LIMITS.sourceUrlMax, `massimo ${REPORT_LIMITS.sourceUrlMax} caratteri`)
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(REPORT_LIMITS.sourceUrlMax))
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.username === "" && url.password === "" &&
        !/[\s<>()"'`\\]/u.test(value);
    } catch {
      return false;
    }
  }, { message: "deve essere un URL https valido" });

/**
 * Only a path on the canonical site is accepted: the client never sends a
 * full URL, so an attacker cannot make the issue link to another domain.
 */
const sitePagePath = z
  .string()
  .max(REPORT_LIMITS.pagePathMax)
  .refine((value) => {
    if (!value.startsWith("/") || value.startsWith("//")) return false;
    if (/[\s<>()"'`\\]/u.test(value)) return false;
    try {
      const url = new URL(value, PUBLIC_SITE_URL);
      return url.origin === PUBLIC_SITE_URL && url.pathname + url.search === value;
    } catch {
      return false;
    }
  }, { message: "percorso pagina non valido" });

const viewport = z.strictObject({
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
});

const isoTimestamp = z
  .string()
  .max(40)
  .refine((value) => Number.isFinite(Date.parse(value)), { message: "timestamp non valido" });

export const reportRequestSchema = z
  .strictObject({
    /** UUID chosen by the client; the server uses it to avoid duplicate issues. */
    clientKey: z.uuid(),
    category: z.enum(REPORT_CATEGORY_IDS),
    observed: boundedText(REPORT_LIMITS.observedMax, { required: true }),
    expected: boundedText(REPORT_LIMITS.expectedMax, { required: true }),
    steps: boundedText(REPORT_LIMITS.stepsMax, { required: true }),
    sourceUrl: publicHttpsUrl.optional(),
    page: z.strictObject({
      path: sitePagePath,
      title: boundedText(REPORT_LIMITS.pageTitleMax, { required: false }),
    }),
    context: z.strictObject({
      reportedAt: isoTimestamp,
      openedAt: isoTimestamp,
      viewport: viewport.optional(),
      userAgent: boundedText(REPORT_LIMITS.userAgentMax, { required: false }).optional(),
    }),
    /** Honeypot: must stay empty. Bots that fill every field are rejected. */
    website: z.literal("").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.category === "dato" && !value.sourceUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "per contestare un dato indica il link di una fonte ufficiale",
      });
    }
  });

export type ReportRequest = z.infer<typeof reportRequestSchema>;

export type ReportValidation =
  | Readonly<{ ok: true; value: ReportRequest }>
  | Readonly<{ ok: false; message: string }>;

export function parseReportRequest(payload: unknown): ReportValidation {
  const result = reportRequestSchema.safeParse(payload);
  if (result.success) return { ok: true, value: result.data };
  const first = result.error.issues[0];
  const path = first?.path.map(String).join(".") ?? "";
  return {
    ok: false,
    message: path
      ? `Campo «${path}» non valido: ${first?.message ?? "valore rifiutato"}`
      : "Segnalazione non valida",
  };
}

/** Timing checks that complement the honeypot. Returns a reason, or `null` when fine. */
export function timingRejection(context: ReportRequest["context"], now = Date.now()): string | null {
  const opened = Date.parse(context.openedAt);
  const reported = Date.parse(context.reportedAt);
  if (reported < opened) return "Orari della segnalazione incoerenti";
  if (reported - opened < REPORT_LIMITS.minFillMs) return "Invio troppo rapido";
  if (now - opened > REPORT_LIMITS.maxFillMs) return "Modulo aperto da troppo tempo: ricarica la pagina";
  if (reported - now > 5 * 60 * 1_000) return "Orario della segnalazione nel futuro";
  return null;
}

/* ── Issue rendering ─────────────────────────────────────────────────────── */

/**
 * Wraps user text in a fenced block whose fence is longer than any backtick
 * run inside it. Inside a fence GitHub renders no HTML, no @mentions, no
 * #references and no links, so the text cannot notify anyone or embed markup.
 */
export function fenceUserText(value: string): string {
  const text = value.length > 0 ? value : "(non indicato)";
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/gu), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/** Inline text for headings and links: single line, no Markdown/HTML syntax, mentions defused. */
export function inlineSafe(value: string, max: number): string {
  const flat = normalizeUserText(value)
    .replace(/\s+/gu, " ")
    .replace(/[<>`*_[\]#|\\()]/gu, "")
    .replace(/@/gu, "＠")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export type IssueDraft = Readonly<{
  title: string;
  body: string;
  labels: readonly string[];
}>;

export const REPORT_KEY_MARKER = "dvns-report-key";

export function issueMarker(clientKey: string): string {
  return `<!-- ${REPORT_KEY_MARKER}: ${clientKey} -->`;
}

function formatRome(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "non disponibile";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(date);
}

/**
 * Renders the issue. Title and structure are fixed here; the client can only
 * fill the user sections, which are all fenced.
 */
export function buildIssueDraft(request: ReportRequest): IssueDraft {
  const category = REPORT_CATEGORIES[request.category];
  // The path is already restricted by the schema; the title is plain text on
  // GitHub, so only its length needs bounding here.
  const pagePath = request.page.path.length > 120 ? `${request.page.path.slice(0, 119)}…` : request.page.path;
  const pageUrl = `${PUBLIC_SITE_URL}${request.page.path}`;
  const pageTitle = request.page.title ? inlineSafe(request.page.title, 120) : "";
  const title = `[Segnalazione] ${category}: ${pagePath}`;

  const source = request.sourceUrl
    ? `<${request.sourceUrl}>`
    : request.category === "dato"
      ? "(non indicata)"
      : "(non pertinente)";

  const technical = [
    `- Segnalata il: ${formatRome(request.context.reportedAt)} (Europe/Rome)`,
    request.context.viewport
      ? `- Viewport: ${request.context.viewport.width}×${request.context.viewport.height} px`
      : "- Viewport: non raccolto",
    request.context.userAgent
      ? `- Browser: \`${request.context.userAgent.replace(/`/gu, "'")}\``
      : "- Browser: non raccolto",
  ].join("\n");

  const lines: Array<string | null> = [
    issueMarker(request.clientKey),
    "## Tipo di problema",
    category,
    "",
    "## Pagina",
    pageTitle ? `[${pageTitle}](${pageUrl})` : `<${pageUrl}>`,
    "",
    "## Risultato osservato",
    fenceUserText(request.observed),
    "",
    "## Risultato atteso",
    fenceUserText(request.expected),
    "",
    "## Passaggi per riprodurre",
    fenceUserText(request.steps),
    "",
    "## Fonte ufficiale, se pertinente",
    source,
    "",
    "## Contesto tecnico",
    technical,
    "",
    "> Segnalazione inviata dal form pubblico del sito. Il contenuto inserito dall’utente non è stato verificato.",
    request.category === "dato"
      ? "> Un dato contestato non dimostra da solo spreco, frode o responsabilità: va confrontato con la fonte ufficiale."
      : null,
  ];

  return {
    title,
    body: lines.filter((line): line is string => line !== null).join("\n"),
    labels: [REPORT_ISSUE_LABEL],
  };
}

/** Fallback when the server cannot create the issue: GitHub's own composer, prefilled. */
export function githubComposerUrl(draft: IssueDraft): string {
  const params = new URLSearchParams({
    title: draft.title,
    body: draft.body.replace(/^<!--[^\n]*-->\n/u, ""),
    labels: draft.labels.join(","),
  });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

/* ── Response contract ───────────────────────────────────────────────────── */

export type ReportFailureCode = "invalid_request" | "rate_limited" | "unavailable" | "forbidden";

export type ReportResponse =
  | Readonly<{ ok: true; issue: Readonly<{ number: number; url: string }>; duplicate: boolean }>
  | Readonly<{ ok: false; code: ReportFailureCode; message: string; fallbackUrl?: string }>;
