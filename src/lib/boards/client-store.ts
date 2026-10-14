"use client";

import type { BoardDocument } from "@/lib/data/boards-document";
import {
  createBoard as createLocalBoard,
  deleteBoard as deleteLocalBoard,
  listBoardMetas,
  loadBoardDocument,
  saveBoardDocument,
  updateBoardMeta as updateLocalMeta,
  type BoardMeta,
} from "@/lib/boards/board-library";

export type BoardsStorageMode = "local" | "cloud";

export type BoardsCapabilities = {
  authMode: string;
  storage: BoardsStorageMode;
  share: boolean;
  export: boolean;
  signedIn: boolean;
};

let cachedCapabilities: BoardsCapabilities | null = null;

export async function fetchBoardsCapabilities(): Promise<BoardsCapabilities> {
  const response = await fetch("/api/boards/capabilities", { cache: "no-store" });
  if (!response.ok) {
    return {
      authMode: "local_preview",
      storage: "local",
      share: false,
      export: true,
      signedIn: false,
    };
  }
  const data = (await response.json()) as BoardsCapabilities;
  cachedCapabilities = data;
  return data;
}

export function getCachedBoardsCapabilities(): BoardsCapabilities | null {
  return cachedCapabilities;
}

export async function listBoardsClient(userId: string): Promise<{
  storage: BoardsStorageMode;
  boards: BoardMeta[];
}> {
  const caps = await fetchBoardsCapabilities();
  if (caps.storage === "cloud") {
    const response = await fetch("/api/boards/library", { cache: "no-store" });
    if (!response.ok) throw new Error("Impossibile leggere le board cloud.");
    const data = (await response.json()) as { storage: BoardsStorageMode; boards: BoardMeta[] };
    return { storage: "cloud", boards: data.boards ?? [] };
  }
  return { storage: "local", boards: listBoardMetas(userId) };
}

export async function createBoardClient(
  userId: string,
  input: { title?: string; category?: string },
): Promise<BoardMeta> {
  const caps = await fetchBoardsCapabilities();
  if (caps.storage === "cloud") {
    const response = await fetch("/api/boards/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Creazione non riuscita.");
    return data.board as BoardMeta;
  }
  return createLocalBoard(userId, input);
}

export async function loadBoardClient(
  userId: string,
  boardId: string,
): Promise<BoardDocument | null> {
  const caps = await fetchBoardsCapabilities();
  if (caps.storage === "cloud") {
    const response = await fetch(`/api/boards/library/${encodeURIComponent(boardId)}`, {
      cache: "no-store",
    });
    if (response.status === 404) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Lettura board non riuscita.");
    return data.document as BoardDocument;
  }
  return loadBoardDocument(userId, boardId);
}

export async function saveBoardClient(
  userId: string,
  boardId: string,
  document: BoardDocument,
): Promise<void> {
  const caps = cachedCapabilities ?? (await fetchBoardsCapabilities());
  if (caps.storage === "cloud") {
    const response = await fetch(`/api/boards/library/${encodeURIComponent(boardId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        typeof data.error === "string" ? data.error : "Salvataggio cloud non riuscito.",
      );
    }
    return;
  }
  saveBoardDocument(userId, boardId, document);
}

export async function updateBoardMetaClient(
  userId: string,
  boardId: string,
  patch: { title?: string; category?: string },
): Promise<void> {
  const caps = await fetchBoardsCapabilities();
  if (caps.storage === "cloud") {
    const response = await fetch(`/api/boards/library/${encodeURIComponent(boardId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : "Aggiornamento non riuscito.");
    }
    return;
  }
  updateLocalMeta(userId, boardId, patch);
}

export async function deleteBoardClient(userId: string, boardId: string): Promise<void> {
  const caps = await fetchBoardsCapabilities();
  if (caps.storage === "cloud") {
    const response = await fetch(`/api/boards/library/${encodeURIComponent(boardId)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : "Eliminazione non riuscita.");
    }
    return;
  }
  deleteLocalBoard(userId, boardId);
}

export async function createShareClient(boardId: string): Promise<{ url: string; token: string }> {
  const response = await fetch("/api/boards/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ boardId }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; url?: string; token?: string };
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Condivisione non riuscita.");
  }
  if (typeof data.url !== "string" || typeof data.token !== "string") {
    throw new Error("Risposta share incompleta.");
  }
  return { url: data.url, token: data.token };
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
