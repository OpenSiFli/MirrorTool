#!/usr/bin/env bun

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { applySyncedTasks, readConfig, stringifyConfig, writeConfig } from "./config.ts";
import { downloadReleaseAssets } from "./downloader.ts";
import { GitHubClient, resolveGitHubToken } from "./github.ts";
import { buildPlan } from "./planner.ts";
import type { PlannerMode, Release, SyncTask } from "./types.ts";

const HELP_TEXT = `Usage:
  bun run src/cli.ts plan --config mirror.config.json --mode <push|schedule|workflow_dispatch> [--github-output <path>]
  bun run src/cli.ts download --owner <owner> --repo <repo> --tag <tag> --output-root <dir> [--github-output <path>]
  bun run src/cli.ts apply-state --config mirror.config.json --tasks-json <json> [--write] [--github-output <path>]
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const args = parseArgs(rest);

  switch (command) {
    case "plan":
      await runPlan(args);
      return;
    case "download":
      await runDownload(args);
      return;
    case "apply-state":
      await runApplyState(args);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runPlan(args: ArgMap): Promise<void> {
  const configPath = requireArg(args, "--config");
  const mode = requirePlannerMode(requireArg(args, "--mode"));
  const githubOutput = optionalArg(args, "--github-output");
  const config = await readConfig(configPath);
  const client = new GitHubClient(resolveGitHubToken(process.env));

  const releasesByRepo = new Map<string, Release[]>();
  if (mode !== "push") {
    const releasePairs = await Promise.all(
      config.repos.map(async (repo) => {
        const releases = await client.listReleases(repo.owner, repo.repo);
        return [`${repo.owner}/${repo.repo}`, releases] as const;
      }),
    );

    for (const [repoKey, releases] of releasePairs) {
      releasesByRepo.set(repoKey, releases);
    }
  }

  const plan = buildPlan(config.repos, releasesByRepo, mode);
  if (githubOutput) {
    await appendGitHubOutputs(githubOutput, {
      has_tasks: String(plan.tasks.length > 0),
      task_count: String(plan.tasks.length),
      tasks_json: JSON.stringify(plan.tasks),
    });
  }

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function runDownload(args: ArgMap): Promise<void> {
  const owner = requireArg(args, "--owner");
  const repo = requireArg(args, "--repo");
  const tag = requireArg(args, "--tag");
  const outputRoot = requireArg(args, "--output-root");
  const githubOutput = optionalArg(args, "--github-output");
  const client = new GitHubClient(resolveGitHubToken(process.env));

  const result = await downloadReleaseAssets({
    client,
    owner,
    repo,
    tag,
    outputRoot,
  });

  if (githubOutput) {
    await appendGitHubOutputs(githubOutput, {
      download_directory: result.downloadDirectory,
      prefix: result.prefix,
      asset_count: String(result.assetCount),
    });
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runApplyState(args: ArgMap): Promise<void> {
  const configPath = requireArg(args, "--config");
  const tasksJson = requireArg(args, "--tasks-json");
  const githubOutput = optionalArg(args, "--github-output");
  const write = hasFlag(args, "--write");
  const currentConfig = await readConfig(configPath);
  const tasks = parseTasksJson(tasksJson);
  const nextConfig = applySyncedTasks(currentConfig, tasks);
  const currentText = stringifyConfig(currentConfig);
  const nextText = stringifyConfig(nextConfig);
  const changed = currentText !== nextText;

  if (write && changed) {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeConfig(configPath, nextConfig);
  }

  if (githubOutput) {
    await appendGitHubOutputs(githubOutput, {
      config_changed: String(changed),
    });
  }

  process.stdout.write(nextText);
}

function parseTasksJson(tasksJson: string): SyncTask[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tasksJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse --tasks-json: ${detail}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("--tasks-json must contain a JSON array");
  }

  return parsed.map((task, index) => normalizeTask(task, index));
}

function normalizeTask(task: unknown, index: number): SyncTask {
  if (!isRecord(task)) {
    throw new Error(`tasks[${index}] must be an object`);
  }

  const reason = task.reason;
  if (reason !== "manual" && reason !== "discovered") {
    throw new Error(`tasks[${index}].reason must be "manual" or "discovered"`);
  }

  return {
    owner: requireString(task.owner, `tasks[${index}].owner`),
    repo: requireString(task.repo, `tasks[${index}].repo`),
    tag: requireString(task.tag, `tasks[${index}].tag`),
    flushUrl: normalizeFlushUrl(task.flushUrl, `tasks[${index}].flushUrl`),
    reason,
  };
}

function normalizeFlushUrl(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, fieldName);
}

type ArgMap = Map<string, string | true>;

function parseArgs(args: string[]): ArgMap {
  const parsed = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(arg, true);
      continue;
    }

    parsed.set(arg, next);
    index += 1;
  }

  return parsed;
}

function hasFlag(args: ArgMap, flagName: string): boolean {
  return args.get(flagName) === true;
}

function requireArg(args: ArgMap, name: string): string {
  const value = args.get(name);
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required argument ${name}`);
  }

  return value;
}

function optionalArg(args: ArgMap, name: string): string | undefined {
  const value = args.get(name);
  return typeof value === "string" ? value : undefined;
}

function requirePlannerMode(value: string): PlannerMode {
  if (value === "push" || value === "schedule" || value === "workflow_dispatch") {
    return value;
  }

  throw new Error(`Unsupported planner mode: ${value}`);
}

async function appendGitHubOutputs(outputPath: string, values: Record<string, string>): Promise<void> {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}<<__MIRROR_TOOL__`);
    lines.push(value);
    lines.push("__MIRROR_TOOL__");
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value;
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(detail);
  process.exitCode = 1;
});
