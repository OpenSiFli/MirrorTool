import { describe, expect, test } from "bun:test";

import { buildMirrorPrefix, buildReleaseDirectory } from "../src/downloader.ts";

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
});
