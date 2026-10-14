"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent as ReactChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BOARD_TILE_VIEWS,
  assertBoardDocument,
  type BoardDocument,
  type BoardTile,
  type BoardTileView,
} from "@/lib/data/boards-document";
import {
  BOARD_TOOL_PRESETS,
  clampBoardTileFrames,
  createDataTile,
  createLocalTile,
  createToolTile,
  moveTileFrame,
  resizeTileFrame,
  type BoardToolId,
} from "@/lib/boards/local-board";
import {
  boardRegionOptionsForDataset,
} from "@/lib/boards/board-region";
import {
  BOARD_DATASET_CATEGORIES,
  type BoardDatasetCategoryId,
} from "@/lib/boards/tile-categories";
import {
  buildLocalTableFromCsv,
  LOCAL_CSV_MAX_BYTES,
} from "@/lib/boards/local-csv";
import type { BoardTileCatalogEntry } from "@/lib/boards/tile-catalog";
import {
  createShareClient,
  downloadJson,
  downloadText,
  fetchBoardsCapabilities,
  loadBoardClient,
  saveBoardClient,
  type BoardsCapabilities,
} from "@/lib/boards/client-store";
import { ensureBoardHtml } from "@/lib/boards/board-html";
import { ThemeToggle } from "@/components/theme-toggle";
import { BoardRichText } from "./board-rich-text";
import { BoardLocalTileChart, BoardTileChart } from "./board-tile-chart";
import {
  IconExportCsv,
  IconExportJson,
  IconImport,
  IconLogout,
  IconPanel,
  IconSettings,
  IconShare,
} from "./board-toolbar-icons";
import styles from "./board-studio.module.css";

type Props = {
  userId: string;
  boardId: string;
  siteHref: string;
  catalog: readonly BoardTileCatalogEntry[];
};

type DragState = {
  mode: "move" | "resize";
  tileId: string;
  startX: number;
  startY: number;
  origin: { x: number; y: number; w: number; h: number };
};

const VIEW_LABEL: Record<BoardTileView, string> = {
  kpi: "KPI",
  table: "Tabella",
  line: "Serie",
  bar: "Barre",
};

const FILTER_LABEL: Record<string, string> = {
  code: "Codice ente / amministrazione",
  year: "Anno",
  month: "Mese (1-12)",
  region: "Regione",
  cup: "CUP",
  territory: "Territorio",
  channel: "Canale",
  country: "Paese",
  cofog: "COFOG",
};

