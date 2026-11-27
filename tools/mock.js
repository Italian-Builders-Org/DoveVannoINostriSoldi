(() => {
  if (window.__dvnsMock) return "already";
  window.__dvnsMock = true;
  const real = window.fetch.bind(window);
  const text = [
    "Nel 2025 i Comuni della Calabria hanno registrato **pagamenti di cassa per 3,21 miliardi di euro**, circa 1.740 € per abitante.",
    "",
    "Le voci principali:",
    "- **Spese correnti**: 2,38 mld (personale, servizi, rifiuti)",
    "- **Spese in conto capitale**: 0,61 mld (opere e manutenzioni)",
    "- **Rimborso prestiti**: 0,22 mld",
    "",
    "| Provincia | Pagamenti 2025 | € per abitante |",
    "|---|---:|---:|",
    "| Cosenza | 1,08 mld | 1.590 |",
    "| Reggio Calabria | 0,94 mld | 1.800 |",
    "| Catanzaro | 0,63 mld | 1.849 |",
    "| Crotone | 0,29 mld | 1.770 |",
    "| Vibo Valentia | 0,27 mld | 1.770 |",
    "",
    "Puoi esplorare il dettaglio per Comune in [Pagamenti dei Comuni per territorio](/territori?anno=2025&regione=Calabria) e confrontarlo con le altre regioni nella pagina [Pagamenti comunali](/spese?anno=2025).",
  ].join("\n");
  const response = {
    ok: true, kind: "ai_answer", provider: "regolo", model: "gpt-oss-120b", text,
    evidence: [
      { dataset: "siope_comuni", title: "Pagamenti dei Comuni", href: "/spese?anno=2025", sources: [
        { name: "SIOPE / SIOPE+", url: "https://www.siope.it/", period: "2025" },
        { name: "Indice PA", url: "https://www.indicepa.gov.it/", period: "2025" },
        { name: "ISTAT SITUAS", url: "https://situas.istat.it/", period: "2025" },
      ], caveat: "Sono pagamenti di cassa registrati in SIOPE: non coincidono con impegni o competenza di bilancio. Le partite di giro sono escluse." },
    ],
    siteLinks: [
      { href: "/territori?anno=2025&regione=Calabria", title: "Pagamenti dei Comuni per territorio", description: "Regioni, province e singoli Comuni a confronto" },
      { href: "/spese?anno=2025", title: "Pagamenti comunali", description: "Spesa dei Comuni per voce e per anno" },
      { href: "/enti/c_d086", title: "Scheda dell’ente", description: "Comune di Cosenza" },
    ],
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = (event) => `data: ${JSON.stringify(event)}\n\n`;
  window.__dvnsMockDelay = window.__dvnsMockDelay ?? 1;
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.pathname === "/api/assistant/quota") {
      return new Response(JSON.stringify({ available: true, remaining: 7, resetAt: new Date(Date.now() + 36e5).toISOString() }), { headers: { "content-type": "application/json" } });
    }
    if (url.pathname !== "/api/assistant/chat") return real(input, init);
    const enc = new TextEncoder();
    const d = window.__dvnsMockDelay;
    const stream = new ReadableStream({
      async start(c) {
        const send = (e) => c.enqueue(enc.encode(frame(e)));
        send({ type: "activity", activity: { id: "planning", label: "Scelgo i dati da consultare", status: "running" } });
        await sleep(600 * d);
        send({ type: "activity", activity: { id: "planning", label: "Scelgo i dati da consultare", status: "done" } });
        send({ type: "activity", activity: { id: "query-0", label: "Consulto i pagamenti dei Comuni", status: "running", resources: ["Pagamenti dei Comuni"] } });
        await sleep(900 * d);
        send({ type: "activity", activity: { id: "query-0", label: "Consulto i pagamenti dei Comuni", status: "done", resources: ["Pagamenti dei Comuni"] } });
        send({ type: "activity", activity: { id: "answer", label: "Scrivo la risposta", status: "running" } });
        for (let i = 0; i < text.length; i += 24) { send({ type: "delta", text: text.slice(i, i + 24) }); await sleep(30 * d); }
        send({ type: "activity", activity: { id: "answer", label: "Scrivo la risposta", status: "done" } });
        send({ type: "done", response });
        c.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "X-Assistant-Remaining": "6", "X-Assistant-Reset": new Date(Date.now() + 36e5).toISOString() } });
  };
  window.dispatchEvent(new Event("focus"));
  return "mocked";
})()
