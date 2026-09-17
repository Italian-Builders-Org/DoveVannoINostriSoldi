import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/politici/[id]/news/route.ts");

test("politici news rejects unknown people without contacting GDELT", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch should not run");
  };
  try {
    const response = await GET(
      new Request("http://localhost/api/politici/unknown/news"),
      { params: Promise.resolve({ id: "unknown" }) },
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("politici news maps only safe GDELT article metadata", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      articles: [
        {
          url: "https://example.test/politica/notizia",
          title: " Giorgia Meloni e Lorenzo Fontana: titolo verificabile ",
          seendate: "20260917T120000Z",
          socialimage: "https://example.test/image.jpg",
          domain: "example.test",
          language: "Italian",
          sourcecountry: "Italy",
        },
        {
          url: "javascript:alert(1)",
          title: "URL non sicuro",
        },
        {
          url: "https://example.test/politica/notizia",
          title: "Duplicato",
        },
      ],
    }), { headers: { "content-type": "application/json" } });
  };
  try {
    const response = await GET(
      new Request("http://localhost/api/politici/camera%3Ad302103_19/news"),
      { params: Promise.resolve({ id: "camera:d302103_19" }) },
    );
    assert.equal(response.status, 200);
    assert.match(requestedUrl, /api\.gdeltproject\.org/);
    assert.match(new URL(requestedUrl).searchParams.get("query"), /"Giorgia Meloni"/);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.person.name, "Giorgia Meloni");
    assert.equal(body.articles.length, 1);
    assert.deepEqual(body.articles[0], {
      title: "Giorgia Meloni e Lorenzo Fontana: titolo verificabile",
      url: "https://example.test/politica/notizia",
      source: "example.test",
      publishedAt: "2026-09-17T12:00:00Z",
      imageUrl: "https://example.test/image.jpg",
      language: "Italian",
      sourceCountry: "Italy",
    });
    assert.equal(body.connections.length, 1);
    assert.equal(body.connections[0].person.name, "Lorenzo Fontana");
    assert.equal(body.connections[0].person.chamber, "camera");
    assert.match(response.headers.get("cache-control"), /s-maxage=1800/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
