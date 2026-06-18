import { describe, expect, test } from "bun:test";

import { applySyncedTasks, normalizeConfig, stringifyConfig } from "../src/config.ts";
import type { MirrorConfig } from "../src/types.ts";

describe("normalizeConfig", () => {
  test("rejects duplicate repositories", () => {
    expect(() =>
      normalizeConfig({
        version: 1,
        repos: [
          {
            owner: "OpenSiFli",
            repo: "crosstool-ng",
            manualTags: [],
            syncedTags: [],
            flushUrl: null,
            assetNames: null,
            assetTransforms: [],
          },
          {
            owner: "OpenSiFli",
            repo: "crosstool-ng",
            manualTags: [],
            syncedTags: [],
            flushUrl: null,
            assetNames: null,
            assetTransforms: [],
          },
        ],
      }),
    ).toThrow("Duplicate repository entry");
  });

  test("rejects duplicate tags inside an array", () => {
    expect(() =>
      normalizeConfig({
        version: 1,
        repos: [
          {
            owner: "OpenSiFli",
            repo: "crosstool-ng",
            manualTags: ["14.2.0-20250221", "14.2.0-20250221"],
            syncedTags: [],
            flushUrl: null,
            assetNames: null,
            assetTransforms: [],
          },
        ],
      }),
    ).toThrow("Duplicate value in repos[0].manualTags");
  });

  test("accepts an optional release asset whitelist", () => {
    const config = normalizeConfig({
      version: 1,
      repos: [
        {
          owner: "zephyrproject-rtos",
          repo: "sdk-ng",
          manualTags: ["v1.0.1"],
          syncedTags: [],
          flushUrl: null,
          assetNames: [
            "toolchain_gnu_linux-x86_64_arm-zephyr-eabi.tar.xz",
            "toolchain_gnu_linux-aarch64_arm-zephyr-eabi.tar.xz",
          ],
          assetTransforms: [],
        },
      ],
    });

    expect(config.repos[0]?.assetNames).toEqual([
      "toolchain_gnu_linux-aarch64_arm-zephyr-eabi.tar.xz",
      "toolchain_gnu_linux-x86_64_arm-zephyr-eabi.tar.xz",
    ]);
  });

  test("accepts archive transform rules", () => {
    const config = normalizeConfig({
      version: 1,
      repos: [
        {
          owner: "zephyrproject-rtos",
          repo: "sdk-ng",
          manualTags: ["v1.0.1"],
          syncedTags: [],
          flushUrl: null,
          assetNames: ["toolchain_gnu_windows-x86_64_arm-zephyr-eabi.7z"],
          assetTransforms: [
            {
              sourceName: "toolchain_gnu_windows-x86_64_arm-zephyr-eabi.7z",
              targetName: "toolchain_gnu_windows-x86_64_arm-zephyr-eabi.zip",
              format: "zip",
            },
          ],
        },
      ],
    });

    expect(config.repos[0]?.assetTransforms).toEqual([
      {
        sourceName: "toolchain_gnu_windows-x86_64_arm-zephyr-eabi.7z",
        targetName: "toolchain_gnu_windows-x86_64_arm-zephyr-eabi.zip",
        format: "zip",
        removeSource: true,
      },
    ]);
  });

  test("rejects unsupported archive transform formats", () => {
    expect(() =>
      normalizeConfig({
        version: 1,
        repos: [
          {
            owner: "zephyrproject-rtos",
            repo: "sdk-ng",
            manualTags: ["v1.0.1"],
            syncedTags: [],
            flushUrl: null,
            assetNames: ["toolchain.7z"],
            assetTransforms: [
              {
                sourceName: "toolchain.7z",
                targetName: "toolchain.tar.xz",
                format: "tar.xz",
              },
            ],
          },
        ],
      }),
    ).toThrow('format must be "zip"');
  });

  test("sorts tags and archive transforms", () => {
    const config = normalizeConfig({
      version: 1,
      repos: [
        {
          owner: "zephyrproject-rtos",
          repo: "sdk-ng",
          manualTags: ["v1.0.2", "v1.0.1"],
          syncedTags: ["v1.0.2", "v1.0.1"],
          flushUrl: null,
          assetNames: null,
          assetTransforms: [
            {
              sourceName: "z.7z",
              targetName: "z.zip",
              format: "zip",
            },
            {
              sourceName: "a.7z",
              targetName: "a.zip",
              format: "zip",
            },
          ],
        },
      ],
    });

    expect(config.repos[0]?.manualTags).toEqual(["v1.0.1", "v1.0.2"]);
    expect(config.repos[0]?.syncedTags).toEqual(["v1.0.1", "v1.0.2"]);
    expect(config.repos[0]?.assetTransforms.map((transform) => transform.targetName)).toEqual(["a.zip", "z.zip"]);
  });

  test("rejects duplicate configured asset names", () => {
    expect(() =>
      normalizeConfig({
        version: 1,
        repos: [
          {
            owner: "zephyrproject-rtos",
            repo: "sdk-ng",
            manualTags: ["v1.0.1"],
            syncedTags: [],
            flushUrl: null,
            assetNames: ["toolchain.tar.xz", "toolchain.tar.xz"],
            assetTransforms: [],
          },
        ],
      }),
    ).toThrow("Duplicate value in repos[0].assetNames");
  });
});

describe("applySyncedTasks", () => {
  test("appends successful tags and keeps a stable JSON layout", () => {
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

    const nextConfig = applySyncedTasks(config, [
      {
        owner: "OpenSiFli",
        repo: "crosstool-ng",
        tag: "14.2.0-20250221",
        flushUrl: null,
        assetNames: null,
        assetTransforms: [],
        reason: "manual",
      },
    ]);

    expect(nextConfig.repos[0]?.syncedTags).toEqual(["14.2.0-20250221"]);
    expect(stringifyConfig(nextConfig)).toContain('"syncedTags": [');
  });
});
