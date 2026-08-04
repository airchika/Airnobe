import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { importLibraryBook, parseBaseSnapshot } from "./library-import.js";
import { readLibraryIndex } from "./library-store.js";

const runReal = process.env.RUN_REAL_EPUB_TESTS === "1";
const repositoryDirectory = resolve(process.cwd(), "../..");
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.skipIf(!runReal)("real EPUB library import", () => {
  it("stores Chinese P0 directly and Japanese output with a compressed base snapshot", async () => {
    const chinesePath = join(repositoryDirectory, "zjws.epub");
    const japanesePath = join(repositoryDirectory, "kokorokonekuto.epub");
    await access(chinesePath);
    await access(japanesePath);
    const directory = await mkdtemp(join(tmpdir(), "airnobe-library-real-"));
    temporaryDirectories.push(directory);

    const chineseBytes = await readFile(chinesePath);
    const chinese = await importLibraryBook({
      libraryDirectory: join(directory, "zh"),
      bytes: chineseBytes,
      fileName: "zjws.epub",
    });
    const chineseFiles = await readdir(join(directory, "zh", "books", chinese.entry.id));
    expect(chinese.entry.annotationStatus).toBe("not-applicable");
    expect(chineseFiles).toContain("source.epub");
    expect(chineseFiles).not.toContain("base.snapshot.json.gz");
    await expect(importLibraryBook({
      libraryDirectory: join(directory, "zh"),
      bytes: chineseBytes,
      fileName: "zjws.epub",
    })).rejects.toThrow(/已存在/);
    expect((await readLibraryIndex(join(directory, "zh", "library.json"))).books).toHaveLength(1);
    await expect(importLibraryBook({
      libraryDirectory: join(directory, "zh"),
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "broken.epub",
      replaceBookId: chinese.entry.id,
    })).rejects.toBeTruthy();
    expect(await readFile(join(directory, "zh", "books", chinese.entry.id, "source.epub"))).toEqual(chineseBytes);

    const japanese = await importLibraryBook({
      libraryDirectory: join(directory, "ja"),
      bytes: await readFile(japanesePath),
      fileName: "kokorokonekuto.epub",
    });
    const japaneseDirectory = join(directory, "ja", "books", japanese.entry.id);
    const japaneseFiles = await readdir(japaneseDirectory);
    expect(japanese.entry.annotationStatus).toBe("ready");
    expect(japaneseFiles).toContain("source.epub");
    expect(japaneseFiles).toContain("base.snapshot.json.gz");
    const snapshot = parseBaseSnapshot(await readFile(join(japaneseDirectory, "base.snapshot.json.gz")));
    expect(snapshot.book.derivation).toBeUndefined();
    expect(snapshot.documents.length).toBeGreaterThan(0);

    const failed = await importLibraryBook({
      libraryDirectory: join(directory, "ja-failed"),
      bytes: await readFile(japanesePath),
      fileName: "kokorokonekuto.epub",
      tokenizerFactory: async () => { throw new Error("fixture tokenizer failure"); },
    });
    const failedDirectory = join(directory, "ja-failed", "books", failed.entry.id);
    expect(failed.entry.annotationStatus).toBe("failed");
    expect(await readdir(failedDirectory)).not.toContain("base.snapshot.json.gz");
    const failedReport = JSON.parse(await readFile(join(failedDirectory, "report.json"), "utf8")) as {
      warnings: Array<{ code: string }>;
    };
    expect(failedReport.warnings.some((warning) => warning.code === "FURIGANA_DERIVATION_FAILED")).toBe(true);
  }, 120_000);
});
