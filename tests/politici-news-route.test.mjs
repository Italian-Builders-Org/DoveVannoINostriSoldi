import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/politici/[id]/news/route.ts");

test("politici news rejects unknown people without contacting news indexes", async () => {
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

test("politici news maps only safe Google News article metadata", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel>
        <item>
          <title>Giorgia Meloni e Lorenzo Fontana: titolo verificabile - Example Test</title>
          <link>https://example.test/politica/notizia</link>
          <pubDate>Wed, 17 Sep 2026 12:00:00 GMT</pubDate>
          <source url="https://example.test">Example Test</source>
        </item>
        <item>
          <title>URL non sicuro</title>
          <link>javascript:alert(1)</link>
        </item>
        <item>
          <title>Duplicato - Example Test</title>
          <link>https://example.test/politica/notizia</link>
        </item>
      </channel></rss>`;
    return new Response(rss, { headers: { "content-type": "application/rss+xml" } });
  };
  try {
    const response = await GET(
      new Request("http://localhost/api/politici/dep-302103/news"),
      { params: Promise.resolve({ id: "dep-302103" }) },
    );
    assert.equal(response.status, 200);
    assert.match(requestedUrl, /^https:\/\/news\.google\.com\/rss\/search(?:\?|$)/);
    assert.match(new URL(requestedUrl).searchParams.get("q"), /"Giorgia Meloni"/);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.person.name, "Giorgia Meloni");
    assert.equal(body.provider.id, "google-news");
    assert.equal(body.articles.length, 1);
    assert.equal(body.articles[0].title, "Giorgia Meloni e Lorenzo Fontana: titolo verificabile");
    assert.equal(body.articles[0].url, "https://example.test/politica/notizia");
    assert.equal(body.articles[0].source, "Example Test");
    assert.equal(body.connections.length, 1);
    assert.equal(body.connections[0].person.name, "Lorenzo Fontana");
    assert.equal(body.connections[0].person.chamber, "camera");
    assert.deepEqual(body.connections[0].articleUrls, ["https://example.test/politica/notizia"]);
    assert.equal(body.connections[0].articleCount, 1);
    assert.match(response.headers.get("cache-control"), /s-maxage=1800/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
