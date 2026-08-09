import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAppState, parseAppState, saveAppState } from "./app-state.js";

afterEach(() => vi.restoreAllMocks());

describe("app state client", () => {
  const bookId = "01234567-89ab-4cde-8fab-0123456789ab";

  it("parses only the versioned last-book state", () => {
    expect(parseAppState({ version: 1, lastReadingBookId: bookId })).toEqual({ version: 1, lastReadingBookId: bookId });
    expect(parseAppState({ version: 1, lastReadingBookId: null })).toEqual({ version: 1, lastReadingBookId: null });
    expect(parseAppState({ version: 1, lastReadingBookId: "bad" })).toBeUndefined();
    expect(parseAppState({ version: 1, lastReadingBookId: null, extra: true })).toBeUndefined();
  });

  it("loads and saves through the dedicated API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, lastReadingBookId: bookId })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, lastReadingBookId: bookId })));
    await expect(loadAppState()).resolves.toEqual({ version: 1, lastReadingBookId: bookId });
    await expect(saveAppState(bookId)).resolves.toEqual({ version: 1, lastReadingBookId: bookId });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/app-state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, lastReadingBookId: bookId }),
    });
  });
});
