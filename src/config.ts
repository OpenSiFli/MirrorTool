import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeConfig as normalizeMirrorConfig } from "./schema.ts";
import type { MirrorConfig, SyncTask } from "./types.ts";

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
  try {
    return normalizeMirrorConfig(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(detail);
  }
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
