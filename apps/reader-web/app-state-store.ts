import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { EMPTY_APP_STATE, parseAppState, type AppState } from "./src/app-state.js";

export async function readAppState(statePath: string): Promise<AppState> {
  try {
    return parseAppState(JSON.parse(await readFile(statePath, "utf8"))) ?? structuredClone(EMPTY_APP_STATE);
  } catch {
    return structuredClone(EMPTY_APP_STATE);
  }
}

export async function writeAppState(statePath: string, state: AppState): Promise<void> {
  if (!parseAppState(state)) throw new Error("拒绝保存无效的应用状态。");
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, statePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw new Error(`无法保存应用状态：${(error as Error).message}`);
  }
}
