import { describe, expect, test } from "bun:test";

import { buildMirrorPrefix, buildReleaseDirectory, selectAssets } from "../src/downloader.ts";
import type { ReleaseAsset } from "../src/types.ts";

const assets: ReleaseAsset[] = [
  {
    id: 1,
    name: "toolchain_gnu_linux-x86_64_arm-zephyr-eabi.tar.xz",
    size: 1,
    url: "https://api.github.test/assets/1",
    browserDownloadUrl: "https://github.test/assets/1",
  },
  {
    id: 2,
    name: "toolchain_gnu_macos-aarch64_arm-zephyr-eabi.tar.xz",
    size: 1,
    url: "https://api.github.test/assets/2",
    browserDownloadUrl: "https://github.test/assets/2",
  },
];

describe("mirror download paths", () => {
  test("builds the expected COS prefix", () => {
    expect(buildMirrorPrefix("OpenSiFli", "crosstool-ng", "14.2.0-20250221")).toBe(
      "github_assets/OpenSiFli/crosstool-ng/releases/download/14.2.0-20250221",
    );
  });

  test("builds the local working directory for a release", () => {
    expect(buildReleaseDirectory(".mirror-work/assets", "OpenSiFli", "crosstool-ng", "14.2.0-20250221")).toBe(
      ".mirror-work/assets/OpenSiFli/crosstool-ng/releases/download/14.2.0-20250221",
    );
  });

  test("selects only configured release assets when a whitelist is provided", () => {
    expect(selectAssets(assets, ["toolchain_gnu_macos-aarch64_arm-zephyr-eabi.tar.xz"]).map((asset) => asset.name))
      .toEqual(["toolchain_gnu_macos-aarch64_arm-zephyr-eabi.tar.xz"]);
  });

  test("rejects a whitelist that references missing release assets", () => {
    expect(() => selectAssets(assets, ["missing.tar.xz"])).toThrow("Release is missing configured asset");
  });
});
