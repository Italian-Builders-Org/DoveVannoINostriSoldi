const STABLE_FOR_MS = 100;
const MIN_STABLE_FRAMES = 2;

/**
 * Wait until a mobile primary-navigation target can be tapped at a stable point.
 * The caller must read boundingBox() after this wait and immediately use those
 * coordinates for the input event; this helper deliberately does not sleep
 * without checking the target and its scroll-container geometry.
 */
export async function waitForStableNavigationTouchTarget(page, element, { timeout = 3_000 } = {}) {
  await page.waitForFunction(
    async (candidate, stability) => {
      const sameSnapshot = (first, second) => {
        if (!first || !second) return false;
        return [
          "x",
          "y",
          "width",
          "height",
          "navigationX",
          "navigationWidth",
          "navigationClientWidth",
          "navigationScrollWidth",
          "scrollLeft",
        ].every((key) => Math.abs(first[key] - second[key]) <= 0.25);
      };

      const readSnapshot = () => {
        if (!candidate.isConnected) return null;

        const rect = candidate.getBoundingClientRect();
        const navigation = candidate.closest(".primary-nav");
        const navigationRect = navigation?.getBoundingClientRect();
        const style = window.getComputedStyle(candidate);
        if (
          !navigation ||
          !navigationRect ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.pointerEvents === "none"
        ) {
          return null;
        }

        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        if (!hit || (hit !== candidate && !candidate.contains(hit))) return null;

        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          navigationX: navigationRect.x,
          navigationWidth: navigationRect.width,
          navigationClientWidth: navigation.clientWidth,
          navigationScrollWidth: navigation.scrollWidth,
          scrollLeft: navigation.scrollLeft,
        };
      };

      let previous = readSnapshot();
      if (!previous) return false;

      const stableSince = performance.now();
      let stableFrames = 0;
      while (
        stableFrames < stability.minStableFrames ||
        performance.now() - stableSince < stability.stableForMs
      ) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        const current = readSnapshot();
        if (!sameSnapshot(previous, current)) return false;
        previous = current;
        stableFrames += 1;
      }

      return true;
    },
    { timeout },
    element,
    { stableForMs: STABLE_FOR_MS, minStableFrames: MIN_STABLE_FRAMES },
  );
}
