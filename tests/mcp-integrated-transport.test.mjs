import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");
const { PUBLIC_SITE_URL } = await import("../src/lib/site.ts");

function hosted(t) {
  const before = process.env.VERCEL;
  process.env.VERCEL = "1";
  t.after(() => { if (before === undefined) delete process.env.VERCEL; else process.env.VERCEL = before; });
}

test("MCP hosted uses the real corpus API contract for old/new data, filters and release cursors", async (t) => {
  hosted(t);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, PUBLIC_SITE_URL);
    assert.equal(options.redirect, "error");
    assert.equal(new Headers(options.headers).has("authorization"), false);
    assert.equal(new Headers(options.headers).has("cookie"), false);
    requests.push(url);
    return GET(new Request(url, { signal: options.signal }), {
      params: Promise.resolve({ dataset: url.pathname.split("/").at(-1) }),
    });
  });
  for (const [code, count] of [["arera-entrate-2024-2025",54],["arera-spese-2024-2025",6],["ade-cinque-per-mille-territori-2024",22],["consulenze-legali",1]]) {
    const limit = code === "consulenze-legali" ? 1 : 100;
    const result = await queryPublicDataset({ dataset:"spesa_pa_dettaglio",code,limit });
    assert.equal(result.dataset.id, code);
    assert.equal(result.rows.length, count);
    const actual = await GET(new Request(`${PUBLIC_SITE_URL}/api/dati/${code}?limit=${limit}`),{params:Promise.resolve({dataset:code})});
    assert.deepEqual(result,await actual.json());
  }
  const code="arera-entrate-2024-2025";
  const first=await queryPublicDataset({dataset:"spesa_pa_dettaglio",code,query:"E.1.01.01.99",limit:2});
  const next=await queryPublicDataset({dataset:"spesa_pa_dettaglio",code,query:"E.1.01.01.99",limit:2,cursor:first.pagination.nextCursor});
  assert.equal(new Set([...first.rows,...next.rows].map(row=>row.id)).size,4);
  await queryPublicDataset({dataset:"spesa_pa_dettaglio",code,query:"a&limit=100#?",limit:1});
  assert.equal(requests.at(-1).searchParams.get("q"),"a&limit=100#?");
  assert.equal(requests.at(-1).searchParams.getAll("limit").length,1);
  const beds=await queryPublicDataset({dataset:"salute_posti_letto",limit:1});
  assert.equal(beds.rows.length,1);
  assert.equal(requests.at(-1).pathname,"/api/dati/salute-posti-letto-2023");
  assert.equal(requests.length,8);
});

test("MCP rejects unsafe corpus IDs and aborts before dispatch", async (t) => {
  hosted(t);
  const fetch=t.mock.method(globalThis,"fetch",()=>{throw new Error("unexpected fetch");});
  for(const code of ["../consulenze-legali","//evil.example/path","https://evil.example"]) {
    await assert.rejects(queryPublicDataset({dataset:"spesa_pa_dettaglio",code}),/dataset|identificativo/i);
  }
  const signal=AbortSignal.abort(new Error("client cancelled"));
  await assert.rejects(queryPublicDataset({dataset:"spesa_pa_dettaglio",code:"consulenze-legali"},{signal}),/client cancelled/);
  assert.equal(fetch.mock.callCount(),0);
});

test("MCP hosted rejects unavailable, malformed, mismatched and oversized upstream responses", async (t) => {
  hosted(t);
  const code="consulenze-legali";
  const query={dataset:"spesa_pa_dettaglio",code,limit:1};
  let response;
  t.mock.method(globalThis,"fetch",async()=>response);
  for(const status of [400,404,429,503]) {
    response=Response.json({error:"errore di controllo"},{status});
    await assert.rejects(queryPublicDataset(query),new RegExp(`${status}.*errore di controllo`));
  }
  response=new Response("not JSON");
  await assert.rejects(queryPublicDataset(query),/JSON|json/);
  response=Response.json({dataset:{id:"wrong"},rows:[],pagination:{returned:0,exhausted:true}});
  await assert.rejects(queryPublicDataset(query),/contratto|dataset/i);
  let cancelled=false;
  response=new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(751000));},cancel(){cancelled=true;}}));
  await assert.rejects(queryPublicDataset(query),/dimensione|budget|grande/i);
  assert.equal(cancelled,true);
});

test("MCP hosted forwards abort and does not retry failed network calls", async (t) => {
  hosted(t);
  const controller=new AbortController();
  const fetch=t.mock.method(globalThis,"fetch",async(_url,options)=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true});
    controller.abort(new Error("cancelled during fetch"));
  }));
  await assert.rejects(queryPublicDataset({dataset:"spesa_pa_dettaglio",code:"consulenze-legali"},{signal:controller.signal}),/cancelled during fetch/);
  assert.equal(fetch.mock.callCount(),1);
});
