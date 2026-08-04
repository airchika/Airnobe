import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import kuromoji from "kuromoji";
import {
  BookDocumentSchema,
  BookManifestSchema,
  ConversionReportSchema,
  validateBookGraph,
} from "@airnobe/book-format";
import type { BookDocument, BookManifest, ConversionReport } from "@airnobe/book-format";
import { writeConversionAtomically } from "@airnobe/epub-normalizer";
import type { AssetPayload, ConversionResult } from "@airnobe/epub-normalizer";
import { annotateDocuments, type TokenizerLike } from "./annotate.js";

const require = createRequire(import.meta.url);
const packageJson = require("kuromoji/package.json") as { version: string };
export const KUROMOJI_VERSION = packageJson.version;
export const DICTIONARY_ID = "mecab-ipadic-2.7.0-20070801-bundled";

function derivedBookId(baseBookId: string): string {
  return `book-${createHash("sha256").update(`${baseBookId}:furigana:kuromoji:${KUROMOJI_VERSION}:${DICTIONARY_ID}`).digest("hex").slice(0, 16)}`;
}

export async function loadTokenizer(): Promise<TokenizerLike> {
  const dictionaryPath = join(dirname(require.resolve("kuromoji/package.json")), "dict").replace(/\\/g, "/");
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictionaryPath }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  });
}

export async function readBaseBook(inputDirectory: string): Promise<ConversionResult> {
  const book = BookManifestSchema.parse(JSON.parse(await readFile(join(inputDirectory, "book.json"), "utf8")));
  if (book.derivation) throw new Error("Input is already a furigana-derived book; repeated derivation is refused.");
  const report = ConversionReportSchema.parse(JSON.parse(await readFile(join(inputDirectory, "report.json"), "utf8")));
  const documents: BookDocument[] = [];
  for (const entry of book.readingOrder) {
    documents.push(BookDocumentSchema.parse(JSON.parse(await readFile(join(inputDirectory, ...entry.path.split("/")), "utf8"))));
  }
  const graphErrors = validateBookGraph(book, documents);
  if (graphErrors.length > 0) throw new Error(`Invalid base book:\n${graphErrors.join("\n")}`);
  const assets: AssetPayload[] = [];
  for (const descriptor of book.assets) {
    assets.push({ descriptor, bytes: await readFile(join(inputDirectory, ...descriptor.path.split("/"))) });
  }
  return { book, documents, report, assets };
}

export function deriveFurigana(base: ConversionResult, tokenizer: TokenizerLike): ConversionResult {
  if (base.book.derivation) throw new Error("Input is already a furigana-derived book; repeated derivation is refused.");
  const book = structuredClone(base.book) as BookManifest;
  const documents = structuredClone(base.documents) as BookDocument[];
  const report = structuredClone(base.report) as ConversionReport;
  const stats = annotateDocuments(documents, tokenizer);
  book.id = derivedBookId(base.book.id);
  book.derivation = {
    type: "furigana",
    baseBookId: base.book.id,
    engine: "kuromoji",
    engineVersion: KUROMOJI_VERSION,
    dictionary: DICTIONARY_ID,
  };
  report.metrics.generatedRubyCount = stats.generatedRubyCount;
  report.metrics.reusedRubyCount = stats.reusedRubyCount;
  if (stats.skippedLowConfidenceCount > 0) {
    report.warnings.push({
      code: "FURIGANA_LOW_CONFIDENCE_SKIPPED",
      message: `${stats.skippedLowConfidenceCount} unknown or person-name tokens were kept unchanged.`,
    });
  }
  report.status = report.warnings.length > 0 ? "ok-with-warnings" : "ok";
  return { book, documents, report, assets: base.assets };
}

export async function deriveFuriganaDirectory(inputDirectory: string, outputDirectory: string, force = false): Promise<ConversionResult> {
  const base = await readBaseBook(inputDirectory);
  const tokenizer = await loadTokenizer();
  const result = deriveFurigana(base, tokenizer);
  await writeConversionAtomically(outputDirectory, result, force);
  return result;
}
