import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  EMPTY_READING_STATE,
  parseReadingState,
  type ReadingPosition,
  type ReadingState,
} from "./src/reading-state.js";

export async function readReadingState(statePath: string): Promise<ReadingState> {
  try {
    return parseReadingState(JSON.parse(await readFile(statePath, "utf8"))) ?? structuredClone(EMPTY_READING_STATE);
  } catch {
    return structuredClone(EMPTY_READING_STATE);
  }
}

export async function writeReadingState(
  statePath: string,
  position: ReadingPosition | null,
  updatedAt = new Date().toISOString(),
): Promise<ReadingState> {
  const state: ReadingState = { version: 1, position, updatedAt: position ? updatedAt : null };
  if (!parseReadingState(state)) throw new Error("拒绝保存无效的阅读进度。");
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, statePath);
    return state;
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw new Error(`无法保存阅读进度：${(error as Error).message}`);
  }
}
