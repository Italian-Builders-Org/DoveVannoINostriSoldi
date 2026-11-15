import { normalizeText } from "./explorer.mjs";
// Native selects remain the data boundary and the fallback without enhancement.
const selectMenus = new Map();
let openSelectMenu = null;
export function closeSelectMenu(restore = false) {
  const menu = openSelectMenu;
  if (!menu) return;
  openSelectMenu = null;
  menu.popup.remove();
  menu.trigger.setAttribute("aria-expanded", "false");
  menu.trigger.removeAttribute("aria-activedescendant");
  if (restore && !menu.trigger.disabled)
    menu.trigger.focus({ preventScroll: true });
}
export function syncSelectMenus() {
  for (const menu of selectMenus.values()) menu.sync();
}
function positionSelectMenu() {
  const menu = openSelectMenu;
  if (!menu) return;
  const rect = menu.trigger.getBoundingClientRect(),
    viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0,
    top = viewport?.offsetTop || 0;
  const width = viewport?.width || innerWidth,
    height = viewport?.height || innerHeight;
  const availableBelow = top + height - rect.bottom - 8,
    availableAbove = rect.top - top - 8;
  const above = availableBelow < 180 && availableAbove > availableBelow;
  const room = Math.max(
    80,
    Math.min(360, above ? availableAbove : availableBelow),
  );
  Object.assign(menu.popup.style, {
    width:
      Math.min(
        Math.max(rect.width, menu.select.id === "route" ? 310 : 260),
        width - 16,
      ) + "px",
    maxHeight: room + "px",
    left:
      Math.max(
        left + 8,
        Math.min(
          rect.left,
          left +
            width -
            8 -
            Math.min(
              Math.max(rect.width, menu.select.id === "route" ? 310 : 260),
              width - 16,
            ),
        ),
      ) + "px",
    top:
      (above
        ? Math.max(
            top + 8,
            rect.top - 8 - Math.min(room, menu.popup.scrollHeight),
          )
        : rect.bottom + 6) + "px",
  });
  menu.popup.dataset.side = above ? "above" : "below";
}
function leaveSelectMenu(backward) {
  const menu = openSelectMenu;
  const focusable = [
    ...document.querySelectorAll(
      "button,input,select,a[href],summary,canvas[tabindex]",
    ),
  ].filter(
    (el) =>
      !el.disabled &&
      el.tabIndex >= 0 &&
      el.getClientRects().length &&
      !menu.popup.contains(el),
  );
  const next = focusable[focusable.indexOf(menu.trigger) + (backward ? -1 : 1)];
  closeSelectMenu();
  (next || menu.trigger).focus({ preventScroll: true });
}
export function enhanceSelect(select, beforeOpen = () => {}) {
  if (selectMenus.has(select)) return;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select-trigger";
  trigger.id = select.id + "-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute(
    "aria-label",
    select.getAttribute("aria-label") || select.id,
  );
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", select.id + "-options");
  const text = document.createElement("span");
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  arrow.setAttribute("viewBox", "0 0 24 24");
  arrow.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m7 10 5 5 5-5");
  arrow.append(path);
  trigger.append(text, arrow);
  select.after(trigger);
  select.hidden = true;
  select.labels?.[0]?.setAttribute("for", trigger.id);
  select.parentElement.classList.add("select-enhanced");
  let signature = "";
  const menu = {
    select,
    trigger,
    popup: null,
    sync() {
      const options = [...select.options];
      const next = JSON.stringify([
        select.disabled,
        select.value,
        options.map((o) => [
          o.value,
          o.textContent,
          o.disabled,
          o.dataset.subtitle,
        ]),
      ]);
      if (next !== signature && openSelectMenu === menu) closeSelectMenu();
      signature = next;
      trigger.disabled = select.disabled;
      text.textContent =
        select.selectedOptions[0]?.textContent || "Nessuna opzione";
      trigger.title = text.textContent;
    },
  };
  selectMenus.set(select, menu);
  menu.sync();
  const open = (event, firstQuery = "") => {
    if (trigger.disabled) return;
    if (openSelectMenu === menu) {
      closeSelectMenu(true);
      return;
    }
    closeSelectMenu();
    beforeOpen();
    const popup = document.createElement("div");
    popup.className = "select-popup";
    const list = document.createElement("div");
    list.className = "select-options";
    list.id = select.id + "-options";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", trigger.getAttribute("aria-label"));
    const empty = document.createElement("p");
    empty.className = "select-empty";
    empty.textContent = "Nessun risultato";
    empty.setAttribute("role", "status");
    const options = [...select.options],
      searchable = options.length > 7;
    let input = null,
      visible = [],
      current = -1;
    const activate = (index, focus = false) => {
      if (!visible.length) return;
      current = Math.max(0, Math.min(index, visible.length - 1));
      for (const [i, node] of visible.entries())
        node.dataset.active = String(i === current);
      trigger.setAttribute("aria-activedescendant", visible[current].id);
      const itemTop = visible[current].offsetTop - list.offsetTop;
      const itemBottom = itemTop + visible[current].offsetHeight;
      if (itemTop < list.scrollTop) list.scrollTop = itemTop;
      else if (itemBottom > list.scrollTop + list.clientHeight)
        list.scrollTop = itemBottom - list.clientHeight;
      if (focus) visible[current].focus({ preventScroll: true });
    };
    const render = (query) => {
      const tokens = normalizeText(query).split(" ").filter(Boolean);
      list.replaceChildren();
      visible = [];
      for (const [i, option] of options.entries()) {
        const subtitle = option.dataset.subtitle || "";
        const search = normalizeText(option.textContent + " " + subtitle);
        if (!tokens.every((token) => search.includes(token))) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "select-option";
        button.id = select.id + "-option-" + i;
        button.tabIndex = -1;
        button.disabled = option.disabled;
        button.setAttribute("role", "option");
        button.setAttribute(
          "aria-selected",
          String(option.value === select.value),
        );
        const copy = document.createElement("span");
        copy.className = "option-copy";
        const label = document.createElement("span");
        label.textContent = option.textContent;
        copy.append(label);
        if (subtitle) {
          const small = document.createElement("small");
          small.textContent = subtitle;
          copy.append(small);
        }
        const check = document.createElement("span");
        check.className = "option-check";
        check.textContent = "✓";
        check.setAttribute("aria-hidden", "true");
        button.append(copy, check);
        list.append(button);
        if (!option.disabled) visible.push(button);
        button.addEventListener("click", () => {
          select.value = option.value;
          closeSelectMenu(true);
          select.dispatchEvent(new Event("change", { bubbles: true }));
          syncSelectMenus();
        });
      }
      empty.hidden = visible.length > 0;
      current = -1;
      const selected = visible.findIndex(
        (node) => node.getAttribute("aria-selected") === "true",
      );
      positionSelectMenu();
      if (visible.length) activate(selected < 0 ? 0 : selected);
    };
    if (searchable) {
      const field = document.createElement("div");
      field.className = "select-filter";
      input = document.createElement("input");
      input.type = "search";
      input.autocomplete = "off";
      input.placeholder = "Cerca…";
      input.setAttribute(
        "aria-label",
        "Filtra " + trigger.getAttribute("aria-label").toLocaleLowerCase("it"),
      );
      input.setAttribute("aria-controls", list.id);
      input.maxLength = 80;
      input.value = firstQuery;
      field.append(input);
      popup.append(field);
      input.addEventListener("input", () => render(input.value));
    }
    popup.append(list, empty);
    menu.popup = popup;
    document.body.append(popup);
    openSelectMenu = menu;
    trigger.setAttribute("aria-expanded", "true");
    render(firstQuery);
    if (input) input.focus({ preventScroll: true });
    else activate(Math.max(0, current), true);
    popup.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSelectMenu(true);
      } else if (event.key === "Tab") {
        event.preventDefault();
        leaveSelectMenu(event.shiftKey);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        if (
          (event.key === "Home" || event.key === "End") &&
          event.target === input
        )
          return;
        event.preventDefault();
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? visible.length - 1
              : current + (event.key === "ArrowDown" ? 1 : -1);
        activate(index, true);
      } else if (event.key === "Enter" && event.target === input) {
        event.preventDefault();
        visible[current]?.click();
      } else if (
        event.key.length === 1 &&
        event.target !== input &&
        input &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        input.focus();
        input.value = event.key;
        render(input.value);
      }
    });
    if (
      event.detail > 0 &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      popup.animate
    )
      popup.animate(
        [
          {
            opacity: 0,
            transform:
              "translateY(" +
              (popup.dataset.side === "above" ? "3" : "-3") +
              "px)",
          },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 130, easing: "cubic-bezier(0.23,1,0.32,1)" },
      );
  };
  trigger.addEventListener("click", open);
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      open(event);
    } else if (event.key === "Escape") closeSelectMenu(true);
    else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      open(event, event.key);
    }
  });
  select.addEventListener("change", () => menu.sync());
}
document.addEventListener("pointerdown", (event) => {
  if (
    openSelectMenu &&
    !openSelectMenu.popup.contains(event.target) &&
    !openSelectMenu.trigger.contains(event.target)
  )
    closeSelectMenu();
});
document.addEventListener("focusin", (event) => {
  if (
    openSelectMenu &&
    !openSelectMenu.popup.contains(event.target) &&
    !openSelectMenu.trigger.contains(event.target)
  )
    closeSelectMenu();
});
window.addEventListener("resize", positionSelectMenu);
window.visualViewport?.addEventListener("resize", positionSelectMenu);
window.visualViewport?.addEventListener("scroll", positionSelectMenu);
window.addEventListener(
  "scroll",
  (event) => {
    if (openSelectMenu && !openSelectMenu.popup.contains(event.target))
      closeSelectMenu();
  },
  { capture: true, passive: true },
);
