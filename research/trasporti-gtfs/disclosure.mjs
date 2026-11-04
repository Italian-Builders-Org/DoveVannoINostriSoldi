const enhancedDisclosures = new WeakMap();
export function enhanceDisclosure(details) {
  if (enhancedDisclosures.has(details)) return;
  const summary = details.querySelector(":scope > summary");
  if (!summary) return;
  details.classList.add("disclosure");
  const body = document.createElement("div");
  body.className = "disclosure-body";
  for (const child of [...details.childNodes])
    if (child !== summary) body.append(child);
  details.append(body);
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  for (const [path, cls] of [
    ["M6 12h12", ""],
    ["M12 6v12", "disclosure-vertical"],
  ]) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", path);
    if (cls) line.setAttribute("class", cls);
    icon.append(line);
  }
  summary.prepend(icon);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let expanded = details.open,
    animation = null;
  const sync = () => {
    summary.setAttribute("aria-expanded", String(expanded));
    details.dataset.expanded = String(expanded);
    body.inert = !expanded;
  };
  const settle = () => {
    if (animation) {
      animation.onfinish = null;
      animation.cancel();
      animation = null;
    }
    details.open = expanded;
    details.style.height = "";
    details.style.overflow = "";
    delete details.dataset.animating;
    sync();
  };
  enhancedDisclosures.set(details, settle);
  sync();
  summary.addEventListener("click", (event) => {
    event.preventDefault();
    summary.focus({ preventScroll: true });
    const start = details.getBoundingClientRect().height;
    expanded = !expanded;
    details.dataset.instant = String(
      event.detail === 0 ||
        reduced.matches ||
        typeof details.animate !== "function",
    );
    if (details.dataset.instant === "true") {
      settle();
      return;
    }
    if (animation) {
      animation.onfinish = null;
      animation.cancel();
      animation = null;
    }
    details.style.height = "";
    details.open = true;
    const border = details.offsetHeight - details.clientHeight;
    const end =
      summary.getBoundingClientRect().height +
      (expanded ? body.getBoundingClientRect().height : 0) +
      border;
    sync();
    details.style.height = start + "px";
    details.style.overflow = "hidden";
    details.dataset.animating = "true";
    animation = details.animate(
      [{ height: start + "px" }, { height: end + "px" }],
      {
        duration: expanded ? 180 : 140,
        easing: "cubic-bezier(0.23,1,0.32,1)",
        fill: "both",
      },
    );
    animation.onfinish = settle;
  });
}

export function finishDisclosures(root = document) {
  for (const details of root.querySelectorAll(".disclosure[data-animating]"))
    enhancedDisclosures.get(details)?.();
}
