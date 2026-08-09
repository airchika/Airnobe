import { BUILTIN_THEMES, parseThemeDefinition, type ThemeDefinition } from "./themes.js";
import { apiFetch } from "./api-transport.js";

export interface AvailableTheme {
  theme: ThemeDefinition;
  builtin: boolean;
}

function parseThemeList(value: unknown): AvailableTheme[] {
  if (typeof value !== "object" || value === null || !("themes" in value) || !Array.isArray(value.themes)) {
    throw new Error("主题服务返回了无效响应。");
  }
  return value.themes.map((item) => {
    if (typeof item !== "object" || item === null || !("theme" in item) || typeof item.builtin !== "boolean") {
      throw new Error("主题服务返回了无效主题。");
    }
    const theme = parseThemeDefinition(item.theme);
    if (!theme) throw new Error("主题服务返回了无效主题。");
    return { theme, builtin: item.builtin };
  });
}

async function responseJson(response: Response): Promise<unknown> {
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error("主题服务返回了无效响应。"); }
  if (!response.ok) {
    const message = typeof value === "object" && value !== null && "error" in value
      ? String((value as { error: unknown }).error)
      : `主题请求失败（${response.status}）。`;
    throw new Error(message);
  }
  return value;
}

export async function loadThemes(): Promise<AvailableTheme[]> {
  return parseThemeList(await responseJson(await apiFetch("/api/themes")));
}

export async function importTheme(theme: ThemeDefinition): Promise<AvailableTheme> {
  const value = await responseJson(await apiFetch(`/api/themes/${encodeURIComponent(theme.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(theme),
  }));
  if (typeof value !== "object" || value === null || !("theme" in value)) throw new Error("主题服务返回了无效主题。");
  const parsed = parseThemeDefinition(value.theme);
  if (!parsed) throw new Error("主题服务返回了无效主题。");
  return { theme: parsed, builtin: false };
}

export function builtinThemeOptions(): AvailableTheme[] {
  return BUILTIN_THEMES.map((theme) => ({ theme, builtin: true }));
}
