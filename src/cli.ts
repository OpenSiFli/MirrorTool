#!/usr/bin/env bun

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { cli, define } from "gunshi";

import {
  applySyncedTasks as applySyncedTasksDefault,
  readConfig as readConfigDefault,
  stringifyConfig,
  writeConfig as writeConfigDefault,
} from "./config.ts";
import { downloadReleaseAssets as downloadReleaseAssetsDefault } from "./downloader.ts";
import { GitHubClient, resolveGitHubToken } from "./github.ts";
import { buildPlan as buildPlanDefault } from "./planner.ts";
import {
  normalizeAssetNames,
  normalizeAssetTransforms,
  normalizePlannerMode,
  normalizeSyncTasks,
} from "./schema.ts";

const HELP_TEXT = `Usage:
  bun run src/cli.ts plan --config mirror.config.json --mode <push|workflow_dispatch> [--github-output <path>]
  bun run src/cli.ts download --owner <owner> --repo <repo> --tag <tag> --output-root <dir> [--asset-names-json <json>] [--asset-transforms-json <json>] [--github-output <path>]
  bun run src/cli.ts apply-state --config mirror.config.json --tasks-json <json> [--write] [--github-output <path>]
`;

const COMMAND_NAMES = new Set(["plan", "download", "apply-state"]);
const PLANNER_MODES = ["push", "workflow_dispatch"] as const;

export interface CliDependencies {
  applySyncedTasks: typeof applySyncedTasksDefault;
  buildPlan: typeof buildPlanDefault;
  createGitHubClient: () => GitHubClient;
  downloadReleaseAssets: typeof downloadReleaseAssetsDefault;
  readConfig: typeof readConfigDefault;
  writeConfig: typeof writeConfigDefault;
  writeStdout: (text: string) => void;
}

export function createDefaultDependencies(): CliDependencies {
  return {
    applySyncedTasks: applySyncedTasksDefault,
    buildPlan: buildPlanDefault,
    createGitHubClient: () => new GitHubClient(resolveGitHubToken(process.env)),
    downloadReleaseAssets: downloadReleaseAssetsDefault,
    readConfig: readConfigDefault,
    writeConfig: writeConfigDefault,
    writeStdout: (text) => {
      process.stdout.write(text);
    },
  };
}

export async function runCli(
  args = process.argv.slice(2),
  dependencyOverrides: Partial<CliDependencies> = {},
): Promise<void> {
  const dependencies = {
    ...createDefaultDependencies(),
    ...dependencyOverrides,
  };

  if (!args[0] || args[0] === "--help" || args[0] === "-h") {
    dependencies.writeStdout(HELP_TEXT);
    return;
  }

  if (!COMMAND_NAMES.has(args[0])) {
    throw new Error(`Unknown command: ${args[0]}`);
  }

  await cli(args, define({ name: "mirror-tool" }), {
    name: "mirror-tool",
    subCommands: createCommands(dependencies),
    renderHeader: null,
    renderValidationErrors: null,
  });
}

