import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MirrorConfig, RepoConfig, SyncTask } from "./types.ts";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export async function readConfig(configPath: string): Promise<MirrorConfig> {
  const raw = await readFile(configPath, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to parse ${configPath}: ${detail}`);
  }

  return normalizeConfig(parsed);
}

export function normalizeConfig(input: unknown): MirrorConfig {
  if (!isRecord(input)) {
    throw new ConfigError("mirror.config.json must contain a JSON object");
  }

  if (input.version !== 1) {
    throw new ConfigError("mirror.config.json version must be 1");
  }

  if (!Array.isArray(input.repos)) {
    throw new ConfigError("mirror.config.json repos must be an array");
  }

  const seenRepos = new Set<string>();
  const repos = input.repos.map((repo, index) => normalizeRepo(repo, index, seenRepos));

  return {
    version: 1,
    repos: repos.sort(compareRepos),
  };
}

function normalizeRepo(input: unknown, index: number, seenRepos: Set<string>): RepoConfig {
  if (!isRecord(input)) {
    throw new ConfigError(`repos[${index}] must be an object`);
  }

  const owner = requireNonEmptyString(input.owner, `repos[${index}].owner`);
  const repo = requireNonEmptyString(input.repo, `repos[${index}].repo`);
  const repoKey = `${owner}/${repo}`;
  if (seenRepos.has(repoKey)) {
    throw new ConfigError(`Duplicate repository entry: ${repoKey}`);
  }
  seenRepos.add(repoKey);

  const manualTags = normalizeStringArray(input.manualTags, `repos[${index}].manualTags`);
  const syncedTags = normalizeStringArray(input.syncedTags, `repos[${index}].syncedTags`);
  const flushUrl = normalizeNullableString(input.flushUrl, `repos[${index}].flushUrl`);

  return {
    owner,
    repo,
    manualTags: [...manualTags].sort(),
    syncedTags: [...syncedTags].sort(),
    flushUrl,
  };
}

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${fieldName} must be an array of strings`);
  }

  const seen = new Set<string>();
  return value.map((entry, index) => {
    const tag = requireNonEmptyString(entry, `${fieldName}[${index}]`);
    if (seen.has(tag)) {
      throw new ConfigError(`Duplicate value in ${fieldName}: ${tag}`);
    }
    seen.add(tag);
    return tag;
  });
}

function normalizeNullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNonEmptyString(value, fieldName);
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${fieldName} must be a non-empty string`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function compareRepos(left: RepoConfig, right: RepoConfig): number {
  return `${left.owner}/${left.repo}`.localeCompare(`${right.owner}/${right.repo}`);
}

export async function writeConfig(configPath: string, config: MirrorConfig): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, stringifyConfig(config), "utf8");
}

export function stringifyConfig(config: MirrorConfig): string {
  return `${JSON.stringify(normalizeConfig(config), null, 2)}\n`;
}

export function applySyncedTasks(config: MirrorConfig, tasks: SyncTask[]): MirrorConfig {
  const repoToTags = new Map<string, Set<string>>();

  for (const task of tasks) {
    const key = `${task.owner}/${task.repo}`;
    const tags = repoToTags.get(key) ?? new Set<string>();
    tags.add(task.tag);
    repoToTags.set(key, tags);
  }

  return normalizeConfig({
    version: 1,
    repos: config.repos.map((repo) => {
      const key = `${repo.owner}/${repo.repo}`;
      const taskTags = repoToTags.get(key);
      if (!taskTags) {
        return repo;
      }

      return {
        ...repo,
        syncedTags: Array.from(new Set([...repo.syncedTags, ...taskTags])),
      };
    }),
  });
}
