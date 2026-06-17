export interface RepoConfig {
  owner: string;
  repo: string;
  manualTags: string[];
  syncedTags: string[];
  flushUrl: string | null;
  assetNames: string[] | null;
}

export interface MirrorConfig {
  version: 1;
  repos: RepoConfig[];
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  url: string;
  browserDownloadUrl: string;
}

export interface Release {
  tagName: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt: string | null;
  assets: ReleaseAsset[];
}

export type PlannerMode = "push" | "workflow_dispatch";

export interface SyncTask {
  owner: string;
  repo: string;
  tag: string;
  flushUrl: string | null;
  assetNames: string[] | null;
  reason: "manual";
}

export interface PlanResult {
  mode: PlannerMode;
  generatedAt: string;
  tasks: SyncTask[];
}
