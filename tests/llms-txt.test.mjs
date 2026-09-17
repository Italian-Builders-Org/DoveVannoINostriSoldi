import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { test } from "node:test";
import {
  LLMS_DISCOVERY_PATHS,
  PUBLIC_INDEXABLE_PATHS,
} from "../src/lib/public-discovery.ts";
import { PUBLIC_SITE_URL } from "../src/lib/site.ts";

const llmsPath = new URL("../public/llms.txt", import.meta.url);

const requiredApiLinks = [
  "/api/mcp",
  "/api/spese/comuni",
  "/api/spese/comuni/distribuzione",
  "/api/spese/invalidita",
  "/api/territori/fisco",
  "/api/territori/irpef",
];

const routeFiles = {
  "/api/mcp": "../src/app/api/mcp/route.ts",
  "/api/spese/comuni": "../src/app/api/spese/comuni/route.ts",
  "/api/spese/comuni/distribuzione": "../src/app/api/spese/comuni/distribuzione/route.ts",
  "/api/spese/invalidita": "../src/app/api/spese/invalidita/route.ts",
  "/api/territori/fisco": "../src/app/api/territori/fisco/route.ts",
  "/api/territori/irpef": "../src/app/api/territori/irpef/route.ts",
};

test("llms.txt is a complete, canonical static discovery surface", async () => {
  await access(llmsPath, constants.R_OK);
  assert.equal(llmsPath.pathname.endsWith("/public/llms.txt"), true);

  const text = await readFile(llmsPath, "utf8");
  assert.match(text, /^# DoveVannoINostriSoldi\n/);
  assert.match(text, /MCP Streamable HTTP/);
  assert.match(text, /list_datasets/);
  assert.match(text, /query_dataset/);
  assert.doesNotMatch(text, /localhost|127\.0\.0\.1|<dominio|\b(?:TODO|TBD)\b/i);

  const links = [...text.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((match) => new URL(match[1]));
  const requiredLinks = [...LLMS_DISCOVERY_PATHS, ...requiredApiLinks];
  assert.ok(links.length >= requiredLinks.length, "discovery file should expose the main public surfaces");
  assert.ok(links.every((link) => link.protocol === "https:"), "all links must be HTTPS");
  assert.match(text, /\/api\/mcp\): endpoint canonico pubblico e read-only/);
  assert.match(text, /\/mcp\): pagina informativa[\s\S]*`POST` e `OPTIONS` MCP[\s\S]*canonico resta `\/api\/mcp`/);

  for (const link of links) {
    if (link.origin !== PUBLIC_SITE_URL || link.pathname.startsWith("/api/")) continue;
    assert.equal(
      PUBLIC_INDEXABLE_PATHS.includes(link.pathname),
      true,
      `internal HTML link is missing from the sitemap catalog: ${link.pathname}`,
    );
  }

  for (const path of requiredLinks) {
    assert.equal(
      links.some((link) => link.origin === PUBLIC_SITE_URL && link.pathname === path),
      true,
      `missing canonical link: ${PUBLIC_SITE_URL}${path}`,
    );
    if (requiredApiLinks.includes(path)) {
      await access(new URL(routeFiles[path], import.meta.url), constants.R_OK);
    }
  }
});
