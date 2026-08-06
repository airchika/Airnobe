import { describe, expect, it } from "vitest";
import { DEFAULT_READER_SETTINGS, DEFAULT_SHORTCUTS, parseReaderSettings } from "./reader-settings.js";

describe("reader settings v9", () => {
  it("accepts the current settings and the 800 weight", () => {
    const settings = structuredClone(DEFAULT_READER_SETTINGS);
    settings.appearance.typography.fontWeight = 800;
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
    expect(migrated).toMatchObject({ version: 9, navigation: { textSteps: 10 }, pageTransitions: true });
    expect(migrated?.shortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(migrated?.appearance).toEqual(DEFAULT_READER_SETTINGS.appearance);
  });

  it("rejects invalid current values and duplicate bindings", () => {
    const invalidRuby = structuredClone(DEFAULT_READER_SETTINGS);
    invalidRuby.appearance.typography.rubyScale = 0.9;
    expect(parseReaderSettings(invalidRuby)).toBeUndefined();
    const invalidSteps = structuredClone(DEFAULT_READER_SETTINGS);
    invalidSteps.navigation.textSteps = 11;
    expect(parseReaderSettings(invalidSteps)).toBeUndefined();
    const duplicate = structuredClone(DEFAULT_READER_SETTINGS);
    duplicate.shortcuts.pageDown = duplicate.shortcuts.pageUp;
    expect(parseReaderSettings(duplicate)).toBeUndefined();
  });
});
