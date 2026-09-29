"use client";

import type { MouseEvent } from "react";
import styles from "./comuni.module.css";

const SEARCH_INPUT_ID = "comuni-search";

export function ChangeComuneButton() {
  function focusSearch(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (!(input instanceof HTMLInputElement)) return;

    window.setTimeout(() => {
      input.scrollIntoView({ behavior: "smooth", block: "nearest" });
      input.focus();
      input.select();
    }, 0);
  }

  return (
    <button
      type="button"
      className={`btn btn-secondary ${styles.changeComune}`}
      onClick={focusSearch}
    >
      Cambia Comune
    </button>
  );
}
