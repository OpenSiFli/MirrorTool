import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import { ZipFile } from "yazl";

import type { AssetTransform } from "./types.ts";

export interface ApplyAssetTransformsResult {
  outputAssetCountDelta: number;
}

export async function applyAssetTransforms(
  downloadDirectory: string,
  transforms: readonly AssetTransform[],
): Promise<ApplyAssetTransformsResult> {
  let outputAssetCountDelta = 0;

  for (const transform of transforms) {
    const sourceName = sanitizeAssetName(transform.sourceName);
    const targetName = sanitizeAssetName(transform.targetName);
    const root = path.resolve(downloadDirectory);
    const sourcePath = path.join(root, sourceName);
    const targetPath = path.join(root, targetName);

    if (sourcePath === targetPath) {
      throw new Error(`Transformed asset target must differ from source: ${sourceName}`);
    }
    if (transform.format !== "zip") {
      throw new Error(`Unsupported transform format: ${transform.format}`);
    }

    await ensureFileExists(sourcePath, `Transform source asset does not exist: ${sourceName}`);
    await rm(targetPath, { force: true });
    await repackArchiveAsZip(sourcePath, targetPath);

    if (transform.removeSource) {
      await rm(sourcePath, { force: true });
    } else {
      outputAssetCountDelta += 1;
    }
  }

  return { outputAssetCountDelta };
}

export async function repackArchiveAsZip(sourcePath: string, targetPath: string): Promise<void> {
  const tempRoot = await makeTempDirectory(sourcePath);
  const extractDirectory = path.join(tempRoot, "extract");

  try {
    await mkdir(extractDirectory, { recursive: true });
    await extractArchive(sourcePath, extractDirectory);
    await createZipFromDirectory(extractDirectory, targetPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function extractArchive(sourcePath: string, extractDirectory: string): Promise<void> {
  await chmod(path7za, 0o755).catch(() => undefined);
  await runCommand(path7za, ["x", "-y", `-o${extractDirectory}`, sourcePath]);
}

async function createZipFromDirectory(sourceDirectory: string, targetPath: string): Promise<void> {
  const entries = await collectFileEntries(sourceDirectory);
  if (entries.length === 0) {
    throw new Error(`Cannot create zip from empty directory: ${sourceDirectory}`);
  }

  await writeZipFile(sourceDirectory, targetPath, entries);
}

async function collectFileEntries(root: string, current = root): Promise<string[]> {
  const dirents = await readdir(current, { withFileTypes: true });
  const entries: string[] = [];

  for (const dirent of [...dirents].sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(current, dirent.name);
    if (dirent.isDirectory()) {
      entries.push(...await collectFileEntries(root, absolutePath));
      continue;
    }
    if (!dirent.isFile()) {
      throw new Error(`Unsupported non-file entry while creating zip: ${absolutePath}`);
    }

    entries.push(toZipEntryName(path.relative(root, absolutePath)));
  }

  return entries.sort();
}

function toZipEntryName(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

async function ensureFileExists(filePath: string, errorMessage: string): Promise<void> {
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile()) {
      throw new Error(errorMessage);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(errorMessage);
    }
    throw error;
  }
}

async function makeTempDirectory(sourcePath: string): Promise<string> {
  const hash = createHash("sha256").update(sourcePath).digest("hex").slice(0, 12);
  const tempRoot = path.join(os.tmpdir(), `mirror-archive-${hash}-${process.pid}`);
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });
  return tempRoot;
}

type RunOptions = {
  cwd?: string;
};

function runCommand(command: string, args: string[], options: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`exited with ${code}${stderr ? `: ${stderr.trim()}` : stdout ? `: ${stdout.trim()}` : ""}`));
    });

    child.stdin.end();
  });
}

function writeZipFile(sourceDirectory: string, targetPath: string, entries: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const output = createWriteStream(targetPath);
    const stableMtime = new Date(2000, 0, 1, 0, 0, 0);

    output.on("close", resolve);
    output.on("error", reject);
    zip.on("error", reject);
    zip.outputStream.pipe(output);

    for (const entry of entries) {
      zip.addFile(path.join(sourceDirectory, entry), entry, {
        mtime: stableMtime,
        mode: 0o644,
        forceDosTimestamp: true,
      });
    }

    zip.end();
  });
}

function sanitizeAssetName(assetName: string): string {
  const normalized = path.posix.normalize(assetName);
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/")) {
    throw new Error(`Unsupported asset name with path separators: ${assetName}`);
  }

  if (normalized.trim() === "") {
    throw new Error("Release asset name cannot be empty");
  }

  return normalized;
}
