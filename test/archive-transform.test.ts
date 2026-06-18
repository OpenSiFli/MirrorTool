import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { ZipFile } from "yazl";

import { repackArchiveAsZip } from "../src/archive-transform.ts";

describe("repackArchiveAsZip", () => {
  test("cleans up mkdtemp directories when archive extraction fails", async () => {
    const before = await listMirrorArchiveTempDirs();
    const directory = await mkdtemp(path.join(tmpdir(), "mirror-repack-test-"));
    const sourcePath = path.join(directory, "empty.zip");
    try {
      await writeEmptyDirectoryZip(sourcePath);
      await expect(repackArchiveAsZip(sourcePath, path.join(directory, "out.zip"))).rejects
        .toThrow("Cannot create zip from empty directory");

      const after = await listMirrorArchiveTempDirs();
      expect(Array.from(after).filter((name) => !before.has(name))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);
});

async function listMirrorArchiveTempDirs(): Promise<Set<string>> {
  const names = await readdir(tmpdir());
  return new Set(names.filter((name) => name.startsWith("mirror-archive-")));
}

function writeEmptyDirectoryZip(targetPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const output = createWriteStream(targetPath);

    output.on("close", resolve);
    output.on("error", reject);
    zip.on("error", reject);
    zip.outputStream.pipe(output);
    zip.addEmptyDirectory("empty");
    zip.end();
  });
}
