import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convertEpubBytes } from "@airnobe/epub-normalizer";
import { deriveFurigana, loadTokenizer } from "@airnobe/furigana";
import { deleteLibraryEntryAtomically, readLibraryIndex, updateLibraryEntry, writeLibraryIndexAtomically } from "./library-store.js";
import { GETTING_STARTED_KEY, readBundledBooksState, syncGettingStartedBook, writeBundledBooksState } from "./bundled-books-store.js";

const execFileAsync = promisify(execFile);
const repositoryDirectory = resolve(import.meta.dirname, "../..");
const scriptPath = resolve(repositoryDirectory, "apps/desktop/scripts/build-guide-epub.mjs");
const epubPath = resolve(repositoryDirectory, "apps/desktop/src-tauri/resources/airnobe-getting-started.epub");
const directories: string[] = [];
let bytes: Uint8Array;

beforeAll(async () => {
  await execFileAsync(process.execPath, [scriptPath], { cwd: repositoryDirectory });
  bytes = await readFile(epubPath);
});

afterAll(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("bundled Airnobe getting-started book", () => {
  it("builds byte-for-byte reproducibly with an uncompressed first mimetype entry", async () => {
    const firstHash = createHash("sha256").update(bytes).digest("hex");
    await execFileAsync(process.execPath, [scriptPath], { cwd: repositoryDirectory });
    const rebuilt = await readFile(epubPath);
    expect(createHash("sha256").update(rebuilt).digest("hex")).toBe(firstHash);
    expect(rebuilt.subarray(0, 4).toString("binary")).toBe("PK\u0003\u0004");
    expect(rebuilt.readUInt16LE(8)).toBe(0);
    expect(rebuilt.subarray(30, 38).toString("utf8")).toBe("mimetype");
  });

  it("normalizes into paired content and derives all three annotation forms", async () => {
    const base = await convertEpubBytes(bytes, "Airnobe Start.epub");
    expect(base.book.metadata).toMatchObject({ title: "Airnobe Start", authors: ["Airnobe"] });
    expect(base.book.metadata.languages).toEqual(expect.arrayContaining(["zh-CN", "ja-JP"]));
    expect(base.book.source.identifier).toBe("urn:airnobe:getting-started");
    expect(base.book.coverAssetId).toBeTruthy();
    expect(base.report.metrics.parallelBlockCount).toBe(30);
    expect(base.report.metrics.spacerBlockCount).toBe(7);
    expect(base.report.metrics.sourceRubyCount).toBe(3);
    const derived = deriveFurigana(base, await loadTokenizer());
    expect(derived.report.metrics.generatedRubyCount).toBeGreaterThan(0);
    expect(derived.report.metrics.katakanaRomajiCount).toBeGreaterThan(0);
    expect(derived.report.warnings).toHaveLength(0);
  });

  it("installs only into a new library, defaults to reading, and respects deletion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-getting-started-"));
    directories.push(directory);
    const installed = await syncGettingStartedBook({ libraryDirectory: directory, epubPath, libraryWasMissing: true });
    expect(installed.outcome).toBe("installed");
    expect(installed.importResult?.entry.collectionStatus).toBe("reading");
    const bookId = installed.importResult?.entry.id as string;
    expect(await readFile(join(directory, "books", bookId, "source.epub"))).toEqual(Buffer.from(bytes));
    expect((await readBundledBooksState(join(directory, "bundled-books.json"))).books[GETTING_STARTED_KEY]?.bookId).toBe(bookId);
    await expect(syncGettingStartedBook({ libraryDirectory: directory, epubPath, libraryWasMissing: false })).resolves.toMatchObject({ outcome: "unchanged" });
    const index = await readLibraryIndex(join(directory, "library.json"));
    const updated = updateLibraryEntry(index, bookId, { collectionStatus: "completed", note: "keep me" }, "2026-08-09T00:00:00.000Z")!;
    await writeLibraryIndexAtomically(join(directory, "library.json"), updated.index);
    await writeFile(join(directory, "books", bookId, "reading-state.json"), "stale", "utf8");
    await writeFile(join(directory, "books", bookId, "bookmarks.json"), "stale", "utf8");
    await writeBundledBooksState(join(directory, "bundled-books.json"), {
      version: 1,
      books: { [GETTING_STARTED_KEY]: { bookId, sourceSha256: "0".repeat(64) } },
    });
    const refreshed = await syncGettingStartedBook({ libraryDirectory: directory, epubPath, libraryWasMissing: false });
    expect(refreshed.outcome).toBe("updated");
    expect(refreshed.importResult?.entry).toMatchObject({ id: bookId, collectionStatus: "completed", note: "keep me", addedAt: installed.importResult?.entry.addedAt });
    await expect(readFile(join(directory, "books", bookId, "reading-state.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(directory, "books", bookId, "bookmarks.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await deleteLibraryEntryAtomically(directory, bookId);
    await expect(syncGettingStartedBook({ libraryDirectory: directory, epubPath, libraryWasMissing: false })).resolves.toMatchObject({ outcome: "deleted" });
  }, 30_000);

  it("does not seed an existing empty index", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airnobe-getting-started-existing-"));
    directories.push(directory);
    await writeLibraryIndexAtomically(join(directory, "library.json"), { version: 1, books: [] });
    await expect(syncGettingStartedBook({ libraryDirectory: directory, epubPath, libraryWasMissing: false })).resolves.toMatchObject({ outcome: "skipped-existing-library" });
    expect((await readLibraryIndex(join(directory, "library.json"))).books).toHaveLength(0);
  });
});
