import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { inlinePlainText } from "@airnobe/book-format";
import { parseConvertArgs, runConvertCli } from "./cli.js";
import { convertEpubBytes } from "./convert.js";
import { writeConversionAtomically } from "./output.js";
import { makeEpubFixture } from "./test-fixture.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("EPUB normalizer", () => {
  it("uses EPUB3 nav semantics but excludes nav from readingOrder", async () => {
    const result = await convertEpubBytes(await makeEpubFixture(), "fixture.epub");
    expect(result.report.metrics.spineDocumentCount).toBe(2);
    expect(result.book.readingOrder).toHaveLength(1);
    expect(result.book.toc[0]?.target?.documentId).toBe(result.documents[0]?.id);
    expect(result.book.toc[0]?.target?.fragmentId).toBe("start");
    expect(result.documents[0]?.anchors.start).toBeTruthy();
    expect(result.book.source.identifier).toBe("fixture-id");
  });

  it("pairs zh-jp only from the auto-novel anchor and preserves semantic AST", async () => {
    const result = await convertEpubBytes(await makeEpubFixture(), "fixture.epub");
    const parallel = result.documents[0]?.blocks.find((block) => block.type === "text" && block.variants.length === 2);
    expect(parallel?.type).toBe("text");
    if (parallel?.type !== "text") throw new Error("missing text block");
    expect(parallel.variants.map((variant) => [variant.language, variant.origin])).toEqual([
      ["ja-JP", "source"],
      ["zh-CN", "translation"],
    ]);
    expect(result.report.metrics.parallelBlockCount).toBe(1);
    expect(result.report.metrics.sourceRubyCount).toBe(1);
    const ruby = parallel.variants[0]?.content.find((node) => node.type === "ruby");
    expect(ruby).toEqual({ type: "ruby", origin: "source", readingType: "kana", segments: [{ base: "帰", reading: "き" }, { base: "還", reading: "かん" }] });
    expect(result.book.assets).toHaveLength(1);
  });

  it.each([
    ["rb+rt and rp", `<ruby><rb>帰</rb><rp>(</rp><rt>き</rt><rp>)</rp><rb>還</rb><rt>かん</rt></ruby>`],
    ["Kobo span bases", `<ruby><span>帰</span><rt>き</rt><span>還</span><rt>かん</rt></ruby>`],
  ])("parses %s ruby syntax", async (_name, rubyMarkup) => {
    const result = await convertEpubBytes(await makeEpubFixture({ rubyMarkup }), "ruby.epub");
    const rubies = result.documents.flatMap((document) => document.blocks.flatMap((block) => block.type === "text"
      ? block.variants.flatMap((variant) => variant.content.filter((node) => node.type === "ruby"))
      : []));
    expect(rubies[0]).toEqual({ type: "ruby", origin: "source", readingType: "kana", segments: [{ base: "帰", reading: "き" }, { base: "還", reading: "かん" }] });
  });

  it("infers jp-zh and retains multiple ordered translations", async () => {
    const result = await convertEpubBytes(await makeEpubFixture({ epub2: true, direction: "jp-zh", translations: 2 }), "fixture.epub");
    const block = result.documents[0]?.blocks.find((item) => item.type === "text" && item.variants.length === 3);
    expect(block?.type).toBe("text");
    if (block?.type !== "text") throw new Error("missing parallel block");
    expect(block.variants.slice(1).map((variant) => [variant.language, variant.order, inlinePlainText(variant.content)])).toEqual([
      ["zh-CN", 0, "中文译文1"],
      ["zh-CN", 1, "中文译文2"],
    ]);
    expect(result.report.adapter?.directions).toEqual(["jp-zh"]);
    expect(result.book.toc[0]?.target?.fragmentId).toBe("start");
  });

  it("keeps a pure Chinese EPUB without pairing warnings", async () => {
    const result = await convertEpubBytes(await makeEpubFixture({ pureChinese: true }), "zh.epub");
    expect(result.report.adapter).toBeUndefined();
    expect(result.report.metrics.parallelBlockCount).toBe(0);
    expect(result.report.metrics.unclassifiedTextCount).toBe(0);
    expect(result.report.warnings.some((warning) => warning.code.includes("UNPAIRED"))).toBe(false);
    const languages = result.documents[0]?.blocks.flatMap((block) => block.type === "text" ? block.variants.map((variant) => variant.language) : []);
    expect(new Set(languages)).toEqual(new Set(["zh-CN"]));
  });

  it.each([
    ["direct image", `<p id="start"><img src="../Images/pic.png" alt="插画"/></p>`],
    ["linked image", `<p id="start"><a href="#full"><img src="../Images/pic.png" alt="插画"/></a></p>`],
    ["wrapped image", `<p id="start"><span class="fit"><img src="../Images/pic.png" alt="插画"/></span></p>`],
  ])("promotes an image-only paragraph with %s to a block illustration", async (_name, bodyMarkup) => {
    const result = await convertEpubBytes(await makeEpubFixture({ bodyMarkup }), "image.epub");
    expect(result.documents[0]?.role).toBe("illustration");
    expect(result.documents[0]?.blocks).toHaveLength(1);
    expect(result.documents[0]?.blocks[0]).toMatchObject({ type: "image", role: "illustration", alt: "插画" });
  });

  it("keeps an image mixed with paragraph text as an inline gaiji", async () => {
    const bodyMarkup = `<p id="start">正文<img src="../Images/pic.png" alt="字"/>继续</p>`;
    const result = await convertEpubBytes(await makeEpubFixture({ bodyMarkup }), "gaiji.epub");
    const block = result.documents[0]?.blocks[0];
    expect(block?.type).toBe("text");
    if (block?.type !== "text") throw new Error("missing text block");
    expect(block.variants[0]?.content).toContainEqual({
      type: "image",
      assetId: result.book.assets[0]?.id,
      alt: "字",
      role: "gaiji",
    });
  });

  it("preserves explicit empty paragraphs as one interior spacer and redirects their anchors", async () => {
    const bodyMarkup = `<p id="leading"><br/></p><p id="start">第一段<br/></p><p id="gap-a"><span id="gap-child"><br/></span></p><p id="gap-b">　</p><p id="end">第二段</p><p id="trailing"></p>`;
    const result = await convertEpubBytes(await makeEpubFixture({ bodyMarkup }), "spacing.epub");
    const document = result.documents[0];
    expect(document?.blocks.map((block) => block.type)).toEqual(["text", "spacer", "text"]);
    expect(result.report.metrics.spacerBlockCount).toBe(1);
    const firstId = document?.blocks[0]?.id;
    const spacerId = document?.blocks[1]?.id;
    const lastId = document?.blocks[2]?.id;
    expect(document?.anchors).toMatchObject({
      leading: firstId,
      start: firstId,
      "gap-a": spacerId,
      "gap-child": spacerId,
      "gap-b": spacerId,
      end: lastId,
      trailing: lastId,
    });
  });

  it("does not classify image or unknown-content paragraphs as spacers", async () => {
    const result = await convertEpubBytes(await makeEpubFixture({ bodyMarkup: `<p id="start"><img src="../Images/pic.png" alt="插画"/></p><p><math/></p>` }), "not-spacers.epub");
    expect(result.report.metrics.spacerBlockCount).toBe(0);
    expect(result.documents[0]?.blocks.some((block) => block.type === "image")).toBe(true);
  });

  it("rejects dangerous archive paths and malformed XML", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("../escape.txt", "bad");
    await expect(convertEpubBytes(await zip.generateAsync({ type: "uint8array" }), "unsafe.epub")).rejects.toThrow(/Unsafe.*path/i);
    await expect(convertEpubBytes(await makeEpubFixture({ malformedChapter: true }), "bad.epub")).rejects.toThrow(/Invalid XML/);
  });

  it("writes deterministic output and only replaces with --force semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "airnobe-normalizer-test-"));
    temporaryDirectories.push(root);
    const first = join(root, "first");
    const second = join(root, "second");
    const result = await convertEpubBytes(await makeEpubFixture(), "fixture.epub");
    await writeConversionAtomically(first, result);
    await writeConversionAtomically(second, result);
    const listFiles = async (directory: string): Promise<string[]> => {
      const output: string[] = [];
      const walk = async (relative: string): Promise<void> => {
        for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
          const child = join(relative, entry.name);
          if (entry.isDirectory()) await walk(child);
          else output.push(child.replace(/\\/g, "/"));
        }
      };
      await walk("");
      return output.sort();
    };
    const files = await listFiles(first);
    expect(files).toEqual(await listFiles(second));
    for (const file of files) expect(await readFile(join(first, file))).toEqual(await readFile(join(second, file)));
    await expect(writeConversionAtomically(first, result)).rejects.toThrow(/already exists/);
    await writeConversionAtomically(first, result, true);
    const validBook = await readFile(join(first, "book.json"));
    const invalid = structuredClone(result);
    const firstEntry = invalid.book.readingOrder[0];
    if (firstEntry) firstEntry.documentId = "missing-document";
    await expect(writeConversionAtomically(first, invalid, true)).rejects.toThrow(/validation failed/i);
    expect(await readFile(join(first, "book.json"))).toEqual(validBook);
  });
});

describe("CLI", () => {
  it("uses exit code 2 for argument errors and parses --force", async () => {
    expect(await runConvertCli([])).toBe(2);
    expect(parseConvertArgs(["book.epub", "--out", "out", "--force"])).toEqual({ input: "book.epub", output: "out", force: true });
  });

  it("uses exit code 1 for I/O failures and 0 for success", async () => {
    expect(await runConvertCli(["missing.epub", "--out", "out"])).toBe(1);
    const root = await mkdtemp(join(tmpdir(), "airnobe-cli-test-"));
    temporaryDirectories.push(root);
    const input = join(root, "fixture.epub");
    await writeFile(input, await makeEpubFixture());
    const output = join(root, "book");
    expect(await runConvertCli([input, "--out", output])).toBe(0);
    expect(await runConvertCli([input, "--out", output])).toBe(1);
    expect(await runConvertCli([input, "--out", output, "--force"])).toBe(0);
  });
});
