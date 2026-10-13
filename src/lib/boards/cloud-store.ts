import "server-only";
import { randomBytes } from "node:crypto";
import {
  assertBoardDocument,
  type BoardDocument,
} from "@/lib/data/boards-document";
import { boardsRest, boardsCloudStorageAvailable } from "@/lib/boards/supabase";

export type CloudBoardMeta = {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  updatedAt: string;
};

type BoardRow = {
  id: string;
  owner_id: string;
  title: string;
  category: string;
  document: unknown;
  created_at: string;
  updated_at: string;
};

type ShareRow = {
  token: string;
  board_id: string;
  owner_id: string;
  created_at: string;
  revoked_at: string | null;
};

function normalizeCategory(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  return value === "" ? "Generale" : value.slice(0, 48);
}

function rowToMeta(row: BoardRow): CloudBoardMeta {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isCloudBoardsEnabled(): boolean {
  return boardsCloudStorageAvailable();
}

export async function ensureCloudProfile(
  userId: string,
  email: string,
  privacyAcceptedAt = new Date().toISOString(),
): Promise<void> {
  await boardsRest("/profiles", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      user_id: userId,
      email: email.toLowerCase(),
      privacy_accepted_at: privacyAcceptedAt,
      updated_at: new Date().toISOString(),
    },
  });
}

export async function listCloudBoards(ownerId: string): Promise<CloudBoardMeta[]> {
  const { data } = await boardsRest<BoardRow[]>(
    `/boards?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,owner_id,title,category,created_at,updated_at&order=updated_at.desc`,
  );
  return (data ?? []).map((row) => rowToMeta(row as BoardRow));
}

export async function getCloudBoard(
  ownerId: string,
  boardId: string,
): Promise<{ meta: CloudBoardMeta; document: BoardDocument } | null> {
  const { data } = await boardsRest<BoardRow[]>(
    `/boards?owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(boardId)}&select=*`,
  );
  const row = data?.[0];
  if (!row) return null;
  return { meta: rowToMeta(row), document: assertBoardDocument(row.document) };
}

export async function createCloudBoard(
  ownerId: string,
  input: { title?: string; category?: string; document?: BoardDocument },
): Promise<{ meta: CloudBoardMeta; document: BoardDocument }> {
  const title = (input.title?.trim() || "Nuova board").slice(0, 120);
  const category = normalizeCategory(input.category);
  const document = assertBoardDocument(
    input.document ?? {
      schemaVersion: 1,
      title,
      layout: "free",
      tiles: [],
    },
  );
  const id = `board_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  const row: BoardRow = {
    id,
    owner_id: ownerId,
    title: document.title,
    category,
    document,
    created_at: now,
    updated_at: now,
  };
  await boardsRest("/boards", {
    method: "POST",
    prefer: "return=minimal",
    body: row,
  });
  return { meta: rowToMeta(row), document };
}

export async function saveCloudBoard(
  ownerId: string,
  boardId: string,
  document: BoardDocument,
  category?: string,
): Promise<CloudBoardMeta | null> {
  const valid = assertBoardDocument(document);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    title: valid.title,
    document: valid,
    updated_at: now,
  };
  if (category !== undefined) patch.category = normalizeCategory(category);
  const { data } = await boardsRest<BoardRow[]>(
    `/boards?owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(boardId)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: patch,
    },
  );
  const existing = data?.[0];
  if (existing) return rowToMeta(existing);

  // Upsert: board assente (es. id locale migrato) → crea la riga così lo share può procedere.
  const row: BoardRow = {
    id: boardId,
    owner_id: ownerId,
    title: valid.title,
    category: category !== undefined ? normalizeCategory(category) : normalizeCategory(undefined),
    document: valid,
    created_at: now,
    updated_at: now,
  };
  await boardsRest("/boards", {
    method: "POST",
    prefer: "return=minimal",
    body: row,
  });
  return rowToMeta(row);
}

export async function updateCloudBoardMeta(
  ownerId: string,
  boardId: string,
  patch: { title?: string; category?: string },
): Promise<CloudBoardMeta | null> {
  const current = await getCloudBoard(ownerId, boardId);
  if (!current) return null;
  const title = patch.title !== undefined
    ? (patch.title.trim() || current.meta.title).slice(0, 120)
    : current.meta.title;
  const category = patch.category !== undefined
    ? normalizeCategory(patch.category)
    : current.meta.category;
  const document = { ...current.document, title };
  return saveCloudBoard(ownerId, boardId, document, category);
}

/**
 * Cancella profilo, board e share dell'utente (CASCADE su profiles).
 * Non tocca Auth: chiamare `supabaseAdminDeleteUser` a parte in cloud.
 */
export async function deleteCloudAccountData(ownerId: string): Promise<void> {
  await boardsRest(
    `/profiles?user_id=eq.${encodeURIComponent(ownerId)}`,
    { method: "DELETE", prefer: "return=minimal" },
  );
}

export async function deleteCloudBoard(ownerId: string, boardId: string): Promise<boolean> {
  await boardsRest(
    `/boards?owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(boardId)}`,
    { method: "DELETE", prefer: "return=minimal" },
  );
  return true;
}

export async function createCloudShare(
  ownerId: string,
  boardId: string,
): Promise<{ token: string; createdAt: string }> {
  const board = await getCloudBoard(ownerId, boardId);
  if (!board) throw new Error("Board non trovata");
  const token = randomBytes(24).toString("base64url");
  const createdAt = new Date().toISOString();
  await boardsRest("/shares", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      token,
      board_id: boardId,
      owner_id: ownerId,
      created_at: createdAt,
      revoked_at: null,
    },
  });
  return { token, createdAt };
}

export async function revokeCloudShare(ownerId: string, token: string): Promise<boolean> {
  const { data } = await boardsRest<ShareRow[]>(
    `/shares?owner_id=eq.${encodeURIComponent(ownerId)}&token=eq.${encodeURIComponent(token)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: { revoked_at: new Date().toISOString() },
    },
  );
  return Boolean(data?.[0]);
}

export async function getSharedBoard(
  token: string,
): Promise<{ meta: CloudBoardMeta; document: BoardDocument } | null> {
  const { data: shares } = await boardsRest<ShareRow[]>(
    `/shares?token=eq.${encodeURIComponent(token)}&revoked_at=is.null&select=*`,
  );
  const share = shares?.[0];
  if (!share) return null;
  const { data: boards } = await boardsRest<BoardRow[]>(
    `/boards?id=eq.${encodeURIComponent(share.board_id)}&select=*`,
  );
  const row = boards?.[0];
  if (!row) return null;
  return { meta: rowToMeta(row), document: assertBoardDocument(row.document) };
}

export async function listCloudShares(
  ownerId: string,
  boardId: string,
): Promise<{ token: string; createdAt: string }[]> {
  const { data } = await boardsRest<ShareRow[]>(
    `/shares?owner_id=eq.${encodeURIComponent(ownerId)}&board_id=eq.${encodeURIComponent(boardId)}&revoked_at=is.null&select=token,created_at&order=created_at.desc`,
  );
  return (data ?? []).map((row) => ({ token: row.token, createdAt: row.created_at }));
}
