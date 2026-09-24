/**
 * Visitor-driven share cards: a square fact image visitors can download
 * and post, so sharing is intrinsic to the product rather than manual
 * social posting by the maintainers.
 */

import { PUBLIC_SITE_URL } from "@/lib/site";

export const SHARE_FACT_CARD_SIZE = 1080;

const TITLE_MAX = 80;
const VALUE_MAX = 48;
const DETAIL_MAX = 180;
const SOURCE_MAX = 100;
const PATH_MAX = 120;
const PATH_RE = /^\/[a-z0-9/_-]*$/i;

export type ShareFactCardInput = {
  title: string;
  value: string;
  detail?: string;
  source?: string;
  /** Page path on the public site, e.g. `/debito`. */
  path: string;
};

export type ShareFactCardParsed = {
  title: string;
  value: string;
  detail: string | null;
  source: string | null;
  path: string;
  pageUrl: string;
  hostLabel: string;
};

export class ShareFactCardError extends Error {
  readonly code: "invalid_params";

  constructor(message: string) {
    super(message);
    this.name = "ShareFactCardError";
    this.code = "invalid_params";
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function requireField(raw: string | null, label: string, max: number): string {
  if (raw == null) {
    throw new ShareFactCardError(`missing_${label}`);
  }
  const value = collapseWhitespace(raw);
  if (!value) {
    throw new ShareFactCardError(`empty_${label}`);
  }
  if (value.length > max) {
    throw new ShareFactCardError(`${label}_too_long`);
  }
  return value;
}

function optionalField(raw: string | null, label: string, max: number): string | null {
  if (raw == null) return null;
  const value = collapseWhitespace(raw);
  if (!value) return null;
  if (value.length > max) {
    throw new ShareFactCardError(`${label}_too_long`);
  }
  return value;
}

function parsePath(raw: string | null): string {
  const path = requireField(raw ?? "/", "path", PATH_MAX);
  if (!PATH_RE.test(path) || path.includes("//")) {
    throw new ShareFactCardError("invalid_path");
  }
  return path === "" ? "/" : path;
}

export function parseShareFactCardSearchParams(
  params: URLSearchParams,
): ShareFactCardParsed {
  const title = requireField(params.get("title"), "title", TITLE_MAX);
  const value = requireField(params.get("value"), "value", VALUE_MAX);
  const detail = optionalField(params.get("detail"), "detail", DETAIL_MAX);
  const source = optionalField(params.get("source"), "source", SOURCE_MAX);
  const path = parsePath(params.get("path"));
  const pageUrl = new URL(path, PUBLIC_SITE_URL).toString();
  const hostLabel = new URL(PUBLIC_SITE_URL).host.replace(/^www\./, "");

  return { title, value, detail, source, path, pageUrl, hostLabel };
}

export function buildShareFactCardPath(input: ShareFactCardInput): string {
  const params = new URLSearchParams();
  params.set("title", collapseWhitespace(input.title));
  params.set("value", collapseWhitespace(input.value));
  if (input.detail?.trim()) params.set("detail", collapseWhitespace(input.detail));
  if (input.source?.trim()) params.set("source", collapseWhitespace(input.source));
  params.set("path", input.path.trim() || "/");
  // Validate before exposing the URL to the client.
  parseShareFactCardSearchParams(params);
  return `/api/share/card?${params.toString()}`;
}

export function buildShareFactMessage(input: ShareFactCardInput, pageUrl?: string): string {
  const parsed = parseShareFactCardSearchParams(
    new URLSearchParams({
      title: input.title,
      value: input.value,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.source ? { source: input.source } : {}),
      path: input.path,
    }),
  );
  const url = pageUrl ?? parsed.pageUrl;
  const detailLine = parsed.detail ? ` ${parsed.detail}` : "";
  return (
    `${parsed.title}: ${parsed.value}.${detailLine} ` +
    `Fonte e dettaglio su Dove Vanno I Nostri Soldi: ${url}`
  ).replace(/\s+/g, " ").trim();
}
