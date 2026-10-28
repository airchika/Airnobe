import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export function loadWebConfig(root, env = process.env) {
  const path = resolve(root, "airnobe.local.json");
  if (!existsSync(path)) {
    const existing = resolve(root, "AirnobeLibrary");
    const libraryDirectory = existsSync(resolve(existing, "library.json"))
      ? existing : resolve(homedir(), "AirnobeLibrary");
    writeFileSync(path, JSON.stringify({ libraryDirectory, port: 5173 }, null, 2) + "\n", { flag: "wx" });
  }
  const config = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  const libraryDirectory = env.AIRNOBE_LIBRARY_DIRECTORY || config.libraryDirectory;
  const port = Number(env.AIRNOBE_WEB_PORT || config.port || 5173);
  if (typeof libraryDirectory !== "string" || !isAbsolute(libraryDirectory)) {
    throw new Error("airnobe.local.json 的 libraryDirectory 必须是绝对路径。");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("网页端口必须为 1024–65535。");
  return { libraryDirectory: resolve(libraryDirectory), port };
}
