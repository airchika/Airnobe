import { describe, expect, it } from "vitest";
import { DEFAULT_READER_APPEARANCE, DEFAULT_READER_SETTINGS, parseReaderSettings } from "./reader-settings.js";

describe("reader settings", () => {
  it("uses one two-block navigation distance and eleven default shortcuts", () => {
    expect(DEFAULT_READER_SETTINGS).toEqual({
      version: 6,
      navigation: { textSteps: 2 },
      shortcuts: {
        toggleJapanese: { code: "KeyQ" },
        toggleAssistedRuby: { code: "KeyE" },
        toggleKatakanaRomaji: { code: "KeyZ" },
        topBackward: { code: "KeyR" },
        topForward: { code: "KeyF" },
        bottomBackward: { code: "KeyW" },
        bottomForward: { code: "KeyS" },
        pageUp: { code: "KeyA" },
        pageDown: { code: "KeyD" },
        toggleMenu: { code: "Digit1" },
        toggleToc: { code: "Digit2" },
      },
      pageTransitions: false,
      appearance: DEFAULT_READER_APPEARANCE,
    });
  });

  it("accepts valid v6 settings and optional single modifiers", () => {
    const value = structuredClone(DEFAULT_READER_SETTINGS);
    value.navigation.textSteps = 9;
    value.shortcuts.topBackward = { code: "ArrowUp", modifier: "Control" };
    value.pageTransitions = true;
    expect(parseReaderSettings(value)).toEqual(value);
  });

  it("migrates v2 bindings and finds a free directory key without overwriting", () => {
    const { toggleMenu: _toggleMenu, toggleToc: _toggleToc, ...legacyShortcuts } = DEFAULT_READER_SETTINGS.shortcuts;
    legacyShortcuts.pageDown = { code: "Digit1" };
    const migrated = parseReaderSettings({
      version: 2,
      navigation: { textSteps: 4 },
      shortcuts: legacyShortcuts,
      pageTransitions: true,
    });
    expect(migrated).toEqual({
      version: 6,
      navigation: { textSteps: 4 },
      shortcuts: { ...legacyShortcuts, toggleMenu: { code: "Digit3" }, toggleToc: { code: "Digit2" } },
      pageTransitions: true,
      appearance: DEFAULT_READER_APPEARANCE,
    });
  });

  it("migrates v4 and validates v6 appearance ranges", () => {
    const legacy = structuredClone(DEFAULT_READER_SETTINGS) as unknown as Record<string, unknown>;
    legacy.version = 4;
    delete legacy.appearance;
    expect(parseReaderSettings(legacy)?.appearance).toEqual(DEFAULT_READER_APPEARANCE);
    const invalid = structuredClone(DEFAULT_READER_SETTINGS);
    invalid.appearance.typography.lineHeight = 1.3;
    expect(parseReaderSettings(invalid)).toBeUndefined();
    invalid.appearance.typography.lineHeight = 1.6;
    invalid.appearance.typography.paragraphSpacing = 2.1;
    expect(parseReaderSettings(invalid)).toBeUndefined();
  });

  it("migrates v5 line spacing and adds paragraph spacing", () => {
    const legacy = structuredClone(DEFAULT_READER_SETTINGS) as unknown as { version: number; appearance: { typography: Record<string, number> } };
    legacy.version = 5;
    legacy.appearance.typography.lineHeight = 2.05;
    delete legacy.appearance.typography.paragraphSpacing;
    expect(parseReaderSettings(legacy)?.appearance.typography).toMatchObject({ lineHeight: 1.6, paragraphSpacing: 1 });

    legacy.appearance.typography.lineHeight = 2.6;
    expect(parseReaderSettings(legacy)?.appearance.typography.lineHeight).toBe(2.2);
    legacy.appearance.typography.lineHeight = 1.9;
    expect(parseReaderSettings(legacy)?.appearance.typography.lineHeight).toBe(1.9);
  });

  it("migrates the default v3 directory key to Digit2 and reserves Digit1 for the menu", () => {
    const { toggleMenu: _toggleMenu, ...v3Shortcuts } = DEFAULT_READER_SETTINGS.shortcuts;
    v3Shortcuts.toggleToc = { code: "Digit1" };
    expect(parseReaderSettings({
      version: 3,
      navigation: { textSteps: 2 },
      shortcuts: v3Shortcuts,
      pageTransitions: false,
    })).toEqual(DEFAULT_READER_SETTINGS);
  });

  it("preserves customized v3 bindings and finds a free menu key", () => {
    const { toggleMenu: _toggleMenu, ...v3Shortcuts } = DEFAULT_READER_SETTINGS.shortcuts;
    v3Shortcuts.pageDown = { code: "Digit1" };
    v3Shortcuts.toggleToc = { code: "KeyT" };
    const migrated = parseReaderSettings({
      version: 3,
      navigation: { textSteps: 5 },
      shortcuts: v3Shortcuts,
      pageTransitions: true,
    });
    expect(migrated?.shortcuts.pageDown).toEqual({ code: "Digit1" });
    expect(migrated?.shortcuts.toggleToc).toEqual({ code: "KeyT" });
    expect(migrated?.shortcuts.toggleMenu).toEqual({ code: "Digit2" });
  });

  it("migrates valid v1 settings with a reset two-block distance", () => {
    expect(parseReaderSettings({
      version: 1,
      navigation: { backwardTextSteps: 3, forwardTextSteps: 9 },
      pageTransitions: true,
    })).toEqual({ ...DEFAULT_READER_SETTINGS, pageTransitions: true });
  });

  it("rejects invalid counts, bindings, modifiers, and duplicate chords", () => {
    const invalidCount = structuredClone(DEFAULT_READER_SETTINGS);
    invalidCount.navigation.textSteps = 0;
    expect(parseReaderSettings(invalidCount)).toBeUndefined();

    const invalidCode = structuredClone(DEFAULT_READER_SETTINGS) as unknown as { shortcuts: { pageDown: { code: string } } };
    invalidCode.shortcuts.pageDown.code = "F5";
    expect(parseReaderSettings(invalidCode)).toBeUndefined();

    const invalidModifier = structuredClone(DEFAULT_READER_SETTINGS) as unknown as { shortcuts: { pageDown: { code: string; modifier: string } } };
    invalidModifier.shortcuts.pageDown.modifier = "Meta";
    expect(parseReaderSettings(invalidModifier)).toBeUndefined();

    const duplicate = structuredClone(DEFAULT_READER_SETTINGS);
    duplicate.shortcuts.pageDown = { code: "KeyA" };
    expect(parseReaderSettings(duplicate)).toBeUndefined();
  });
});