function createCommands(dependencies: CliDependencies) {
  return {
    plan: define({
      name: "plan",
      description: "Build the mirror task plan",
      toKebab: true,
      args: {
        config: {
          type: "string",
          required: true,
          description: "Path to mirror.config.json",
        },
        mode: {
          type: "enum",
          choices: PLANNER_MODES,
          required: true,
          description: "Planner mode",
        },
        githubOutput: {
          type: "string",
          description: "Path to the GitHub Actions output file",
        },
      },
      run: async (ctx) => {
        const configPath = ctx.values.config;
        const mode = normalizePlannerMode(ctx.values.mode);
        const githubOutput = ctx.values.githubOutput;
        const config = await dependencies.readConfig(configPath);

        const plan = dependencies.buildPlan(config.repos, mode);
        if (githubOutput) {
          await appendGitHubOutputs(githubOutput, {
            has_tasks: String(plan.tasks.length > 0),
            task_count: String(plan.tasks.length),
            tasks_json: JSON.stringify(plan.tasks),
          });
        }

        dependencies.writeStdout(`${JSON.stringify(plan, null, 2)}\n`);
      },
    }),
    download: define({
      name: "download",
      description: "Download release assets",
      toKebab: true,
      args: {
        owner: {
          type: "string",
          required: true,
          description: "GitHub repository owner",
        },
        repo: {
          type: "string",
          required: true,
          description: "GitHub repository name",
        },
        tag: {
          type: "string",
          required: true,
          description: "GitHub release tag",
        },
        outputRoot: {
          type: "string",
          required: true,
          description: "Root directory for downloaded assets",
        },
        assetNamesJson: {
          type: "custom",
          parse: (value: string) => parseJsonArg(value, "--asset-names-json", (input) =>
            normalizeAssetNames(input, "--asset-names-json")),
          metavar: "json",
          description: "JSON release asset name whitelist",
        },
        assetTransformsJson: {
          type: "custom",
          parse: (value: string) => parseJsonArg(value, "--asset-transforms-json", (input) =>
            normalizeAssetTransforms(input, "--asset-transforms-json")),
          metavar: "json",
          description: "JSON archive transform rules",
        },
        githubOutput: {
          type: "string",
          description: "Path to the GitHub Actions output file",
        },
      },
      run: async (ctx) => {
        const client = dependencies.createGitHubClient();
        const result = await dependencies.downloadReleaseAssets({
          client,
          owner: ctx.values.owner,
          repo: ctx.values.repo,
          tag: ctx.values.tag,
          outputRoot: ctx.values.outputRoot,
          assetNames: ctx.values.assetNamesJson ?? null,
          assetTransforms: ctx.values.assetTransformsJson ?? [],
        });

        if (ctx.values.githubOutput) {
          await appendGitHubOutputs(ctx.values.githubOutput, {
            download_directory: result.downloadDirectory,
            prefix: result.prefix,
            asset_count: String(result.assetCount),
          });
        }

        dependencies.writeStdout(`${JSON.stringify(result, null, 2)}\n`);
      },
    }),
    "apply-state": define({
      name: "apply-state",
      description: "Apply synced tags to the mirror config",
      toKebab: true,
      args: {
        config: {
          type: "string",
          required: true,
          description: "Path to mirror.config.json",
        },
        tasksJson: {
          type: "custom",
          required: true,
          parse: (value: string) => parseJsonArg(value, "--tasks-json", normalizeSyncTasks),
          metavar: "json",
          description: "JSON sync tasks",
        },
        write: {
          type: "boolean",
          description: "Write the updated config to disk",
        },
        githubOutput: {
          type: "string",
          description: "Path to the GitHub Actions output file",
        },
      },
      run: async (ctx) => {
        const configPath = ctx.values.config;
        const currentConfig = await dependencies.readConfig(configPath);
        const tasks = ctx.values.tasksJson;
        const nextConfig = dependencies.applySyncedTasks(currentConfig, tasks);
        const currentText = stringifyConfig(currentConfig);
        const nextText = stringifyConfig(nextConfig);
        const changed = currentText !== nextText;

        if (ctx.values.write === true && changed) {
          await dependencies.writeConfig(configPath, nextConfig);
        }

        if (ctx.values.githubOutput) {
          await appendGitHubOutputs(ctx.values.githubOutput, {
            config_changed: String(changed),
          });
        }

        dependencies.writeStdout(nextText);
      },
    }),
  };
}

function parseJsonArg<T>(value: string, argName: string, normalize: (input: unknown) => T): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${argName}: ${detail}`);
  }

  try {
    return normalize(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${argName}: ${detail}`);
  }
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

export function formatCliError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map(formatCliError).join("\n");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

if (import.meta.main) {
  runCli().catch((error) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}
