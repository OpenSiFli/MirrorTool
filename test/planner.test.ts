import { describe, expect, test } from "bun:test";

import { buildPlan } from "../src/planner.ts";
import type { Release, RepoConfig } from "../src/types.ts";

const repo: RepoConfig = {
  owner: "OpenSiFli",
  repo: "crosstool-ng",
  manualTags: ["manual-tag"],
  syncedTags: ["already-synced"],
  flushUrl: null,
};

describe("buildPlan", () => {
  test("push mode only enqueues unsynced manual tags", () => {
    const plan = buildPlan([repo], new Map(), "push", "2026-04-13T00:00:00.000Z");

    expect(plan.tasks).toEqual([
      {
        owner: "OpenSiFli",
        repo: "crosstool-ng",
        tag: "manual-tag",
        flushUrl: null,
        reason: "manual",
      },
    ]);
  });

  test("schedule mode discovers stable releases with assets only", () => {
    const releases: Release[] = [
      {
        tagName: "manual-tag",
        draft: false,
        prerelease: false,
        publishedAt: "2026-04-01T00:00:00Z",
        assets: [{ id: 1, name: "manual.tar.xz", size: 10, url: "https://example.com/1", browserDownloadUrl: "https://example.com/1" }],
      },
      {
        tagName: "draft-tag",
        draft: true,
        prerelease: false,
        publishedAt: "2026-04-02T00:00:00Z",
        assets: [{ id: 2, name: "draft.tar.xz", size: 10, url: "https://example.com/2", browserDownloadUrl: "https://example.com/2" }],
      },
      {
        tagName: "prerelease-tag",
        draft: false,
        prerelease: true,
        publishedAt: "2026-04-03T00:00:00Z",
        assets: [{ id: 3, name: "pre.tar.xz", size: 10, url: "https://example.com/3", browserDownloadUrl: "https://example.com/3" }],
      },
      {
        tagName: "empty-assets",
        draft: false,
        prerelease: false,
        publishedAt: "2026-04-04T00:00:00Z",
        assets: [],
      },
      {
        tagName: "new-stable",
        draft: false,
        prerelease: false,
        publishedAt: "2026-04-05T00:00:00Z",
        assets: [{ id: 4, name: "stable.tar.xz", size: 10, url: "https://example.com/4", browserDownloadUrl: "https://example.com/4" }],
      },
      {
        tagName: "already-synced",
        draft: false,
        prerelease: false,
        publishedAt: "2026-04-06T00:00:00Z",
        assets: [{ id: 5, name: "synced.tar.xz", size: 10, url: "https://example.com/5", browserDownloadUrl: "https://example.com/5" }],
      },
    ];

    const plan = buildPlan(
      [repo],
      new Map([["OpenSiFli/crosstool-ng", releases]]),
      "schedule",
      "2026-04-13T00:00:00.000Z",
    );

    expect(plan.tasks).toEqual([
      {
        owner: "OpenSiFli",
        repo: "crosstool-ng",
        tag: "manual-tag",
        flushUrl: null,
        reason: "manual",
      },
      {
        owner: "OpenSiFli",
        repo: "crosstool-ng",
        tag: "new-stable",
        flushUrl: null,
        reason: "discovered",
      },
    ]);
  });
});
