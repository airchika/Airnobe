import { afterEach, expect, it, vi } from "vitest";
import { clearReaderSession, loadReaderSession, saveReaderSession } from "./reader-session.js";

afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); });

it("ignores malformed or invalid browser checkpoints", () => {
  for (const value of ["{", "null", '{"version":1,"bookId":"../bad","position":null}', '{"version":1,"bookId":"01234567-89ab-4cde-8fab-0123456789ab","position":{"progress":2}}']) {
    window.sessionStorage.setItem("airnobe.reader-session.v1", value);
    expect(loadReaderSession()).toBeUndefined();
  }
});

it("does not break reading when browser storage is disabled", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("disabled"); });
  expect(loadReaderSession()).toBeUndefined();
  expect(() => saveReaderSession("01234567-89ab-4cde-8fab-0123456789ab", null)).not.toThrow();
  expect(() => clearReaderSession()).not.toThrow();
});
