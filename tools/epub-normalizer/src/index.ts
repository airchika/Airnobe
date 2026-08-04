import { readFile } from "node:fs/promises";
import { convertEpubBytes } from "./convert.js";
import { loadEpub, parsePackage } from "./epub.js";
import { writeConversionAtomically } from "./output.js";
import { sha256 } from "./util.js";

export { convertEpubBytes } from "./convert.js";
export { writeConversionAtomically, validateConversionResult } from "./output.js";
export { parsePackage, parseNavigation } from "./epub.js";
export type { ConversionResult, AssetPayload } from "./types.js";

export interface EpubInspection {
  sourceSha256: string;
  title: string;
  authors: string[];
  identifier?: string;
}

export async function inspectEpubBytes(bytes: Uint8Array): Promise<EpubInspection> {
  const packageInfo = await parsePackage(await loadEpub(bytes, []));
  return {
    sourceSha256: sha256(bytes),
    title: packageInfo.title,
    authors: packageInfo.authors,
    ...(packageInfo.uniqueIdentifier ? { identifier: packageInfo.uniqueIdentifier } : {}),
  };
}

export async function convertEpubFile(inputPath: string, outputDirectory: string, force = false) {
  const bytes = await readFile(inputPath);
  const result = await convertEpubBytes(bytes, inputPath);
  await writeConversionAtomically(outputDirectory, result, force);
  return result;
}
