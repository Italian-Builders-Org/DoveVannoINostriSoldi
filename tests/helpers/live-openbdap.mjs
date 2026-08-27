/**
 * Live OpenBDAP integration tests reconcile the data contracts against the
 * real published series. OpenBDAP can be intermittently unreachable
 * (maintenance windows, rate limiting, transient network errors), which turns
 * a valuable live check into a flaky CI gate: a single failed request among
 * the sequential discovery+fetch chain fails the whole `node` job and blocks
 * every open PR for a reason that has nothing to do with the data contract.
 *
 * `isOpenBdapReachable` probes the lightest CKAN endpoint the live tests rely
 * on (`package_search?rows=1`) with a short, independent timeout. The live
 * tests call it at the top of their body and `context.skip()` when it returns
 * false, so an outage is reported as a skip instead of a failure.
 */

const BDAP_ACTION = "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action";

export async function isOpenBdapReachable({ timeoutMs = 8_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${BDAP_ACTION}/package_search?rows=1`,
      { method: "GET", signal: controller.signal, redirect: "error" },
    );
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
