import type { PlanResult, PlannerMode, Release, RepoConfig, SyncTask } from "./types.ts";

export function buildPlan(
  repos: RepoConfig[],
  discoveredReleases: Map<string, Release[]>,
  mode: PlannerMode,
  generatedAt = new Date().toISOString(),
): PlanResult {
  const tasks: SyncTask[] = [];

  for (const repo of repos) {
    const repoKey = `${repo.owner}/${repo.repo}`;
    const syncedTags = new Set(repo.syncedTags);
    const queuedTags = new Set<string>();

    for (const tag of repo.manualTags) {
      if (syncedTags.has(tag) || queuedTags.has(tag)) {
        continue;
      }

      tasks.push({
        owner: repo.owner,
        repo: repo.repo,
        tag,
        flushUrl: repo.flushUrl,
        reason: "manual",
      });
      queuedTags.add(tag);
    }

    if (mode === "push") {
      continue;
    }

    const releases = [...(discoveredReleases.get(repoKey) ?? [])].sort(compareReleases);
    for (const release of releases) {
      if (release.draft || release.prerelease || release.assets.length === 0) {
        continue;
      }

      if (syncedTags.has(release.tagName) || queuedTags.has(release.tagName)) {
        continue;
      }

      tasks.push({
        owner: repo.owner,
        repo: repo.repo,
        tag: release.tagName,
        flushUrl: repo.flushUrl,
        reason: "discovered",
      });
      queuedTags.add(release.tagName);
    }
  }

  return {
    mode,
    generatedAt,
    tasks: tasks.sort(compareTasks),
  };
}

function compareReleases(left: Release, right: Release): number {
  const leftPublishedAt = left.publishedAt ?? "";
  const rightPublishedAt = right.publishedAt ?? "";
  const publishedAtResult = leftPublishedAt.localeCompare(rightPublishedAt);
  if (publishedAtResult !== 0) {
    return publishedAtResult;
  }

  return left.tagName.localeCompare(right.tagName);
}

function compareTasks(left: SyncTask, right: SyncTask): number {
  return `${left.owner}/${left.repo}/${left.tag}`.localeCompare(`${right.owner}/${right.repo}/${right.tag}`);
}