const YEAR_OPTIONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
const FRAME_MIN_W = 160;
const FRAME_MIN_H = 120;
export function BoardStudio({ userId, boardId, siteHref, catalog }: Props) {
  const router = useRouter();
  const [document, setDocument] = useState<BoardDocument | null>(null);
  const [missing, setMissing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "featured" | BoardDatasetCategoryId>("all");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"tools" | "data">("tools");
  const [pendingLogout, startLogout] = useTransition();
  const [canvasDropActive, setCanvasDropActive] = useState(false);
  const [caps, setCaps] = useState<BoardsCapabilities | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<"problema" | "feedback" | "idea">("problema");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextCaps = await fetchBoardsCapabilities();
        if (!cancelled) setCaps(nextCaps);
        const loaded = await loadBoardClient(userId, boardId);
        if (cancelled) return;
        if (!loaded) {
          setMissing(true);
          setDocument(null);
          return;
        }
        setMissing(false);
        setDocument(clampBoardTileFrames(loaded));
      } catch {
        if (!cancelled) {
          setMissing(true);
          setDocument(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, boardId]);

  useEffect(() => {
    if (!document) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveBoardClient(userId, boardId, document).catch((error) => {
        setActionError(error instanceof Error ? error.message : "Salvataggio non riuscito.");
      });
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [document, userId, boardId]);

  useEffect(() => {
    if (!shareUrl || actionError) return;
    const timer = window.setTimeout(() => {
      setShareUrl(null);
      setShareCopied(false);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [shareUrl, actionError]);

  useEffect(() => {
    if (!feedbackNotice) return;
    const timer = window.setTimeout(() => setFeedbackNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [feedbackNotice]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((entry) => {
      if (categoryFilter === "featured" && !entry.featured) return false;
      if (
        categoryFilter !== "all"
        && categoryFilter !== "featured"
        && entry.category !== categoryFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        entry.label.toLowerCase().includes(q)
        || entry.id.includes(q)
        || entry.blurb.toLowerCase().includes(q)
        || entry.category.includes(q)
      );
    });
  }, [catalog, query, categoryFilter]);

  const catalogGroups = useMemo(() => {
    if (categoryFilter !== "all" || query.trim()) {
      return [{ id: "filtered", label: null as string | null, entries: filteredCatalog }];
    }
    const groups: { id: string; label: string | null; entries: typeof filteredCatalog }[] = [];
    const featured = filteredCatalog.filter((entry) => entry.featured);
    if (featured.length > 0) {
      groups.push({ id: "featured", label: "In evidenza", entries: featured });
    }
    for (const category of BOARD_DATASET_CATEGORIES) {
      const entries = filteredCatalog.filter(
        (entry) => entry.category === category.id && !entry.featured,
      );
      if (entries.length === 0) continue;
      groups.push({ id: category.id, label: category.label, entries });
    }
    // Featured already listed under "In evidenza"; also show non-featured leftovers
    // already handled. If a featured item's category has only featured items, skip empty.
    const leftovers = filteredCatalog.filter(
      (entry) =>
        !entry.featured
        && !BOARD_DATASET_CATEGORIES.some((category) => category.id === entry.category),
    );
    if (leftovers.length > 0) {
      groups.push({ id: "extra", label: "Altro", entries: leftovers });
    }
    return groups;
  }, [filteredCatalog, categoryFilter, query]);

  const selected = document?.tiles.find((tile) => tile.id === selectedId) ?? null;

  async function submitFeedback() {
    setFeedbackBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/boards/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: feedbackKind,
          message: feedbackMessage,
          boardId,
          pageUrl: window.location.href,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Invio non riuscito.");
      }
      setFeedbackOpen(false);
      setFeedbackMessage("");
      setFeedbackKind("problema");
      setFeedbackNotice("Segnalazione inviata. Grazie.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Invio non riuscito.");
    } finally {
      setFeedbackBusy(false);
    }
  }

  function updateTiles(updater: (tiles: BoardTile[]) => BoardTile[]) {
    setDocument((current) => {
      if (!current) return current;
      return { ...current, tiles: updater(current.tiles) };
    });
  }

  function patchSelected(patch: Partial<BoardTile>) {
    if (!selectedId) return;
    updateTiles((tiles) =>
      tiles.map((tile) => (tile.id === selectedId ? { ...tile, ...patch } : tile)),
    );
  }

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    updateTiles((tiles) => tiles.filter((tile) => tile.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!selectedId) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT"
          || tag === "TEXTAREA"
          || tag === "SELECT"
          || target.isContentEditable
        ) {
          return;
        }
      }
      event.preventDefault();
      removeSelected();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, removeSelected]);

  function addDataset(datasetId: string, origin?: Readonly<{ x: number; y: number }>) {
    updateTiles((tiles) => {
      const tile = createDataTile(datasetId, tiles, catalog, undefined, origin);
      setSelectedId(tile.id);
      return [...tiles, tile];
    });
  }

  function onDatasetDragStart(
    event: ReactDragEvent<HTMLButtonElement>,
    datasetId: string,
  ) {
    event.dataTransfer.setData("application/x-dvns-dataset", datasetId);
    event.dataTransfer.setData("text/plain", datasetId);
    event.dataTransfer.effectAllowed = "copy";
  }

  function onCanvasDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (![...event.dataTransfer.types].some((type) =>
      type === "application/x-dvns-dataset" || type === "text/plain"
    )) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setCanvasDropActive(true);
  }

  function onCanvasDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setCanvasDropActive(false);
  }

  function onCanvasDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setCanvasDropActive(false);
    const datasetId =
      event.dataTransfer.getData("application/x-dvns-dataset")
      || event.dataTransfer.getData("text/plain");
    if (!datasetId || !catalog.some((entry) => entry.id === datasetId)) return;
    const pane = canvasRef.current;
    if (!pane) {
      addDataset(datasetId);
      return;
    }
    const rect = pane.getBoundingClientRect();
    addDataset(datasetId, {
      x: event.clientX - rect.left + pane.scrollLeft,
      y: event.clientY - rect.top + pane.scrollTop,
    });
  }

  function addTool(toolId: BoardToolId) {
    updateTiles((tiles) => {
      const tile = createToolTile(toolId, tiles);
      setSelectedId(tile.id);
      return [...tiles, tile];
    });
  }

  function onTilePointerDown(event: ReactPointerEvent<HTMLElement>, tile: BoardTile) {
    if (!tile.frame || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, select, a, input, textarea, label")) return;
    const mode = target.dataset.resize === "se" ? "resize" : "move";
    event.preventDefault();
    setSelectedId(tile.id);
    dragRef.current = {
      mode,
      tileId: tile.id,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...tile.frame },
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onTilePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    updateTiles((tiles) =>
      tiles.map((tile) => {
        if (tile.id !== drag.tileId || !tile.frame) return tile;
        if (drag.mode === "resize") {
          return {
            ...tile,
            frame: resizeTileFrame(
              { ...tile.frame, w: drag.origin.w, h: drag.origin.h },
              dx,
              dy,
            ),
          };
        }
        return {
          ...tile,
          frame: moveTileFrame(
            { ...tile.frame, x: drag.origin.x, y: drag.origin.y },
            dx,
            dy,
          ),
        };
      }),
    );
  }

  function onTilePointerUp() {
    dragRef.current = null;
  }

  async function onShare() {
    setActionError(null);
    setShareUrl(null);
    setShareCopied(false);
    setShareBusy(true);
    try {
      const nextCaps = caps ?? (await fetchBoardsCapabilities());
      if (!caps) setCaps(nextCaps);
      if (!nextCaps.share || nextCaps.storage !== "cloud") {
        setActionError(
          "La condivisione richiede Auth cloud (Supabase Boards). Verifica di essere connesso e che BOARDS_SUPABASE_* sia configurato.",
        );
        return;
      }
      if (!document) {
        setActionError("Board non ancora caricata.");
        return;
      }
      // Il link punta alla copia cloud: salva subito prima di creare lo share.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      await saveBoardClient(userId, boardId, document);
      const share = await createShareClient(boardId);
      setShareUrl(share.url);
      try {
        await navigator.clipboard.writeText(share.url);
        setShareCopied(true);
      } catch {
        setShareCopied(false);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Condivisione non riuscita.");
    } finally {
      setShareBusy(false);
    }
  }

  function onExportRecipe() {
    if (!document) return;
    downloadJson(
      `dvns-board-${boardId}.json`,
      {
        exportedAt: new Date().toISOString(),
        boardId,
        document,
        note: "Ricetta DVNS Boards: i numeri si rileggono dal layer pubblico all’apertura.",
      },
    );
  }

  function onExportCsvStub() {
    if (!document) return;
    const rows = [
      ["tile_id", "kind", "title", "dataset_id", "view", "filters_json"],
      ...document.tiles.map((tile) => [
        tile.id,
        tile.kind,
        tile.title ?? "",
        tile.datasetId ?? "",
        tile.view ?? "",
        JSON.stringify(tile.filters ?? {}),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    downloadText(`dvns-board-${boardId}-tiles.csv`, `${csv}\n`, "text/csv;charset=utf-8");
  }

  function onImportClick() {
    importInputRef.current?.click();
  }

  async function onImportFile(event: ReactChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setActionError(null);
    try {
      if (file.size > LOCAL_CSV_MAX_BYTES) {
        throw new Error(`File troppo grande (max ${Math.round(LOCAL_CSV_MAX_BYTES / 1024)} KB).`);
      }
      const text = await file.text();
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".json") || file.type === "application/json") {
        const parsed = JSON.parse(text) as unknown;
        const candidate =
          parsed
          && typeof parsed === "object"
          && "document" in parsed
          && (parsed as { document: unknown }).document
            ? (parsed as { document: unknown }).document
            : parsed;
        const next = assertBoardDocument(candidate);
        const replace = window.confirm(
          "Sostituire la board corrente con la ricetta JSON importata? L’operazione non è annullabile.",
        );
        if (!replace) return;
        setDocument(next);
        setSelectedId(null);
        return;
      }
      if (
        lower.endsWith(".csv")
        || lower.endsWith(".tsv")
        || lower.endsWith(".txt")
        || file.type.includes("csv")
        || file.type === "text/tab-separated-values"
        || file.type === "text/plain"
      ) {
        const table = buildLocalTableFromCsv(text, file.name);
        updateTiles((tiles) => {
          const tile = createLocalTile(table, tiles, "line");
          setSelectedId(tile.id);
          return [...tiles, tile];
        });
        return;
      }
      throw new Error("Formato non supportato. Usa CSV/TSV per i dati, oppure JSON per una ricetta board.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Import non riuscito.");
    }
  }

  if (missing) {
    return (
      <div className={styles.shell} data-immersive-page="boards" data-testid="boards-missing">
        <p className={styles.loading}>
          Board non trovata.{" "}
          <Link href="/dashboard">Torna alla home</Link>
        </p>
      </div>
    );
  }

  if (!document) {
    return (
      <div className={styles.shell} data-immersive-page="boards">
        <p className={styles.loading}>Caricamento board…</p>
      </div>
    );
  }

  return (
    <div className={styles.shell} data-immersive-page="boards" data-testid="boards-dashboard">
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <a className={styles.siteLink} href={siteHref}>
            ← Torna al sito
          </a>
          <span className={styles.brandSep} aria-hidden="true" />
          <Link className={styles.product} href="/dashboard">
            DVNS Boards
          </Link>
          <span className={styles.brandSep} aria-hidden="true" />
          <Link className={styles.siteLink} href="/dashboard">
            Home
          </Link>
        </div>
        <label className={styles.titleField}>
          <span className={styles.srOnly}>Titolo board</span>
          <input
            value={document.title}
            onChange={(event) =>
              setDocument((current) =>
                current ? { ...current, title: event.target.value || "La mia board" } : current,
              )
            }
            className={styles.titleInput}
          />
        </label>
        <div className={styles.topActions}>
          <span className={`${styles.themeSlot} ${styles.iconTipWrap}`} data-tip="Cambia tema chiaro/scuro">
            <ThemeToggle />
          </span>
          <button
            type="button"
            className={styles.iconBtn}
            aria-pressed={sidebarOpen}
            aria-label={sidebarOpen ? "Nascondi pannello strumenti e dati" : "Mostra pannello strumenti e dati"}
            data-tip={sidebarOpen ? "Nascondi pannello" : "Mostra strumenti e dati"}
            onClick={() => setSidebarOpen((value) => !value)}
          >
            <IconPanel />
          </button>
          <span className={styles.toolSep} aria-hidden="true" />
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json,text/plain"
            className={styles.srOnly}
            onChange={(event) => void onImportFile(event)}
          />
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Importa CSV o ricetta JSON"
            data-tip="Importa CSV/TSV o ricetta JSON"
            onClick={onImportClick}
          >
            <IconImport />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Esporta ricetta JSON"
            data-tip="Esporta ricetta JSON"
            onClick={onExportRecipe}
          >
            <IconExportJson />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Esporta elenco tile CSV"
            data-tip="Esporta elenco tile CSV"
            onClick={onExportCsvStub}
          >
            <IconExportCsv />
          </button>
          <span className={styles.toolSep} aria-hidden="true" />
          <button
            type="button"
            className={styles.iconBtn}
            aria-label={shareBusy ? "Creazione link in corso" : "Condividi board in sola lettura"}
            data-tip={shareBusy ? "Creazione link…" : "Condividi link sola lettura"}
            disabled={shareBusy || !document}
            onClick={() => void onShare()}
          >
            <IconShare />
          </button>
          <Link
            className={styles.iconBtn}
            href="/dashboard/settings"
            aria-label="Impostazioni account"
            data-tip="Impostazioni account"
          >
            <IconSettings />
          </Link>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label={pendingLogout ? "Uscita in corso" : "Esci dall’account"}
            data-tip={pendingLogout ? "Uscita in corso…" : "Esci dall’account"}
            disabled={pendingLogout}
            onClick={() => {
              startLogout(async () => {
                await fetch("/api/boards/auth/logout", { method: "POST" });
                router.push("/accedi");
              });
            }}
          >
            <IconLogout />
          </button>
        </div>
      </header>

      {actionError || shareUrl || shareBusy || feedbackNotice ? (
        <div
          className={styles.toast}
          role="status"
          data-tone={actionError ? "error" : "ok"}
        >
          {shareBusy ? <p>Creazione link…</p> : null}
          {actionError ? <p>{actionError}</p> : null}
          {shareUrl ? (
            <p>
              {shareCopied ? "Link copiato. " : "Link pronto. "}
              <a href={shareUrl} target="_blank" rel="noreferrer">
                Apri condivisione
              </a>
            </p>
          ) : null}
          {feedbackNotice ? <p>{feedbackNotice}</p> : null}
          <button
            type="button"
            className={styles.toastDismiss}
            aria-label="Chiudi avviso"
            onClick={() => {
              setShareUrl(null);
              setShareCopied(false);
              setActionError(null);
              setFeedbackNotice(null);
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className={styles.workspace}>
        <aside className={styles.sidebar} data-open={sidebarOpen ? "true" : "false"} aria-label="Pannello board">
          <div className={styles.sidebarHead}>
            <div className={styles.sidebarTabs} role="tablist" aria-label="Sezioni pannello">
              <button
                type="button"
                role="tab"
                className={styles.sidebarTab}
                aria-selected={sidebarTab === "tools"}
                data-active={sidebarTab === "tools" ? "true" : undefined}
                onClick={() => setSidebarTab("tools")}
              >
                Strumenti
              </button>
              <button
                type="button"
                role="tab"
                className={styles.sidebarTab}
                aria-selected={sidebarTab === "data"}
                data-active={sidebarTab === "data" ? "true" : undefined}
                onClick={() => setSidebarTab("data")}
              >
                Dati
              </button>
            </div>
            {sidebarTab === "tools" ? (
              <p className={styles.sidebarLead}>Clicca per aggiungere sulla canvas.</p>
            ) : (
              <>
                <p className={styles.sidebarLead}>
                  {filteredCatalog.length === catalog.length
                    ? `${catalog.length} dataset`
                    : `${filteredCatalog.length} di ${catalog.length}`}
                  {" · trascina o clicca"}
                </p>
                <label className={styles.searchLabel}>
                  <span className={styles.srOnly}>Cerca dataset</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Cerca tra ${catalog.length} dataset…`}
                    className={styles.search}
                  />
                </label>
                <label className={styles.categoryField}>
                  <span>Categoria</span>
                  <select
                    className={styles.categorySelect}
                    value={categoryFilter}
                    aria-label="Filtra per categoria"
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "all" || value === "featured") {
                        setCategoryFilter(value);
                        return;
                      }
                      setCategoryFilter(value as BoardDatasetCategoryId);
                    }}
                  >
                    <option value="all">Tutti i dataset</option>
                    <option value="featured">In evidenza</option>
                    {BOARD_DATASET_CATEGORIES.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
          <div className={styles.sidebarBody}>
            {sidebarTab === "tools" ? (
              <div className={styles.toolPalette} role="group" aria-label="Strumenti">
                {BOARD_TOOL_PRESETS.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className={styles.toolChip}
                    title={tool.blurb}
                    onClick={() => addTool(tool.id)}
                  >
                    <span className={styles.toolGlyph} aria-hidden="true">
                      {tool.glyph}
                    </span>
                    <span className={styles.toolChipLabel}>{tool.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.datasetScroll}>
                {filteredCatalog.length === 0 ? (
                  <p className={styles.datasetEmpty}>Nessun dataset con questi filtri.</p>
                ) : null}
                {catalogGroups.map((group) => (
                  <section key={group.id} className={styles.datasetGroup}>
                    {group.label ? (
                      <h2 className={styles.datasetGroupTitle}>{group.label}</h2>
                    ) : null}
                    <ul className={styles.datasetList}>
                      {group.entries.map((entry) => (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className={styles.datasetItem}
                            data-featured={entry.featured ? "true" : undefined}
                            draggable
                            onDragStart={(event) => onDatasetDragStart(event, entry.id)}
                            onClick={() => addDataset(entry.id)}
                            title="Trascina sulla canvas o clicca per aggiungere"
                          >
                            <strong>{entry.label}</strong>
                            <span>{entry.blurb}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
          <footer className={styles.sidebarFoot}>
            <button
              type="button"
              className={styles.feedbackLink}
              onClick={() => {
                setActionError(null);
                setFeedbackOpen(true);
              }}
            >
              Segnala un problema o dai feedback
            </button>
          </footer>
        </aside>

        {feedbackOpen ? (
          <div
            className={styles.feedbackBackdrop}
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget && !feedbackBusy) setFeedbackOpen(false);
            }}
          >
            <div
              className={styles.feedbackDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="boards-feedback-title"
            >
              <header className={styles.feedbackDialogHead}>
                <h2 id="boards-feedback-title">Segnalazione</h2>
                <button
                  type="button"
                  className={styles.toastDismiss}
                  aria-label="Chiudi"
                  disabled={feedbackBusy}
                  onClick={() => setFeedbackOpen(false)}
                >
                  ×
                </button>
              </header>
              <p className={styles.feedbackDialogLead}>
                Il messaggio arriva a Domenico via email. Rispondiamo se lasci dettagli utili.
              </p>
              <fieldset className={styles.feedbackKinds}>
                <legend className={styles.srOnly}>Tipo</legend>
                {(
                  [
                    ["problema", "Problema"],
                    ["feedback", "Feedback"],
                    ["idea", "Idea"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className={styles.feedbackKind}>
                    <input
                      type="radio"
                      name="boards-feedback-kind"
                      value={value}
                      checked={feedbackKind === value}
                      disabled={feedbackBusy}
                      onChange={() => setFeedbackKind(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label className={styles.feedbackMessage}>
                Messaggio
                <textarea
                  rows={6}
                  value={feedbackMessage}
                  disabled={feedbackBusy}
                  maxLength={4000}
                  placeholder="Cosa non funziona, cosa manca, o cosa miglioreresti…"
                  onChange={(event) => setFeedbackMessage(event.target.value)}
                />
              </label>
              <p className={styles.feedbackHint} aria-live="polite">
                {feedbackMessage.trim().length < 10
                  ? `Minimo 10 caratteri (ne mancano ${10 - feedbackMessage.trim().length}).`
                  : `${feedbackMessage.trim().length} / 4000 caratteri`}
              </p>
              <div className={styles.feedbackActions}>
                <button
                  type="button"
                  className={styles.feedbackCancel}
                  disabled={feedbackBusy}
                  onClick={() => setFeedbackOpen(false)}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  className={styles.feedbackSubmit}
                  disabled={feedbackBusy || feedbackMessage.trim().length < 10}
                  title={
                    feedbackMessage.trim().length < 10
                      ? "Scrivi almeno 10 caratteri per inviare"
                      : undefined
                  }
                  onClick={() => {
                    void submitFeedback();
                  }}
                >
                  {feedbackBusy ? "Invio…" : "Invia"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className={styles.canvasPane} aria-label="Board">
          <div
            ref={canvasRef}
            className={styles.canvas}
            data-drop-active={canvasDropActive ? "true" : undefined}
            onDragOver={onCanvasDragOver}
            onDragLeave={onCanvasDragLeave}
            onDrop={onCanvasDrop}
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectedId(null);
            }}
          >
            {document.tiles.length === 0 ? (
              <div className={styles.emptyCanvas}>
                <p>Parti da Strumenti: titolo o paragrafo, poi i grafici da Dati.</p>
                <p>O importa un CSV dalla barra in alto.</p>
              </div>
            ) : null}
            {document.tiles.map((tile) => {
              const frame = tile.frame!;
              const active = tile.id === selectedId;
              return (
                <article
                  key={tile.id}
                  className={styles.tile}
                  data-selected={active ? "true" : undefined}
                  data-kind={tile.kind}
                  style={{
                    left: frame.x,
                    top: frame.y,
                    width: frame.w,
                    height: frame.h,
                    ["--tile-accent" as string]: tile.color ?? "var(--boards-accent)",
                  }}
                  onPointerDown={(event) => onTilePointerDown(event, tile)}
                  onPointerMove={onTilePointerMove}
                  onPointerUp={onTilePointerUp}
                  onPointerCancel={onTilePointerUp}
                  onClick={() => setSelectedId(tile.id)}
                >
                  {tile.kind === "heading" || tile.kind === "note" ? null : (
                    <header className={styles.tileHeader}>
                      <div className={styles.tileTitles}>
                        <strong>{tile.title ?? tile.datasetId ?? tile.kind}</strong>
                        {tile.subtitle ? <span className={styles.tileSubtitle}>{tile.subtitle}</span> : null}
                      </div>
                      <span>
                        {(tile.kind === "data" || tile.kind === "local") && tile.view
                          ? VIEW_LABEL[tile.view]
                          : tile.kind === "local"
                            ? "CSV"
                            : tile.kind}
                      </span>
                    </header>
                  )}
                  <div className={styles.tileBody}>
                    {tile.kind === "data" ? (
                      <BoardTileChart
                        tile={tile}
                        onFiltersChange={(filters) => {
                          updateTiles((tiles) =>
                            tiles.map((item) =>
                              item.id === tile.id ? { ...item, filters } : item,
                            ),
                          );
                        }}
                      />
                    ) : null}
                    {tile.kind === "local" && tile.localTable ? (
                      <BoardLocalTileChart tile={tile} />
                    ) : null}
                    {tile.kind === "heading" || tile.kind === "note" ? (
                      <BoardRichText
                        html={ensureBoardHtml(
                          tile.body,
                          tile.kind === "heading"
                            ? (tile.title ?? "Titolo di sezione")
                            : "Scrivi qui…",
                        )}
                        active={active}
                        minHeight={FRAME_MIN_H}
                        placeholder={
                          tile.kind === "heading"
                            ? "Titolo o testo di sezione…"
                            : "Scrivi qui il contesto…"
                        }
                        onChange={({ html, title }) =>
                          updateTiles((tiles) =>
                            tiles.map((item) =>
                              item.id === tile.id
                                ? {
                                    ...item,
                                    body: html,
                                    title:
                                      title
                                      || (tile.kind === "heading" ? "Titolo di sezione" : "Nota"),
                                    subtitle: undefined,
                                  }
                                : item,
                            ),
                          )
                        }
                        onFitHeight={(height) => {
                          const nextH = Math.max(FRAME_MIN_H, height);
                          const current = tile.frame?.h ?? 0;
                          if (Math.abs(current - nextH) < 2) return;
                          updateTiles((tiles) =>
                            tiles.map((item) =>
                              item.id === tile.id
                                ? {
                                    ...item,
                                    frame: {
                                      ...(item.frame ?? {
                                        x: 40,
                                        y: 40,
                                        w: Math.max(FRAME_MIN_W, 360),
                                        h: nextH,
                                      }),
                                      w: Math.max(FRAME_MIN_W, item.frame?.w ?? 360),
                                      h: nextH,
                                    },
                                  }
                                : item,
                            ),
                          );
                        }}
                        onDone={() => setSelectedId(null)}
                      />
                    ) : null}
                    {tile.kind === "link" ? (
                      <a
                        className={styles.linkBody}
                        href={tile.href}
                        target="_blank"
                        rel="noreferrer"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {tile.href}
                      </a>
                    ) : null}
                    {tile.kind === "image" && tile.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={styles.imageBody} src={tile.imageUrl} alt={tile.title ?? ""} />
                    ) : null}
                  </div>
                  {active ? (
                    <span
                      className={styles.resizeHandle}
                      data-resize="se"
                      aria-hidden="true"
                      title="Ridimensiona"
                    />
                  ) : null}
                </article>
              );
            })}
          </div>

          {selected ? (
            <div className={styles.inspector} aria-label="Proprietà elemento">
              <h2>Elemento selezionato</h2>
              <p className={styles.inspectorMeta}>
                {selected.kind}
                {selected.datasetId ? ` · ${selected.datasetId}` : ""}
              </p>
              {selected.kind === "heading" || selected.kind === "note" ? null : (
                <>
                  <label className={styles.inspectorField}>
                    Titolo
                    <input
                      value={selected.title ?? ""}
                      onChange={(event) => patchSelected({ title: event.target.value || undefined })}
                    />
                  </label>
                  <label className={styles.inspectorField}>
                    Sottotitolo
                    <input
                      value={selected.subtitle ?? ""}
                      onChange={(event) =>
                        patchSelected({ subtitle: event.target.value || undefined })
                      }
                    />
                  </label>
                </>
              )}
              <label className={styles.inspectorField}>
                Colore bordo
                <input
                  type="color"
                  value={selected.color ?? "#3d9b74"}
                  onChange={(event) => patchSelected({ color: event.target.value })}
                />
              </label>
              {selected.kind === "local" && selected.localTable ? (
                <>
                  <label className={styles.inspectorField}>
                    Vista
                    <select
                      value={selected.view ?? "line"}
                      onChange={(event) =>
                        patchSelected({ view: event.target.value as BoardTileView })
                      }
                    >
                      {BOARD_TILE_VIEWS.map((view) => (
                        <option key={view} value={view}>
                          {VIEW_LABEL[view]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.inspectorField}>
                    Colonna etichette
                    <select
                      value={selected.localTable.labelColumn}
                      onChange={(event) =>
                        patchSelected({
                          localTable: {
                            ...selected.localTable!,
                            labelColumn: event.target.value,
                          },
                        })
                      }
                    >
                      {selected.localTable.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className={styles.inspectorField}>
                    <legend>Colonne valori (max 3)</legend>
                    {selected.localTable.headers.map((header) => {
                      const checked = selected.localTable!.valueColumns.includes(header);
                      return (
                        <label key={header} className={styles.checkRow}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const current = selected.localTable!.valueColumns;
                              let next = event.target.checked
                                ? [...current, header]
                                : current.filter((item) => item !== header);
                              if (next.length === 0) next = [header];
                              if (next.length > 3) next = next.slice(-3);
                              patchSelected({
                                localTable: { ...selected.localTable!, valueColumns: next },
                              });
                            }}
                          />
                          {header}
                        </label>
                      );
                    })}
                  </fieldset>
                  <p className={styles.inspectorMeta}>
                    File {selected.localTable.filename} · {selected.localTable.rows.length} righe
                    (dati locali, non ufficiali)
                  </p>
                </>
              ) : null}
              {selected.kind === "data" ? (
                <>
                  <label className={styles.inspectorField}>
                    Vista
                    <select
                      value={selected.view ?? "line"}
                      onChange={(event) =>
                        patchSelected({ view: event.target.value as BoardTileView })
                      }
                    >
                      {BOARD_TILE_VIEWS.map((view) => (
                        <option key={view} value={view}>
                          {VIEW_LABEL[view]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(catalog.find((entry) => entry.id === selected.datasetId)?.filters ?? [])
                    .filter(
                      (name) =>
                        !["limit", "offset", "cursor", "query", "series_key"].includes(name),
                    )
                    .map((name) => {
                      const required =
                        name === "code" && selected.datasetId === "openbdap_amministrazione";
                      const label = FILTER_LABEL[name] ?? `Filtro ${name}`;
                      const current =
                        selected.filters && selected.filters[name] != null
                          ? String(selected.filters[name])
                          : "";
                      function commitFilter(raw: string) {
                        if (!selected) return;
                        const next = { ...(selected.filters ?? {}) };
                        if (raw === "") {
                          delete next[name];
                        } else if (
                          /^\d+$/u.test(raw)
                          && (name === "year" || name === "month" || name === "years")
                        ) {
                          next[name] = Number(raw);
                        } else {
                          next[name] = raw;
                        }
                        patchSelected({ filters: next });
                      }
                      if (name === "year") {
                        return (
                          <label key={`${selected.id}-${name}`} className={styles.inspectorField}>
                            {label}
                            {required ? " (obbligatorio)" : ""}
                            <select
                              value={current}
                              onChange={(event) => commitFilter(event.target.value)}
                            >
                              <option value="">Nessuno</option>
                              {YEAR_OPTIONS.map((year) => (
                                <option key={year} value={year}>
                                  {year}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      }
                      if (name === "region") {
                        const regionOptions = boardRegionOptionsForDataset(
                          selected.datasetId ?? "",
                        );
                        return (
                          <label key={`${selected.id}-${name}`} className={styles.inspectorField}>
                            {label}
                            <select
                              value={current}
                              onChange={(event) => commitFilter(event.target.value)}
                            >
                              <option value="">Tutte / default</option>
                              {regionOptions.map((region) => (
                                <option key={region.value} value={region.value}>
                                  {region.label}
                                  {/^\d/u.test(region.value) ? ` (${region.value})` : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      }
                      return (
                        <label key={`${selected.id}-${name}`} className={styles.inspectorField}>
                          {label}
                          {required ? " (obbligatorio)" : ""}
                          <input
                            defaultValue={current}
                            placeholder={
                              name === "code"
                                ? "Codice OpenBDAP / CF / IPA"
                                : name === "month"
                                  ? "1-12"
                                  : undefined
                            }
                            onBlur={(event) => commitFilter(event.target.value.trim())}
                          />
                        </label>
                      );
                    })}
                </>
              ) : null}
              {selected.kind === "heading" || selected.kind === "note" ? (
                <p className={styles.inspectorHint}>
                  La barra di formattazione appare sopra il box. Premi Fatto o Esc per chiudere.
                </p>
              ) : null}
              {selected.kind === "link" ? (
                <label className={styles.inspectorField}>
                  URL (HTTPS)
                  <input
                    value={selected.href ?? ""}
                    onChange={(event) => patchSelected({ href: event.target.value })}
                  />
                </label>
              ) : null}
              {selected.kind === "image" ? (
                <label className={styles.inspectorField}>
                  URL immagine (HTTPS)
                  <input
                    value={selected.imageUrl ?? ""}
                    onChange={(event) => patchSelected({ imageUrl: event.target.value })}
                  />
                </label>
              ) : null}
              <label className={styles.inspectorField}>
                Larghezza × altezza
                <span className={styles.sizeRow}>
                  <input
                    type="number"
                    min={160}
                    max={2000}
                    step={20}
                    value={selected.frame?.w ?? 360}
                    onChange={(event) =>
                      patchSelected({
                        frame: {
                          ...(selected.frame ?? { x: 40, y: 40, w: 360, h: 260 }),
                          w: Math.max(FRAME_MIN_W, Number(event.target.value) || 360),
                        },
                      })
                    }
                  />
                  <input
                    type="number"
                    min={120}
                    max={2000}
                    step={20}
                    value={selected.frame?.h ?? 260}
                    onChange={(event) =>
                      patchSelected({
                        frame: {
                          ...(selected.frame ?? { x: 40, y: 40, w: 360, h: 260 }),
                          h: Math.max(FRAME_MIN_H, Number(event.target.value) || 260),
                        },
                      })
                    }
                  />
                </span>
              </label>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => removeSelected()}
              >
                Rimuovi
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
