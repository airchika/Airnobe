import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  EMPTY_BOOKMARK_STATE,
  parseBookmarkDraft,
  parseBookmarkState,
  type BookmarkDraft,
  type BookmarkMutationResult,
  type BookmarkState,
} from "./src/bookmarks.js";

export async function readBookmarkState(statePath: string): Promise<BookmarkState> {
  try {
    return parseBookmarkState(JSON.parse(await readFile(statePath, "utf8"))) ?? structuredClone(EMPTY_BOOKMARK_STATE);
  } catch {
    return structuredClone(EMPTY_BOOKMARK_STATE);
  }
}

async function writeBookmarkState(statePath: string, state: BookmarkState): Promise<BookmarkState> {
  if (!parseBookmarkState(state)) throw new Error("拒绝保存无效的书签。");
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, statePath);
    return state;
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw new Error(`无法保存书签：${(error as Error).message}`);
  }
}

export async function addBookmark(
  statePath: string,
  draftValue: BookmarkDraft,
  id = randomUUID(),
  createdAt = new Date().toISOString(),
): Promise<BookmarkMutationResult> {
  const draft = parseBookmarkDraft(draftValue);
  if (!draft) throw new Error("拒绝保存无效的书签。");
  const previous = await readBookmarkState(statePath);
  if (previous.bookmarks.some((bookmark) => bookmark.position.blockId === draft.position.blockId)) {
    return { outcome: "duplicate", state: previous };
  }
  const state: BookmarkState = {
    version: 1,
    bookmarks: [...previous.bookmarks, { id, ...draft, createdAt }],
  };
  return { outcome: "created", state: await writeBookmarkState(statePath, state) };
}

export async function deleteBookmark(statePath: string, bookmarkId: string): Promise<BookmarkState> {
  const previous = await readBookmarkState(statePath);
  const bookmarks = previous.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
  if (bookmarks.length === previous.bookmarks.length) return previous;
  return writeBookmarkState(statePath, { version: 1, bookmarks });
}
