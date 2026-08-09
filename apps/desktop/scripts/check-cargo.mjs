import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const desktopDirectory = resolve(import.meta.dirname, "..");
const tauriDirectory = resolve(desktopDirectory, "src-tauri");
const targetTriple = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
if (!targetTriple) throw new Error("无法确定 Rust 目标平台。");

const executableSuffix = process.platform === "win32" ? ".exe" : "";
const sidecarPath = resolve(tauriDirectory, "binaries", `airnobe-sidecar-${targetTriple}${executableSuffix}`);
const dictionaryDirectory = resolve(tauriDirectory, "resources", "kuromoji-dict");
const guideBuildScript = resolve(desktopDirectory, "scripts", "build-guide-epub.mjs");
const createdSidecar = !existsSync(sidecarPath);
const createdDictionary = !existsSync(dictionaryDirectory);

try {
  execFileSync(process.execPath, [guideBuildScript], { cwd: desktopDirectory, stdio: "inherit" });
  if (createdSidecar) {
    await mkdir(resolve(tauriDirectory, "binaries"), { recursive: true });
    await writeFile(sidecarPath, new Uint8Array());
  }
  if (createdDictionary) await mkdir(dictionaryDirectory, { recursive: true });

  const result = spawnSync("cargo", ["check", "--manifest-path", resolve(tauriDirectory, "Cargo.toml")], {
    cwd: desktopDirectory,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (createdSidecar) await rm(sidecarPath, { force: true });
  if (createdDictionary) await rm(dictionaryDirectory, { recursive: true, force: true });
}
