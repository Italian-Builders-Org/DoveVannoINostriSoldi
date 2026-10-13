import {
  assertBoardDocument,
  BOARDS_DOCUMENT_SCHEMA_VERSION,
  type BoardDocument,
} from "@/lib/data/boards-document";
import { emptyBoardDocument } from "@/lib/boards/local-board";

const INDEX_PREFIX = "dvns-boards-index:v1:";
const DOC_PREFIX = "dvns-boards-doc:v2:";
/** Chiave legacy di una sola board per utente (migrata alla libreria). */
const LEGACY_DOC_PREFIX = "dvns-boards-doc:v1:";

export const BOARD_LIBRARY_SCHEMA_VERSION = 1 as const;

export const BOARD_CATEGORY_SUGGESTIONS = [
  "Generale",
  "Comuni",
  "Sanità",
  "Debito",
  "Stato",
  "Lavoro",
  "Personale",
] as const;

export type BoardMeta = {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  updatedAt: string;
};

export type BoardLibraryIndex = {
  schemaVersion: typeof BOARD_LIBRARY_SCHEMA_VERSION;
  boards: BoardMeta[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newBoardId(): string {
  return `board_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeCategory(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  return value === "" ? "Generale" : value.slice(0, 48);
}

function assertMeta(value: unknown): BoardMeta {
  if (!isPlainObject(value)) throw new Error("BoardMeta: oggetto richiesto");
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!/^board_[a-z0-9_]+$/u.test(id)) throw new Error("BoardMeta: id non valido");
  if (!title) throw new Error("BoardMeta: title obbligatorio");
  const category = normalizeCategory(
    typeof value.category === "string" ? value.category : undefined,
  );
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : nowIso();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
  return { id, title: title.slice(0, 120), category, createdAt, updatedAt };
}

function assertIndex(value: unknown): BoardLibraryIndex {
  if (!isPlainObject(value)) throw new Error("BoardLibraryIndex: oggetto richiesto");
  if (value.schemaVersion !== BOARD_LIBRARY_SCHEMA_VERSION) {
    throw new Error("BoardLibraryIndex: schemaVersion non supportata");
  }
  if (!Array.isArray(value.boards)) throw new Error("BoardLibraryIndex: boards array");
  if (value.boards.length > 64) throw new Error("BoardLibraryIndex: massimo 64 board");
  const seen = new Set<string>();
  const boards = value.boards.map((entry) => {
    const meta = assertMeta(entry);
    if (seen.has(meta.id)) throw new Error(`BoardLibraryIndex: id duplicato ${meta.id}`);
    seen.add(meta.id);
    return meta;
  });
  return { schemaVersion: BOARD_LIBRARY_SCHEMA_VERSION, boards };
}

function emptyIndex(): BoardLibraryIndex {
  return { schemaVersion: BOARD_LIBRARY_SCHEMA_VERSION, boards: [] };
}

function indexKey(userId: string): string {
  return `${INDEX_PREFIX}${userId}`;
}

function docKey(userId: string, boardId: string): string {
  return `${DOC_PREFIX}${userId}:${boardId}`;
}

function writeIndex(userId: string, index: BoardLibraryIndex): void {
  window.localStorage.setItem(indexKey(userId), JSON.stringify(assertIndex(index)));
}

function readRawIndex(userId: string): BoardLibraryIndex | null {
  const raw = window.localStorage.getItem(indexKey(userId));
  if (!raw) return null;
  return assertIndex(JSON.parse(raw));
}

function migrateLegacyIfNeeded(userId: string): BoardLibraryIndex {
  const existing = readRawIndex(userId);
  if (existing) return existing;

  const legacyRaw = window.localStorage.getItem(`${LEGACY_DOC_PREFIX}${userId}`);
  if (!legacyRaw) {
    const index = emptyIndex();
    writeIndex(userId, index);
    return index;
  }

  let document: BoardDocument;
  try {
    document = assertBoardDocument(JSON.parse(legacyRaw));
  } catch {
    const index = emptyIndex();
    writeIndex(userId, index);
    return index;
  }

  const stamp = nowIso();
  const meta: BoardMeta = {
    id: newBoardId(),
    title: document.title || "La mia board",
    category: "Generale",
    createdAt: stamp,
    updatedAt: stamp,
  };
  window.localStorage.setItem(docKey(userId, meta.id), JSON.stringify(document));
  const index: BoardLibraryIndex = {
    schemaVersion: BOARD_LIBRARY_SCHEMA_VERSION,
    boards: [meta],
  };
  writeIndex(userId, index);
  return index;
}

/** Carica (e migra se serve) l’indice board dell’utente. */
export function loadBoardLibrary(userId: string): BoardLibraryIndex {
  if (typeof window === "undefined") return emptyIndex();
  try {
    return migrateLegacyIfNeeded(userId);
  } catch (error) {
    console.error("DVNS Boards: indice locale illegibile", error);
    return emptyIndex();
  }
}

export function listBoardMetas(userId: string): BoardMeta[] {
  return [...loadBoardLibrary(userId).boards].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function loadBoardDocument(userId: string, boardId: string): BoardDocument | null {
  if (typeof window === "undefined") return null;
  try {
    const index = loadBoardLibrary(userId);
    if (!index.boards.some((board) => board.id === boardId)) return null;
    const raw = window.localStorage.getItem(docKey(userId, boardId));
    if (!raw) return emptyBoardDocument("Board");
    return assertBoardDocument(JSON.parse(raw));
  } catch (error) {
    console.error("DVNS Boards: documento board illegibile", error);
    return null;
  }
}

export function saveBoardDocument(
  userId: string,
  boardId: string,
  document: BoardDocument,
): void {
  if (typeof window === "undefined") return;
  try {
    const valid = assertBoardDocument(document);
    const index = loadBoardLibrary(userId);
    const stamp = nowIso();
    const boards = index.boards.map((board) =>
      board.id === boardId
        ? { ...board, title: valid.title, updatedAt: stamp }
        : board,
    );
    if (!boards.some((board) => board.id === boardId)) {
      throw new Error("Board non presente in libreria");
    }
    window.localStorage.setItem(docKey(userId, boardId), JSON.stringify(valid));
    writeIndex(userId, { ...index, boards });
  } catch (error) {
    console.error("DVNS Boards: salvataggio board rifiutato", error);
  }
}

export function createBoard(
  userId: string,
  input: { title?: string; category?: string } = {},
): BoardMeta {
  const stamp = nowIso();
  const title = (input.title?.trim() || "Nuova board").slice(0, 120);
  const meta: BoardMeta = {
    id: newBoardId(),
    title,
    category: normalizeCategory(input.category),
    createdAt: stamp,
    updatedAt: stamp,
  };
  const document: BoardDocument = {
    schemaVersion: BOARDS_DOCUMENT_SCHEMA_VERSION,
    title,
    layout: "free",
    tiles: [],
  };
  const index = loadBoardLibrary(userId);
  if (index.boards.length >= 64) {
    throw new Error("Hai raggiunto il massimo di 64 board");
  }
  window.localStorage.setItem(docKey(userId, meta.id), JSON.stringify(document));
  writeIndex(userId, { ...index, boards: [meta, ...index.boards] });
  return meta;
}

export function updateBoardMeta(
  userId: string,
  boardId: string,
  patch: { title?: string; category?: string },
): BoardMeta | null {
  const index = loadBoardLibrary(userId);
  const current = index.boards.find((board) => board.id === boardId);
  if (!current) return null;

  const next: BoardMeta = {
    ...current,
    title: patch.title !== undefined
      ? (patch.title.trim() || current.title).slice(0, 120)
      : current.title,
    category: patch.category !== undefined
      ? normalizeCategory(patch.category)
      : current.category,
    updatedAt: nowIso(),
  };

  writeIndex(userId, {
    ...index,
    boards: index.boards.map((board) => (board.id === boardId ? next : board)),
  });

  if (patch.title !== undefined) {
    const raw = window.localStorage.getItem(docKey(userId, boardId));
    if (raw) {
      try {
        const document = assertBoardDocument(JSON.parse(raw));
        window.localStorage.setItem(
          docKey(userId, boardId),
          JSON.stringify({ ...document, title: next.title }),
        );
      } catch {
        /* ignore corrupt doc on rename */
      }
    }
  }

  return next;
}

export function deleteBoard(userId: string, boardId: string): boolean {
  const index = loadBoardLibrary(userId);
  if (!index.boards.some((board) => board.id === boardId)) return false;
  writeIndex(userId, {
    ...index,
    boards: index.boards.filter((board) => board.id !== boardId),
  });
  window.localStorage.removeItem(docKey(userId, boardId));
  return true;
}

/** Svuota tutte le board locali dell'utente (anteprima / cleanup account). */
export function clearAllLocalBoardsForUser(userId: string): void {
  if (typeof window === "undefined") return;
  const index = loadBoardLibrary(userId);
  for (const board of index.boards) {
    window.localStorage.removeItem(docKey(userId, board.id));
  }
  window.localStorage.removeItem(`${INDEX_PREFIX}${userId}`);
  window.localStorage.removeItem(`${LEGACY_DOC_PREFIX}${userId}`);
}

export function groupBoardsByCategory(boards: readonly BoardMeta[]): {
  category: string;
  boards: BoardMeta[];
}[] {
  const order: string[] = [];
  const map = new Map<string, BoardMeta[]>();
  for (const board of boards) {
    const key = board.category || "Generale";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(board);
  }
  order.sort((a, b) => a.localeCompare(b, "it"));
  return order.map((category) => ({
    category,
    boards: (map.get(category) ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  }));
}
