import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convertEpubBytes } from "./convert.js";

const run = process.env.RUN_REAL_EPUB_TESTS === "1" ? describe : describe.skip;
const repository = resolve(import.meta.dirname, "../../..");
const realEpubDirectory = process.env.AIRNOBE_REAL_EPUB_DIR
  ? resolve(process.env.AIRNOBE_REAL_EPUB_DIR)
  : resolve(repository, "epub");

run("local real EPUB regression", () => {
  it("matches the measured mixed-book pairing and native-ruby totals", async () => {
    const expected = [
      ["asobinokankei2.epub", 3775, 1066],
      ["kagejitsu.epub", 4198, 602],
      ["kokorokonekuto.epub", 3366, 1244],
      ["mimozanoGaoBai.epub", 3717, 2795],
    ] as const;
    let pairs = 0;
    let rubies = 0;
    for (const [name, expectedPairs, expectedRubies] of expected) {
      const result = await convertEpubBytes(await readFile(resolve(realEpubDirectory, name)), name);
      expect(result.report.metrics.parallelBlockCount, name).toBe(expectedPairs);
      expect(result.report.metrics.sourceRubyCount, name).toBe(expectedRubies);
      expect(result.report.metrics.spacerBlockCount, name).toBeGreaterThan(0);
      const illustrationPaths = name === "kokorokonekuto.epub"
        ? ["text/part0000.html", "text/part0001.html", "text/part0002.html", "text/part0003.html", "text/part0004.html"]
        : name === "mimozanoGaoBai.epub"
          ? ["text/part0001.html", "text/part0002.html", "text/part0003.html", "text/part0004.html", "text/part0006.html"]
          : [];
      for (const sourcePath of illustrationPaths) {
        const document = result.documents.find((candidate) => candidate.sourcePath === sourcePath);
        expect(document?.role, `${name}:${sourcePath}`).toBe("illustration");
        expect(document?.blocks.every((block) => block.type === "image"), `${name}:${sourcePath}`).toBe(true);
      }
      pairs += result.report.metrics.parallelBlockCount;
      rubies += result.report.metrics.sourceRubyCount;
    }
    expect(pairs).toBe(15_056);
    expect(rubies).toBe(5_707);
  }, 120_000);

  it("excludes zjws nav and does not emit a whole-book unpaired warning", async () => {
    const result = await convertEpubBytes(await readFile(resolve(realEpubDirectory, "zjws.epub")), "zjws.epub");
    expect(result.report.metrics.spineDocumentCount).toBe(result.report.metrics.outputDocumentCount + 1);
    expect(result.report.metrics.textBlockCount).toBe(9_818);
    expect(result.report.metrics.spacerBlockCount).toBeGreaterThan(0);
    expect(result.report.warnings.some((warning) => warning.code.includes("UNPAIRED"))).toBe(false);
  }, 30_000);
});
