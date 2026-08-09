import { afterEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openExternalUrl } from "./external-links.js";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("external links", () => {
  it("opens a new browser tab outside Tauri", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await openExternalUrl("https://n.novelia.cc/");
    expect(open).toHaveBeenCalledWith("https://n.novelia.cc/", "_blank", "noopener,noreferrer");
  });

  it("uses the Tauri opener in the desktop runtime", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    await openExternalUrl("https://n.novelia.cc/");
    expect(openUrl).toHaveBeenCalledWith("https://n.novelia.cc/");
  });
});
