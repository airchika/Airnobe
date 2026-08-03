#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { deriveFuriganaDirectory } from "./derive.js";

const USAGE = "Usage: airnobe-furigana <input-book-directory> --out <directory> [--force]";

function parseCli(args: string[]): { input: string; output: string; force: boolean } {
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
  const output = parsed.values.out;
  const force = parsed.values.force;
  if (parsed.values.help || parsed.positionals.length !== 1 || typeof output !== "string" || typeof force !== "boolean") {
    throw new TypeError(USAGE);
  }
  return { input: parsed.positionals[0] as string, output, force };
}

export async function runFuriganaCli(args: string[]): Promise<number> {
  let options: ReturnType<typeof parseCli>;
  try {
    options = parseCli(args);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  try {
    const result = await deriveFuriganaDirectory(options.input, options.output, options.force);
    console.log(`Derived: ${result.book.metadata.title || result.book.source.fileName}`);
    console.log(`Generated ruby: ${result.report.metrics.generatedRubyCount}`);
    console.log(`Warnings: ${result.report.warnings.length}`);
    console.log(`Output: ${options.output}`);
    return 0;
  } catch (error) {
    console.error(`Furigana derivation failed: ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runFuriganaCli(process.argv.slice(2));
}
