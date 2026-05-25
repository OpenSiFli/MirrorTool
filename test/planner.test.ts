import { describe, expect, test } from "bun:test";

import { buildPlan } from "../src/planner.ts";
import type { RepoConfig } from "../src/types.ts";

const repo: RepoConfig = {
  owner: "OpenSiFli",
  repo: "crosstool-ng",
  manualTags: ["manual-tag"],
  syncedTags: ["already-synced"],
  flushUrl: null,
};

describe("buildPlan", () => {
  test("push mode only enqueues unsynced manual tags", () => {
    const plan = buildPlan([repo], "push", "2026-04-13T00:00:00.000Z");

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

  test("workflow dispatch also only enqueues unsynced manual tags", () => {
    const plan = buildPlan([repo], "workflow_dispatch", "2026-04-13T00:00:00.000Z");

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
});
