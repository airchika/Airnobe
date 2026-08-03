#!/usr/bin/env node
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { convertEpubFile } from "./index.js";

const USAGE = "Usage: airnobe-convert <input.epub> --out <directory> [--force]";

export interface ConvertCliOptions {
  input: string;
  output: string;
  force: boolean;
}

export function parseConvertArgs(args: string[]): ConvertCliOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: "string", short: "o" },
        force: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new TypeError(`${(error as Error).message}\n${USAGE}`);
  }
  if (parsed.values.help) throw new TypeError(USAGE);
  if (parsed.positionals.length !== 1 || !parsed.values.out) throw new TypeError(USAGE);
  const output = parsed.values.out;
  const force = parsed.values.force;
  if (typeof output !== "string" || typeof force !== "boolean") throw new TypeError(USAGE);
  return { input: parsed.positionals[0] as string, output, force };
}

export async function runConvertCli(args: string[]): Promise<number> {
  let options: ConvertCliOptions;
  try {
    options = parseConvertArgs(args);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  try {
    const result = await convertEpubFile(options.input, options.output, options.force);
    console.log(`Converted: ${result.book.metadata.title || result.book.source.fileName}`);
    console.log(`Documents: ${result.report.metrics.outputDocumentCount}`);
    console.log(`Parallel blocks: ${result.report.metrics.parallelBlockCount}`);
    console.log(`Warnings: ${result.report.warnings.length}`);
    console.log(`Output: ${options.output}`);
    return 0;
  } catch (error) {
    console.error(`Conversion failed: ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runConvertCli(process.argv.slice(2));
}
