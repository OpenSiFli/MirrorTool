import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import { Octokit, type RestEndpointMethodTypes } from "@octokit/rest";

import type { Release, ReleaseAsset } from "./types.ts";

const API_VERSION = "2022-11-28";
const USER_AGENT = "OpenSiFli-MirrorTool";

type GitHubReleaseResponse = RestEndpointMethodTypes["repos"]["getReleaseByTag"]["response"]["data"];
type GitHubReleaseAssetResponse = GitHubReleaseResponse["assets"][number];

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export class GitHubClient {
  readonly token: string | null;
  private readonly octokit: Octokit;

  constructor(token: string | null, octokit?: Octokit) {
    this.token = token;
    this.octokit = octokit ?? new Octokit({
      auth: token ?? undefined,
      userAgent: USER_AGENT,
      request: {
        headers: {
          "X-GitHub-Api-Version": API_VERSION,
        },
      },
    });
  }

  async getReleaseByTag(owner: string, repo: string, tag: string): Promise<Release> {
    try {
      const response = await this.octokit.rest.repos.getReleaseByTag({
        owner,
        repo,
        tag,
      });
      return mapRelease(response.data);
    } catch (error) {
      throw toGitHubApiError(
        error,
        `GitHub API request failed for /repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      );
    }
  }

  async downloadAsset(asset: ReleaseAsset, destinationPath: string): Promise<void> {
    const response = await fetch(asset.url, {
      headers: {
        ...this.baseHeaders(),
        Accept: "application/octet-stream",
      },
      redirect: "follow",
    });

    if (!response.ok || !response.body) {
      const detail = await safeReadText(response);
      throw new GitHubApiError(
        `Failed to download asset ${asset.name}: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
        response.status,
      );
    }

    await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationPath));
  }

  private baseHeaders(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": API_VERSION,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }
}

export function resolveGitHubToken(environment: NodeJS.ProcessEnv): string | null {
  const rawToken = environment.GH_TOKEN || environment.GITHUB_TOKEN;
  return rawToken?.trim() ? rawToken : null;
}

function mapRelease(response: GitHubReleaseResponse): Release {
  return {
    tagName: response.tag_name,
    draft: response.draft,
    prerelease: response.prerelease,
    publishedAt: response.published_at,
    assets: response.assets.map(mapAsset),
  };
}

function toGitHubApiError(error: unknown, message: string): GitHubApiError {
  if (error instanceof GitHubApiError) {
    return error;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new GitHubApiError(`${message}${detail ? `: ${detail}` : ""}`, readStatus(error));
}

function readStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    return error.status;
  }

  return 0;
}

function mapAsset(asset: GitHubReleaseAssetResponse): ReleaseAsset {
  return {
    id: asset.id,
    name: asset.name,
    size: asset.size,
    url: asset.url,
    browserDownloadUrl: asset.browser_download_url,
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}
