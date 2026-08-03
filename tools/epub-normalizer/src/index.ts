import { readFile } from "node:fs/promises";
import { convertEpubBytes } from "./convert.js";
import { writeConversionAtomically } from "./output.js";

export { convertEpubBytes } from "./convert.js";
export { writeConversionAtomically, validateConversionResult } from "./output.js";
export { parsePackage, parseNavigation } from "./epub.js";
export type { ConversionResult, AssetPayload } from "./types.js";

export async function convertEpubFile(inputPath: string, outputDirectory: string, force = false) {
  const bytes = await readFile(inputPath);
  const result = await convertEpubBytes(bytes, inputPath);
  await writeConversionAtomically(outputDirectory, result, force);
  return result;
}
