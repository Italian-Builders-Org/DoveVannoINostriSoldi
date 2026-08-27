/**
 * Live OpenBDAP integration tests reconcile the data contracts against the
 * real published series. OpenBDAP can be intermittently unreachable
 * (maintenance windows, rate limiting, transient network errors), which turns
 * a valuable live check into a flaky CI gate: a single failed request among
 * the sequential discovery+fetch chain fails the whole `node` job and blocks
 * every open PR for a reason that has nothing to do with the data contract.
 *
 * `isOpenBdapReachable` probes the lightest CKAN endpoint the live tests rely
 * on (`package_search?rows=1`) with a short, independent timeout. When the
 * probe fails the live call is skipped immediately, avoiding a multi-minute
 * timeout chain.
 *
 * `runLiveOpenBdap` wraps a live assertion body: it probes first, then runs
 * the body, and if the body throws a `SourceFetchError` (OpenBDAP answered the
 * probe but flaked during the heavy data fetch) the test is skipped instead of
 * failing. Real assertion failures propagate normally.
 */

const BDAP_ACTION = "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action";

const SKIP_REASON = "OpenBDAP non raggiungibile — test live saltato";

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

function isTransientSourceError(error) {
  if (error?.name === "SourceFetchError") return true;
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return true;
  return false;
}

/**
 * Runs a live OpenBDAP assertion. Skips the test when the source is unreachable
 * (probe or during the call); real assertion failures still propagate.
 */
export async function runLiveOpenBdap(context, body) {
  if (!(await isOpenBdapReachable())) {
    context.skip(SKIP_REASON);
    return;
  }
  try {
    return await body();
  } catch (error) {
    if (isTransientSourceError(error)) {
      context.skip(SKIP_REASON);
      return;
    }
    throw error;
  }
}
