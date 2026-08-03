import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BookDocumentSchema,
  BookManifestSchema,
  ConversionReportSchema,
  validateBookGraph,
} from "@airnobe/book-format";
import type { ConversionResult } from "./types.js";
import { jsonText } from "./util.js";

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertSafeSibling(target: string, candidate: string): void {
  const parent = path.dirname(target);
  if (path.dirname(candidate) !== parent || path.resolve(candidate) === path.parse(candidate).root) {
    throw new Error(`Unsafe transaction path: ${candidate}`);
  }
}

export function validateConversionResult(result: ConversionResult): void {
  BookManifestSchema.parse(result.book);
  ConversionReportSchema.parse(result.report);
  for (const document of result.documents) BookDocumentSchema.parse(document);
  const graphErrors = validateBookGraph(result.book, result.documents);
  const outputPaths = new Set(result.assets.map((asset) => asset.descriptor.path));
  for (const asset of result.book.assets) {
    if (!outputPaths.has(asset.path)) graphErrors.push(`asset payload is missing for ${asset.id}`);
  }
  if (graphErrors.length > 0) throw new Error(`Output validation failed:\n${graphErrors.join("\n")}`);
}

async function writeResult(directory: string, result: ConversionResult): Promise<void> {
  await mkdir(path.join(directory, "documents"), { recursive: true });
  await mkdir(path.join(directory, "assets"), { recursive: true });
  await writeFile(path.join(directory, "book.json"), jsonText(result.book), "utf8");
  for (let index = 0; index < result.documents.length; index += 1) {
    await writeFile(path.join(directory, "documents", `${String(index).padStart(4, "0")}.json`), jsonText(result.documents[index]), "utf8");
  }
  for (const asset of result.assets) {
    const target = path.join(directory, ...asset.descriptor.path.split("/"));
    await writeFile(target, asset.bytes);
  }
  await writeFile(path.join(directory, "report.json"), jsonText(result.report), "utf8");
}

async function validateWrittenResult(directory: string, expected: ConversionResult): Promise<void> {
  const book = BookManifestSchema.parse(JSON.parse(await readFile(path.join(directory, "book.json"), "utf8")));
  const report = ConversionReportSchema.parse(JSON.parse(await readFile(path.join(directory, "report.json"), "utf8")));
  const documents = [];
  for (const entry of book.readingOrder) {
    documents.push(BookDocumentSchema.parse(JSON.parse(await readFile(path.join(directory, ...entry.path.split("/")), "utf8"))));
  }
  validateConversionResult({ ...expected, book, report, documents });
  for (const asset of book.assets) await stat(path.join(directory, ...asset.path.split("/")));
}

export async function writeConversionAtomically(outputDirectory: string, result: ConversionResult, force = false): Promise<void> {
  const target = path.resolve(outputDirectory);
  if (target === path.parse(target).root) throw new Error("The filesystem root cannot be used as an output directory.");
  if (await exists(target) && !force) throw new Error(`Output directory already exists: ${target}`);
  const parent = path.dirname(target);
  const name = path.basename(target);
  await mkdir(parent, { recursive: true });
  const nonce = `${process.pid}-${Math.random().toString(16).slice(2)}`;
  const temporary = path.join(parent, `.${name}.airnobe-tmp-${nonce}`);
  const backup = path.join(parent, `.${name}.airnobe-backup-${nonce}`);
  assertSafeSibling(target, temporary);
  assertSafeSibling(target, backup);
  try {
    validateConversionResult(result);
    await writeResult(temporary, result);
    await validateWrittenResult(temporary, result);
    let movedExisting = false;
    if (await exists(target)) {
      await rename(target, backup);
      movedExisting = true;
    }
    try {
      await rename(temporary, target);
      if (movedExisting) await rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (movedExisting && !(await exists(target)) && await exists(backup)) await rename(backup, target);
      throw error;
    }
  } finally {
    if (await exists(temporary)) await rm(temporary, { recursive: true, force: true });
    if (await exists(backup) && await exists(target)) await rm(backup, { recursive: true, force: true });
  }
}
