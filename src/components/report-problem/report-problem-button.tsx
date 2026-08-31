"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { Flag02Icon } from "@hugeicons/core-free-icons";
import styles from "./report-problem.module.css";

// The dialog, its schema and its styles are downloaded only on the first
// activation: the button itself is the only interactive code every page pays for.
const ReportProblemDialog = dynamic(
  () => import("./report-problem-dialog").then((module) => module.ReportProblemDialog),
  { ssr: false },
);

type ReportProblemButtonProps = Readonly<{
  /** `floating` is the global control; `inline` is a plain text button for footers and pages. */
  variant?: "floating" | "inline";
}>;

export function ReportProblemButton({ variant = "floating" }: ReportProblemButtonProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openDialog = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => setOpen(false), []);

  // Native dialogs restore focus themselves in most browsers; be explicit so
  // the behaviour is identical everywhere. Runs after the closed state has
  // been committed, so the trigger is guaranteed to be focusable again.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={variant === "floating" ? styles.floatingTrigger : styles.inlineTrigger}
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Segnala un problema"
        title="Segnala un problema"
        data-report-problem-trigger={variant}
      >
        <HugeiconsIcon icon={Flag02Icon} size={variant === "floating" ? 18 : 16} strokeWidth={1.8} aria-hidden="true" />
        {variant === "floating" ? (
          <span className={styles.visuallyHidden}>Segnala un problema</span>
        ) : (
          "Segnala un problema"
        )}
      </button>
      {/* Portalled to <body>: the inline variant lives inside <p>, which cannot contain a <dialog>. */}
      {mounted ? createPortal(<ReportProblemDialog open={open} onClose={closeDialog} />, document.body) : null}
    </>
  );
}
