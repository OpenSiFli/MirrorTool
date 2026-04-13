import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { GitHubClient } from "./github.ts";

export interface DownloadReleaseAssetsOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  tag: string;
  outputRoot: string;
}

export interface DownloadReleaseAssetsResult {
  downloadDirectory: string;
  prefix: string;
  assetCount: number;
}

export async function downloadReleaseAssets(
  options: DownloadReleaseAssetsOptions,
): Promise<DownloadReleaseAssetsResult> {
  const { client, owner, repo, tag, outputRoot } = options;
  const release = await client.getReleaseByTag(owner, repo, tag);

  if (release.assets.length === 0) {
    throw new Error(`Release ${owner}/${repo}@${tag} has no assets to mirror`);
  }

  const downloadDirectory = buildReleaseDirectory(outputRoot, owner, repo, tag);
  await rm(downloadDirectory, { recursive: true, force: true });
  await mkdir(downloadDirectory, { recursive: true });

  for (const asset of release.assets) {
    const fileName = sanitizeAssetName(asset.name);
    const destinationPath = path.join(downloadDirectory, fileName);
    await client.downloadAsset(asset, destinationPath);
  }

  return {
    downloadDirectory,
    prefix: buildMirrorPrefix(owner, repo, tag),
    assetCount: release.assets.length,
  };
}

export function buildMirrorPrefix(owner: string, repo: string, tag: string): string {
  return `github_assets/${owner}/${repo}/releases/download/${tag}`;
}

export function buildReleaseDirectory(outputRoot: string, owner: string, repo: string, tag: string): string {
  return path.join(outputRoot, owner, repo, "releases", "download", tag);
}

function sanitizeAssetName(assetName: string): string {
  const normalized = path.posix.normalize(assetName);
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/")) {
    throw new Error(`Unsupported asset name with path separators: ${assetName}`);
  }

  if (normalized.trim() === "") {
    throw new Error("Release asset name cannot be empty");
  }

  return normalized;
}
