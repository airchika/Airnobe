import { describe, expect, it } from "vitest";
import { DEFAULT_READER_SETTINGS, parseReaderSettings } from "./reader-settings.js";

describe("reader settings v8", () => {
  it("accepts and clones the current settings", () => {
    expect(parseReaderSettings(structuredClone(DEFAULT_READER_SETTINGS))).toEqual(DEFAULT_READER_SETTINGS);
  });

  it("migrates v6 appearance and menu shortcuts", () => {
    const { toggleSidebar: _sidebar, returnLibrary: _library, ...reading } = DEFAULT_READER_SETTINGS.shortcuts;
    const migrated = parseReaderSettings({
      version: 6,
      navigation: { textSteps: 4 },
      shortcuts: { ...reading, toggleMenu: { code: "Digit1" }, toggleToc: { code: "Digit2" } },
      pageTransitions: true,
      appearance: {
        themeId: "warm-paper",
        typography: { fontSize: 20, fontWeight: 600, lineHeight: 1.7, paragraphSpacing: 1.2, columnWidth: 800, japaneseOpacity: 0.5 },
        defaults: { showJapanese: true, showAssistedRuby: false, showKatakanaRomaji: true },
      },
    });
    expect(migrated).toMatchObject({ version: 8, navigation: { textSteps: 4 }, pageTransitions: true });
    expect(migrated?.shortcuts.toggleSidebar).toEqual({ code: "Digit1" });
    expect(migrated?.shortcuts.returnLibrary).toEqual({ code: "Digit2" });
    expect(migrated?.appearance.theme).toMatchObject({ mode: "day", lightThemeId: "warm-paper" });
    expect(migrated?.appearance.display).toMatchObject({ showJapanese: true, showKatakanaRomaji: true });
    expect(migrated?.appearance.typography.rubyScale).toBe(0.6);
  });

  it("rejects invalid ruby size and duplicate bindings", () => {
    const invalid = structuredClone(DEFAULT_READER_SETTINGS);
    invalid.appearance.typography.rubyScale = 0.9;
    expect(parseReaderSettings(invalid)).toBeUndefined();
    const duplicate = structuredClone(DEFAULT_READER_SETTINGS);
    duplicate.shortcuts.returnLibrary = duplicate.shortcuts.toggleSidebar;
    expect(parseReaderSettings(duplicate)).toBeUndefined();
  });
});
