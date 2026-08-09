import { describe, expect, it } from "vitest";
import { desktopShortcutFromEvent } from "./desktop-settings.js";

describe("desktopShortcutFromEvent", () => {
  it("captures multiple modifiers in a stable order", () => {
    expect(desktopShortcutFromEvent(new KeyboardEvent("keydown", {
      code: "KeyE", key: "e", ctrlKey: true, altKey: true,
    }))).toBe("Ctrl+Alt+E");
    expect(desktopShortcutFromEvent(new KeyboardEvent("keydown", {
      code: "Digit4", key: "$", ctrlKey: true, shiftKey: true,
    }))).toBe("Ctrl+Shift+4");
  });

  it("rejects modifier-only, Meta and unsupported keys", () => {
    expect(desktopShortcutFromEvent(new KeyboardEvent("keydown", { code: "ControlLeft", key: "Control", ctrlKey: true }))).toBeUndefined();
    expect(desktopShortcutFromEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "e", metaKey: true }))).toBeUndefined();
    expect(desktopShortcutFromEvent(new KeyboardEvent("keydown", { code: "Backquote", key: "`" }))).toBeUndefined();
  });

  it("supports function and navigation keys", () => {
    expect(desktopShortcutFromEvent(new KeyboardEvent("keydown", { code: "F11", key: "F11" }))).toBe("F11");
    expect(desktopShortcutFromEvent(new KeyboardEvent("keydown", { code: "ArrowUp", key: "ArrowUp", altKey: true }))).toBe("Alt+Up");
  });
});
