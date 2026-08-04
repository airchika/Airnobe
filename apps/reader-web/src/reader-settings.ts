export interface ReaderSettings {
  version: 1;
  navigation: {
    backwardTextSteps: number;
    forwardTextSteps: number;
  };
  pageTransitions: boolean;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  version: 1,
  navigation: {
    backwardTextSteps: 2,
    forwardTextSteps: 2,
  },
  pageTransitions: false,
};

export function isNavigationStepCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99;
}

export function parseReaderSettings(value: unknown): ReaderSettings | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.navigation !== "object" || record.navigation === null) return undefined;
  const navigation = record.navigation as Record<string, unknown>;
  if (!isNavigationStepCount(navigation.backwardTextSteps) || !isNavigationStepCount(navigation.forwardTextSteps)) return undefined;
  return {
    version: 1,
    navigation: {
      backwardTextSteps: navigation.backwardTextSteps,
      forwardTextSteps: navigation.forwardTextSteps,
    },
    pageTransitions: typeof record.pageTransitions === "boolean" ? record.pageTransitions : false,
  };
}

export function cloneReaderSettings(settings: ReaderSettings): ReaderSettings {
  return {
    version: 1,
    navigation: { ...settings.navigation },
    pageTransitions: settings.pageTransitions,
  };
}

async function settingsResponse(response: Response): Promise<ReaderSettings> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("阅读设置服务返回了无效响应。");
  }
  if (!response.ok) {
    const message = typeof value === "object" && value !== null && "error" in value
      ? String((value as { error: unknown }).error)
      : `阅读设置请求失败（${response.status}）。`;
    throw new Error(message);
  }
  const settings = parseReaderSettings(value);
  if (!settings) throw new Error("阅读设置服务返回了无效设置。");
  return settings;
}

export async function loadReaderSettings(): Promise<ReaderSettings> {
  return settingsResponse(await fetch("/api/settings"));
}

export async function saveReaderSettings(settings: ReaderSettings): Promise<ReaderSettings> {
  return settingsResponse(await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  }));
}
