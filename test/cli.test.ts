import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { formatCliError, runCli } from "../src/cli.ts";
import type { DownloadReleaseAssetsOptions } from "../src/downloader.ts";
import type { GitHubClient } from "../src/github.ts";
import type { MirrorConfig } from "../src/types.ts";

const config: MirrorConfig = {
  version: 1,
  repos: [
    {
      owner: "OpenSiFli",
      repo: "crosstool-ng",
      manualTags: ["14.2.0-20250221"],
      syncedTags: [],
      flushUrl: null,
      assetNames: null,
      assetTransforms: [],
    },
  ],
};

describe("runCli", () => {
  test("reports required arguments for each subcommand", async () => {
    await expectCliError(["plan"], "Optional argument '--config' is required");
    await expectCliError(["download"], "Optional argument '--owner' is required");

    const { configPath, cleanup } = await writeTempConfig(config);
    try {
      await expectCliError(["apply-state", "--config", configPath], "Optional argument '--tasks-json' is required");
    } finally {
      await cleanup();
    }
  });

  test("parses download JSON options and keeps stdout shape", async () => {
    let downloadOptions: DownloadReleaseAssetsOptions | undefined;
    let stdout = "";

    await runCli(
      [
        "download",
        "--owner",
        "OpenSiFli",
        "--repo",
        "crosstool-ng",
        "--tag",
        "14.2.0-20250221",
        "--output-root",
        ".mirror-work/assets",
        "--asset-names-json",
        "null",
        "--asset-transforms-json",
        JSON.stringify([
          {
            sourceName: "toolchain.7z",
            targetName: "toolchain.zip",
            format: "zip",
          },
        ]),
      ],
      {
        createGitHubClient: () => ({}) as GitHubClient,
        downloadReleaseAssets: async (options) => {
          downloadOptions = options;
          return {
            downloadDirectory: ".mirror-work/assets/OpenSiFli/crosstool-ng/releases/download/14.2.0-20250221",
            prefix: "github_assets/OpenSiFli/crosstool-ng/releases/download/14.2.0-20250221",
            assetCount: 1,
          };
        },
        writeStdout: (text) => {
          stdout += text;
        },
      },
    );

    expect(downloadOptions?.assetNames).toBeNull();
    expect(downloadOptions?.assetTransforms).toEqual([
      {
        sourceName: "toolchain.7z",
        targetName: "toolchain.zip",
        format: "zip",
        removeSource: true,
      },
    ]);
    expect(JSON.parse(stdout)).toEqual({
      downloadDirectory: ".mirror-work/assets/OpenSiFli/crosstool-ng/releases/download/14.2.0-20250221",
      prefix: "github_assets/OpenSiFli/crosstool-ng/releases/download/14.2.0-20250221",
      assetCount: 1,
    });
  });

  test("rejects invalid JSON option values before running a command", async () => {
    await expectCliError(
      [
        "download",
        "--owner",
        "OpenSiFli",
        "--repo",
        "crosstool-ng",
        "--tag",
        "14.2.0-20250221",
        "--output-root",
        ".mirror-work/assets",
        "--asset-names-json",
        "{",
      ],
      "Failed to parse --asset-names-json",
    );
  });

  test("validates tasks JSON and honors the write flag", async () => {
    const { configPath, cleanup } = await writeTempConfig(config);
    let stdout = "";
    try {
      await expectCliError(
        [
          "apply-state",
          "--config",
          configPath,
          "--tasks-json",
          "{}",
        ],
        "Invalid --tasks-json",
      );

      await runCli(
        [
          "apply-state",
          "--config",
          configPath,
          "--tasks-json",
          JSON.stringify([
            {
              owner: "OpenSiFli",
              repo: "crosstool-ng",
              tag: "14.2.0-20250221",
              flushUrl: null,
              assetNames: null,
              assetTransforms: [],
              reason: "manual",
            },
          ]),
          "--write",
        ],
        {
          writeStdout: (text) => {
            stdout += text;
          },
        },
      );

      expect(JSON.parse(stdout).repos[0].syncedTags).toEqual(["14.2.0-20250221"]);
      expect(JSON.parse(await readFile(configPath, "utf8")).repos[0].syncedTags).toEqual(["14.2.0-20250221"]);
    } finally {
      await cleanup();
    }
  });
});

async function expectCliError(args: string[], expectedMessage: string): Promise<void> {
  let message = "";
  try {
    await runCli(args, {
      writeStdout: () => undefined,
    });
  } catch (error) {
    message = formatCliError(error);
  }

  expect(message).toContain(expectedMessage);
}

async function writeTempConfig(value: MirrorConfig): Promise<{ configPath: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), "mirror-cli-test-"));
  const configPath = path.join(directory, "mirror.config.json");
  await writeFile(configPath, JSON.stringify(value), "utf8");

  return {
    configPath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
