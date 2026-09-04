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
 * the body, and skips only an explicit OpenBDAP outage, network error, timeout,
 * or abort. Configuration and data-contract failures propagate normally.
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

export function isTransientSourceError(error) {
  // The CSV endpoint can fail after the lightweight CKAN probe succeeds.
  // Match only its explicit transient HTTP failures, never schema/assertion errors.
  if (error instanceof Error && error.name === "Error"
    && /^OpenBDAP CSV HTTP (?:429|5\d{2})(?: per l'anno \d{4})?$/.test(error.message)) return true;
  if (error?.name === "OpenBdapUnavailableError") return true;
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return true;
  if (error?.name === "SourceFetchError") {
    return /^Errore di rete verso openbdap\b/.test(error?.message ?? "")
      || /^Impossibile interrogare la fonte openbdap\b/.test(error?.message ?? "");
  }
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
