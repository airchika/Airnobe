import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAppState, parseAppState, parseAppStatePatch, saveAppState, saveLibraryFilter } from "./app-state.js";

afterEach(() => vi.restoreAllMocks());

describe("app state client", () => {
  const bookId = "01234567-89ab-4cde-8fab-0123456789ab";

  it("migrates v1 and parses the complete v2 state", () => {
    expect(parseAppState({ version: 1, lastReadingBookId: bookId })).toEqual({ version: 2, lastReadingBookId: bookId, libraryFilter: "all" });
    expect(parseAppState({ version: 2, lastReadingBookId: null, libraryFilter: "reading" })).toEqual({ version: 2, lastReadingBookId: null, libraryFilter: "reading" });
    expect(parseAppState({ version: 1, lastReadingBookId: "bad" })).toBeUndefined();
    expect(parseAppState({ version: 2, lastReadingBookId: null, libraryFilter: "bad" })).toBeUndefined();
  });

  it("accepts field-level patches without requiring the other field", () => {
    expect(parseAppStatePatch({ libraryFilter: "completed" })).toEqual({ libraryFilter: "completed" });
    expect(parseAppStatePatch({ lastReadingBookId: bookId })).toEqual({ lastReadingBookId: bookId });
    expect(parseAppStatePatch({})).toBeUndefined();
    expect(parseAppStatePatch({ libraryFilter: "unknown" })).toBeUndefined();
  });

  it("loads and saves through the dedicated API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 2, lastReadingBookId: bookId, libraryFilter: "all" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 2, lastReadingBookId: bookId, libraryFilter: "all" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 2, lastReadingBookId: bookId, libraryFilter: "reading" })));
    await expect(loadAppState()).resolves.toEqual({ version: 2, lastReadingBookId: bookId, libraryFilter: "all" });
    await expect(saveAppState(bookId)).resolves.toEqual({ version: 2, lastReadingBookId: bookId, libraryFilter: "all" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/app-state", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastReadingBookId: bookId }),
    });
    await expect(saveLibraryFilter("reading")).resolves.toEqual({ version: 2, lastReadingBookId: bookId, libraryFilter: "reading" });
  });
});
