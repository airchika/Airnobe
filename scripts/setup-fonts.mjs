import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  rename,
  rm,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import sevenZipBin from "7zip-bin";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "..");
const fontDirectory = resolve(repositoryDirectory, "Font");
const version = "1.0.40";
const mirrorReleaseDirectory = `Sarasa%20Gothic%2C%20Version%20${version}`;

const families = [
  {
    id: "SC",
    archive: `SarasaGothicSC-TTF-${version}.7z`,
    archiveSha256: "bde7727d6f08e16667dd9a6ee9ad93c399b53da38d2e26dbead8b4b382b71d16",
    files: {
      "SarasaGothicSC-Regular.ttf": "6541a94ad09601b71dff4100360807f4bb2068a0d5fe8b76c71a75e0cb6cf749",
      "SarasaGothicSC-SemiBold.ttf": "d0cc8e7b85d3fcabfdfbf7051eeb7453ee3d7eb77ae5ce8e7a69f5331d12d8d5",
      "SarasaGothicSC-Bold.ttf": "c013b1f06260bde27265346904004d345a45a5f3ca917584d6ea8195c7243886",
    },
  },
  {
    id: "J",
    archive: `SarasaGothicJ-TTF-${version}.7z`,
    archiveSha256: "1eaa4017a1843179469827e6d32fa7a79b57ca2a439df6f99ec5857876ba1071",
    files: {
      "SarasaGothicJ-Regular.ttf": "b78bf108578c62150109c0d6527ea5468a43e18b763ce31c5678fa543613d4e6",
      "SarasaGothicJ-SemiBold.ttf": "4c5675b59829b7db13daa86cb91ed05db872e3deeaaf56e36f6be896e3214b9c",
      "SarasaGothicJ-Bold.ttf": "b74731329fa2545820290227fee51d650133a73cbad3fb1f36b1fa3ccaedd1a8",
    },
  },
];

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function isValidFontSet(directory) {
  try {
    for (const family of families) {
      for (const [name, expected] of Object.entries(family.files)) {
        if (await sha256(resolve(directory, name)) !== expected) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(900_000) });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败：${response.status} ${response.statusText}`);
  }
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  let lastReported = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received - lastReported >= 8 * 1024 * 1024 || received === total) {
        lastReported = received;
        const currentMiB = (received / 1024 / 1024).toFixed(1);
        const totalText = total ? ` / ${(total / 1024 / 1024).toFixed(1)} MiB` : " MiB";
        process.stdout.write(`  ${currentMiB}${totalText}\n`);
      }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(destination));
}

async function downloadVerifiedArchive(family, destination) {
  const urls = [
    `https://mirrors.tuna.tsinghua.edu.cn/github-release/be5invis/Sarasa-Gothic/${mirrorReleaseDirectory}/${family.archive}`,
    `https://github.com/be5invis/Sarasa-Gothic/releases/download/v${version}/${family.archive}`,
  ];
  const errors = [];
  for (const url of urls) {
    try {
      console.log(`正在下载 Sarasa Gothic ${family.id} ${version}：${new URL(url).hostname}`);
      await rm(destination, { force: true });
      await download(url, destination);
      if (await sha256(destination) !== family.archiveSha256) {
        throw new Error("SHA-256 校验失败");
      }
      return;
    } catch (error) {
      errors.push(`${new URL(url).hostname}: ${error instanceof Error ? error.message : String(error)}`);
      console.warn(`字体下载源不可用，准备尝试下一来源。`);
    }
  }
  throw new Error(`无法下载 ${family.archive}：\n${errors.join("\n")}`);
}

async function replaceDirectory(stagedDirectory, targetDirectory, backupDirectory) {
  let hadTarget = false;
  try {
    await access(targetDirectory);
    hadTarget = true;
  } catch {
    // The target does not exist in a clean clone.
  }

  if (hadTarget) await rename(targetDirectory, backupDirectory);
  try {
    await rename(stagedDirectory, targetDirectory);
  } catch (error) {
    if (hadTarget) await rename(backupDirectory, targetDirectory);
    throw error;
  }
  if (hadTarget) await rm(backupDirectory, { recursive: true, force: true });
}

if (await isValidFontSet(fontDirectory)) {
  console.log(`Sarasa Gothic ${version} 字体已就绪。`);
  process.exit(0);
}

const nonce = `${process.pid}-${randomUUID()}`;
const workingDirectory = resolve(repositoryDirectory, `.airnobe-font-setup-${nonce}`);
const stagedFontDirectory = resolve(workingDirectory, "Font");
const backupDirectory = resolve(repositoryDirectory, `.airnobe-font-backup-${nonce}`);

try {
  await mkdir(stagedFontDirectory, { recursive: true });
  for (const family of families) {
    const archivePath = resolve(workingDirectory, family.archive);
    await downloadVerifiedArchive(family, archivePath);
    execFileSync(sevenZipBin.path7za, [
      "e",
      archivePath,
      ...Object.keys(family.files),
      `-o${stagedFontDirectory}`,
      "-y",
    ], { stdio: "inherit" });
  }

  if (!await isValidFontSet(stagedFontDirectory)) {
    throw new Error("提取后的字体缺失或 SHA-256 校验失败。");
  }

  await replaceDirectory(stagedFontDirectory, fontDirectory, backupDirectory);
  console.log(`已准备 Sarasa Gothic ${version} 的 6 个构建字体。`);
} finally {
  await rm(workingDirectory, { recursive: true, force: true });
}
