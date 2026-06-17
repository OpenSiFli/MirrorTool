import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { GitHubClient } from "./github.ts";
import type { ReleaseAsset } from "./types.ts";

export interface DownloadReleaseAssetsOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  tag: string;
  outputRoot: string;
  assetNames?: readonly string[] | null;
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
  const assets = selectAssets(release.assets, options.assetNames ?? null);

  if (assets.length === 0) {
    throw new Error(`Release ${owner}/${repo}@${tag} has no assets to mirror`);
  }

  const downloadDirectory = buildReleaseDirectory(outputRoot, owner, repo, tag);
  await rm(downloadDirectory, { recursive: true, force: true });
  await mkdir(downloadDirectory, { recursive: true });

  for (const asset of assets) {
    const fileName = sanitizeAssetName(asset.name);
    const destinationPath = path.join(downloadDirectory, fileName);
    await client.downloadAsset(asset, destinationPath);
  }

  return {
    downloadDirectory,
    prefix: buildMirrorPrefix(owner, repo, tag),
    assetCount: assets.length,
  };
}

export function selectAssets(assets: ReleaseAsset[], assetNames: readonly string[] | null): ReleaseAsset[] {
  if (!assetNames || assetNames.length === 0) {
    return assets;
  }

  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const missing = assetNames.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Release is missing configured asset(s): ${missing.join(", ")}`);
  }

  return assetNames.map((name) => byName.get(name)!);
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
