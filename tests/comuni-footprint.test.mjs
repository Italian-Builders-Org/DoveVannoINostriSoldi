import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const [
  {
    featuredComuni,
    footprintStatusFromIndex,
    footprintStatusLabel,
    getComuniFootprintByIpaCode,
    searchComuni,
  },
  { isComuniImmersive, immersiveKind },
] = await Promise.all([
  import("../src/lib/comuni-footprint.ts"),
  import("../src/lib/politici-immersive.ts"),
]);

test("comuni search finds Mantova and ranks exact names first", () => {
  const hits = searchComuni("mantova", 8);
  assert.ok(hits.length > 0);
  assert.equal(hits[0]?.codiceIpa, "c_e897");
  assert.match(hits[0]?.name ?? "", /MANTOVA/i);
});

test("featured comuni resolve committed SIOPE identities", () => {
  const featured = featuredComuni();
  assert.equal(featured.length, 6);
  assert.ok(featured.some((item) => item.codiceIpa === "c_h501"));
  assert.ok(featured.some((item) => item.codiceIpa === "c_a783"));
});

test("transparent distance bands never invent a risk score", () => {
  assert.equal(footprintStatusFromIndex(100), "in_linea");
  assert.equal(footprintStatusFromIndex(110), "in_linea");
  assert.equal(footprintStatusFromIndex(130), "da_osservare");
  assert.equal(footprintStatusFromIndex(70), "da_osservare");
  assert.equal(footprintStatusFromIndex(160), "notevole");
  assert.equal(footprintStatusFromIndex(40), "notevole");
  assert.equal(footprintStatusFromIndex(null), "non_disponibile");
});

test("status labels say higher or lower vs the peer median, not vague distance", () => {
  assert.equal(footprintStatusLabel(100), "In linea");
  assert.equal(footprintStatusLabel(110), "In linea");
  assert.equal(footprintStatusLabel(130), "Più alti");
  assert.equal(footprintStatusLabel(160), "Molto più alti");
  assert.equal(footprintStatusLabel(70), "Più bassi");
  assert.equal(footprintStatusLabel(40), "Molto più bassi");
  assert.equal(footprintStatusLabel(null), "n.d.");
});

test("Mantova footprint exposes indexed indicators against peer median", async () => {
  const footprint = await getComuniFootprintByIpaCode("c_e897");
  assert.ok(footprint);
  assert.equal(footprint.displayName, "Mantova");
  assert.ok(footprint.peer);
  assert.ok(footprint.peer.peers >= 10);
  assert.ok(footprint.peer.taxCodes.length === footprint.peer.peers);
  assert.ok(footprint.indicators.length >= 6);
  const payments = footprint.indicators.find((item) => item.id === "payments-per-capita");
  assert.ok(payments);
  assert.ok(payments.index !== null);
  assert.ok(payments.meaning.includes("pagamenti"));
  const passThrough = footprint.indicators.find((item) => item.id === "passthrough-share");
  assert.ok(passThrough?.meaning.includes("conto di terzi") || passThrough?.meaning.includes("partite di giro"));
  const vsStandard = footprint.indicators.find((item) => item.id === "opencivitas-vs-standard");
  assert.ok(vsStandard?.meaning.includes("OpenCivitas") || vsStandard?.meaning.includes("standard"));
  assert.equal(footprint.indicators.some((item) => item.id === "irpef-taxpayers"), false);
  assert.ok(footprint.receiptsPerCapitaCents !== null);
  assert.equal(footprint.entityHref, "/enti/c_e897");
  assert.equal(footprint.appaltiHref, "/enti/c_e897/appalti");
  assert.ok(footprint.irpefIncomeBands?.length === 8);
  assert.ok(footprint.irpefIncomeBands.some((band) => band.frequency !== null && band.frequency > 0));
  assert.equal(footprint.schoolServices.status, "available");
  assert.ok(footprint.pnrr.localizedRegistrations !== null && footprint.pnrr.localizedRegistrations > 0);
  assert.equal(footprint.pnrr.sampleProjects.length, 0);
  assert.match(footprint.pnrr.projectsHref, /^\/pnrr\?territory=/);
  assert.ok(footprint.anac.status === "available" || footprint.anac.status === "unavailable");
});

test("Caserta footprint surfaces national PNRR localization even without childcare attuatore rows", async () => {
  const footprint = await getComuniFootprintByIpaCode("c_b963");
  assert.ok(footprint);
  assert.equal(footprint.displayName, "Caserta");
  assert.ok(footprint.pnrr.localizedRegistrations !== null && footprint.pnrr.localizedRegistrations > 0);
  assert.equal(footprint.pnrr.sampleProjects.length, 0);
  assert.equal(footprint.pnrrChildcare.data.totalProjects, 0);
  assert.ok(footprint.irpef.status === "available");
  assert.ok(footprint.irpefIncomeBands?.length === 8);
});

test("Milano falls back to large-city peer group instead of staying unmatched", async () => {
  const footprint = await getComuniFootprintByIpaCode("c_f205");
  assert.ok(footprint);
  assert.ok(footprint.peer, "grandi città must form a peer set");
  assert.match(footprint.peer.criteria.join(" "), /grandi città|fascia di popolazione/i);
  assert.ok(footprint.peer.peers >= 5);
  const payments = footprint.indicators.find((item) => item.id === "payments-per-capita");
  assert.ok(payments?.index !== null);
});

test("comuni immersive helpers recognise path and subdomain", () => {
  assert.equal(isComuniImmersive("/comuni", "www.dovevannoinostrisoldi.com"), true);
  assert.equal(isComuniImmersive("/", "comuni.dovevannoinostrisoldi.com"), true);
  assert.equal(isComuniImmersive("/", "www.dovevannoinostrisoldi.com"), false);
  assert.equal(immersiveKind("/politici", "localhost"), "politici");
  assert.equal(immersiveKind("/comuni", "localhost"), "comuni");
  assert.equal(immersiveKind("/snapshot-pages/comuni/c_f205", "localhost"), "comuni");
  assert.equal(immersiveKind("/enti", "localhost"), null);
});

test("bare /comuni defaults to Mantova so the radar is visible immediately", async () => {
  const { DEFAULT_COMUNI_IPA, getComuniFootprintByIpaCode } = await import("../src/lib/comuni-footprint.ts");
  assert.equal(DEFAULT_COMUNI_IPA, "c_e897");
  const footprint = await getComuniFootprintByIpaCode(DEFAULT_COMUNI_IPA);
  assert.ok(footprint);
  assert.equal(footprint.displayName, "Mantova");
  assert.ok(footprint.indicators.some((item) => item.index !== null));
});
