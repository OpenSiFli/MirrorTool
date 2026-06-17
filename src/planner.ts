import type { PlanResult, PlannerMode, RepoConfig, SyncTask } from "./types.ts";

export function buildPlan(
  repos: RepoConfig[],
  mode: PlannerMode,
  generatedAt = new Date().toISOString(),
): PlanResult {
  const tasks: SyncTask[] = [];

  for (const repo of repos) {
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
        assetNames: repo.assetNames,
        assetTransforms: repo.assetTransforms,
        reason: "manual",
      });
      queuedTags.add(tag);
    }
  }

  return {
    mode,
    generatedAt,
    tasks: tasks.sort(compareTasks),
  };
}

function compareTasks(left: SyncTask, right: SyncTask): number {
  return `${left.owner}/${left.repo}/${left.tag}`.localeCompare(`${right.owner}/${right.repo}/${right.tag}`);
}
