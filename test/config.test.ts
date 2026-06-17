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
          },
          {
            owner: "OpenSiFli",
            repo: "crosstool-ng",
            manualTags: [],
            syncedTags: [],
            flushUrl: null,
            assetNames: null,
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
        },
      ],
    });

    expect(config.repos[0]?.assetNames).toEqual([
      "toolchain_gnu_linux-aarch64_arm-zephyr-eabi.tar.xz",
      "toolchain_gnu_linux-x86_64_arm-zephyr-eabi.tar.xz",
    ]);
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
        reason: "manual",
      },
    ]);

    expect(nextConfig.repos[0]?.syncedTags).toEqual(["14.2.0-20250221"]);
    expect(stringifyConfig(nextConfig)).toContain('"syncedTags": [');
  });
});
