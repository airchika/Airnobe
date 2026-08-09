import { describe, expect, it } from "vitest";
import { assignShortcutBinding, DEFAULT_READER_SETTINGS, DEFAULT_SHORTCUTS, parseReaderSettings } from "./reader-settings.js";

describe("reader settings v13", () => {
  it("accepts the current settings, empty bindings, and the 800 weight", () => {
    const settings = structuredClone(DEFAULT_READER_SETTINGS);
    settings.appearance.typography.fontWeight = 800;
    settings.shortcuts.toggleFullscreen = null;
    settings.shortcuts.returnLibrary = null;
    expect(parseReaderSettings(settings)).toEqual(settings);
  });

  it("migrates v8 appearance and navigation while resetting shortcuts", () => {
    const migrated = parseReaderSettings({
      version: 8,
      navigation: { textSteps: 12 },
      shortcuts: {
        toggleJapanese: { code: "KeyQ" }, toggleAssistedRuby: { code: "KeyE" }, toggleKatakanaRomaji: { code: "KeyZ" },
        topBackward: { code: "KeyR" }, topForward: { code: "KeyF" }, bottomBackward: { code: "KeyW" }, bottomForward: { code: "KeyS" },
        pageUp: { code: "KeyA" }, pageDown: { code: "KeyD" }, toggleSidebar: { code: "Digit1" }, returnLibrary: { code: "Digit2" },
      },
      pageTransitions: true,
      appearance: structuredClone(DEFAULT_READER_SETTINGS.appearance),
    });
    expect(migrated).toMatchObject({ version: 13, navigation: { textSteps: 10 }, pageTransitions: true });
    expect(migrated?.shortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(migrated?.appearance).toEqual(DEFAULT_READER_SETTINGS.appearance);
  });

  it("migrates v9 with opaque Chinese text", () => {
    const legacy = structuredClone(DEFAULT_READER_SETTINGS) as unknown as Record<string, unknown>;
    legacy.version = 9;
    const appearance = legacy.appearance as Record<string, Record<string, unknown>>;
    delete appearance.typography?.chineseOpacity;
    const migrated = parseReaderSettings(legacy);
    expect(migrated).toMatchObject({ version: 13, appearance: { typography: { chineseOpacity: 1 } } });
    expect(migrated?.appearance.display).not.toHaveProperty("showScrollbar");
    expect(migrated?.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it("migrates v10 while dropping the old scrollbar setting", () => {
    const legacy = structuredClone(DEFAULT_READER_SETTINGS) as unknown as Record<string, unknown>;
    legacy.version = 10;
    const appearance = legacy.appearance as { display: Record<string, unknown> };
    appearance.display.showScrollbar = false;
    const migrated = parseReaderSettings(legacy);
    expect(migrated?.version).toBe(13);
    expect(migrated?.appearance.display).not.toHaveProperty("showScrollbar");
  });

  it("resets v12 shortcuts while preserving non-shortcut settings", () => {
    const legacy = structuredClone(DEFAULT_READER_SETTINGS) as unknown as Record<string, unknown>;
    legacy.version = 12;
    legacy.navigation = { textSteps: 7 };
    legacy.pageTransitions = true;
    (legacy.shortcuts as Record<string, unknown>).toggleJapanese = { code: "KeyV" };
    ((legacy.appearance as Record<string, unknown>).typography as Record<string, unknown>).fontSize = 24;
    const migrated = parseReaderSettings(legacy);
    expect(migrated).toMatchObject({ version: 13, navigation: { textSteps: 7 }, pageTransitions: true, appearance: { typography: { fontSize: 24 } } });
    expect(migrated?.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it("swaps occupied bindings and moves an occupied binding to empty", () => {
    const swapped = assignShortcutBinding(DEFAULT_SHORTCUTS, "toggleFullscreen", { code: "KeyE" });
    expect(swapped.toggleFullscreen).toEqual({ code: "KeyE" });
    expect(swapped.returnLibrary).toEqual({ code: "KeyF" });
    const withoutFullscreen = assignShortcutBinding(swapped, "toggleFullscreen", null);
    const moved = assignShortcutBinding(withoutFullscreen, "toggleFullscreen", { code: "KeyF" });
    expect(moved.toggleFullscreen).toEqual({ code: "KeyF" });
    expect(moved.returnLibrary).toBeNull();
    const withModifiers = assignShortcutBinding(moved, "pageUp", { code: "KeyM", modifier: "Control" });
    const modifierSwap = assignShortcutBinding(withModifiers, "pageDown", { code: "KeyM", modifier: "Control" });
    expect(modifierSwap.pageDown).toEqual({ code: "KeyM", modifier: "Control" });
    expect(modifierSwap.pageUp).toEqual({ code: "KeyD" });
  });

  it("rejects invalid current values and duplicate non-empty bindings", () => {
    const invalidRuby = structuredClone(DEFAULT_READER_SETTINGS);
    invalidRuby.appearance.typography.rubyScale = 0.9;
    expect(parseReaderSettings(invalidRuby)).toBeUndefined();
    const invalidChineseOpacity = structuredClone(DEFAULT_READER_SETTINGS);
    invalidChineseOpacity.appearance.typography.chineseOpacity = 0.1;
    expect(parseReaderSettings(invalidChineseOpacity)).toBeUndefined();
    const invalidSteps = structuredClone(DEFAULT_READER_SETTINGS);
    invalidSteps.navigation.textSteps = 11;
    expect(parseReaderSettings(invalidSteps)).toBeUndefined();
    const duplicate = structuredClone(DEFAULT_READER_SETTINGS);
    duplicate.shortcuts.pageDown = duplicate.shortcuts.pageUp;
    expect(parseReaderSettings(duplicate)).toBeUndefined();
  });
});
