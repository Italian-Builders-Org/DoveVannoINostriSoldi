"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  plainTextFromHtml,
  sanitizeBoardHtml,
} from "@/lib/boards/board-html";
import styles from "./board-rich-text.module.css";

type Props = {
  html: string;
  active: boolean;
  placeholder?: string;
  minHeight?: number;
  onChange: (next: { html: string; title: string }) => void;
  onFitHeight?: (height: number) => void;
  onDone?: () => void;
};

const FONT_SIZES = [
  { label: "S", value: "0.85rem" },
  { label: "M", value: "1rem" },
  { label: "L", value: "1.25rem" },
  { label: "XL", value: "1.6rem" },
] as const;

const FONTS = [
  { label: "Sans", value: "var(--font-geist), system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, SFMono-Regular, Menlo, monospace" },
] as const;

const BODY_PAD_Y = 20;
const TOOLBAR_GAP = 8;

function runCommand(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function applyFontSize(editor: HTMLDivElement, size: string) {
  editor.focus();
  runCommand("fontSize", "7");
  editor.querySelectorAll('font[size="7"]').forEach((node) => {
    const span = document.createElement("span");
    span.style.fontSize = size;
    span.innerHTML = node.innerHTML;
    node.replaceWith(span);
  });
}

export function BoardRichText({
  html,
  active,
  placeholder,
  minHeight = 48,
  onChange,
  onFitHeight,
  onDone,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastHtml = useRef(html);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);

  function measureAndFit() {
    const el = editorRef.current;
    if (!el || !onFitHeight) return;
    const next = Math.max(minHeight, Math.ceil(el.scrollHeight) + BODY_PAD_Y);
    onFitHeight(next);
  }

  function placeToolbar() {
    const root = rootRef.current;
    if (!root || !active) {
      setToolbarPos(null);
      return;
    }
    const rect = root.getBoundingClientRect();
    setToolbarPos({
      top: Math.max(8, rect.top - TOOLBAR_GAP),
      left: rect.left,
    });
  }

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.innerHTML !== html) {
      el.innerHTML = html || "";
      lastHtml.current = html;
    }
  }, [html]);

  useLayoutEffect(() => {
    measureAndFit();
    placeToolbar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measure on activate/html
  }, [active, html]);

  useEffect(() => {
    if (!active) return;
    function onReposition() {
      placeToolbar();
    }
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    // cursore in coda
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [active]);

  function commit() {
    const el = editorRef.current;
    if (!el) return;
    const nextHtml = sanitizeBoardHtml(el.innerHTML);
    if (nextHtml !== lastHtml.current) {
      lastHtml.current = nextHtml;
      onChange({ html: nextHtml, title: plainTextFromHtml(nextHtml) });
    }
    measureAndFit();
  }

  function format(command: string, value?: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    runCommand(command, value);
    commit();
  }

  function finish() {
    commit();
    measureAndFit();
    onDone?.();
  }

  const toolbar =
    active && toolbarPos && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.popover}
            role="toolbar"
            aria-label="Formattazione testo"
            style={{ top: toolbarPos.top, left: toolbarPos.left, transform: "translateY(-100%)" }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" className={styles.toolBtn} onClick={() => format("bold")} title="Grassetto">
              <strong>B</strong>
            </button>
            <button type="button" className={styles.toolBtn} onClick={() => format("italic")} title="Corsivo">
              <em>I</em>
            </button>
            <button type="button" className={styles.toolBtn} onClick={() => format("underline")} title="Sottolineato">
              <span className={styles.underline}>U</span>
            </button>
            <span className={styles.sep} aria-hidden="true" />
            {FONT_SIZES.map((size) => (
              <button
                key={size.value}
                type="button"
                className={styles.toolBtn}
                title={`Dimensione ${size.label}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  const el = editorRef.current;
                  if (!el) return;
                  applyFontSize(el, size.value);
                  commit();
                }}
              >
                {size.label}
              </button>
            ))}
            <span className={styles.sep} aria-hidden="true" />
            <label className={styles.colorLabel} title="Colore testo">
              <span className={styles.srOnly}>Colore</span>
              <input
                type="color"
                defaultValue="#182b3a"
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => format("foreColor", event.target.value)}
              />
            </label>
            <select
              className={styles.fontSelect}
              aria-label="Font"
              defaultValue=""
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                format("fontName", value);
                event.target.value = "";
              }}
            >
              <option value="" disabled>
                Font
              </option>
              {FONTS.map((font) => (
                <option key={font.label} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
            <span className={styles.sep} aria-hidden="true" />
            <button type="button" className={styles.doneBtn} onClick={finish}>
              Fatto
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={styles.root} data-active={active ? "true" : undefined}>
      {toolbar}
      <div
        ref={(el) => {
          editorRef.current = el;
          if (el && el.dataset.seeded !== "1") {
            el.innerHTML = html || "";
            el.dataset.seeded = "1";
            lastHtml.current = html;
          }
        }}
        className={styles.editor}
        contentEditable={active}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "Scrivi…"}
        role="textbox"
        aria-multiline="true"
        aria-label="Testo"
        onPointerDown={(event) => {
          if (active) event.stopPropagation();
        }}
        onInput={() => commit()}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && document.body.contains(next)) {
            const popover = document.querySelector(`.${styles.popover}`);
            if (popover?.contains(next)) return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            finish();
          }
        }}
      />
    </div>
  );
}
