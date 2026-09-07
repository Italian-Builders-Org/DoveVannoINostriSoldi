"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight02Icon, Flag02Icon } from "@hugeicons/core-free-icons";
import styles from "./report-problem.module.css";

// The dialog, its schema and its styles are downloaded only on the first
// activation: the button itself is the only interactive code every page pays for.
const ReportProblemDialog = dynamic(
  () => import("./report-problem-dialog").then((module) => module.ReportProblemDialog),
  { ssr: false },
);

type ReportProblemButtonProps = Readonly<{
  variant?: "sidebar" | "inline";
  compact?: boolean;
  onOpen?: () => void;
  restoreFocusRef?: RefObject<HTMLButtonElement | null>;
}>;

export function ReportProblemButton({ variant = "inline", compact = false, onOpen, restoreFocusRef }: ReportProblemButtonProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openDialog = useCallback(() => {
    onOpen?.();
    setMounted(true);
    setOpen(true);
  }, [onOpen]);

  const closeDialog = useCallback(() => setOpen(false), []);

  // Native dialogs restore focus themselves in most browsers; be explicit so
  // the behaviour is identical everywhere. Runs after the closed state has
  // been committed, so the trigger is guaranteed to be focusable again.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const target = restoreFocusRef?.current ?? triggerRef.current;
      const visibleTarget = target?.getClientRects().length ? target : [...document.querySelectorAll<HTMLButtonElement>('[data-report-problem-trigger="sidebar"], .mobile-menu-trigger')].find((button) => button.getClientRects().length);
      visibleTarget?.focus({ preventScroll: true });
    }
    wasOpenRef.current = open;
  }, [open, restoreFocusRef]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={variant === "sidebar" ? styles.sidebarTrigger : styles.inlineTrigger}
        data-compact={compact}
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Segnala un problema"
        title="Segnala un problema"
        data-report-problem-trigger={variant}
      >
        <HugeiconsIcon icon={Flag02Icon} size={variant === "sidebar" ? 18 : 16} strokeWidth={1.8} aria-hidden="true" />
        {variant === "sidebar" ? (
          <span className={styles.sidebarCopy}>
            <strong>Qualcosa non torna?</strong>
            <span>Aiutaci a migliorare il sito.</span>
            <span className={styles.sidebarAction}>Segnala un problema <HugeiconsIcon icon={ArrowRight02Icon} size={15} aria-hidden="true" /></span>
          </span>
        ) : (
          "Segnala un problema"
        )}
      </button>
      {/* Portalled to <body>: the inline variant lives inside <p>, which cannot contain a <dialog>. */}
      {mounted ? createPortal(<ReportProblemDialog open={open} onClose={closeDialog} />, document.body) : null}
    </>
  );
}
