import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const desktopDirectory = resolve(import.meta.dirname, "..");
const repositoryDirectory = resolve(desktopDirectory, "../..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("无法定位 npm CLI，请通过 npm run desktop 启动。");
const tauriCli = resolve(repositoryDirectory, "node_modules/@tauri-apps/cli/tauri.js");
const readerServer = resolve(repositoryDirectory, "apps/reader-web/dev-server.ts");
const cargoBin = resolve(process.env.USERPROFILE ?? "", ".cargo/bin");
const childEnvironment = {
  ...process.env,
  PATH: process.platform === "win32" ? `${cargoBin};${process.env.PATH ?? ""}` : `${cargoBin}:${process.env.PATH ?? ""}`,
};

let readerProcess;
let tauriProcess;
let stopping = false;

function run(command, args, cwd = repositoryDirectory) {
  const result = spawnSync(command, args, { cwd, env: childEnvironment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function isAirnobeServerReady() {
  try {
    const response = await fetch("http://127.0.0.1:5173/api/library", { signal: AbortSignal.timeout(800) });
    if (!response.ok) return false;
    const value = await response.json();
    return value !== null && typeof value === "object" && Array.isArray(value.books);
  } catch {
    return false;
  }
}

async function waitForReader() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isAirnobeServerReady()) return;
    if (readerProcess?.exitCode !== null) throw new Error(`Reader 服务提前退出（${readerProcess?.exitCode ?? "未知状态"}）。`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("等待 Reader 服务启动超时。");
}

function stopReader() {
  if (!readerProcess || readerProcess.exitCode !== null) return;
  readerProcess.kill();
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(readerProcess.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

function stopChildren() {
  if (stopping) return;
  stopping = true;
  if (tauriProcess?.exitCode === null) tauriProcess.kill();
  stopReader();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopChildren();
    process.exitCode = 0;
  });
}

process.on("exit", stopReader);

try {
  const reuseReader = await isAirnobeServerReady();
  if (reuseReader) {
    console.log("使用已运行的 Airnobe Reader 服务：http://127.0.0.1:5173/");
  } else {
    run(process.execPath, [npmCli, "run", "build", "-w", "@airnobe/book-format"]);
    run(process.execPath, [npmCli, "run", "build", "-w", "@airnobe/epub-normalizer"]);
    run(process.execPath, [npmCli, "run", "build", "-w", "@airnobe/furigana"]);
    readerProcess = spawn(process.execPath, ["--import", "tsx", readerServer], {
      cwd: resolve(repositoryDirectory, "apps/reader-web"),
      env: childEnvironment,
      stdio: "inherit",
    });
    await waitForReader();
  }

  tauriProcess = spawn(process.execPath, [tauriCli, "dev"], {
    cwd: desktopDirectory,
    env: childEnvironment,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolveExit) => tauriProcess.once("exit", resolveExit));
  stopReader();
  if (!stopping && exitCode !== 0) process.exitCode = typeof exitCode === "number" ? exitCode : 1;
} catch (error) {
  stopChildren();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
