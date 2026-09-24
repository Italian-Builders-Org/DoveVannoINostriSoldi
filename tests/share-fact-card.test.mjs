import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const root = join(import.meta.dirname, "..");

const {
  ShareFactCardError,
  buildShareFactCardPath,
  buildShareFactMessage,
  parseShareFactCardSearchParams,
} = await import("../src/lib/share-fact-card.ts");
const { GET } = await import("../src/app/api/share/card/route.ts");

test("parseShareFactCardSearchParams keep title value path and builds public url", () => {
  const parsed = parseShareFactCardSearchParams(
    new URLSearchParams({
      title: "Debito pubblico italiano",
      value: "3.049,2 mld €",
      detail: "+4,1 mld € rispetto al mese precedente",
      source: "Banca d’Italia",
      path: "/debito",
    }),
  );

  assert.equal(parsed.title, "Debito pubblico italiano");
  assert.equal(parsed.value, "3.049,2 mld €");
  assert.equal(parsed.path, "/debito");
  assert.match(parsed.pageUrl, /\/debito$/);
  assert.ok(parsed.hostLabel.includes("dovevannoinostrisoldi"));
});

test("parseShareFactCardSearchParams fail-closed on missing title", () => {
  assert.throws(
    () => parseShareFactCardSearchParams(new URLSearchParams({ value: "1", path: "/debito" })),
    (error) => error instanceof ShareFactCardError && error.message === "missing_title",
  );
});

test("parseShareFactCardSearchParams reject unsafe path", () => {
  assert.throws(
    () =>
      parseShareFactCardSearchParams(
        new URLSearchParams({
          title: "x",
          value: "1",
          path: "https://evil.example",
        }),
      ),
    (error) => error instanceof ShareFactCardError && error.message === "invalid_path",
  );
});

test("buildShareFactCardPath round-trips through the parser", () => {
  const path = buildShareFactCardPath({
    title: "Debito pubblico italiano",
    value: "3.049,2 mld €",
    detail: "variazione mensile",
    source: "Banca d’Italia",
    path: "/debito",
  });
  assert.match(path, /^\/api\/share\/card\?/);
  const params = new URL(path, "https://example.test").searchParams;
  const parsed = parseShareFactCardSearchParams(params);
  assert.equal(parsed.title, "Debito pubblico italiano");
  assert.equal(parsed.path, "/debito");
});

test("buildShareFactMessage includes value and public page url", () => {
  const message = buildShareFactMessage({
    title: "Debito pubblico italiano",
    value: "3.049,2 mld €",
    path: "/debito",
  });
  assert.match(message, /3\.049,2 mld €/);
  assert.match(message, /\/debito/);
  assert.match(message, /Dove Vanno I Nostri Soldi/);
});

test("GET /api/share/card returns png for valid fact", async () => {
  const path = buildShareFactCardPath({
    title: "Debito pubblico italiano",
    value: "3.049,2 mld €",
    detail: "+4,1 mld € rispetto al mese precedente",
    source: "Banca d’Italia",
    path: "/debito",
  });
  const response = await GET(new Request(`http://localhost${path}`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /image\/png/);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=86400/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 1_000);
  assert.equal(bytes[0], 0x89);
  assert.equal(bytes[1], 0x50);
});

test("GET /api/share/card returns 400 without inventing a card", async () => {
  const response = await GET(new Request("http://localhost/api/share/card?value=1&path=/debito"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_params");
});

test("debito page wires ShareFactButton for visitor-driven share", () => {
  const source = readFileSync(join(root, "src/app/debito/page.tsx"), "utf8");
  assert.match(source, /ShareFactButton/);
  assert.match(source, /Condividi questo dato/);
  assert.match(source, /path="\/debito"/);
});
