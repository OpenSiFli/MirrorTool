export interface RepoConfig {
  owner: string;
  repo: string;
  manualTags: string[];
  syncedTags: string[];
  flushUrl: string | null;
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

export type PlannerMode = "push" | "schedule" | "workflow_dispatch";

export interface SyncTask {
  owner: string;
  repo: string;
  tag: string;
  flushUrl: string | null;
  reason: "manual" | "discovered";
}

export interface PlanResult {
  mode: PlannerMode;
  generatedAt: string;
  tasks: SyncTask[];
}
