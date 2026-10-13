"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  BOARD_CATEGORY_SUGGESTIONS,
  groupBoardsByCategory,
  type BoardMeta,
} from "@/lib/boards/board-library";
import {
  createBoardClient,
  deleteBoardClient,
  downloadJson,
  fetchBoardsCapabilities,
  listBoardsClient,
  updateBoardMetaClient,
  type BoardsCapabilities,
} from "@/lib/boards/client-store";
import styles from "./boards-home.module.css";

type Props = {
  email: string;
  userId: string;
  siteHref: string;
};

function formatUpdated(iso: string): string {
  try {
    return new Intl.DateTimeFormat("it-IT", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function BoardsHome({ email, userId, siteHref }: Props) {
  const router = useRouter();
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [caps, setCaps] = useState<BoardsCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCategory, setDraftCategory] = useState("Generale");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [pendingLogout, startLogout] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");

  const refresh = useCallback(async (options?: { clearError?: boolean }) => {
    if (options?.clearError !== false) setError(null);
    try {
      const nextCaps = await fetchBoardsCapabilities();
      setCaps(nextCaps);
      const listed = await listBoardsClient(userId);
      setBoards(listed.boards);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caricamento non riuscito.");
      setBoards([]);
    }
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextCaps = await fetchBoardsCapabilities();
        const listed = await listBoardsClient(userId);
        if (cancelled) return;
        setCaps(nextCaps);
        setBoards(listed.boards);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Caricamento non riuscito.");
        setBoards([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const groups = useMemo(() => {
    if (!boards) return [];
    const q = filter.trim().toLowerCase();
    const visible = q
      ? boards.filter(
          (board) =>
            board.title.toLowerCase().includes(q)
            || board.category.toLowerCase().includes(q),
        )
      : boards;
    return groupBoardsByCategory(visible);
  }, [boards, filter]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    try {
      const meta = await createBoardClient(userId, {
        title: draftTitle || "Nuova board",
        category: draftCategory,
      });
      setDraftTitle("");
      setDraftCategory("Generale");
      setCreating(false);
      router.push(`/dashboard/b/${meta.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione non riuscita.");
    }
  }

  function startEdit(board: BoardMeta) {
    setEditingId(board.id);
    setEditTitle(board.title);
    setEditCategory(board.category);
  }

  async function commitEdit(boardId: string) {
    try {
      await updateBoardMetaClient(userId, boardId, {
        title: editTitle,
        category: editCategory,
      });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Salvataggio non riuscito.");
    }
  }

  async function onDelete(board: BoardMeta) {
    const ok = window.confirm(`Eliminare «${board.title}»?`);
    if (!ok) return;
    try {
      await deleteBoardClient(userId, board.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eliminazione non riuscita.");
    }
  }

  function onExportAll() {
    if (!boards) return;
    downloadJson(`dvns-boards-export-${new Date().toISOString().slice(0, 10)}.json`, {
      exportedAt: new Date().toISOString(),
      storage: caps?.storage ?? "local",
      boards,
      note: "Elenco metadati. Apri ogni board e usa Esporta per la ricetta completa + provenance.",
    });
  }

  if (!boards) {
    return (
      <div className={styles.shell} data-immersive-page="boards">
        <p className={styles.loading}>Caricamento…</p>
      </div>
    );
  }

  return (
    <div className={styles.shell} data-immersive-page="boards" data-testid="boards-home">
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <a className={styles.siteLink} href={siteHref}>
            ← Sito
          </a>
          <span className={styles.brandSep} aria-hidden="true" />
          <strong className={styles.product}>DVNS Boards</strong>
        </div>
        <div className={styles.topActions}>
          <ThemeToggle />
          <Link className={styles.textBtn} href="/dashboard/settings">
            Impostazioni
          </Link>
          <button
            type="button"
            className={styles.textBtn}
            disabled={pendingLogout}
            onClick={() => {
              startLogout(async () => {
                await fetch("/api/boards/auth/logout", { method: "POST" });
                router.push("/accedi");
              });
            }}
          >
            {pendingLogout ? "Uscita…" : "Esci"}
          </button>
          <span className={styles.userChip} title={email}>
            {email}
          </span>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.toolbar}>
          <h1 className={styles.title}>Board</h1>
          <p className={styles.storageHint}>
            {caps?.storage === "cloud" ? "Sync cloud" : "Solo questo dispositivo"}
            {caps?.share ? " · share on" : ""}
          </p>
          <label className={styles.search}>
            <span className={styles.srOnly}>Cerca</span>
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filtra…"
            />
          </label>
          <button type="button" className={styles.textBtn} onClick={onExportAll}>
            Esporta lista
          </button>
          <button
            type="button"
            className={styles.newBtn}
            onClick={() => setCreating((value) => !value)}
            aria-expanded={creating}
          >
            {creating ? "Chiudi" : "Nuova"}
          </button>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {creating ? (
          <form className={styles.createRow} onSubmit={onCreate}>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="Nome"
              maxLength={120}
              autoComplete="off"
              autoFocus
              required
            />
            <input
              list="board-category-suggestions"
              value={draftCategory}
              onChange={(event) => setDraftCategory(event.target.value)}
              placeholder="Categoria"
              maxLength={48}
              autoComplete="off"
            />
            <datalist id="board-category-suggestions">
              {BOARD_CATEGORY_SUGGESTIONS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <button type="submit" className={styles.newBtn}>
              Crea
            </button>
          </form>
        ) : null}

        {boards.length === 0 ? (
          <p className={styles.empty}>Nessuna board. Premi Nuova.</p>
        ) : groups.length === 0 ? (
          <p className={styles.empty}>Nessun risultato.</p>
        ) : (
          groups.map((group) => (
            <section key={group.category} className={styles.group}>
              <h2 className={styles.groupTitle}>{group.category}</h2>
              <ul className={styles.list}>
                {group.boards.map((board) => (
                  <li key={board.id} className={styles.row}>
                    {editingId === board.id ? (
                      <form
                        className={styles.editRow}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void commitEdit(board.id);
                        }}
                      >
                        <input
                          value={editTitle}
                          onChange={(event) => setEditTitle(event.target.value)}
                          maxLength={120}
                          autoFocus
                          aria-label="Nome"
                        />
                        <input
                          list="board-category-suggestions"
                          value={editCategory}
                          onChange={(event) => setEditCategory(event.target.value)}
                          maxLength={48}
                          aria-label="Categoria"
                        />
                        <button type="submit" className={styles.textBtn}>
                          Salva
                        </button>
                        <button
                          type="button"
                          className={styles.textBtn}
                          onClick={() => setEditingId(null)}
                        >
                          Annulla
                        </button>
                      </form>
                    ) : (
                      <>
                        <Link
                          href={`/dashboard/b/${board.id}`}
                          className={styles.rowTitle}
                        >
                          {board.title}
                        </Link>
                        <time className={styles.rowMeta} dateTime={board.updatedAt}>
                          {formatUpdated(board.updatedAt)}
                        </time>
                        <div className={styles.rowActions}>
                          <Link
                            href={`/dashboard/b/${board.id}`}
                            className={styles.textBtn}
                          >
                            Apri
                          </Link>
                          <button
                            type="button"
                            className={styles.textBtn}
                            onClick={() => startEdit(board)}
                          >
                            Rinomina
                          </button>
                          <button
                            type="button"
                            className={styles.dangerText}
                            onClick={() => void onDelete(board)}
                          >
                            Elimina
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
