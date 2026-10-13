"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import styles from "./boards-account-menu.module.css";

type SessionState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "user"; email: string };

function emailLabel(email: string): string {
  const local = email.split("@")[0] ?? email;
  if (local.length <= 18) return local;
  return `${local.slice(0, 16)}…`;
}

export function BoardsAccountMenu() {
  const router = useRouter();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/boards/auth/session", { credentials: "same-origin" })
      .then(async (response) => {
        const data = (await response.json()) as {
          authenticated?: boolean;
          email?: string;
        };
        if (cancelled) return;
        if (data.authenticated && typeof data.email === "string") {
          setSession({ status: "user", email: data.email });
        } else {
          setSession({ status: "guest" });
        }
      })
      .catch(() => {
        if (!cancelled) setSession({ status: "guest" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (session.status === "loading") {
    return (
      <span className={styles.placeholder} aria-hidden="true">
        …
      </span>
    );
  }

  if (session.status === "guest") {
    return (
      <Link className="header-action" href="/accedi" aria-label="Accedi alla dashboard">
        Accedi
      </Link>
    );
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`header-action ${styles.trigger}`}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {session.email.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.triggerLabel}>{emailLabel(session.email)}</span>
      </button>
      {open ? (
        <div className={styles.menu} id={menuId} role="menu" aria-label="Account">
          <p className={styles.email}>{session.email}</p>
          <Link
            role="menuitem"
            className={styles.item}
            href="/dashboard"
            onClick={() => setOpen(false)}
          >
            Apri dashboard
          </Link>
          <Link
            role="menuitem"
            className={styles.item}
            href="/dashboard/settings"
            onClick={() => setOpen(false)}
          >
            Impostazioni
          </Link>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                await fetch("/api/boards/auth/logout", { method: "POST" });
                setSession({ status: "guest" });
                setOpen(false);
                router.refresh();
              });
            }}
          >
            {pending ? "Uscita…" : "Esci"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
