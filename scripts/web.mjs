import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, watch } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadWebConfig } from "./web-config.mjs";

const root = resolve(import.meta.dirname, "..");
const runtime = resolve(root, ".airnobe-web");
mkdirSync(runtime, { recursive: true });
const statePath = resolve(runtime, "session.json");
const action = process.argv[2] || "start";
const noOpen = process.argv.includes("--no-open") || process.env.AIRNOBE_NO_OPEN === "1";
const delay = ms => new Promise(r => setTimeout(r, ms));
function openBrowser(url) {
  if (noOpen) return;
  if (process.platform !== "win32") { console.log(`打开 ${url}`); return; }
  const child = spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Process $env:AIRNOBE_OPEN_URL"], {
    windowsHide: true, stdio: "ignore", env: { ...process.env, AIRNOBE_OPEN_URL: url },
  });
  child.on("error", console.error);
}
async function existingSession() {
  if (!existsSync(statePath)) return undefined;
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  try { process.kill(state.pid, 0); } catch (e) {
    if (e.code !== "ESRCH") throw e;
    unlinkSync(statePath); return undefined;
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const current = JSON.parse(readFileSync(statePath, "utf8"));
    if (current.controlPort) return current;
    await delay(250);
  }
  throw new Error("已有启动任务尚未就绪，请查看 .airnobe-web 日志。");
}
async function main() {
  if (!["start", "stop", "restart", "status"].includes(action)) throw new Error("支持 start、stop、restart、status。");
  const existing = await existingSession();
  if (existing) {
    const response = await fetch(`http://127.0.0.1:${existing.controlPort}/${action}`, {
      method: "POST", headers: { authorization: `Bearer ${existing.token}` }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`服务管理失败：${response.status}`);
    const status = await response.json();
    console.log(status);
    if (action === "start" && status.ready) openBrowser(status.url);
    return;
  }
  if (action === "stop" || action === "status") { console.log("Airnobe 网页服务未运行。"); return; }
  if (!existsSync(resolve(root, "node_modules/tsx/package.json"))) throw new Error("请先在仓库执行 npm ci。");
  const token = randomUUID();
  writeFileSync(statePath, JSON.stringify({ pid: process.pid, token }), { flag: "wx" });
  let child, config, ready = false, stopping = false, busy = false, pending = false, timer;
  const watchers = [];
  const state = () => ({ ready, url: config ? `http://127.0.0.1:${config.port}/` : null, libraryDirectory: config?.libraryDirectory });
  const control = createServer((req, res) => {
    if (req.method !== "POST" || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403).end(); return; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(state()));
    if (req.url === "/stop") void stop();
    if (req.url === "/restart") schedule();
    if (req.url === "/start" && !ready) console.log("已有启动请求，服务就绪后可打开网页。");
  });
  async function terminateChild() {
    const current = child;
    if (!current || current.exitCode !== null) return;
    await new Promise(done => {
      current.once("exit", done);
      current.kill();
    });
  }
  async function stop() {
    if (stopping) return;
    stopping = true; clearTimeout(timer);
    watchers.forEach(w => w.close());
    await terminateChild();
    control.close();
    unlinkSync(statePath);
  }
  function run(args, env = process.env) {
    return new Promise((done, fail) => {
      child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
      child.once("error", fail);
      child.once("exit", code => code === 0 ? done() : fail(new Error(`进程退出：${code}`)));
    });
  }
  async function rebuild() {
    if (busy || stopping) { pending = !stopping; return; }
    busy = true; ready = false;
    try {
      await terminateChild();
      config = loadWebConfig(root);
      console.log(`书库：${config.libraryDirectory}`);
      for (const workspace of ["packages/book-format", "tools/epub-normalizer", "tools/furigana"]) {
        if (stopping) return;
        await run([resolve(root, "node_modules/typescript/bin/tsc"), "-p", `${workspace}/tsconfig.json`]);
      }
      if (stopping) return;
      await run([resolve(root, "apps/desktop/scripts/build-guide-epub.mjs")]);
      if (stopping) return;
      const instance = randomUUID();
      child = spawn(process.execPath, ["--import", "tsx", "apps/reader-web/dev-server.ts"], {
        cwd: root, stdio: "inherit", windowsHide: true,
        env: { ...process.env, AIRNOBE_LIBRARY_DIRECTORY: config.libraryDirectory, AIRNOBE_WEB_PORT: String(config.port), AIRNOBE_WEB_INSTANCE: instance },
      });
      child.on("error", console.error);
      child.on("exit", () => { ready = false; });
      const deadline = Date.now() + 90_000;
      while (!stopping && Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error("网页服务提前退出，请检查端口和上方日志。");
        try {
          const response = await fetch(`${state().url}api/health`, { signal: AbortSignal.timeout(800) });
          const health = await response.json();
          if (health.instance === instance) { ready = true; break; }
        } catch { /* Service is still starting. */ }
        await delay(250);
      }
      if (!ready && !stopping) throw new Error("网页启动超时。");
      if (ready) console.log(`Airnobe 已就绪：${state().url}`);
    } catch (e) { console.error(e); }
    finally { busy = false; if (pending && !stopping) { pending = false; schedule(); } }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => void rebuild(), 600); }
  try {
    config = loadWebConfig(root);
    await new Promise((done, fail) => { control.once("error", fail); control.listen(0, "127.0.0.1", done); });
    writeFileSync(statePath, JSON.stringify({ pid: process.pid, token, controlPort: control.address().port }));
    for (const path of ["packages/book-format/src", "tools/epub-normalizer/src", "tools/furigana/src", "apps/reader-web"]) {
      watchers.push(watch(resolve(root, path), { recursive: true }, (_, filename) => {
        const name = String(filename).replaceAll("\\", "/");
        if (/node_modules|(^|\/)dist\/|\.test\./.test(name)) return;
        if (path === "apps/reader-web" && (name.startsWith("src/") || name === "index.html")) return;
        if (/\.(ts|json)$/.test(name)) schedule();
      }));
    }
    watchers.push(watch(root, (_, filename) => {
      if (["airnobe.local.json", "Airnobe Start.md", "tsconfig.base.json"].includes(String(filename))) schedule();
    }));
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void stop());
    await rebuild();
    if (ready) openBrowser(state().url);
  } catch (e) { await stop(); throw e; }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
