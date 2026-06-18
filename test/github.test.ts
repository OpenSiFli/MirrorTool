import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { GitHubApiError, GitHubClient } from "../src/github.ts";
import type { ReleaseAsset } from "../src/types.ts";

describe("GitHubClient", () => {
  test("maps Octokit release responses to the internal release type", async () => {
    const octokit = {
      rest: {
        repos: {
          getReleaseByTag: async (params: { owner: string; repo: string; tag: string }) => {
            expect(params).toEqual({
              owner: "OpenSiFli",
              repo: "crosstool-ng",
              tag: "14.2.0-20250221",
            });

            return {
              data: {
                tag_name: "14.2.0-20250221",
                draft: false,
                prerelease: false,
                published_at: "2026-04-13T00:00:00Z",
                assets: [
                  {
                    id: 1,
                    name: "toolchain.tar.xz",
                    size: 123,
                    url: "https://api.github.test/assets/1",
                    browser_download_url: "https://github.test/assets/1",
                  },
                ],
              },
            };
          },
        },
      },
    };
    const client = new GitHubClient("token", octokit as never);

    await expect(client.getReleaseByTag("OpenSiFli", "crosstool-ng", "14.2.0-20250221")).resolves.toEqual({
      tagName: "14.2.0-20250221",
      draft: false,
      prerelease: false,
      publishedAt: "2026-04-13T00:00:00Z",
      assets: [
        {
          id: 1,
          name: "toolchain.tar.xz",
          size: 123,
          url: "https://api.github.test/assets/1",
          browserDownloadUrl: "https://github.test/assets/1",
        },
      ],
    });
  });

  test("wraps failed asset downloads in GitHubApiError with status", async () => {
    const originalFetch = globalThis.fetch;
    const directory = await mkdtemp(path.join(tmpdir(), "mirror-github-test-"));
    const asset: ReleaseAsset = {
      id: 1,
      name: "toolchain.tar.xz",
      size: 123,
      url: "https://api.github.test/assets/1",
      browserDownloadUrl: "https://github.test/assets/1",
    };

    globalThis.fetch = (async () =>
      new Response("missing", { status: 404, statusText: "Not Found" })) as unknown as typeof fetch;
    try {
      await expect(new GitHubClient(null).downloadAsset(asset, path.join(directory, asset.name))).rejects.toMatchObject({
        name: "GitHubApiError",
        status: 404,
      });
    } finally {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("wraps Octokit request failures in GitHubApiError with status", async () => {
    const octokit = {
      rest: {
        repos: {
          getReleaseByTag: async () => {
            const error = new Error("Not Found") as Error & { status: number };
            error.status = 404;
            throw error;
          },
        },
      },
    };

    await expect(new GitHubClient(null, octokit as never).getReleaseByTag("OpenSiFli", "missing", "v1")).rejects
      .toBeInstanceOf(GitHubApiError);
    await expect(new GitHubClient(null, octokit as never).getReleaseByTag("OpenSiFli", "missing", "v1")).rejects
      .toMatchObject({ status: 404 });
  });
});
