import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function collectWorkspacePackageFiles() {
  const files = [resolve(repositoryDirectory, "package.json")];
  for (const group of ["apps", "packages", "tools"]) {
    const groupDirectory = resolve(repositoryDirectory, group);
    for (const entry of await readdir(groupDirectory, { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(resolve(groupDirectory, entry.name, "package.json"));
    }
  }
  return files;
}

function packageVersionFromToml(contents, name) {
  const packageSection = contents.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error(`无法读取 ${name} 的 [package].version。`);
  return version;
}

function packageVersionFromCargoLock(contents, packageName) {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const packageBlock = contents.match(new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${escapedName}"([\\s\\S]*?)(?=\\r?\\n\\[\\[package\\]\\]|$)`))?.[1];
  const version = packageBlock?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error(`无法读取 Cargo.lock 中 ${packageName} 的版本。`);
  return version;
}

const rootPackage = await readJson(resolve(repositoryDirectory, "package.json"));
const expectedVersion = rootPackage.version;
const requestedTag = process.argv[2];

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
  throw new Error(`根 package.json 的版本不是受支持的 SemVer：${expectedVersion}`);
}
if (requestedTag && requestedTag !== `v${expectedVersion}`) {
  throw new Error(`发布标签 ${requestedTag} 与项目版本 v${expectedVersion} 不一致。`);
}

const versions = [];
const packageFiles = await collectWorkspacePackageFiles();
const workspaceLockPaths = new Set(packageFiles.map((path) => {
  const packagePath = relative(repositoryDirectory, dirname(path)).replaceAll("\\", "/");
  return packagePath === "." ? "" : packagePath;
}));
for (const path of packageFiles) {
  const value = await readJson(path);
  if (!value.name || !value.version) throw new Error(`${relative(repositoryDirectory, path)} 缺少 name 或 version。`);
  versions.push([relative(repositoryDirectory, path), value.version]);
}

const lock = await readJson(resolve(repositoryDirectory, "package-lock.json"));
versions.push(["package-lock.json", lock.version]);
for (const [path, value] of Object.entries(lock.packages ?? {})) {
  if (workspaceLockPaths.has(path)) {
    versions.push([`package-lock.json:${path || "root"}`, value.version]);
  }
}

const tauriConfig = await readJson(resolve(repositoryDirectory, "apps/desktop/src-tauri/tauri.conf.json"));
versions.push(["apps/desktop/src-tauri/tauri.conf.json", tauriConfig.version]);

const cargoToml = await readFile(resolve(repositoryDirectory, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
versions.push(["apps/desktop/src-tauri/Cargo.toml", packageVersionFromToml(cargoToml, "Cargo.toml")]);

const cargoLock = await readFile(resolve(repositoryDirectory, "apps/desktop/src-tauri/Cargo.lock"), "utf8");
versions.push(["apps/desktop/src-tauri/Cargo.lock:airnobe-desktop", packageVersionFromCargoLock(cargoLock, "airnobe-desktop")]);

const mismatches = versions.filter(([, version]) => version !== expectedVersion);
if (mismatches.length > 0) {
  const details = mismatches.map(([path, version]) => `- ${path}: ${String(version)}`).join("\n");
  throw new Error(`以下版本与 ${expectedVersion} 不一致：\n${details}`);
}

console.log(`Airnobe ${expectedVersion} 版本一致性检查通过（${versions.length} 项）。`);
