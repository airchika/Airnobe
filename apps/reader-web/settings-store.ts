import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  cloneReaderSettings,
  DEFAULT_READER_SETTINGS,
  parseReaderSettings,
  type ReaderSettings,
} from "./src/reader-settings.js";

export async function readReaderSettings(settingsPath: string): Promise<ReaderSettings> {
  try {
    const parsed = parseReaderSettings(JSON.parse(await readFile(settingsPath, "utf8")));
    return cloneReaderSettings(parsed ?? DEFAULT_READER_SETTINGS);
  } catch {
    return cloneReaderSettings(DEFAULT_READER_SETTINGS);
  }
}

export async function writeReaderSettings(settingsPath: string, settings: ReaderSettings): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  const temporaryPath = `${settingsPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(temporaryPath, settingsPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw new Error(`无法保存阅读设置：${(error as Error).message}`);
  }
}
