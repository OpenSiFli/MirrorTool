import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import type { Release, ReleaseAsset } from "./types.ts";

const API_BASE_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "OpenSiFli-MirrorTool";

interface GitHubReleaseAssetResponse {
  id: number;
  name: string;
  size: number;
  url: string;
  browser_download_url: string;
}

interface GitHubReleaseResponse {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GitHubReleaseAssetResponse[];
}

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

  constructor(token: string | null) {
    this.token = token;
  }

  async getReleaseByTag(owner: string, repo: string, tag: string): Promise<Release> {
    const response = await this.requestJson<GitHubReleaseResponse>(
      `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    );

    return mapRelease(response);
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

  private async requestJson<T>(pathname: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${pathname}`, {
      headers: {
        ...this.baseHeaders(),
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new GitHubApiError(
        `GitHub API request failed for ${pathname}: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
        response.status,
      );
    }

    return (await response.json()) as T;
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
