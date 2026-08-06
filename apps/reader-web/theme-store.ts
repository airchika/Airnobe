import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_THEME_IDS, parseThemeDefinition, type ThemeDefinition } from "./src/themes.js";

export async function readCustomThemes(directory: string): Promise<ThemeDefinition[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const themes = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map(async (entry) => {
      try {
        const theme = parseThemeDefinition(JSON.parse(await readFile(join(directory, entry.name), "utf8")));
        if (!theme || BUILTIN_THEME_IDS.has(theme.id) || entry.name !== `${theme.id}.json`) return undefined;
        return theme;
      } catch {
        return undefined;
      }
    }));
  return themes.filter((theme): theme is ThemeDefinition => Boolean(theme)).sort((left, right) => left.name.localeCompare(right.name));
}

export async function writeCustomTheme(directory: string, theme: ThemeDefinition): Promise<void> {
  if (BUILTIN_THEME_IDS.has(theme.id)) throw new Error("内置主题不能被覆盖。");
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${theme.id}.json`);
  const temporary = join(directory, `.${theme.id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(theme, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw new Error(`无法保存主题：${(error as Error).message}`);
  }
}
