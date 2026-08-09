import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(desktopDirectory, "../..");
const tauriDirectory = resolve(desktopDirectory, "src-tauri");
const buildDirectory = resolve(desktopDirectory, ".sidecar-build");
const bundledEntry = resolve(buildDirectory, "airnobe-sidecar.cjs");
const targetTriple = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
if (!targetTriple) throw new Error("无法确定 Rust 目标平台。");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const output = resolve(tauriDirectory, "binaries", `airnobe-sidecar-${targetTriple}${executableSuffix}`);
const dictionaryTarget = resolve(tauriDirectory, "resources", "kuromoji-dict");

rmSync(buildDirectory, { recursive: true, force: true });
mkdirSync(buildDirectory, { recursive: true });
mkdirSync(dirname(output), { recursive: true });
rmSync(dictionaryTarget, { recursive: true, force: true });
cpSync(resolve(repositoryDirectory, "node_modules", "kuromoji", "dict"), dictionaryTarget, { recursive: true });

await build({
  entryPoints: [resolve(repositoryDirectory, "apps", "reader-web", "dev-server.ts")],
  outfile: bundledEntry,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "bundle",
  external: ["vite"],
  define: { "import.meta.url": "__filename" },
  logLevel: "info",
});

const pkgCli = resolve(repositoryDirectory, "node_modules", "@yao-pkg", "pkg", "lib-es5", "bin.js");
execFileSync(process.execPath, [
  pkgCli,
  "--targets", `node22-${process.platform === "win32" ? "win" : process.platform}-${process.arch}`,
  "--compress", "GZip",
  "--output", output,
  bundledEntry,
], { cwd: repositoryDirectory, stdio: "inherit" });

console.log(`Airnobe sidecar: ${output}`);
